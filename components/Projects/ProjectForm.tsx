'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Project, DEFAULT_CONSTRUCTION_TYPE_COLORS, DailySchedule, WorkSchedule, LEGACY_CONSTRUCTION_CONTENT_LABELS } from '@/types/calendar';
import { Customer } from '@/types/customer';
import { useMasterData } from '@/hooks/useMasterData';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarStore } from '@/stores/calendarStore';
import { formatDateKey } from '@/utils/employeeUtils';
import { isManagerOrAbove } from '@/utils/permissions';
import MultiDayScheduleEditor from './MultiDayScheduleEditor';
import { User, Search, Plus } from 'lucide-react';
import { useSession } from 'next-auth/react';
import CustomerModal from '@/components/Customers/CustomerModal';
import { CustomerInput } from '@/types/customer';
import { useFinanceStore } from '@/stores/financeStore';
import { ButtonLoading } from '@/components/ui/Loading';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/lib/logger';
import toast from 'react-hot-toast';

const HONORIFIC_OPTIONS = [
    { value: '様邸', label: '様邸' },
    { value: '様', label: '様' },
    { value: '御中', label: '御中' },
    { value: '', label: 'なし' },
];

// 旧データ: titleから名前・敬称・工事名称をパースする
function parseTitleIntoFields(title: string, suffixes: ConstructionSuffixItem[]) {
    let name = title;
    let honorific = '';
    let suffixId = '';
    // 工事名称マスタとマッチングして除去（末尾スペース+名称）
    for (const s of suffixes) {
        if (title.endsWith(' ' + s.name)) {
            name = title.slice(0, -(s.name.length + 1));
            suffixId = s.id;
            break;
        }
    }
    // 敬称をマッチングして除去（長い順にチェック）
    const sortedHonorifics = HONORIFIC_OPTIONS
        .filter(opt => opt.value)
        .sort((a, b) => b.value.length - a.value.length);
    for (const opt of sortedHonorifics) {
        if (name.endsWith(opt.value)) {
            name = name.slice(0, -opt.value.length);
            honorific = opt.value;
            break;
        }
    }
    return { name, honorific, suffixId };
}

interface ConstructionSuffixItem {
    id: string;
    name: string;
    sortOrder: number;
}

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
    const { data: session } = useSession();
    const currentUserId = session?.user?.id;
    const { projects } = useProjects();
    const { vehicles: mockVehicles, constructionTypes, getTotalMembersForDate } = useMasterData();
    const { getForemanName, allForemen } = useCalendarDisplay();
    const { getVacationEmployees } = useVacation();
    const memberAdjustments = useCalendarStore((state) => state.memberAdjustments);

    // 工事名称マスタ
    const [constructionSuffixes, setConstructionSuffixes] = useState<ConstructionSuffixItem[]>([]);
    useEffect(() => {
        const fetchSuffixes = async () => {
            try {
                const res = await fetch('/api/master-data/construction-suffixes');
                if (res.ok) setConstructionSuffixes(await res.json());
            } catch { /* ignore */ }
        };
        fetchSuffixes();
    }, []);

    // 工事内容マスタ
    const [constructionContents, setConstructionContents] = useState<{ id: string; name: string }[]>([]);
    useEffect(() => {
        const fetchContents = async () => {
            try {
                const res = await fetch('/api/master-data/construction-contents');
                if (res.ok) setConstructionContents(await res.json());
            } catch { /* ignore */ }
        };
        fetchContents();
    }, []);

    // 3フィールド分離前の古い案件: name=undefinedの場合titleからフォールバック
    const hasInitialName = !!initialData?.name;
    const [formData, setFormData] = useState({
        name: initialData?.name || initialData?.title || '',
        honorific: hasInitialName ? (initialData?.honorific ?? '様邸') : (initialData?.honorific || ''),
        constructionSuffixId: initialData?.constructionSuffixId || '',
        siteShortName: initialData?.siteShortName || '',
        title: initialData?.title || '',
        customer: initialData?.customer || '',
        customerId: '', // 顧客ID追加
        selectedManagers: Array.isArray(initialData?.createdBy)
            ? initialData.createdBy
            : initialData?.createdBy
                ? [initialData.createdBy]
                : [], // 案件担当者(複数選択)
        memberCount: initialData?.memberCount ?? initialData?.workers?.length ?? 0, // メンバー数
        estimatedHours: initialData?.estimatedHours ?? 8, // 予定作業時間（デフォルト8h）
        selectedVehicles: initialData?.isDispatchConfirmed && initialData?.confirmedVehicleIds?.length
            ? initialData.confirmedVehicleIds.map(id => mockVehicles.find(v => v.id === id)?.name).filter((n): n is string => !!n)
            : initialData?.trucks || [],
        // 工事種別（単一選択 - IDまたはレガシーコードで保存）
        constructionType: initialData?.constructionType || '',
        // 工事内容
        constructionContent: initialData?.constructionContent || '',
        remarks: initialData?.remarks || '',
        // 日付の確度（'tentative' = 先方未確定の仮押さえ）と先方確認予定日（YYYY-MM-DD）
        dateStatus: (initialData?.dateStatus === 'tentative' ? 'tentative' : 'confirmed') as 'confirmed' | 'tentative',
        confirmDueDate: initialData?.confirmDueDate ? formatDateKey(new Date(initialData.confirmDueDate)) : '',
    });

    // initialDataが変わったらformDataをリセット（備考などが前回の値で残るのを防止）
    useEffect(() => {
        const hasName = !!initialData?.name;
        setFormData({
            name: initialData?.name || initialData?.title || '',
            honorific: hasName ? (initialData?.honorific ?? '様邸') : (initialData?.honorific || ''),
            constructionSuffixId: initialData?.constructionSuffixId || '',
            siteShortName: initialData?.siteShortName || '',
            title: initialData?.title || '',
            customer: initialData?.customer || '',
            customerId: '',
            selectedManagers: Array.isArray(initialData?.createdBy)
                ? initialData.createdBy
                : initialData?.createdBy
                    ? [initialData.createdBy]
                    : [],
            memberCount: initialData?.memberCount ?? initialData?.workers?.length ?? 0,
            estimatedHours: initialData?.estimatedHours ?? 8,
            selectedVehicles: initialData?.isDispatchConfirmed && initialData?.confirmedVehicleIds?.length
                ? initialData.confirmedVehicleIds.map(id => mockVehicles.find(v => v.id === id)?.name).filter((n): n is string => !!n)
                : initialData?.trucks || [],
            constructionType: initialData?.constructionType || '',
            constructionContent: initialData?.constructionContent || '',
            remarks: initialData?.remarks || '',
            dateStatus: (initialData?.dateStatus === 'tentative' ? 'tentative' : 'confirmed') as 'confirmed' | 'tentative',
            confirmDueDate: initialData?.confirmDueDate ? formatDateKey(new Date(initialData.confirmDueDate)) : '',
        });
        dateStatusTouchedRef.current = false;
    }, [initialData]);

    // 新規作成時、案件担当者にログインユーザーを自動セット
    // （セッション解決前にマウントされても、解決後にこのeffectが拾う）
    useEffect(() => {
        if (initialData?.id) return;
        if (!currentUserId) return;
        setFormData(prev => {
            if (prev.selectedManagers.length > 0) return prev;
            return { ...prev, selectedManagers: [currentUserId] };
        });
    }, [initialData?.id, currentUserId]);

    // 旧データ（name未設定）の場合、constructionSuffixes取得後にtitleをパースして分離
    const hasInitialNameRef = useRef(hasInitialName);
    useEffect(() => {
        if (!hasInitialNameRef.current && constructionSuffixes.length > 0 && initialData?.title) {
            const parsed = parseTitleIntoFields(initialData.title, constructionSuffixes);
            // パースで実際に分離できた場合のみ更新（敬称 or suffixIdが見つかった場合）
            if (parsed.honorific || parsed.suffixId) {
                setFormData(prev => ({
                    ...prev,
                    name: parsed.name,
                    honorific: parsed.honorific,
                    constructionSuffixId: parsed.suffixId,
                }));
            }
        }
    }, [constructionSuffixes, initialData?.title]);

    // 浮き（班未定）動線か。浮きレーンから開いたときだけ 'unassigned' 文脈になる。
    // 通常の職長行からは 'unassigned' が渡らない（孤児配置ガードは維持）。
    const isFloatingContext = (initialData?.assignedEmployeeId ?? defaultEmployeeId) === 'unassigned';

    // 複数日スケジュール管理用の状態
    const [useMultiDaySchedule, setUseMultiDaySchedule] = useState(false);
    const [multiDaySchedules, setMultiDaySchedules] = useState<DailySchedule[]>([]);

    // 仮予定の確認予定日リード日数（担当者ごとの User.tentativeConfirmLeadDays）。
    // /api/users のレスポンス（apiManagers のフィルタ前）から自分の設定値を引く。
    const [leadDaysByUser, setLeadDaysByUser] = useState<Record<string, number>>({});
    const myLeadDays = (currentUserId && leadDaysByUser[currentUserId]) || 14;
    // ユーザーがトグルを一度でも触ったら、改修×解体の自動初期値より手動選択を優先する
    const dateStatusTouchedRef = useRef(false);

    // 確認予定日の自動提案（予定日の◯日前。◯=操作ユーザーの設定値・初期14日）
    const suggestConfirmDueDate = () => {
        const base = initialData?.startDate || defaultDate || new Date();
        const d = new Date(base);
        d.setDate(d.getDate() - myLeadDays);
        return formatDateKey(d);
    };

    // 仮/確定トグル。仮に切り替えたとき確認予定日が空なら自動提案を入れる（手修正は常に可能）
    const handleDateStatusChange = (next: 'confirmed' | 'tentative') => {
        dateStatusTouchedRef.current = true;
        setFormData(prev => ({
            ...prev,
            dateStatus: next,
            confirmDueDate: next === 'tentative' && !prev.confirmDueDate ? suggestConfirmDueDate() : prev.confirmDueDate,
        }));
    };

    // 「改修 × 解体」の新規登録はトグルの初期値だけ仮側に倒す（保存値の自動変更はしない）。
    // 改修の解体日は先方連絡待ちが常のため。ユーザーがトグルを触った後は上書きしない。
    useEffect(() => {
        if (initialData?.id) return;
        if (dateStatusTouchedRef.current) return;
        const contentLabel = LEGACY_CONSTRUCTION_CONTENT_LABELS[formData.constructionContent] || formData.constructionContent;
        const typeName = constructionTypes.find(t => t.id === formData.constructionType)?.name || formData.constructionType;
        const shouldTentative = typeName === '解体' && contentLabel === '改修';
        setFormData(prev => {
            const next = shouldTentative ? 'tentative' : 'confirmed';
            if (prev.dateStatus === next) return prev;
            let due = prev.confirmDueDate;
            if (next === 'tentative' && !due) {
                const base = initialData?.startDate || defaultDate || new Date();
                const d = new Date(base);
                d.setDate(d.getDate() - myLeadDays);
                due = formatDateKey(d);
            }
            return { ...prev, dateStatus: next, confirmDueDate: due };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.constructionType, formData.constructionContent, constructionTypes, initialData?.id, myLeadDays]);

    // 顧客選択用のstate
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearchTerm, setCustomerSearchTerm] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
    const [customerError, setCustomerError] = useState(false);
    const customerFieldRef = useRef<HTMLDivElement>(null);

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
                logger.error('Failed to fetch customers:', error);
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
                    // 仮予定リード日数マップ（フィルタ前の全ユーザーから構築）
                    const leadMap: Record<string, number> = {};
                    (users as Array<ManagerUser & { tentativeConfirmLeadDays?: number }>).forEach((u) => {
                        if (typeof u.tentativeConfirmLeadDays === 'number') leadMap[u.id] = u.tentativeConfirmLeadDays;
                    });
                    setLeadDaysByUser(leadMap);
                }
            } catch (error) {
                logger.error('Failed to fetch managers:', error);
            } finally {
                setIsLoadingManagers(false);
            }
        };
        fetchManagers();
    }, []);

    // 残りのメンバー数を計算（カレンダー上部の表示と同じロジック）
    const availableMembers = useMemo(() => {
        const targetDate = initialData?.startDate || defaultDate || new Date();
        const dateKey = formatDateKey(targetDate);

        // 同じ日付の全案件を取得（編集中の案件は除外）
        const sameDateProjects = projects.filter(p => {
            const pDateKey = formatDateKey(p.startDate);
            return pDateKey === dateKey && p.id !== initialData?.id;
        });

        // 職長ごとに最大人数を取り、未割当は単純加算（人数ソースは memberCount のみ）
        const byForeman = new Map<string, number[]>();
        sameDateProjects
            .filter(p => p.assignedEmployeeId && p.assignedEmployeeId !== 'unassigned')
            .forEach(p => {
                const key = p.assignedEmployeeId!;
                if (!byForeman.has(key)) byForeman.set(key, []);
                byForeman.get(key)!.push(p.memberCount ?? 0);
            });
        let usedMembers = 0;
        byForeman.forEach(counts => { usedMembers += Math.max(...counts); });

        // 未割り当て案件の人数も加算
        const unassignedUsed = sameDateProjects
            .filter(p => !p.assignedEmployeeId || p.assignedEmployeeId === 'unassigned')
            .reduce((sum, p) => sum + (p.memberCount ?? 0), 0);
        usedMembers += unassignedUsed;

        // 休暇・手動調整を加味
        const vacationCount = getVacationEmployees(dateKey).length;
        const adjustment = memberAdjustments[dateKey] || 0;

        // 総メンバー数（マスターデータから日付ベースで取得）
        return getTotalMembersForDate(dateKey) + adjustment - usedMembers - vacationCount;
    }, [projects, initialData, defaultDate, getTotalMembersForDate, getVacationEmployees, memberAdjustments]);

    // 複数日スケジュール用: 日程範囲の全アサインを別途フェッチ（カレンダーストアは現在週しか保持しないため）
    type RangeAssignment = {
        id: string;
        date: string;
        assignedEmployeeId: string | null;
        memberCount: number | null;
        vehicles: string[];
        projectMasterId: string;
        projectMaster?: { title?: string | null } | null;
    };
    const [rangeAssignments, setRangeAssignments] = useState<RangeAssignment[]>([]);
    const rangeKey = useMemo(() => {
        if (multiDaySchedules.length === 0) return '';
        const ts = multiDaySchedules.map(s => new Date(s.date).getTime());
        const start = new Date(Math.min(...ts));
        const end = new Date(Math.max(...ts));
        return `${formatDateKey(start)}_${formatDateKey(end)}`;
    }, [multiDaySchedules]);
    useEffect(() => {
        if (!useMultiDaySchedule || !rangeKey) {
            setRangeAssignments([]);
            return;
        }
        const [startStr, endStr] = rangeKey.split('_');
        // JST境界: 'YYYY-MM-DD' のみ送ると new Date() がUTC 0時に解釈され
        // JST 0時=UTC前日15時で保存された当日アサインを取りこぼすため、
        // 明示的に +09:00 のISO文字列で送る
        const startISO = `${startStr}T00:00:00+09:00`;
        const endISO = `${endStr}T23:59:59+09:00`;
        let cancelled = false;
        const t = setTimeout(() => {
            fetch(`/api/assignments?startDate=${encodeURIComponent(startISO)}&endDate=${encodeURIComponent(endISO)}`, { cache: 'no-store' })
                .then(r => r.ok ? r.json() : [])
                .then((data: RangeAssignment[]) => { if (!cancelled) setRangeAssignments(Array.isArray(data) ? data : []); })
                .catch(() => { if (!cancelled) setRangeAssignments([]); });
        }, 200);
        return () => { cancelled = true; clearTimeout(t); };
    }, [useMultiDaySchedule, rangeKey]);

    // 複数日スケジュール用：日付ごとの既存配置マップ（rangeAssignmentsベース、編集中の案件は除外）
    const existingDayMap = useMemo(() => {
        const map: Record<string, { foremanId: string; foremanName: string; memberCount: number; projectTitle?: string }[]> = {};
        const selfPmId = initialData?.id;
        rangeAssignments.forEach(a => {
            if (!a.assignedEmployeeId) return;
            if (selfPmId && a.projectMasterId === selfPmId) return;
            const dateKey = formatDateKey(new Date(a.date));
            if (!map[dateKey]) map[dateKey] = [];
            map[dateKey].push({
                foremanId: a.assignedEmployeeId,
                foremanName: getForemanName(a.assignedEmployeeId) || '不明',
                memberCount: a.memberCount ?? 0,
                projectTitle: a.projectMaster?.title || undefined,
            });
        });
        return map;
    }, [rangeAssignments, initialData?.id, getForemanName]);

    // 日付ごとの車両使用マップ（同日の他案件で使われている車両名 → 件数）
    const vehicleUsageByDate = useMemo(() => {
        const map: Record<string, Record<string, number>> = {};
        const selfPmId = initialData?.id;
        rangeAssignments.forEach(a => {
            if (selfPmId && a.projectMasterId === selfPmId) return;
            const dateKey = formatDateKey(new Date(a.date));
            const arr = Array.isArray(a.vehicles) ? a.vehicles : [];
            if (arr.length === 0) return;
            if (!map[dateKey]) map[dateKey] = {};
            arr.forEach(v => {
                if (!v) return;
                map[dateKey][v] = (map[dateKey][v] ?? 0) + 1;
            });
        });
        return map;
    }, [rangeAssignments, initialData?.id]);

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

    const handleNewCustomerSubmit = async (data: CustomerInput) => {
        try {
            const res = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (res.ok) {
                const newCustomer = await res.json();
                setCustomers(prev => [...prev, newCustomer]);
                useFinanceStore.getState().fetchCustomers();
                setFormData(prev => ({
                    ...prev,
                    customerId: newCustomer.id,
                    customer: newCustomer.name,
                }));
                setCustomerSearchTerm('');
                setCustomerError(false);
                setShowNewCustomerModal(false);
            }
        } catch (error) {
            logger.error('Failed to create customer:', error);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name.trim() && !formData.title.trim()) return;
        if (!formData.customer.trim()) return;

        // 正式名称を自動合成
        const suffixName = constructionSuffixes.find(s => s.id === formData.constructionSuffixId)?.name || '';
        const composedTitle = formData.name.trim()
            ? `${formData.name.trim()}${formData.honorific}${suffixName ? ' ' + suffixName : ''}`
            : formData.title;

        // customerId未セット = ドロップダウン未選択 / 新規登録未経由
        // 編集時で顧客名が初期値から変わっていない場合のみ許容（後方互換）
        const customerChanged = formData.customer !== (initialData?.customer || '');
        if (!formData.customerId && (!initialData?.customer || customerChanged)) {
            setCustomerError(true);
            customerFieldRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // 職長の特定（このフォームに職長選択欄は無く、開いた職長行で決まる）。
        // 文脈なしで 'unassigned' のまま保存すると、カレンダーに描画されず
        // 作業履歴で「不明」と表示される消せない孤児配置になるため保存させない。
        // 例外: 浮き動線（浮きレーンから開いた場合）のみ 'unassigned' を許可する。
        // 保存はストアが正門 POST /api/assignments/floating へ振り替え、専用レーンに描画される。
        const assignedEmployeeId = initialData?.assignedEmployeeId || defaultEmployeeId;
        if (!isFloatingContext && (!assignedEmployeeId || assignedEmployeeId === 'unassigned')) {
            toast.error('職長が特定できないため登録できません。カレンダーの職長行のセルから登録してください。');
            return;
        }

        // メンバー数分のダミー配列を作成
        const workers = formData.memberCount > 0
            ? Array.from({ length: formData.memberCount }, (_, i) => `メンバー${i + 1}`)
            : [];

        // 日程はカレンダーの日付を使用
        const startDate = initialData?.startDate || defaultDate || new Date();

        // 色の決定: マスターデータから取得、なければデフォルト
        const selectedType = constructionTypes.find(ct => ct.id === formData.constructionType);
        const color = selectedType?.color || DEFAULT_CONSTRUCTION_TYPE_COLORS[formData.constructionType] || '#a8c8e8';

        // 複数日スケジュールを使用する場合
        let workSchedules: WorkSchedule[] | undefined = undefined;
        if (useMultiDaySchedule && multiDaySchedules.length > 0) {
            workSchedules = [{
                id: uuidv4(),
                type: formData.constructionType,
                dailySchedules: multiDaySchedules,
            }];
        }

        const projectData = {
            title: composedTitle,
            name: formData.name.trim() || null,
            honorific: formData.honorific || null,
            constructionSuffixId: formData.constructionSuffixId || null,
            siteShortName: formData.siteShortName.trim() || null,
            projectMasterId: initialData?.projectMasterId,
            location: initialData?.location,
            customer: formData.customer || null,
            createdBy: formData.selectedManagers.length > 0 ? formData.selectedManagers : [],
            startDate: startDate,
            // 浮きの編集では職長を送らない（単発PATCHは 'unassigned' を拒否する。
            // 班の割り当ては昇格モーダル経由）。新規の浮きは 'unassigned' のまま送出し正門へ
            ...(isFloatingContext && initialData?.id ? {} : { assignedEmployeeId }),
            memberCount: formData.memberCount,
            workers: workers,
            trucks: formData.selectedVehicles.length > 0 ? formData.selectedVehicles : [],
            vehicles: formData.selectedVehicles.length > 0 ? formData.selectedVehicles : [],
            // 工事種別
            constructionType: formData.constructionType,
            // 工事内容
            constructionContent: formData.constructionContent || null,
            // 複数日スケジュール
            workSchedules: workSchedules,
            color: color,
            remarks: formData.remarks ?? '',
            estimatedHours: formData.estimatedHours,
            dateStatus: formData.dateStatus,
            // 確認予定日は JST 0時の Date にして送る（date 列と同じ日境界規約）。確定なら null でクリア
            confirmDueDate: (() => {
                if (formData.dateStatus !== 'tentative' || !formData.confirmDueDate) return null;
                const [cy, cm, cd] = formData.confirmDueDate.split('-').map(Number);
                return cy && cm && cd ? new Date(cy, cm - 1, cd) : null;
            })(),
        };

        onSubmit(projectData as Omit<Project, 'id' | 'createdAt' | 'updatedAt'>);
    };

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* 浮き（班未定）動線の説明 */}
                {isFloatingContext && (
                    <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        <span className="font-bold">浮いている現場</span>
                        （班未定）として登録します。カレンダー最下部のレーンに表示され、班の割り当てはカードのタップから行えます。
                    </div>
                )}

                {/* 現場名（4フィールド分離: 名前/敬称/場所/工事名称） */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        現場名 <span className="text-slate-500">*</span>
                    </label>
                    <div className="space-y-3">
                        {/* 1行目: 名前 + 敬称 */}
                        <div className="flex gap-3">
                            <div className="flex-[2]">
                                <label className="block text-xs text-slate-500 mb-1">名前</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 text-base"
                                    placeholder="例: 佐藤"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-slate-500 mb-1">敬称</label>
                                <select
                                    value={formData.honorific}
                                    onChange={(e) => setFormData({ ...formData, honorific: e.target.value })}
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 text-base"
                                >
                                    {HONORIFIC_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* 2行目: 場所 + 工事名称 */}
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="block text-xs text-slate-500 mb-1">その他</label>
                                <input
                                    type="text"
                                    value={formData.siteShortName}
                                    onChange={(e) => setFormData({ ...formData, siteShortName: e.target.value })}
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 text-base"
                                />
                            </div>
                            <div className="flex-[2]">
                                <label className="block text-xs text-slate-500 mb-1">工事名称</label>
                                <select
                                    value={formData.constructionSuffixId}
                                    onChange={(e) => setFormData({ ...formData, constructionSuffixId: e.target.value })}
                                    className="w-full px-3 py-2.5 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 text-base"
                                >
                                    <option value="">選択なし</option>
                                    {constructionSuffixes.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* プレビュー */}
                        {formData.name.trim() && (
                            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm text-slate-700">
                                正式名称: <span className="font-medium">{formData.name.trim()}{formData.honorific}{(() => { const s = constructionSuffixes.find(s => s.id === formData.constructionSuffixId)?.name; return s ? ' ' + s : ''; })()}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* 元請名（顧客選択） */}
                <div className="relative" ref={customerFieldRef}>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        元請名 <span className="text-slate-500">*</span>
                    </label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                required
                                value={customerSearchTerm || formData.customer}
                                onChange={(e) => {
                                    setCustomerSearchTerm(e.target.value);
                                    setShowCustomerDropdown(true);
                                    setFormData({ ...formData, customer: e.target.value, customerId: '' });
                                    setCustomerError(false);
                                }}
                                onFocus={() => setShowCustomerDropdown(true)}
                                className={`w-full pl-10 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 ${customerError ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                                placeholder="顧客を検索または入力..."
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowNewCustomerModal(true)}
                            className="flex items-center gap-1 px-3 py-2 bg-teal-600 text-white text-sm rounded-md hover:bg-teal-700 transition-colors whitespace-nowrap"
                        >
                            <Plus className="w-4 h-4" />
                            新規登録
                        </button>
                    </div>

                    {customerError && (
                        <p className="mt-1 text-xs text-red-500">リストから選択するか、「新規登録」から顧客を登録してください</p>
                    )}
                    {showCustomerDropdown && filteredCustomers.length > 0 && customerSearchTerm && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                            {filteredCustomers.map(customer => (
                                <button
                                    key={customer.id}
                                    type="button"
                                    onClick={() => {
                                        setFormData({
                                            ...formData,
                                            customerId: customer.id,
                                            customer: customer.name,
                                        });
                                        setCustomerSearchTerm('');
                                        setShowCustomerDropdown(false);
                                        setCustomerError(false);
                                    }}
                                    className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center justify-between"
                                >
                                    <span>{customer.name}</span>
                                    {customer.shortName && (
                                        <span className="text-sm text-slate-500">({customer.shortName})</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                </div>

                {/* 工事種別（検索付きコンボボックス + 選択中プレビュー） */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        工事種別 <span className="text-slate-500">*</span>
                    </label>
                    {constructionTypes.length > 0 ? (
                        <div className="space-y-2">
                            <SearchableSelect
                                options={constructionTypes.map((t) => ({ id: t.id, label: t.name, color: t.color }))}
                                value={formData.constructionType}
                                onChange={(v) => {
                                    setFormData({ ...formData, constructionType: v });
                                    // 工事種別変更時にスケジュールをクリア
                                    setMultiDaySchedules([]);
                                }}
                                placeholder="種別を選択（入力で絞り込み）"
                                allowEmpty={false}
                                size="md"
                            />
                            {/* 選択中の種別を従来の色付きピルで視覚確認 */}
                            {(() => {
                                const selected = constructionTypes.find((t) => t.id === formData.constructionType);
                                if (!selected) return null;
                                return (
                                    <div className="inline-flex items-center">
                                        <span
                                            className="text-sm font-medium px-3 py-1 rounded-full text-slate-900"
                                            style={{
                                                backgroundColor: `${selected.color}30`,
                                                border: `2px solid ${selected.color}`,
                                            }}
                                        >
                                            {selected.name}
                                        </span>
                                    </div>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="border border-slate-200 rounded-md p-4">
                            <p className="text-sm text-slate-500">
                                設定の「工事種別」から種別を追加してください
                            </p>
                        </div>
                    )}
                </div>

                {/* 工事内容 */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        工事内容
                    </label>
                    <select
                        value={formData.constructionContent}
                        onChange={(e) => setFormData({ ...formData, constructionContent: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-500"
                    >
                        <option value="">選択してください</option>
                        {constructionContents.map((item) => (
                            <option key={item.id} value={item.name}>{item.name}</option>
                        ))}
                    </select>
                </div>

                {/* 日付の確度（仮予定トグル）。必須操作はこの1タップのみ */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        日付の確度
                    </label>
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => handleDateStatusChange('confirmed')}
                                className={`px-4 py-2 text-sm font-medium transition-colors ${
                                    formData.dateStatus !== 'tentative'
                                        ? 'bg-slate-700 text-white'
                                        : 'bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                確定
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDateStatusChange('tentative')}
                                className={`px-4 py-2 text-sm font-medium border-l border-slate-300 transition-colors ${
                                    formData.dateStatus === 'tentative'
                                        ? 'bg-amber-500 text-white'
                                        : 'bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                仮
                            </button>
                        </div>
                        {formData.dateStatus === 'tentative' && (
                            <span className="text-xs text-amber-700">
                                先方未確定の仮押さえとして登録します（カレンダーに斜線で表示）
                            </span>
                        )}
                    </div>
                    {formData.dateStatus === 'tentative' && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <label className="text-xs text-slate-500 whitespace-nowrap">先方への確認予定日</label>
                            <input
                                type="date"
                                value={formData.confirmDueDate}
                                onChange={(e) => setFormData({ ...formData, confirmDueDate: e.target.value })}
                                className="px-3 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                            <span className="text-xs text-slate-400">自動提案: 予定日の{myLeadDays}日前</span>
                        </div>
                    )}
                </div>

                {/* 複数日スケジュール管理（浮きは単発の急件のため非表示） */}
                {!isFloatingContext && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <label className="block text-sm font-medium text-slate-700">
                            複数日スケジュール管理
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={useMultiDaySchedule}
                                onChange={(e) => setUseMultiDaySchedule(e.target.checked)}
                                className="w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                            />
                            <span className="text-sm text-slate-600">複数日の作業を登録</span>
                        </label>
                    </div>

                    {useMultiDaySchedule && (
                        <div className="space-y-4 border border-slate-200 rounded-md p-4 bg-slate-50">
                            <div className="bg-white p-4 rounded-lg border border-slate-200">
                                <h3 className="text-lg font-semibold text-slate-700 mb-3">
                                    作業日程
                                </h3>
                                <MultiDayScheduleEditor
                                    type={formData.constructionType}
                                    dailySchedules={multiDaySchedules}
                                    onChange={setMultiDaySchedules}
                                    foremen={allForemen}
                                    vehicles={mockVehicles}
                                    constructionTypes={constructionTypes}
                                    existingDayMap={existingDayMap}
                                    vehicleUsageByDate={vehicleUsageByDate}
                                    getTotalMembersForDate={getTotalMembersForDate}
                                    getVacationCountForDate={(dateStr) => getVacationEmployees(dateStr).length}
                                />
                            </div>
                        </div>
                    )}
                </div>
                )}

                {/* 案件担当者（チェックボックス） */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        <User className="inline w-4 h-4 mr-1" />
                        案件担当者
                    </label>
                    <div className="flex flex-wrap gap-2 border border-slate-200 rounded-md p-3 min-h-[60px]">
                        {isLoadingManagers ? (
                            <div className="flex items-center gap-2 text-slate-500">
                                <ButtonLoading />
                                <span className="text-sm">担当者を読み込み中...</span>
                            </div>
                        ) : apiManagers.length > 0 ? (
                            apiManagers.map(manager => (
                                <label key={manager.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100">
                                    <input
                                        type="checkbox"
                                        checked={formData.selectedManagers.includes(manager.id)}
                                        onChange={() => handleManagerToggle(manager.id)}
                                        className="w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                    />
                                    <span className="text-sm text-slate-700">{manager.displayName}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${manager.role === 'admin' ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-700'}`}>
                                        {manager.role === 'admin' ? '管理者' : 'マネージャー'}
                                    </span>
                                </label>
                            ))
                        ) : (
                            <span className="text-sm text-slate-500">担当者が見つかりません</span>
                        )}
                    </div>
                    {formData.selectedManagers.length > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                            選択中: {formData.selectedManagers.length}名
                        </p>
                    )}
                </div>

                {/* メンバー数（選択式） */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        メンバー数
                        {useMultiDaySchedule && <span className="ml-2 text-xs text-slate-400 font-normal">（複数日スケジュールで設定）</span>}
                    </label>
                    <select
                        value={formData.memberCount}
                        disabled={useMultiDaySchedule}
                        onChange={(e) => setFormData({ ...formData, memberCount: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                        {Array.from({ length: Math.min(availableMembers + formData.memberCount, getTotalMembersForDate(formatDateKey(initialData?.startDate || defaultDate || new Date()))) + 1 }, (_, i) => (
                            <option key={i} value={i}>
                                {i}人
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">
                        残り: {availableMembers}人
                    </p>
                </div>

                {/* 予定作業時間 */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        予定作業時間
                        {useMultiDaySchedule && <span className="ml-2 text-xs text-slate-400 font-normal">（複数日スケジュールで設定）</span>}
                    </label>
                    <div className={`flex flex-wrap gap-2 ${useMultiDaySchedule ? 'opacity-50 pointer-events-none' : ''}`}>
                        {[2, 4, 8].map(hours => (
                            <button
                                key={hours}
                                type="button"
                                disabled={useMultiDaySchedule}
                                onClick={() => setFormData({ ...formData, estimatedHours: hours })}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border disabled:cursor-not-allowed ${formData.estimatedHours === hours
                                        ? 'bg-slate-700 text-white border-slate-700'
                                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                                    }`}
                            >
                                {hours}h
                            </button>
                        ))}
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                min="0.5"
                                max="24"
                                step="0.5"
                                disabled={useMultiDaySchedule}
                                value={![2, 4, 8].includes(formData.estimatedHours) ? formData.estimatedHours : ''}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    if (!isNaN(val) && val >= 0.5 && val <= 24) {
                                        setFormData({ ...formData, estimatedHours: val });
                                    }
                                }}
                                placeholder="その他"
                                className={`w-20 px-2 py-2 border rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:cursor-not-allowed ${![2, 4, 8].includes(formData.estimatedHours)
                                        ? 'border-slate-700 bg-slate-50'
                                        : 'border-slate-300'
                                    }`}
                            />
                            <span className="text-sm text-slate-500">h</span>
                        </div>
                    </div>
                </div>

                {/* 車両（チェックボックス） */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        車両
                        {useMultiDaySchedule && <span className="ml-2 text-xs text-slate-400 font-normal">（複数日スケジュールで設定）</span>}
                    </label>
                    <div className={`flex flex-col gap-1.5 max-h-48 overflow-y-auto border border-slate-200 rounded-md p-3 ${useMultiDaySchedule ? 'opacity-50' : ''}`}>
                        {sortedVehicles.map(vehicle => {
                            const usages = vehicleUsageMap.get(vehicle.name);
                            const isInUse = usages && usages.length > 0;
                            const isConfirmed = confirmedVehicleIdSet.has(vehicle.id);

                            return (
                                <label key={vehicle.id} className={`flex items-center gap-2 p-2 rounded text-sm ${useMultiDaySchedule ? 'cursor-not-allowed' : 'cursor-pointer'} ${isConfirmed ? 'bg-slate-50 hover:bg-slate-100' : isInUse ? 'bg-slate-50 hover:bg-slate-100' : 'hover:bg-slate-50'}`}>
                                    <input
                                        type="checkbox"
                                        checked={formData.selectedVehicles.includes(vehicle.name)}
                                        disabled={useMultiDaySchedule}
                                        onChange={() => handleVehicleToggle(vehicle.name)}
                                        className="w-4 h-4 shrink-0 text-slate-600 border-slate-300 rounded focus:ring-slate-500 disabled:cursor-not-allowed"
                                    />
                                    <span className="text-slate-700 whitespace-nowrap">{vehicle.name}</span>
                                    {isConfirmed ? (
                                        <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 ml-auto whitespace-nowrap">
                                            手配確定済
                                        </span>
                                    ) : isInUse ? (
                                        <div className="flex flex-wrap gap-1 ml-auto">
                                            {usages!.map((u, i) => (
                                                <span key={i} className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 whitespace-nowrap">
                                                    {u.foremanName}班 ({u.projectTitle})
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 ml-auto">
                                            空き
                                        </span>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                    {formData.selectedVehicles.length > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                            選択中: {formData.selectedVehicles.length}台
                        </p>
                    )}
                </div>

                {/* 備考（当日の配置用） */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        備考（この日の配置用）
                    </label>
                    <textarea
                        value={formData.remarks}
                        onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="当日の備考を入力（案件マスターには保存されません）"
                    />
                </div>

                {/* ボタン */}
                <div className="flex gap-3 pt-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isSaving}
                        className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        キャンセル
                    </button>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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

            {/* 新規顧客登録モーダル（formの外に配置してネスト回避） */}
            <CustomerModal
                isOpen={showNewCustomerModal}
                onClose={() => setShowNewCustomerModal(false)}
                onSubmit={handleNewCustomerSubmit}
                title="新規顧客登録"
            />
        </>
    );
}
