'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Project, EventCategory, CONSTRUCTION_TYPE_COLORS, DailySchedule, WorkSchedule, ProjectStatus } from '@/types/calendar';
import { Customer } from '@/types/customer';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { formatDateKey } from '@/utils/employeeUtils';
import { isManagerOrAbove } from '@/utils/permissions';
import VehicleModal from '../VehicleModal';
import MultiDayScheduleEditor from './MultiDayScheduleEditor';
import { Plus, User, Search } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';

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
}

export default function ProjectForm({
    initialData,
    onSubmit,
    onCancel,
    defaultDate,
    defaultEmployeeId,
}: ProjectFormProps) {
    const { projects } = useProjects();
    const { vehicles: mockVehicles, totalMembers: TOTAL_MEMBERS } = useMasterData();

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
        selectedVehicles: initialData?.trucks || [],
        // 工事種別(複数選択可能)
        hasAssembly: initialData?.assemblyStartDate != null || initialData?.constructionType === 'assembly',
        hasDemolition: initialData?.demolitionStartDate != null || initialData?.constructionType === 'demolition',
        hasOther: initialData?.constructionType === 'other',
        // 組立日程
        assemblyStartDate: initialData?.assemblyStartDate || (initialData?.constructionType === 'assembly' ? initialData?.startDate : undefined),
        assemblyEndDate: initialData?.assemblyEndDate,
        // 解体日程
        demolitionStartDate: initialData?.demolitionStartDate || (initialData?.constructionType === 'demolition' ? initialData?.startDate : undefined),
        demolitionEndDate: initialData?.demolitionEndDate,
        // その他用の日程
        otherStartDate: initialData?.constructionType === 'other' ? initialData?.startDate : undefined,
        otherEndDate: initialData?.constructionType === 'other' ? initialData?.endDate : undefined,
        status: initialData?.status || 'pending' as const,
        category: initialData?.category || 'construction' as EventCategory,
        remarks: initialData?.remarks || '',
    });

    // 複数日スケジュール管理用の状態
    const [useMultiDaySchedule, setUseMultiDaySchedule] = useState(false);
    const [assemblySchedules, setAssemblySchedules] = useState<DailySchedule[]>([]);
    const [demolitionSchedules, setDemolitionSchedules] = useState<DailySchedule[]>([]);

    const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);

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

        // バリデーション: 少なくとも組立、解体、その他のどれか1つは選択必須
        if (!formData.hasAssembly && !formData.hasDemolition && !formData.hasOther) {
            toast.error('組立、解体、その他のいずれかを選択してください');
            return;
        }

        // メンバー数分のダミー配列を作成
        const workers = formData.memberCount > 0
            ? Array.from({ length: formData.memberCount }, (_, i) => `メンバー${i + 1}`)
            : undefined;

        // 最初の日程をstartDateに設定(後方互換性のため)
        const startDate = formData.hasAssembly && formData.assemblyStartDate
            ? formData.assemblyStartDate
            : formData.hasDemolition && formData.demolitionStartDate
                ? formData.demolitionStartDate
                : formData.hasOther && formData.otherStartDate
                    ? formData.otherStartDate
                    : initialData?.startDate || defaultDate || new Date();

        // 終了日の設定（その他の場合）
        const endDate = formData.hasOther && formData.otherEndDate
            ? formData.otherEndDate
            : undefined;

        // 色の決定: 組立なら青、解体なら赤、その他なら黄色
        const color = formData.hasAssembly
            ? CONSTRUCTION_TYPE_COLORS.assembly
            : formData.hasDemolition
                ? CONSTRUCTION_TYPE_COLORS.demolition
                : CONSTRUCTION_TYPE_COLORS.other;

        // 複数日スケジュールを使用する場合
        let workSchedules: WorkSchedule[] | undefined = undefined;
        if (useMultiDaySchedule) {
            workSchedules = [];
            if (formData.hasAssembly && assemblySchedules.length > 0) {
                workSchedules.push({
                    id: uuidv4(),
                    type: 'assembly',
                    dailySchedules: assemblySchedules,
                });
            }
            if (formData.hasDemolition && demolitionSchedules.length > 0) {
                workSchedules.push({
                    id: uuidv4(),
                    type: 'demolition',
                    dailySchedules: demolitionSchedules,
                });
            }
        }

        // 工事種別の決定: 組立優先、次に解体、最後にその他
        const constructionType = formData.hasAssembly ? 'assembly' : formData.hasDemolition ? 'demolition' : 'other';

        const projectData: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
            title: formData.title,
            customer: formData.customer || undefined,
            createdBy: formData.selectedManagers.length > 0 ? formData.selectedManagers : undefined,
            startDate: startDate,
            endDate: endDate,
            assignedEmployeeId: initialData?.assignedEmployeeId || defaultEmployeeId || 'unassigned',
            workers: workers,
            trucks: formData.selectedVehicles.length > 0 ? formData.selectedVehicles : undefined,
            // 工事種別
            constructionType: constructionType,
            // 複数日スケジュール
            workSchedules: workSchedules,
            // 組立・解体の日程（後方互換性のため、複数日スケジュールを使わない場合のみ）
            assemblyStartDate: !useMultiDaySchedule && formData.hasAssembly ? formData.assemblyStartDate : undefined,
            assemblyEndDate: !useMultiDaySchedule && formData.hasAssembly ? formData.assemblyEndDate : undefined,
            demolitionStartDate: !useMultiDaySchedule && formData.hasDemolition ? formData.demolitionStartDate : undefined,
            demolitionEndDate: !useMultiDaySchedule && formData.hasDemolition ? formData.demolitionEndDate : undefined,
            status: formData.status,
            category: formData.category,
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

            {/* 工事種別（チェックボックス） */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    工事種別 <span className="text-red-500">*</span>
                </label>
                <div className="space-y-3 border border-gray-200 rounded-md p-4">
                    {/* 組立 */}
                    <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.hasAssembly}
                                onChange={(e) => setFormData({ ...formData, hasAssembly: e.target.checked })}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span
                                className="text-sm font-medium px-3 py-1 rounded-full"
                                style={{
                                    backgroundColor: `${CONSTRUCTION_TYPE_COLORS.assembly}20`,
                                    color: CONSTRUCTION_TYPE_COLORS.assembly,
                                    border: `2px solid ${CONSTRUCTION_TYPE_COLORS.assembly}`
                                }}
                            >
                                組立
                            </span>
                        </label>
                        {formData.hasAssembly && (
                            <div className="ml-6 grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">開始日</label>
                                    <input
                                        type="date"
                                        value={formData.assemblyStartDate ? formData.assemblyStartDate.toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, assemblyStartDate: e.target.value ? new Date(e.target.value) : undefined })}
                                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">終了日</label>
                                    <input
                                        type="date"
                                        value={formData.assemblyEndDate ? formData.assemblyEndDate.toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, assemblyEndDate: e.target.value ? new Date(e.target.value) : undefined })}
                                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 解体 */}
                    <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.hasDemolition}
                                onChange={(e) => setFormData({ ...formData, hasDemolition: e.target.checked })}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span
                                className="text-sm font-medium px-3 py-1 rounded-full"
                                style={{
                                    backgroundColor: `${CONSTRUCTION_TYPE_COLORS.demolition}20`,
                                    color: CONSTRUCTION_TYPE_COLORS.demolition,
                                    border: `2px solid ${CONSTRUCTION_TYPE_COLORS.demolition}`
                                }}
                            >
                                解体
                            </span>
                        </label>
                        {formData.hasDemolition && (
                            <div className="ml-6 grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">開始日</label>
                                    <input
                                        type="date"
                                        value={formData.demolitionStartDate ? formData.demolitionStartDate.toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, demolitionStartDate: e.target.value ? new Date(e.target.value) : undefined })}
                                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">終了日</label>
                                    <input
                                        type="date"
                                        value={formData.demolitionEndDate ? formData.demolitionEndDate.toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, demolitionEndDate: e.target.value ? new Date(e.target.value) : undefined })}
                                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* その他 */}
                    <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.hasOther}
                                onChange={(e) => setFormData({ ...formData, hasOther: e.target.checked })}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span
                                className="text-sm font-medium px-3 py-1 rounded-full"
                                style={{
                                    backgroundColor: `${CONSTRUCTION_TYPE_COLORS.other}40`,
                                    color: '#854d0e', // Darker yellow/brown for text visibility
                                    border: `2px solid ${CONSTRUCTION_TYPE_COLORS.other}`
                                }}
                            >
                                その他
                            </span>
                        </label>
                        {formData.hasOther && (
                            <div className="ml-6 grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">開始日</label>
                                    <input
                                        type="date"
                                        value={formData.otherStartDate ? formData.otherStartDate.toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, otherStartDate: e.target.value ? new Date(e.target.value) : undefined })}
                                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-600 mb-1">終了日</label>
                                    <input
                                        type="date"
                                        value={formData.otherEndDate ? formData.otherEndDate.toISOString().split('T')[0] : ''}
                                        onChange={(e) => setFormData({ ...formData, otherEndDate: e.target.value ? new Date(e.target.value) : undefined })}
                                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
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
                        {formData.hasAssembly && (
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
                        {formData.hasDemolition && (
                            <div className="bg-white p-4 rounded-lg border border-red-200">
                                <h3 className="text-lg font-semibold text-red-700 mb-3">解体スケジュール</h3>
                                <MultiDayScheduleEditor
                                    type="demolition"
                                    dailySchedules={demolitionSchedules}
                                    onChange={setDemolitionSchedules}
                                />
                            </div>
                        )}

                        {!formData.hasAssembly && !formData.hasDemolition && !formData.hasOther && (
                            <p className="text-sm text-gray-500 text-center py-4">
                                工事種別を選択してください
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
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                        車両
                    </label>
                    <button
                        type="button"
                        onClick={() => setIsVehicleModalOpen(true)}
                        className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        追加
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3">
                    {mockVehicles.map(vehicle => (
                        <label key={vehicle.id} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                            <input
                                type="checkbox"
                                checked={formData.selectedVehicles.includes(vehicle.name)}
                                onChange={() => handleVehicleToggle(vehicle.name)}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{vehicle.name}</span>
                        </label>
                    ))}
                </div>
                {formData.selectedVehicles.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                        選択中: {formData.selectedVehicles.length}台
                    </p>
                )}
            </div>

            {/* VehicleModal */}
            <VehicleModal
                isOpen={isVehicleModalOpen}
                onClose={() => setIsVehicleModalOpen(false)}
            />

            {/* ステータス */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    ステータス
                </label>
                <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as ProjectStatus })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="pending">保留</option>
                    <option value="confirmed">確定</option>
                    <option value="completed">完了</option>
                    <option value="cancelled">中止</option>
                </select>
            </div>

            {/* カテゴリー */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    カテゴリー
                </label>
                <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as EventCategory })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="construction">建設</option>
                    <option value="maintenance">メンテナンス</option>
                    <option value="meeting">会議</option>
                    <option value="delivery">配送</option>
                    <option value="inspection">検査</option>
                    <option value="other">その他</option>
                </select>
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
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                    キャンセル
                </button>
                <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                    保存
                </button>
            </div>
        </form>
    );
}
