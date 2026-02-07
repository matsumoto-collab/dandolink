'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Project, DEFAULT_CONSTRUCTION_TYPE_COLORS, CONSTRUCTION_CONTENT_LABELS, ConstructionContentType, DailySchedule, WorkSchedule } from '@/types/calendar';
import { Customer } from '@/types/customer';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { formatDateKey } from '@/utils/employeeUtils';
import { isManagerOrAbove } from '@/utils/permissions';
import MultiDayScheduleEditor from './MultiDayScheduleEditor';
import { User, Search } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import { v4 as uuidv4 } from 'uuid';

interface ManagerUser {
    id: string;
    displayName: string;
    role: string;
    isActive: boolean;
}

interface ProjectFormProps {
    initialData?: Partial<Project>;
    onSubmit: (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => void;
    onCancel: () => void;
    defaultDate?: Date;
    defaultEmployeeId?: string;
    isSaving?: boolean;
}

export default function ProjectForm({
    initialData,
    onSubmit,
    onCancel,
    defaultDate,
    defaultEmployeeId,
    isSaving = false,
}: ProjectFormProps) {
    const { projects } = useProjects();
    const { vehicles: mockVehicles, constructionTypes, totalMembers: TOTAL_MEMBERS } = useMasterData();
    const { getForemanName } = useCalendarDisplay();

    const [formData, setFormData] = useState({
        title: initialData?.title || '',
        customer: initialData?.customer || '',
        customerId: '', // 顧客ID追加
        selectedManagers: Array.isArray(initialData?.createdBy)
            ? initialData.createdBy
            : initialData?.createdBy
                ? [initialData.createdBy]
                : [], // 案件担当者(複数選択)
        memberCount: initialData?.workers?.length || 0, // メンバー数
        selectedVehicles: initialData?.isDispatchConfirmed && initialData?.confirmedVehicleIds?.length
            ? initialData.confirmedVehicleIds.map(id => mockVehicles.find(v => v.id === id)?.name).filter((n): n is string => !!n)
            : initialData?.trucks || [],
        // 工事種別（単一選択 - IDまたはレガシーコードで保存）
        constructionType: initialData?.constructionType || '',
        // 工事内容
        constructionContent: initialData?.constructionContent || '' as ConstructionContentType | '',
        remarks: initialData?.remarks || '',
    });

    // 複数日スケジュール管理用の状態
    const [useMultiDaySchedule, setUseMultiDaySchedule] = useState(false);
    const [assemblySchedules, setAssemblySchedules] = useState<DailySchedule[]>([]);
    const [demolitionSchedules, setDemolitionSchedules] = useState<DailySchedule[]>([]);

    // 顧客選択用のstate
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearchTerm, setCustomerSearchTerm] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

    // Admin/Manager users for project manager selection (from API)
    const [apiManagers, setApiManagers] = useState<ManagerUser[]>([]);
    const [isLoadingManagers, setIsLoadingManagers] = useState(true);

    // 顧客一覧を取得
    useEffect(() => {
        const fetchCustomers = async () => {
            try {
                const res = await fetch('/api/customers');
                if (res.ok) {
                    const data = await res.json();
                    setCustomers(data);
                }
            } catch (error) {
                console.error('Failed to fetch customers:', error);
            }
        };
        fetchCustomers();
    }, []);

    // 顧客検索フィルタリング
    const filteredCustomers = useMemo(() => {
        if (!customerSearchTerm) return customers;
        const lowerTerm = customerSearchTerm.toLowerCase();
        return customers.filter(c =>
            c.name.toLowerCase().includes(lowerTerm) ||
            c.shortName?.toLowerCase().includes(lowerTerm)
        );
    }, [customers, customerSearchTerm]);

    // Fetch admin/manager users from API
    useEffect(() => {
        const fetchManagers = async () => {
            setIsLoadingManagers(true);
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const users = await res.json();
                    // Filter only admin and manager roles
                    const filtered = users.filter((u: ManagerUser) =>
                        isManagerOrAbove(u)
                    );
                    setApiManagers(filtered);
                }
            } catch (error) {
                console.error('Failed to fetch managers:', error);
            } finally {
                setIsLoadingManagers(false);
            }
        };
        fetchManagers();
    }, []);

    // 残りのメンバー数を計算
    const availableMembers = useMemo(() => {
        const targetDate = initialData?.startDate || defaultDate || new Date();
        const dateKey = formatDateKey(targetDate);

        // 同じ日付の全案件を取得
        const sameDateProjects = projects.filter(p => {
            const pDateKey = formatDateKey(p.startDate);
            return pDateKey === dateKey && p.id !== initialData?.id;
        });

        // 使用中のメンバー数を合計
        const usedMembers = sameDateProjects.reduce((sum, p) => {
            return sum + (p.workers?.length || 0);
        }, 0);

        // 総メンバー数（マスターデータから取得）
        return TOTAL_MEMBERS - usedMembers;
    }, [projects, initialData, defaultDate, TOTAL_MEMBERS]);

    // 選択中の工事種別名を取得（マスターデータのIDからnameを解決）
    const selectedConstructionTypeName = useMemo(() => {
        const ct = constructionTypes.find(t => t.id === formData.constructionType);
        // マスターデータにあればname、なければレガシーコード（assembly/demolition/other）をそのまま使用
        return ct?.name || formData.constructionType;
    }, [constructionTypes, formData.constructionType]);

    // 車両使用状況を計算（同日の他案件で使用中の車両を取得）
    const vehicleUsageMap = useMemo(() => {
        const targetDate = initialData?.startDate || defaultDate || new Date();
        const dateKey = formatDateKey(targetDate);

        // 同日の他案件を取得（編集時は自分自身を除外）
        const sameDateProjects = projects.filter(p => {
            const pDateKey = formatDateKey(p.startDate);
            return pDateKey === dateKey && p.id !== initialData?.id;
        });

        // Map<車両名, { projectTitle, foremanName }[]>
        const usageMap = new Map<string, { projectTitle: string; foremanName: string }[]>();

        for (const p of sameDateProjects) {
            const vehicles = p.trucks || p.vehicles || [];
            const foremanName = getForemanName(p.assignedEmployeeId || '');
            for (const vehicleName of vehicles) {
                if (!usageMap.has(vehicleName)) {
                    usageMap.set(vehicleName, []);
                }
                usageMap.get(vehicleName)!.push({
                    projectTitle: p.title,
                    foremanName: foremanName || '不明',
                });
            }
        }

        return usageMap;
    }, [projects, initialData, defaultDate, getForemanName]);

    // 手配確定済み車両IDセットを計算（同日の確定済み案件から）
    const confirmedVehicleIdSet = useMemo(() => {
        const targetDate = initialData?.startDate || defaultDate || new Date();
        const dateKey = formatDateKey(targetDate);

        const confirmed = new Set<string>();
        projects.forEach(p => {
            const pDateKey = formatDateKey(p.startDate);
            if (pDateKey === dateKey && p.id !== initialData?.id && p.isDispatchConfirmed) {
                p.confirmedVehicleIds?.forEach(id => confirmed.add(id));
            }
        });
        return confirmed;
    }, [projects, initialData, defaultDate]);

    // 車両リストをソート: 手配確定済み → その他
    const sortedVehicles = useMemo(() => {
        return [...mockVehicles].sort((a, b) => {
            const aConfirmed = confirmedVehicleIdSet.has(a.id) ? 0 : 1;
            const bConfirmed = confirmedVehicleIdSet.has(b.id) ? 0 : 1;
            return aConfirmed - bConfirmed;
        });
    }, [mockVehicles, confirmedVehicleIdSet]);

    const handleVehicleToggle = (vehicleName: string) => {
        setFormData(prev => ({
            ...prev,
            selectedVehicles: prev.selectedVehicles.includes(vehicleName)
                ? prev.selectedVehicles.filter(v => v !== vehicleName)
                : [...prev.selectedVehicles, vehicleName]
        }));
    };

    const handleManagerToggle = (managerName: string) => {
        setFormData(prev => ({
            ...prev,
            selectedManagers: prev.selectedManagers.includes(managerName)
                ? prev.selectedManagers.filter(m => m !== managerName)
                : [...prev.selectedManagers, managerName]
        }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        // メンバー数分のダミー配列を作成
        const workers = formData.memberCount > 0
            ? Array.from({ length: formData.memberCount }, (_, i) => `メンバー${i + 1}`)
            : undefined;

        // 日程はカレンダーの日付を使用
        const startDate = initialData?.startDate || defaultDate || new Date();

        // 色の決定: マスターデータから取得、なければデフォルト
        const selectedType = constructionTypes.find(ct => ct.id === formData.constructionType);
        const color = selectedType?.color || DEFAULT_CONSTRUCTION_TYPE_COLORS[formData.constructionType] || '#a8c8e8';

        // 複数日スケジュールを使用する場合
        let workSchedules: WorkSchedule[] | undefined = undefined;
        if (useMultiDaySchedule) {
            workSchedules = [];
            if ((selectedConstructionTypeName === '組立' || formData.constructionType === 'assembly') && assemblySchedules.length > 0) {
                workSchedules.push({
                    id: uuidv4(),
                    type: 'assembly',
                    dailySchedules: assemblySchedules,
                });
            }
            if ((selectedConstructionTypeName === '解体' || formData.constructionType === 'demolition') && demolitionSchedules.length > 0) {
                workSchedules.push({
                    id: uuidv4(),
                    type: 'demolition',
                    dailySchedules: demolitionSchedules,
                });
            }
        }

        const projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
            title: formData.title,
            customer: formData.customer || undefined,
            createdBy: formData.selectedManagers.length > 0 ? formData.selectedManagers : undefined,
            startDate: startDate,
            assignedEmployeeId: initialData?.assignedEmployeeId || defaultEmployeeId || 'unassigned',
            workers: workers,
            trucks: formData.selectedVehicles.length > 0 ? formData.selectedVehicles : undefined,
            vehicles: formData.selectedVehicles.length > 0 ? formData.selectedVehicles : undefined,
            // 工事種別
            constructionType: formData.constructionType,
            // 工事内容
            constructionContent: formData.constructionContent || undefined,
            // 複数日スケジュール
            workSchedules: workSchedules,
            color: color,
            remarks: formData.remarks || undefined,
        };

        onSubmit(projectData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* 現場名 */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    現場名 <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 帝人"
                />
            </div>

            {/* 元請名（顧客選択） */}
            <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    元請名
                </label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        value={customerSearchTerm || formData.customer}
                        onChange={(e) => {
                            setCustomerSearchTerm(e.target.value);
                            setShowCustomerDropdown(true);
                            // 入力値をそのままcustomerにもセット（新規入力の場合など）
                            setFormData({ ...formData, customer: e.target.value });
                        }}
                        onFocus={() => setShowCustomerDropdown(true)}
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="顧客を検索または入力..."
                    />
                </div>

                {showCustomerDropdown && filteredCustomers.length > 0 && customerSearchTerm && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                        {filteredCustomers.map(customer => (
                            <button
                                key={customer.id}
                                type="button"
                                onClick={() => {
                                    setFormData({
                                        ...formData,
                                        customerId: customer.id, // IDを保存
                                        customer: customer.name, // 名前を表示用に保存
                                    });
                                    setCustomerSearchTerm(''); // 検索語をクリア（表示はformData.customer優先）
                                    setShowCustomerDropdown(false);
                                }}
                                className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                            >
                                <span>{customer.name}</span>
                                {customer.shortName && (
                                    <span className="text-sm text-gray-500">({customer.shortName})</span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* 工事種別（ラジオボタン） */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    工事種別 <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-3 border border-gray-200 rounded-md p-4">
                    {constructionTypes.length > 0 ? (
                        constructionTypes.map((type) => {
                            // 明るい背景色を生成（色に透明度を追加）
                            const bgColor = `${type.color}30`;
                            // テキスト色（暗めの色を生成）
                            const textColor = type.color;

                            return (
                                <label key={type.id} className="flex items-center space-x-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="constructionType"
                                        checked={formData.constructionType === type.id}
                                        onChange={() => setFormData({ ...formData, constructionType: type.id })}
                                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <span
                                        className="text-sm font-medium px-3 py-1 rounded-full"
                                        style={{
                                            backgroundColor: bgColor,
                                            color: textColor,
                                            border: `2px solid ${type.color}`
                                        }}
                                    >
                                        {type.name}
                                    </span>
                                </label>
                            );
                        })
                    ) : (
                        <p className="text-sm text-gray-500">
                            設定の「工事種別」から種別を追加してください
                        </p>
                    )}
                </div>
            </div>

            {/* 工事内容 */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    工事内容
                </label>
                <div className="flex flex-wrap gap-2 border border-gray-200 rounded-md p-3">
                    {(Object.entries(CONSTRUCTION_CONTENT_LABELS) as [ConstructionContentType, string][]).map(([value, label]) => (
                        <label key={value} className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="radio"
                                name="constructionContent"
                                checked={formData.constructionContent === value}
                                onChange={() => setFormData({ ...formData, constructionContent: value })}
                                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{label}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* 複数日スケジュール管理 */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                        複数日スケジュール管理
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={useMultiDaySchedule}
                            onChange={(e) => setUseMultiDaySchedule(e.target.checked)}
                            className="w-4 h-4 text-slate-600 border-gray-300 rounded focus:ring-slate-500"
                        />
                        <span className="text-sm text-gray-600">複数日の作業を登録</span>
                    </label>
                </div>

                {useMultiDaySchedule && (
                    <div className="space-y-4 border border-gray-200 rounded-md p-4 bg-gray-50">
                        {/* 組立スケジュール */}
                        {(selectedConstructionTypeName === '組立' || formData.constructionType === 'assembly') && (
                            <div className="bg-white p-4 rounded-lg border border-blue-200">
                                <h3 className="text-lg font-semibold text-blue-700 mb-3">組立スケジュール</h3>
                                <MultiDayScheduleEditor
                                    type="assembly"
                                    dailySchedules={assemblySchedules}
                                    onChange={setAssemblySchedules}
                                />
                            </div>
                        )}

                        {/* 解体スケジュール */}
                        {(selectedConstructionTypeName === '解体' || formData.constructionType === 'demolition') && (
                            <div className="bg-white p-4 rounded-lg border border-red-200">
                                <h3 className="text-lg font-semibold text-red-700 mb-3">解体スケジュール</h3>
                                <MultiDayScheduleEditor
                                    type="demolition"
                                    dailySchedules={demolitionSchedules}
                                    onChange={setDemolitionSchedules}
                                />
                            </div>
                        )}

                        {(selectedConstructionTypeName === 'その他' || formData.constructionType === 'other') && (
                            <p className="text-sm text-gray-500 text-center py-4">
                                「その他」は複数日スケジュールに対応していません
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* 案件担当者（チェックボックス） */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    <User className="inline w-4 h-4 mr-1" />
                    案件担当者
                </label>
                <div className="flex flex-wrap gap-2 border border-gray-200 rounded-md p-3 min-h-[60px]">
                    {isLoadingManagers ? (
                        <div className="flex items-center gap-2 text-gray-500">
                            <ButtonLoading />
                            <span className="text-sm">担当者を読み込み中...</span>
                        </div>
                    ) : apiManagers.length > 0 ? (
                        apiManagers.map(manager => (
                            <label key={manager.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                                <input
                                    type="checkbox"
                                    checked={formData.selectedManagers.includes(manager.id)}
                                    onChange={() => handleManagerToggle(manager.id)}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{manager.displayName}</span>
                                <span className={`text-xs px-1.5 py-0.5 rounded ${manager.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                    {manager.role === 'admin' ? '管理者' : 'マネージャー'}
                                </span>
                            </label>
                        ))
                    ) : (
                        <span className="text-sm text-gray-500">担当者が見つかりません</span>
                    )}
                </div>
                {formData.selectedManagers.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                        選択中: {formData.selectedManagers.length}名
                    </p>
                )}
            </div>

            {/* メンバー数（選択式） */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    メンバー数
                </label>
                <select
                    value={formData.memberCount}
                    onChange={(e) => setFormData({ ...formData, memberCount: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    {Array.from({ length: Math.min(availableMembers + formData.memberCount, TOTAL_MEMBERS) + 1 }, (_, i) => (
                        <option key={i} value={i}>
                            {i}人
                        </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                    残り: {availableMembers}人
                </p>
            </div>

            {/* 車両（チェックボックス） */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    車両
                </label>
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-md p-3">
                    {sortedVehicles.map(vehicle => {
                        const usages = vehicleUsageMap.get(vehicle.name);
                        const isInUse = usages && usages.length > 0;
                        const isConfirmed = confirmedVehicleIdSet.has(vehicle.id);

                        return (
                            <label key={vehicle.id} className={`flex items-center gap-2 cursor-pointer p-2 rounded text-sm ${isConfirmed ? 'bg-orange-50 hover:bg-orange-100' : isInUse ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}>
                                <input
                                    type="checkbox"
                                    checked={formData.selectedVehicles.includes(vehicle.name)}
                                    onChange={() => handleVehicleToggle(vehicle.name)}
                                    className="w-4 h-4 shrink-0 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span className="text-gray-700 whitespace-nowrap">{vehicle.name}</span>
                                {isConfirmed ? (
                                    <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 ml-auto whitespace-nowrap">
                                        手配確定済
                                    </span>
                                ) : isInUse ? (
                                    <div className="flex flex-wrap gap-1 ml-auto">
                                        {usages!.map((u, i) => (
                                            <span key={i} className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap">
                                                {u.foremanName}班 ({u.projectTitle})
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 ml-auto">
                                        空き
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
                {formData.selectedVehicles.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                        選択中: {formData.selectedVehicles.length}台
                    </p>
                )}
            </div>

            {/* 備考 */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    備考
                </label>
                <textarea
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="備考を入力"
                />
            </div>

            {/* ボタン */}
            <div className="flex gap-3 pt-4">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                    キャンセル
                </button>
                <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {isSaving ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            保存中...
                        </>
                    ) : (
                        '保存'
                    )}
                </button>
            </div>
        </form>
    );
}
