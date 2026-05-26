'use client';

import React, { Suspense, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useEstimates } from '@/hooks/useEstimates';
import { useInvoices } from '@/hooks/useInvoices';
import { useCompany } from '@/hooks/useCompany';
import { useCustomers } from '@/hooks/useCustomers';
import { ProjectMaster, ScaffoldingSpec, Project } from '@/types/calendar';
import { Estimate, EstimateInput, EstimateItem } from '@/types/estimate';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { Plus, Edit, Trash2, Search, Calendar, MapPin, Building, Loader2, User, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProjectMasterFormData } from '@/components/ProjectMasters/ProjectMasterForm';
import ProjectMasterDetailModal from '@/components/ProjectMaster/ProjectMasterDetailModal';
import ProjectMasterCreateModal from '@/components/ProjectMaster/ProjectMasterCreateModal';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
import toast from 'react-hot-toast';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';

const EstimateModal = dynamic(
    () => import('@/components/Estimates/EstimateModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[70]"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);
const EstimateDetailModal = dynamic(
    () => import('@/components/Estimates/EstimateDetailModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[70]"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);
const InvoiceModal = dynamic(
    () => import('@/components/Invoices/InvoiceModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[70]"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);
const InvoiceDetailModal = dynamic(
    () => import('@/components/Invoices/InvoiceDetailModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[70]"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

// useSearchParams() を含むため、ビルド時のプリレンダリングで Suspense 境界が必要
// （Next.js App Router の制約: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout）
function ProjectMasterListPageContent() {
    const { projectMasters, isLoading, createProjectMaster, updateProjectMaster, deleteProjectMaster, getProjectMasterById, fetchProjectMasters } = useProjectMasters();
    const { addEstimate, updateEstimate, deleteEstimate, ensureDataLoaded: ensureEstimatesLoaded, getEstimatesByProject } = useEstimates();
    const { addInvoice, updateInvoice, deleteInvoice, ensureDataLoaded: ensureInvoicesLoaded, getInvoicesByProject } = useInvoices();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();
    const { data: session } = useSession();
    const userRole = session?.user?.role;
    const isForeman2 = userRole === 'foreman2';
    const isAdminOrManager = userRole === 'admin' || userRole === 'manager';
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('active');
    const [detailPm, setDetailPm] = useState<ProjectMaster | null>(null);
    const [openModalInEditMode, setOpenModalInEditMode] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [isEstimateModalOpen, setIsEstimateModalOpen] = useState(false);
    const [estimateInitialData, setEstimateInitialData] = useState<Partial<EstimateInput>>({});
    const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
    const [viewingEstimate, setViewingEstimate] = useState<Estimate | null>(null);
    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [invoiceInitialData, setInvoiceInitialData] = useState<Partial<InvoiceInput>>({});
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
    // 複数見積/請求がある場合のピッカー
    const [pickerContext, setPickerContext] = useState<{ pm: ProjectMaster; kind: 'estimate' | 'invoice' } | null>(null);
    const [managerMap, setManagerMap] = useState<Record<string, string>>({});
    const [suffixMap, setSuffixMap] = useState<Record<string, string>>({});
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    // Filter and sort
    const filteredMasters = useMemo(() => {
        let results = projectMasters;

        // Status filter
        if (filterStatus !== 'all') {
            results = results.filter(pm => pm.status === filterStatus);
        }

        // Search
        if (searchTerm.trim()) {
            const lower = searchTerm.toLowerCase();
            results = results.filter(pm =>
                pm.title.toLowerCase().includes(lower) ||
                pm.customerName?.toLowerCase().includes(lower) ||
                pm.customerShortName?.toLowerCase().includes(lower) ||
                pm.location?.toLowerCase().includes(lower) ||
                pm.city?.toLowerCase().includes(lower)
            );
        }

        // Sort by updated date
        return results.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }, [projectMasters, searchTerm, filterStatus]);

    // Reset pagination when filter or search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterStatus]);

    // 通知からの遷移など、ページを開いたタイミングで最新データを取得
    // （ストアが初期化済みでも、hidden中に発生した新規案件を取りこぼさないため）
    useEffect(() => {
        fetchProjectMasters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 通知ディープリンク: ?pmId=<id> で案件詳細モーダルを自動オープン
    // 画像通知時は ?scrollTo=files で添付ファイルセクションへスクロール
    // useSearchParams() を経由することで「すでに案件マスタを開いている状態」でも
    // 通知タップ→URL変化を検知してモーダルが開く（window.location 直読 + 限定depsだと再発火しない）
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const lastConsumedPmIdRef = useRef<string | null>(null);
    useEffect(() => {
        const pmId = searchParams?.get('pmId');
        if (!pmId) {
            lastConsumedPmIdRef.current = null;
            return;
        }
        if (lastConsumedPmIdRef.current === pmId) return;
        const pm = getProjectMasterById(pmId);
        if (!pm) return; // データ未到着の場合は次回 projectMasters 更新で再評価
        lastConsumedPmIdRef.current = pmId;
        setDetailPm(pm);
        // ?pmEdit=1 で編集モード起動。権限ガード: 管理者・マネージャーのみ編集モードを許可し、
        // それ以外のロールがURLを推測して付与しても閲覧モードに落とす（新導線の権限制御）。
        const wantEdit = searchParams?.get('pmEdit') === '1';
        setOpenModalInEditMode(wantEdit && isAdminOrManager);
        const scrollTo = searchParams?.get('scrollTo');
        if (scrollTo === 'files') {
            setTimeout(() => {
                const el = document.getElementById('pm-files-section');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
        }
        const next = new URLSearchParams(searchParams?.toString() || '');
        next.delete('pmId');
        next.delete('scrollTo');
        next.delete('pmEdit');
        // MainContent 側はディープリンク params を持つときは URL 掃除をスキップする規約のため、
        // ここで page/view も併せて削って URL を必ず "/" まで戻す。
        next.delete('page');
        next.delete('view');
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, [searchParams, projectMasters, getProjectMasterById, router, pathname, isAdminOrManager]);

    // 見積/請求カラムのために各ストアを遅延ロード
    useEffect(() => {
        ensureEstimatesLoaded();
        ensureInvoicesLoaded();
        ensureCompanyLoaded();
        ensureCustomersLoaded();
    }, [ensureEstimatesLoaded, ensureInvoicesLoaded, ensureCompanyLoaded, ensureCustomersLoaded]);

    // 案件担当者の表示名マップを取得
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/users', { cache: 'no-store' });
                if (!res.ok) return;
                const users: { id: string; displayName: string }[] = await res.json();
                if (cancelled) return;
                const map: Record<string, string> = {};
                users.forEach(u => { map[u.id] = u.displayName; });
                setManagerMap(map);
            } catch (e) {
                logger.error('担当者一覧の取得に失敗:', e);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const getManagersLabel = useCallback((pm: ProjectMaster): string => {
        const ids = Array.isArray(pm.createdBy) ? pm.createdBy : pm.createdBy ? [pm.createdBy] : [];
        if (ids.length === 0) return '';
        return ids.map(id => managerMap[id] || '...').join('、');
    }, [managerMap]);

    // 工事名称マスタを取得（表示用「〇〇様 場所 工事名称」の合成に使用）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/master-data/construction-suffixes', { cache: 'no-store' });
                if (!res.ok) return;
                const suffixes: { id: string; name: string }[] = await res.json();
                if (cancelled) return;
                const map: Record<string, string> = {};
                suffixes.forEach(s => { map[s.id] = s.name; });
                setSuffixMap(map);
            } catch (e) {
                logger.error('工事名称マスタの取得に失敗:', e);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // 案件一覧の表示タイトル: name + honorific + siteShortName + 工事名称
    // 旧データ（name 未設定）は pm.title をそのまま使用
    const buildListTitle = useCallback((pm: ProjectMaster): string => {
        if (!pm.name) return pm.title;
        const honorific = pm.honorific || '';
        const place = pm.siteShortName ? ` ${pm.siteShortName}` : '';
        const suffixName = pm.constructionSuffixId ? suffixMap[pm.constructionSuffixId] || '' : '';
        const suffixPart = suffixName ? ` ${suffixName}` : '';
        return `${pm.name}${honorific}${place}${suffixPart}`;
    }, [suffixMap]);

    const totalPages = Math.ceil(filteredMasters.length / ITEMS_PER_PAGE);

    const paginatedMasters = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredMasters.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredMasters, currentPage]);

    const handleCreate = async (data: ProjectMasterFormData) => {
        const subcontractorCosts = data.subcontractorCosts
            .filter(r => r.constructionTypeId && r.amount !== '')
            .map(r => {
                const amount = Number(r.amount);
                const tc = r.transportCost === '' ? null : Number(r.transportCost);
                return {
                    constructionTypeId: r.constructionTypeId,
                    amount,
                    transportCost: tc != null && Number.isFinite(tc) && tc >= 0 ? tc : null,
                };
            })
            .filter(r => Number.isFinite(r.amount) && r.amount >= 0);

        const pm = await createProjectMaster({
            title: data.title,
            name: data.name || undefined,
            honorific: data.honorific ?? undefined,
            constructionSuffixId: data.constructionSuffixId || undefined,
            siteShortName: data.siteShortName || undefined,
            customerId: data.customerId || undefined,
            customerName: data.customerName || undefined,
            constructionType: 'other',
            constructionContent: data.constructionContent as string,
            status: 'active',
            postalCode: data.postalCode || undefined,
            prefecture: data.prefecture || undefined,
            city: data.city || undefined,
            location: data.location || undefined,
            plusCode: data.plusCode || undefined,
            latitude: data.latitude ?? undefined,
            longitude: data.longitude ?? undefined,
            area: data.area ? parseFloat(data.area) : undefined,
            areaRemarks: data.areaRemarks || undefined,
            estimatedAssemblyWorkers: data.estimatedAssemblyWorkers ? parseInt(data.estimatedAssemblyWorkers) : undefined,
            estimatedDemolitionWorkers: data.estimatedDemolitionWorkers ? parseInt(data.estimatedDemolitionWorkers) : undefined,
            contractAmount: data.contractAmount ? parseInt(data.contractAmount) : undefined,
            scaffoldingSpec: data.scaffoldingSpec,
            remarks: data.remarks || undefined,
            createdBy: data.createdBy.length > 0 ? data.createdBy : undefined,
            subcontractorCosts,
        });

        // 各作業日のアサインを自動生成
        const assignmentPromises = data.workDates.flatMap((w, _rowIdx) => {
            if (!w.date || w.foremen.length === 0) return [];
            return w.foremen.map((f, i) =>
                fetch('/api/assignments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectMasterId: pm.id,
                        assignedEmployeeId: f.foremanId,
                        date: new Date(`${w.date}T00:00:00Z`).toISOString(),
                        memberCount: f.memberCount,
                        sortOrder: i,
                        estimatedHours: 8.0,
                        constructionType: w.constructionType || undefined,
                    }),
                })
            );
        });
        await Promise.all(assignmentPromises);

        toast.success('案件マスターを作成しました');
    };

    const handleUpdate = async (id: string, data: ProjectMasterFormData) => {
        const subcontractorCosts = data.subcontractorCosts
            .filter(r => r.constructionTypeId && r.amount !== '')
            .map(r => {
                const amount = Number(r.amount);
                const tc = r.transportCost === '' ? null : Number(r.transportCost);
                return {
                    constructionTypeId: r.constructionTypeId,
                    amount,
                    transportCost: tc != null && Number.isFinite(tc) && tc >= 0 ? tc : null,
                };
            })
            .filter(r => Number.isFinite(r.amount) && r.amount >= 0);

        // null を送ることで API 側でフィールドをクリアできる（undefined だと更新対象外になる）
        const updatePayload: Record<string, unknown> = {
            title: data.title,
            name: data.name || null,
            honorific: data.honorific ?? null,
            constructionSuffixId: data.constructionSuffixId || null,
            siteShortName: data.siteShortName || null,
            customerId: data.customerId || null,
            customerName: data.customerName || null,
            constructionContent: (data.constructionContent as string) || null,
            postalCode: data.postalCode || null,
            prefecture: data.prefecture || null,
            city: data.city || null,
            location: data.location || null,
            plusCode: data.plusCode || null,
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
            area: data.area ? parseFloat(data.area) : null,
            areaRemarks: data.areaRemarks || null,
            estimatedAssemblyWorkers: data.estimatedAssemblyWorkers ? parseInt(data.estimatedAssemblyWorkers) : null,
            estimatedDemolitionWorkers: data.estimatedDemolitionWorkers ? parseInt(data.estimatedDemolitionWorkers) : null,
            contractAmount: data.contractAmount ? parseInt(data.contractAmount) : null,
            scaffoldingSpec: data.scaffoldingSpec as ScaffoldingSpec,
            remarks: data.remarks ?? '',
            createdBy: data.createdBy.length > 0 ? data.createdBy : [],
            subcontractorCosts,
        };
        await updateProjectMaster(id, updatePayload as Partial<ProjectMaster>);
        // 作業日程から新規アサインを自動生成
        const assignmentPromises = data.workDates.flatMap((w) => {
            if (!w.date || w.foremen.length === 0) return [];
            return w.foremen.map((f, i) =>
                fetch('/api/assignments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        projectMasterId: id,
                        assignedEmployeeId: f.foremanId,
                        date: new Date(`${w.date}T00:00:00Z`).toISOString(),
                        memberCount: f.memberCount,
                        sortOrder: i,
                        estimatedHours: 8.0,
                        constructionType: w.constructionType || undefined,
                    }),
                })
            );
        });
        await Promise.all(assignmentPromises);

        // 保存後、detailPmをストアの最新データで更新（再編集時にpm.latitudeが古い値にならないよう）
        const updated = getProjectMasterById(id);
        if (updated) setDetailPm(updated);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('この案件マスターを削除してもよろしいですか？\n関連する全ての配置も削除されます。')) return;

        try {
            await deleteProjectMaster(id);
        } catch (error) {
            logger.error('Failed to delete project master:', error);
            toast.error('案件マスターの削除に失敗しました');
        }
    };

    const handleArchive = async (pm: ProjectMaster) => {
        try {
            await updateProjectMaster(pm.id, {
                status: pm.status === 'active' ? 'completed' : 'active',
            });
        } catch (error) {
            logger.error('Failed to update status:', error);
        }
    };

    const getConstructionContentLabel = (content: string | undefined) => {
        if (!content) return '-';
        // 旧enum値の後方互換
        const legacy: Record<string, string> = {
            new_construction: '新築',
            renovation: '改修',
            large_scale: '大規模',
            other: 'その他',
        };
        return legacy[content] || content;
    };

    const handleCreateEstimate = useCallback(() => {
        if (detailPm) {
            setEstimateInitialData({
                projectId: detailPm.id,
                title: `${detailPm.title} 見積書`,
            });
            setDetailPm(null); // 詳細モーダルを閉じる
            setIsEstimateModalOpen(true);
        }
    }, [detailPm]);

    // 済/未判定: API の hasEstimate/hasInvoice か、クライアント側で作成直後の状態も反映
    const hasEstimateFor = useCallback((pm: ProjectMaster) => {
        return pm.hasEstimate || getEstimatesByProject(pm.id).length > 0;
    }, [getEstimatesByProject]);
    const hasInvoiceFor = useCallback((pm: ProjectMaster) => {
        return pm.hasInvoice || getInvoicesByProject(pm.id).length > 0;
    }, [getInvoicesByProject]);

    // 見積「済/未」セルのクリック
    // 1件以上ある場合は常にピッカーを開き、既存閲覧と「新規作成（追加見積書）」のどちらも選べるようにする
    const handleEstimateCellClick = useCallback((pm: ProjectMaster) => {
        const list = getEstimatesByProject(pm.id);
        if (list.length === 0) {
            // 未作成 → 作成モーダル
            setEstimateInitialData({
                projectId: pm.id,
                title: `${pm.title} 見積書`,
            });
            setEditingEstimate(null);
            setIsEstimateModalOpen(true);
        } else {
            setPickerContext({ pm, kind: 'estimate' });
        }
    }, [getEstimatesByProject]);

    // 請求「済/未」セルのクリック
    const handleInvoiceCellClick = useCallback((pm: ProjectMaster) => {
        const list = getInvoicesByProject(pm.id);
        if (list.length === 0) {
            // タイトルは手動入力（「令和〇年〇月〇日締めご請求書」等）のため空のまま
            setInvoiceInitialData({ projectId: pm.id });
            setEditingInvoice(null);
            setIsInvoiceModalOpen(true);
        } else if (list.length === 1) {
            setViewingInvoice(list[0]);
        } else {
            setPickerContext({ pm, kind: 'invoice' });
        }
    }, [getInvoicesByProject]);

    // 詳細モーダル表示中の案件に紐付く最初の見積書
    const estimateForDetailPm = useMemo(() => {
        if (!detailPm) return null;
        const list = getEstimatesByProject(detailPm.id);
        return list.length > 0 ? list[0] : null;
    }, [detailPm, getEstimatesByProject]);

    const handleViewEstimate = useCallback(() => {
        if (!detailPm) return;
        const list = getEstimatesByProject(detailPm.id);
        if (list.length === 0) return;
        if (list.length === 1) {
            setViewingEstimate(list[0]);
            setDetailPm(null);
        } else {
            setPickerContext({ pm: detailPm, kind: 'estimate' });
            setDetailPm(null);
        }
    }, [detailPm, getEstimatesByProject]);

    const handleEstimateSubmit = useCallback(async (data: EstimateInput) => {
        try {
            if (editingEstimate) {
                await updateEstimate(editingEstimate.id, data);
                toast.success('見積書を更新しました');
            } else {
                await addEstimate(data);
                toast.success('見積書を作成しました');
            }
            setIsEstimateModalOpen(false);
            setEditingEstimate(null);
        } catch {
            toast.error(editingEstimate ? '見積書の更新に失敗しました' : '見積書の作成に失敗しました');
        }
    }, [addEstimate, updateEstimate, editingEstimate]);

    // 見積詳細モーダルからの編集/削除/原価更新ハンドラ
    const viewingEstimateProject: Project | null = useMemo(() => {
        if (!viewingEstimate?.projectId) return null;
        const pm = projectMasters.find(p => p.id === viewingEstimate.projectId);
        if (!pm) return null;
        return {
            id: pm.id,
            title: pm.title,
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: pm.customerName || pm.customerShortName || '',
            customerHonorific: '御中',
            location: pm.location || '',
            createdAt: pm.createdAt,
            updatedAt: pm.updatedAt,
        };
    }, [viewingEstimate, projectMasters]);

    const viewingEstimateCustomer = useMemo(() => {
        if (!viewingEstimate?.customerId) return { name: undefined, honorific: undefined };
        const c = customers.find(c => c.id === viewingEstimate.customerId);
        return { name: c?.name, honorific: c?.honorific };
    }, [viewingEstimate, customers]);

    const handleEditEstimateFromDetail = useCallback((est: Estimate) => {
        setEditingEstimate(est);
        setEstimateInitialData({});
        setViewingEstimate(null);
        setIsEstimateModalOpen(true);
    }, []);

    const handleDeleteEstimateFromDetail = useCallback(async (id: string) => {
        try {
            await deleteEstimate(id);
            toast.success('見積書を削除しました');
        } catch {
            toast.error('見積書の削除に失敗しました');
        }
    }, [deleteEstimate]);

    const handleUpdateEstimateCost = useCallback(async (id: string, data: { items: EstimateItem[]; costTotal: number | null }) => {
        try {
            await updateEstimate(id, { items: data.items, costTotal: data.costTotal } as Partial<EstimateInput>);
        } catch (e) {
            logger.error('予算書の保存に失敗:', e);
        }
    }, [updateEstimate]);

    // 請求書: 詳細モーダル用のproject/customer情報
    const viewingInvoiceProject: Project | null = useMemo(() => {
        if (!viewingInvoice?.projectId) return null;
        const pm = projectMasters.find(p => p.id === viewingInvoice.projectId);
        if (!pm) return null;
        return {
            id: pm.id,
            title: pm.title,
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: pm.customerName || pm.customerShortName || '',
            customerHonorific: '御中',
            location: pm.location || '',
            createdAt: pm.createdAt,
            updatedAt: pm.updatedAt,
        };
    }, [viewingInvoice, projectMasters]);

    const viewingInvoiceCustomer = useMemo(() => {
        const empty = { name: undefined, honorific: undefined, postalCode: undefined, address: undefined };
        if (!viewingInvoice) return empty;
        // 1) 請求書に直接紐付いた customerId
        if (viewingInvoice.customerId) {
            const c = customers.find(c => c.id === viewingInvoice.customerId);
            if (c) return { name: c.name, honorific: c.honorific, postalCode: c.postalCode, address: c.address };
        }
        // 2) 案件マスター経由（customerId → 顧客名フォールバック）
        const pm = projectMasters.find(p => p.id === viewingInvoice.projectId);
        if (!pm) return empty;
        if (pm.customerId) {
            const c = customers.find(c => c.id === pm.customerId);
            if (c) return { name: c.name, honorific: c.honorific, postalCode: c.postalCode, address: c.address };
        }
        const customerName = pm.customerName || pm.customerShortName;
        if (!customerName) return empty;
        const c = customers.find(c => c.name === customerName || c.shortName === customerName);
        return {
            name: c?.name || customerName,
            honorific: c?.honorific,
            postalCode: c?.postalCode,
            address: c?.address,
        };
    }, [viewingInvoice, customers, projectMasters]);

    const handleInvoiceSubmit = useCallback(async (data: InvoiceInput) => {
        try {
            if (editingInvoice) {
                await updateInvoice(editingInvoice.id, data);
                toast.success('請求書を更新しました');
            } else {
                await addInvoice(data);
                toast.success('請求書を作成しました');
            }
            setIsInvoiceModalOpen(false);
            setEditingInvoice(null);
        } catch {
            toast.error(editingInvoice ? '請求書の更新に失敗しました' : '請求書の作成に失敗しました');
        }
    }, [addInvoice, updateInvoice, editingInvoice]);

    const handleEditInvoiceFromDetail = useCallback((inv: Invoice) => {
        setEditingInvoice(inv);
        setInvoiceInitialData({});
        setViewingInvoice(null);
        setIsInvoiceModalOpen(true);
    }, []);

    const handleDeleteInvoiceFromDetail = useCallback(async (id: string) => {
        try {
            await deleteInvoice(id);
            toast.success('請求書を削除しました');
        } catch {
            toast.error('請求書の削除に失敗しました');
        }
    }, [deleteInvoice]);

    const openDetailModal = (pm: ProjectMaster) => {
        setDetailPm(pm);
        setOpenModalInEditMode(false);
    };

    const openEditModal = (pm: ProjectMaster) => {
        setDetailPm(pm);
        setOpenModalInEditMode(true);
    };

    const closeModal = () => {
        setDetailPm(null);
        setOpenModalInEditMode(false);
    };

    return (
        <>
            {isCreating && (
                <ProjectMasterCreateModal
                    isOpen={isCreating}
                    onClose={() => setIsCreating(false)}
                    onCreate={handleCreate}
                />
            )}
            <ProjectMasterDetailModal
                pm={detailPm}
                onClose={closeModal}
                onUpdate={handleUpdate}
                initialEditMode={openModalInEditMode}
                onCreateEstimate={isAdminOrManager ? handleCreateEstimate : undefined}
                onViewEstimate={isAdminOrManager && estimateForDetailPm ? handleViewEstimate : undefined}
                readOnly={isForeman2}
            />
            <EstimateModal
                isOpen={isEstimateModalOpen}
                onClose={() => { setIsEstimateModalOpen(false); setEditingEstimate(null); }}
                onSubmit={handleEstimateSubmit}
                initialData={editingEstimate || estimateInitialData}
            />
            {companyInfo && (
                <EstimateDetailModal
                    isOpen={viewingEstimate !== null}
                    onClose={() => setViewingEstimate(null)}
                    estimate={viewingEstimate}
                    project={viewingEstimateProject}
                    customerName={viewingEstimateCustomer.name}
                    customerHonorific={viewingEstimateCustomer.honorific}
                    companyInfo={companyInfo}
                    onDelete={handleDeleteEstimateFromDetail}
                    onEdit={handleEditEstimateFromDetail}
                    onUpdateEstimate={handleUpdateEstimateCost}
                />
            )}
            <InvoiceModal
                isOpen={isInvoiceModalOpen}
                onClose={() => { setIsInvoiceModalOpen(false); setEditingInvoice(null); }}
                onSubmit={handleInvoiceSubmit}
                initialData={editingInvoice || invoiceInitialData}
            />
            {companyInfo && (
                <InvoiceDetailModal
                    isOpen={viewingInvoice !== null}
                    onClose={() => setViewingInvoice(null)}
                    invoice={viewingInvoice}
                    project={viewingInvoiceProject}
                    customerName={viewingInvoiceCustomer.name}
                    customerHonorific={viewingInvoiceCustomer.honorific}
                    customerPostalCode={viewingInvoiceCustomer.postalCode}
                    customerAddress={viewingInvoiceCustomer.address}
                    companyInfo={companyInfo}
                    onDelete={handleDeleteInvoiceFromDetail}
                    onEdit={handleEditInvoiceFromDetail}
                />
            )}
            {/* 複数見積/請求の選択ピッカー */}
            {pickerContext && (
                <div
                    className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4"
                    onClick={() => setPickerContext(null)}
                >
                    <div
                        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-slate-200">
                            <h3 className="text-lg font-bold text-slate-800">
                                {pickerContext.kind === 'estimate' ? '見積書を選択' : '請求書を選択'}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">{pickerContext.pm.title}</p>
                        </div>
                        <div className="flex-1 overflow-auto divide-y divide-slate-100">
                            {(pickerContext.kind === 'estimate'
                                ? getEstimatesByProject(pickerContext.pm.id)
                                : getInvoicesByProject(pickerContext.pm.id)
                            ).map((doc) => {
                                const isEstimate = pickerContext.kind === 'estimate';
                                const number = isEstimate ? (doc as Estimate).estimateNumber : (doc as Invoice).invoiceNumber;
                                return (
                                    <button
                                        key={doc.id}
                                        className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors"
                                        onClick={() => {
                                            if (isEstimate) setViewingEstimate(doc as Estimate);
                                            else setViewingInvoice(doc as Invoice);
                                            setPickerContext(null);
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-semibold text-slate-700">{number}</span>
                                            <span className="text-xs text-slate-500">
                                                ¥{doc.total.toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5 truncate">{doc.title}</div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="px-5 py-3 border-t border-slate-200 flex justify-between">
                            <button
                                className="px-3 py-1.5 text-sm rounded-lg text-slate-600 hover:bg-slate-50"
                                onClick={() => setPickerContext(null)}
                            >
                                キャンセル
                            </button>
                            <button
                                className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-white hover:bg-slate-800"
                                onClick={() => {
                                    if (pickerContext.kind === 'estimate') {
                                        setEstimateInitialData({
                                            projectId: pickerContext.pm.id,
                                            title: `${pickerContext.pm.title} 見積書`,
                                        });
                                        setEditingEstimate(null);
                                        setIsEstimateModalOpen(true);
                                    } else {
                                        setInvoiceInitialData({ projectId: pickerContext.pm.id });
                                        setEditingInvoice(null);
                                        setIsInvoiceModalOpen(true);
                                    }
                                    setPickerContext(null);
                                }}
                            >
                                新規作成
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="h-full flex flex-col overflow-hidden bg-slate-50">
                {/* Header */}
                <div className="flex-shrink-0 flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">案件一覧</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            {filteredMasters.length}件の案件データ
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex-shrink-0 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 mb-4 md:mb-6">
                    {/* Search */}
                    <div className="relative w-full md:flex-1 md:max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="現場名・顧客名・場所で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                        />
                    </div>

                    {/* モバイルではフィルタとボタンを縦積みにし、ボタンを全幅にして
                        「新規登録」テキストの右端見切れを防ぐ。md: 以上は従来の横並びを維持 */}
                    <div className="flex flex-col md:flex-row md:items-center gap-3">
                        {/* Status Filter */}
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="w-full md:w-auto md:flex-none px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                        >
                            <option value="all">全てのステータス</option>
                            <option value="active">進行中</option>
                            <option value="completed">完了</option>
                        </select>

                        {!isForeman2 && (
                            <Button
                                variant="primary"
                                onClick={() => setIsCreating(true)}
                                leftIcon={<Plus className="w-5 h-5" />}
                                // モバイルで全幅、md: 以上はコンテンツ幅で右寄せ表示
                                className="w-full md:w-auto"
                            >
                                <span className="hidden sm:inline">新規案件登録</span>
                                <span className="sm:hidden">新規登録</span>
                            </Button>
                        )}
                    </div>
                </div>

                {/* モバイルカードビュー */}
                <div className="md:hidden flex-1 overflow-y-auto space-y-3">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="animate-spin w-8 h-8 border-4 border-slate-500 border-t-transparent rounded-full"></div>
                        </div>
                    ) : filteredMasters.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            <Calendar className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                            <p>案件マスターがありません</p>
                        </div>
                    ) : (
                        paginatedMasters.map((pm) => (
                            <div
                                key={pm.id}
                                className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => openDetailModal(pm)}
                            >
                                <div className="p-3">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                        <h3 className="text-base font-bold text-slate-800">{buildListTitle(pm)}</h3>
                                        {pm.constructionContent && (
                                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">
                                                {getConstructionContentLabel(pm.constructionContent)}
                                            </span>
                                        )}
                                        {pm.status === 'completed' && (
                                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                                                完了
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
                                        {(pm.customerShortName || pm.customerName) && (
                                            <span className="flex items-center gap-1">
                                                <Building className="w-3.5 h-3.5" />
                                                {pm.customerShortName || pm.customerName}
                                            </span>
                                        )}
                                        {getManagersLabel(pm) && (
                                            <span className="flex items-center gap-1">
                                                <User className="w-3.5 h-3.5" />
                                                {getManagersLabel(pm)}
                                            </span>
                                        )}
                                        {(pm.city || pm.location) && (
                                            <span className="flex items-center gap-1">
                                                <MapPin className="w-3.5 h-3.5" />
                                                {[pm.city, pm.location].filter(Boolean).join('-')}
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1 text-slate-500">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {pm.assignmentCount ?? 0}件
                                        </span>
                                    </div>
                                    {/* 見積書・請求書 済/未（管理者・マネージャーのみ） */}
                                    {isAdminOrManager && (
                                        <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                                            {(() => {
                                                const hasEst = hasEstimateFor(pm);
                                                const hasInv = hasInvoiceFor(pm);
                                                const base = 'inline-flex items-center justify-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed';
                                                const done = 'bg-slate-800 text-white border border-slate-800 hover:bg-slate-900 shadow-sm';
                                                const todo = 'bg-white text-slate-400 border border-slate-200 hover:border-slate-400 hover:text-slate-600';
                                                return (
                                                    <>
                                                        <button
                                                            onClick={() => handleEstimateCellClick(pm)}
                                                            className={`${base} ${hasEst ? done : todo}`}
                                                        >
                                                            {hasEst && <Check className="w-3 h-3" strokeWidth={3} />}
                                                            <span>見積 {hasEst ? '済' : '未'}</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleInvoiceCellClick(pm)}
                                                            className={`${base} ${hasInv ? done : todo}`}
                                                        >
                                                            {hasInv && <Check className="w-3 h-3" strokeWidth={3} />}
                                                            <span>請求 {hasInv ? '済' : '未'}</span>
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    )}
                                    <LastUpdatedLabel updatedAt={pm.updatedAt} updatedBy={pm.updatedBy} />
                                    {/* モバイル: アクションボタン行 */}
                                    {!isForeman2 && (
                                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => openEditModal(pm)}
                                                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            >
                                                <Edit className="w-4 h-4" />
                                                編集
                                            </button>
                                            <button
                                                onClick={() => handleArchive(pm)}
                                                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${pm.status === 'active'
                                                    ? 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                                                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                                                    }`}
                                            >
                                                {pm.status === 'active' ? '完了にする' : '再開する'}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(pm.id)}
                                                className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* デスクトップテーブルビュー */}
                <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    現場名
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    工事内容
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    元請会社
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    担当者
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    所在地
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    配置数
                                </th>
                                {isAdminOrManager && (
                                    <>
                                        <th className="px-4 py-4 text-center text-xs font-bold text-slate-800 uppercase tracking-wider">
                                            見積
                                        </th>
                                        <th className="px-4 py-4 text-center text-xs font-bold text-slate-800 uppercase tracking-wider">
                                            請求
                                        </th>
                                    </>
                                )}
                                {!isForeman2 && (
                                    <th className="px-6 py-4 text-right text-xs font-bold text-slate-800 uppercase tracking-wider">
                                        操作
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {isLoading ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-40"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-28"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                                        {isAdminOrManager && (
                                            <>
                                                <td className="px-4 py-4"><div className="h-4 bg-slate-200 rounded w-10 mx-auto"></div></td>
                                                <td className="px-4 py-4"><div className="h-4 bg-slate-200 rounded w-10 mx-auto"></div></td>
                                            </>
                                        )}
                                        {!isForeman2 && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24 ml-auto"></div></td>}
                                    </tr>
                                ))
                            ) : filteredMasters.length === 0 ? (
                                <tr>
                                    <td colSpan={6 + (isAdminOrManager ? 2 : 0) + (!isForeman2 ? 1 : 0)} className="px-6 py-12 text-center text-slate-500">
                                        {searchTerm || filterStatus !== 'all' ? '検索結果が見つかりませんでした' : '案件マスターがありません'}
                                    </td>
                                </tr>
                            ) : (
                                paginatedMasters.map((pm) => (
                                    <tr
                                        key={pm.id}
                                        className="hover:bg-slate-50 transition-all duration-200 cursor-pointer"
                                        onClick={() => openDetailModal(pm)}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[12px] font-semibold text-slate-900">
                                                    {buildListTitle(pm)}
                                                </span>
                                                {pm.status === 'completed' && (
                                                    <span className="px-2 py-0.5 text-[12px] font-medium rounded-full bg-slate-100 text-slate-600">
                                                        完了
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {pm.constructionContent ? (
                                                <span className="px-2 py-0.5 text-[12px] font-medium rounded-full bg-slate-100 text-slate-700">
                                                    {getConstructionContentLabel(pm.constructionContent)}
                                                </span>
                                            ) : (
                                                <span className="text-[12px] text-slate-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {pm.customerShortName || pm.customerName || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {getManagersLabel(pm) || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {[pm.city, pm.location].filter(Boolean).join('-') || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {pm.assignmentCount ?? 0}件
                                        </td>
                                        {isAdminOrManager && (
                                            <>
                                                <td className="px-4 py-4 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                                                    {(() => {
                                                        const hasEst = hasEstimateFor(pm);
                                                        return (
                                                            <button
                                                                onClick={() => handleEstimateCellClick(pm)}
                                                                title={hasEst ? '見積書を確認' : '見積書を作成'}
                                                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${hasEst ? 'bg-slate-800 text-white border border-slate-800 hover:bg-slate-900 shadow-sm' : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-400 hover:text-slate-600'}`}
                                                            >
                                                                {hasEst && <Check className="w-3 h-3" strokeWidth={3} />}
                                                                {hasEst ? '済' : '未'}
                                                            </button>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                                                    {(() => {
                                                        const hasInv = hasInvoiceFor(pm);
                                                        return (
                                                            <button
                                                                onClick={() => handleInvoiceCellClick(pm)}
                                                                title={hasInv ? '請求書を確認' : '請求書を作成'}
                                                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${hasInv ? 'bg-slate-800 text-white border border-slate-800 hover:bg-slate-900 shadow-sm' : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-400 hover:text-slate-600'}`}
                                                            >
                                                                {hasInv && <Check className="w-3 h-3" strokeWidth={3} />}
                                                                {hasInv ? '済' : '未'}
                                                            </button>
                                                        );
                                                    })()}
                                                </td>
                                            </>
                                        )}
                                        {!isForeman2 && (
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => openEditModal(pm)}
                                                    className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 mr-4 transition-colors"
                                                >
                                                    編集
                                                </button>
                                                <button
                                                    onClick={() => handleArchive(pm)}
                                                    className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors mr-4 ${pm.status === 'active'
                                                        ? 'bg-slate-100 text-slate-700 hover:bg-green-200'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                        }`}
                                                >
                                                    {pm.status === 'active' ? '完了にする' : '再開する'}
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(pm.id)}
                                                    className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                                >
                                                    削除
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex-shrink-0 flex justify-center items-center gap-2 py-3 border-t border-slate-200">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            前へ
                        </button>
                        <span className="text-sm font-medium text-slate-600 px-4">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            次へ
                        </button>
                    </div>
                )}
                </div>
            </div>
        </>
    );
}

export default function ProjectMasterListPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>}>
            <ProjectMasterListPageContent />
        </Suspense>
    );
}
