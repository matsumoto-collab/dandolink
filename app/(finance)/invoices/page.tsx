'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { useInvoices } from '@/hooks/useInvoices';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCompany } from '@/hooks/useCompany';
import { useCustomers } from '@/hooks/useCustomers';
import { useDebounce } from '@/hooks/useDebounce';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit, Trash2, Search, FileText, CheckCircle, Clock, AlertCircle, Loader2, UserCheck, ChevronDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import StatusPillSelect, { type StatusOption } from '@/components/ui/StatusPillSelect';
import toast from 'react-hot-toast';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
import { PaymentStatusBadge } from '@/components/Invoices/PaymentStatusBadge';
import { paymentStatusLabel, todayYmd } from '@/lib/invoicePayments';
import InvoicePaymentQuickPopover, { type PaymentPopoverAnchor } from '@/components/Invoices/InvoicePaymentQuickPopover';
import { logger } from '@/lib/logger';
import { matchesSearch } from '@/utils/searchNormalize';
import { extractAssigneeIds } from '@/lib/projectAssignees';

// モーダルを遅延読み込み
const InvoiceModal = dynamic(
    () => import('@/components/Invoices/InvoiceModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

const InvoiceDetailModal = dynamic(
    () => import('@/components/Invoices/InvoiceDetailModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

// CSV セルのエスケープ（現金出納帳・領収書と同じ実装）
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// CSV 用の日付表示（Excel が日付として認識できる YYYY/MM/DD）
const csvDate = (d: Date | string | undefined): string => {
    if (!d) return '';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
};

// 一覧から直接変更できるステータス選択肢（getStatusInfo が扱う 5 種。cancelled は UI 非対応のため除外）
const INVOICE_STATUS_OPTIONS: StatusOption[] = [
    { value: 'draft', label: '下書き' },
    { value: 'confirmed', label: '担当確認済み' },
    { value: 'sent', label: '送付済み' },
    { value: 'paid', label: '支払済み' },
    { value: 'overdue', label: '期限超過' },
];

export default function InvoiceListPage() {
    const { data: session } = useSession();
    // 税理士(accountant)は閲覧のみ。作成・編集・削除の入口を出さない（API 側でも 403）
    const canEdit = session?.user?.role === 'admin' || session?.user?.role === 'manager';
    const { invoices, isInitialized, ensureDataLoaded, addInvoice, updateInvoice, deleteInvoice, refreshInvoices } = useInvoices();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
        ensureCompanyLoaded();
        ensureCustomersLoaded();
        fetchProjectMasters();
    }, [ensureDataLoaded, ensureCompanyLoaded, ensureCustomersLoaded, fetchProjectMasters]);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    // 案件担当者フィルタ（その請求書に含まれる案件の担当者で絞り込み）
    const [assigneeIdFilter, setAssigneeIdFilter] = useState('');
    // 作成日フィルタ（範囲・YYYY-MM-DD。空なら無制限）
    const [createdFrom, setCreatedFrom] = useState('');
    const [createdTo, setCreatedTo] = useState('');
    // /api/users の id → displayName マップ（案件担当者の名前解決用）
    const [userMap, setUserMap] = useState<Record<string, string>>({});
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    // 一覧からステータス変更中の請求書 ID（多重送信防止用）
    const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
    // クイック入金ポップオーバー（入金状況バッジをクリックで開く。anchor はバッジの画面座標）
    const [paymentPopover, setPaymentPopover] = useState<{ invoiceId: string; anchor: PaymentPopoverAnchor } | null>(null);

    // プロジェクト名を取得（複数案件対応）
    const getProjectName = useCallback((invoice: Invoice) => {
        // 複数案件
        if (invoice.projectMasters && invoice.projectMasters.length > 1) {
            return `${invoice.projectMasters[0].title} 他${invoice.projectMasters.length - 1}件`;
        }
        if (invoice.projectMasters && invoice.projectMasters.length === 1) {
            return invoice.projectMasters[0].title;
        }
        // レガシー
        if (!invoice.projectId) return null;
        const pm = projectMasters.find(p => p.id === invoice.projectId);
        return pm?.title ?? null;
    }, [projectMasters]);

    // 顧客名を取得（請求書自身の customerId を優先＝案件未紐付けでも顧客を表示。無ければ案件経由）
    const getCustomerName = useCallback((invoice: Invoice) => {
        if (invoice.customerId) {
            const c = customers.find(c => c.id === invoice.customerId);
            if (c) return c.shortName || c.name;
        }
        const projectId = invoice.projectId;
        if (!projectId) return null;
        const pm = projectMasters.find(p => p.id === projectId);
        if (!pm) return null;
        // customerId があればそちらから取得
        if (pm.customerId) {
            const c = customers.find(c => c.id === pm.customerId);
            return c?.shortName || c?.name || null;
        }
        // customerName / customerShortName から取得
        const customerName = pm.customerName || pm.customerShortName;
        if (!customerName) return null;
        const c = customers.find(c => c.name === customerName || c.shortName === customerName);
        return c?.shortName || c?.name || customerName;
    }, [projectMasters, customers]);

    // 顧客情報を取得（DetailModal/PDF用。請求書自身の customerId を優先＝案件未紐付けでも顧客を表示）
    const getCustomerInfo = useCallback((invoice: Invoice) => {
        const empty = { name: undefined, honorific: undefined, postalCode: undefined, address: undefined };
        if (invoice.customerId) {
            const c = customers.find(c => c.id === invoice.customerId);
            if (c) return { name: c.name, honorific: c.honorific, postalCode: c.postalCode, address: c.address };
        }
        const projectId = invoice.projectId;
        if (!projectId) return empty;
        const pm = projectMasters.find(p => p.id === projectId);
        if (!pm) return empty;
        if (pm.customerId) {
            const c = customers.find(c => c.id === pm.customerId);
            return { name: c?.name, honorific: c?.honorific, postalCode: c?.postalCode, address: c?.address };
        }
        const customerName = pm.customerName || pm.customerShortName;
        if (!customerName) return empty;
        const c = customers.find(c => c.name === customerName || c.shortName === customerName);
        return { name: c?.name || customerName, honorific: c?.honorific, postalCode: c?.postalCode, address: c?.address };
    }, [projectMasters, customers]);

    // ステータスアイコンとカラー（灰=未完成 / 橙=送付待ち / 青=入金待ち / 緑=完了 / 赤=超過）
    const getStatusInfo = (status: Invoice['status']) => {
        switch (status) {
            case 'draft':
                return { icon: Clock, color: 'text-slate-600', bg: 'bg-slate-100', label: '下書き' };
            case 'confirmed':
                return { icon: UserCheck, color: 'text-amber-700', bg: 'bg-amber-100', label: '担当確認済み' };
            case 'sent':
                return { icon: FileText, color: 'text-blue-700', bg: 'bg-blue-100', label: '送付済み' };
            case 'paid':
                return { icon: CheckCircle, color: 'text-green-700', bg: 'bg-green-100', label: '支払済み' };
            case 'overdue':
                return { icon: AlertCircle, color: 'text-red-700', bg: 'bg-red-100', label: '期限超過' };
        }
    };

    // /api/users から id → displayName マップを構築（案件担当者の解決用）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/users', { cache: 'no-store' });
                if (!res.ok) return;
                const users: Array<{ id: string; displayName: string }> = await res.json();
                if (cancelled) return;
                const map: Record<string, string> = {};
                for (const u of users) map[u.id] = u.displayName;
                setUserMap(map);
            } catch (e) {
                logger.error('ユーザー一覧の取得に失敗:', e);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // 案件 ID → 案件担当者の User ID 配列（ProjectMaster.createdBy 由来）
    const projectAssigneeIds = useMemo(() => {
        const m = new Map<string, string[]>();
        for (const pm of projectMasters) m.set(pm.id, extractAssigneeIds(pm.createdBy));
        return m;
    }, [projectMasters]);

    // 顧客 ID → その顧客に紐づく案件群の担当者 User ID（ユニーク）。
    // 案件未紐付けの請求書（顧客のみ）で案件担当者を引けないときのフォールバック用。
    const customerAssigneeIds = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const pm of projectMasters) {
            if (!pm.customerId) continue;
            const set = m.get(pm.customerId) ?? new Set<string>();
            for (const aid of extractAssigneeIds(pm.createdBy)) set.add(aid);
            m.set(pm.customerId, set);
        }
        return m;
    }, [projectMasters]);

    // 請求書に紐づく案件マスタ ID（複数案件 projectMasters + レガシー projectId + 明細行タグを集約）
    // 明細行の projectMasterId は、締めまとめ等で中間テーブル/代表案件が無くても
    // 実際に束ねた案件を特定できるため担当者解決のソースに含める。
    const getInvoiceProjectIds = useCallback((invoice: Invoice): string[] => {
        const ids = new Set<string>();
        if (invoice.projectMasters) {
            for (const pm of invoice.projectMasters) if (pm.id) ids.add(pm.id);
        }
        if (invoice.projectId) ids.add(invoice.projectId);
        for (const it of invoice.items ?? []) if (it.projectMasterId) ids.add(it.projectMasterId);
        return Array.from(ids);
    }, []);

    // 請求書に含まれる案件担当者の User ID（ユニーク）
    const getInvoiceAssigneeIds = useCallback((invoice: Invoice): string[] => {
        const set = new Set<string>();
        for (const pid of getInvoiceProjectIds(invoice)) {
            for (const aid of (projectAssigneeIds.get(pid) ?? [])) set.add(aid);
        }
        // 案件から担当者を一切引けない（顧客のみ請求書で明細タグも無い等）場合は、
        // その顧客に紐づく案件群の担当者を集約してフォールバック表示する。
        if (set.size === 0 && invoice.customerId) {
            for (const aid of (customerAssigneeIds.get(invoice.customerId) ?? [])) set.add(aid);
        }
        return Array.from(set);
    }, [getInvoiceProjectIds, projectAssigneeIds, customerAssigneeIds]);

    // 請求書に含まれる案件担当者の表示名（「、」連結）
    const getInvoiceAssigneeNames = useCallback((invoice: Invoice): string => {
        return getInvoiceAssigneeIds(invoice).map(id => userMap[id]).filter(Boolean).join('、');
    }, [getInvoiceAssigneeIds, userMap]);

    // 担当者フィルタの選択肢（請求書群に実際に含まれる担当者のユニーク一覧、名前順）
    const assigneeOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const inv of invoices) {
            for (const id of getInvoiceAssigneeIds(inv)) {
                const name = userMap[id];
                if (name && !seen.has(id)) seen.set(id, name);
            }
        }
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [invoices, getInvoiceAssigneeIds, userMap]);

    // フィルタリング（useMemoでメモ化）
    const filteredInvoices = useMemo(() => {
        const fromTs = createdFrom ? new Date(`${createdFrom}T00:00:00`).getTime() : null;
        const toTs = createdTo ? new Date(`${createdTo}T23:59:59.999`).getTime() : null;
        return invoices
            .filter(inv => {
                const q = debouncedSearchTerm;
                const matched = matchesSearch(inv.title, q) ||
                    matchesSearch(inv.invoiceNumber, q) ||
                    matchesSearch(getProjectName(inv), q) ||
                    matchesSearch(getCustomerName(inv), q) ||
                    matchesSearch(getInvoiceAssigneeNames(inv), q);
                const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
                const matchesAssignee = !assigneeIdFilter || getInvoiceAssigneeIds(inv).includes(assigneeIdFilter);
                const createdTs = new Date(inv.createdAt).getTime();
                const matchesCreated =
                    (fromTs === null || createdTs >= fromTs) &&
                    (toTs === null || createdTs <= toTs);
                return matched && matchesStatus && matchesAssignee && matchesCreated;
            })
            .sort((a, b) => {
                const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                if (byDate !== 0) return byDate;
                // 作成日が同一（同じ締め日でまとめた請求書など）でも並びが揺れないよう請求番号で決定的に並べる
                return (b.invoiceNumber || '').localeCompare(a.invoiceNumber || '', 'ja', { numeric: true });
            });
    }, [invoices, debouncedSearchTerm, statusFilter, assigneeIdFilter, createdFrom, createdTo, getProjectName, getCustomerName, getInvoiceAssigneeNames, getInvoiceAssigneeIds]);

    // フィルター変更時にページをリセット
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, statusFilter, assigneeIdFilter, createdFrom, createdTo]);

    const totalPages = Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE);
    const paginatedInvoices = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredInvoices.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredInvoices, currentPage]);

    // CSV出力（検索・フィルタ・並び順を反映した表示中の全件。ページングは無視）
    const exportCsv = () => {
        // 案件名は画面の「他N件」省略ではなく全件を「、」連結で出す
        const projectNames = (inv: Invoice): string => {
            if (inv.projectMasters && inv.projectMasters.length > 0) {
                return inv.projectMasters.map((pm) => pm.title).filter(Boolean).join('、');
            }
            if (!inv.projectId) return '';
            return projectMasters.find((p) => p.id === inv.projectId)?.title ?? '';
        };
        const header = ['請求番号', 'タイトル', '顧客名', '案件名', '担当者', '小計(税抜)', '消費税', '合計(税込)', '入金状況', '入金額', '手数料', '残額', 'ステータス', '支払期限', '作成日'];
        const rows = filteredInvoices.map((inv) => {
            const s = inv.paymentSummary;
            // legacyPaid（入金記録なしの旧「支払済み」）は入金額が不明のため空欄にし、残額のみ 0 を出す
            const hasPayments = !!s && s.paymentCount > 0;
            return [
                inv.invoiceNumber || '',
                inv.title || '',
                getCustomerName(inv) ?? '',
                projectNames(inv),
                getInvoiceAssigneeNames(inv),
                String(inv.subtotal ?? 0),
                String(inv.tax ?? 0),
                String(inv.total ?? 0),
                s ? paymentStatusLabel(s.paymentStatus) : '',
                hasPayments ? String(s.paidAmount) : '',
                hasPayments ? String(s.feeAmount) : '',
                s ? String(s.remaining) : '',
                INVOICE_STATUS_OPTIONS.find((o) => o.value === inv.status)?.label ?? inv.status,
                csvDate(inv.dueDate),
                csvDate(inv.createdAt),
            ];
        });
        // 先頭は UTF-8 BOM（Excel で文字化けさせないため）
        const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `請求書一覧_${todayYmd()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDelete = async (id: string) => {
        if (confirm('この請求書を削除してもよろしいですか?')) {
            try {
                await deleteInvoice(id);
            } catch (error) {
                logger.error('Failed to delete invoice:', error);
                toast.error(error instanceof Error ? error.message : '請求書の削除に失敗しました');
            }
        }
    };

    const handleAddNew = () => {
        setEditingInvoice(null);
        setIsModalOpen(true);
    };

    const handleEdit = (invoice: Invoice) => {
        setEditingInvoice(invoice);
        setIsModalOpen(true);
    };

    const handleOpenDetail = (invoice: Invoice) => {
        setSelectedInvoice(invoice);
        setIsDetailModalOpen(true);
    };

    // 入金状況バッジのクリックでクイック入金ポップオーバーを開く（行クリックの詳細モーダルとは別動線）
    const handleOpenPaymentPopover = useCallback((invoice: Invoice, anchorEl: HTMLElement) => {
        const r = anchorEl.getBoundingClientRect();
        setPaymentPopover({
            invoiceId: invoice.id,
            anchor: { top: r.top, left: r.left, bottom: r.bottom, right: r.right },
        });
    }, []);

    // ポップオーバー表示中の請求書（refreshInvoices 後も最新の paymentSummary を渡せるよう id で引き直す）
    const popoverInvoice = useMemo(
        () => (paymentPopover ? invoices.find((i) => i.id === paymentPopover.invoiceId) ?? null : null),
        [paymentPopover, invoices]
    );

    // 一覧から直接ステータスを変更（編集モーダルを開かずに更新）
    const handleStatusChange = useCallback(async (invoice: Invoice, newStatus: string) => {
        if (newStatus === invoice.status) return;
        setStatusUpdatingId(invoice.id);
        try {
            await updateInvoice(invoice.id, { status: newStatus } as Partial<InvoiceInput>);
            toast.success('ステータスを変更しました');
        } catch (error) {
            logger.error('Failed to update invoice status:', error);
            toast.error(error instanceof Error ? error.message : 'ステータスの変更に失敗しました');
        } finally {
            setStatusUpdatingId(null);
        }
    }, [updateInvoice]);

    const handleSubmit = async (data: InvoiceInput) => {
        try {
            setIsSubmitting(true);
            if (editingInvoice) {
                await updateInvoice(editingInvoice.id, data);
            } else {
                await addInvoice(data);
            }
            setIsModalOpen(false);
            setEditingInvoice(null);
        } catch (error) {
            logger.error('Failed to save invoice:', error);
            toast.error(error instanceof Error ? error.message : '請求書の保存に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    // DetailModal用のProject生成
    const getProjectForInvoice = useCallback((projectId: string) => {
        if (!projectId) return null;
        const pm = projectMasters.find(p => p.id === projectId);
        if (!pm) return null;
        return {
            id: pm.id,
            title: pm.title,
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: pm.customerName || pm.customerShortName || '',
            location: pm.location || '',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }, [projectMasters]);

    // 詳細（PDFプレビュー）モーダルへ渡す案件・顧客情報を安定参照化する。
    // これらを毎レンダリング新しいオブジェクトで渡すと、モーダル側の PDF 生成 useEffect が
    // 参照変化で再発火し、印刷タブから戻った際などにプレビューが再生成されてちらつく。
    const detailProject = useMemo(
        () => (selectedInvoice ? getProjectForInvoice(selectedInvoice.projectId || '') : null),
        [selectedInvoice, getProjectForInvoice]
    );
    const detailCustomerInfo = useMemo(
        () => (selectedInvoice ? getCustomerInfo(selectedInvoice) : null),
        [selectedInvoice, getCustomerInfo]
    );

    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー（モバイルは新規作成をタイトル行へ統合・説明文非表示） */}
            <div className="mb-3 sm:mb-6 flex-shrink-0 flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
                        請求書一覧
                    </h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">登録されている全ての請求書を管理できます</p>
                </div>
                {/* CSV出力は閲覧のみ（税理士等）でも使えるよう canEdit の外に置く */}
                <div className="sm:hidden flex-shrink-0 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={exportCsv}
                        disabled={filteredInvoices.length === 0}
                        title="表示中の請求書をCSVでダウンロード"
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />CSV
                    </button>
                    {canEdit && (
                    <Button
                        variant="primary"
                        onClick={handleAddNew}
                        leftIcon={<Plus className="w-5 h-5" />}
                    >
                        新規作成
                    </Button>
                    )}
                </div>
            </div>


            {/* ツールバー（モバイルは 検索+ステータス / 担当者 / 作成日 の3段に圧縮） */}
            <div className="mb-3 sm:mb-6 flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 sm:gap-4">
                {/* 検索バーとフィルター */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4 flex-1">
                    {/* モバイル行1: 検索+ステータス（sm+ では従来どおりフラットに並ぶ） */}
                    <div className="flex flex-row gap-2 sm:contents">
                        {/* 検索バー */}
                        <div className="flex-1 sm:max-w-md relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                            <input
                                type="text"
                                placeholder="請求番号、タイトル、担当者で検索..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                            />
                        </div>

                        {/* ステータスフィルター */}
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="flex-shrink-0 max-w-[45%] sm:max-w-none px-3 sm:px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        >
                            <option value="all">全てのステータス</option>
                            <option value="draft">下書き</option>
                            <option value="confirmed">担当確認済み</option>
                            <option value="sent">送付済み</option>
                            <option value="paid">支払済み</option>
                            <option value="overdue">期限超過</option>
                        </select>
                    </div>

                    {/* 案件担当者フィルター */}
                    <select
                        value={assigneeIdFilter}
                        onChange={(e) => setAssigneeIdFilter(e.target.value)}
                        className="px-3 sm:px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="">全ての担当者</option>
                        {assigneeOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                    </select>

                    {/* 作成日フィルター（範囲。「作成日」ラベルは sm+ のみ） */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="hidden sm:inline text-sm text-slate-500 whitespace-nowrap">作成日</span>
                        <input
                            type="date"
                            value={createdFrom}
                            max={createdTo || undefined}
                            onChange={(e) => setCreatedFrom(e.target.value)}
                            aria-label="作成日（開始）"
                            className="flex-1 sm:flex-none min-w-0 px-2 sm:px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm text-sm"
                        />
                        <span className="text-slate-400 flex-shrink-0">〜</span>
                        <input
                            type="date"
                            value={createdTo}
                            min={createdFrom || undefined}
                            onChange={(e) => setCreatedTo(e.target.value)}
                            aria-label="作成日（終了）"
                            className="flex-1 sm:flex-none min-w-0 px-2 sm:px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm text-sm"
                        />
                        {(createdFrom || createdTo) && (
                            <button
                                type="button"
                                onClick={() => { setCreatedFrom(''); setCreatedTo(''); }}
                                className="flex-shrink-0 text-xs text-slate-500 hover:text-slate-700 underline whitespace-nowrap"
                            >
                                クリア
                            </button>
                        )}
                    </div>
                </div>

                {/* CSV出力＋新規追加ボタン（sm+ のみ。モバイルはタイトル行に表示）
                    CSV出力は閲覧のみ（税理士等）でも使えるよう canEdit の外に置く */}
                <div className="hidden sm:flex flex-shrink-0 items-center gap-2">
                    <button
                        type="button"
                        onClick={exportCsv}
                        disabled={filteredInvoices.length === 0}
                        title="表示中の請求書をCSVでダウンロード"
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />CSV出力
                    </button>
                    {canEdit && (
                    <Button
                        variant="primary"
                        onClick={handleAddNew}
                        leftIcon={<Plus className="w-5 h-5" />}
                    >
                        新規請求書作成
                    </Button>
                    )}
                </div>
            </div>

            {/* モバイルカードビュー */}
            <div className="md:hidden flex-1 overflow-auto">
                {!isInitialized ? (
                    <div className="grid grid-cols-1 gap-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="bg-white border border-slate-200 rounded-lg p-4 animate-pulse">
                                <div className="h-5 bg-slate-200 rounded w-32 mb-3"></div>
                                <div className="h-4 bg-slate-200 rounded w-48 mb-2"></div>
                                <div className="h-6 bg-slate-200 rounded w-24 mb-2"></div>
                                <div className="h-5 bg-slate-200 rounded-full w-20"></div>
                            </div>
                        ))}
                    </div>
                ) : filteredInvoices.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-lg">
                        <p className="text-slate-500">
                            {searchTerm || statusFilter !== 'all' ? '検索結果が見つかりませんでした' : '請求書が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedInvoices.map((invoice) => {
                            const statusInfo = getStatusInfo(invoice.status);

                            return (
                                <div
                                    key={invoice.id}
                                    className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer"
                                    onClick={() => handleOpenDetail(invoice)}
                                >
                                    {/* ヘッダー: 請求番号とアクション */}
                                    <div className="flex items-start justify-between mb-3">
                                        <span className="text-base font-semibold text-slate-600">
                                            {invoice.invoiceNumber}
                                        </span>
                                        {canEdit && (
                                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleEdit(invoice)}
                                                className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                                title="編集"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(invoice.id)}
                                                className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        )}
                                    </div>

                                    {/* タイトル */}
                                    <div className="text-sm font-medium text-slate-800 mb-2 break-words">
                                        {invoice.title || '(タイトル未設定)'}
                                    </div>

                                    {/* 顧客名 */}
                                    {getCustomerName(invoice) && (
                                        <div className="text-sm text-slate-600 mb-1">{getCustomerName(invoice)}</div>
                                    )}

                                    {/* 案件担当者 */}
                                    {getInvoiceAssigneeNames(invoice) && (
                                        <div className="text-xs text-slate-500 mb-3">担当: {getInvoiceAssigneeNames(invoice)}</div>
                                    )}

                                    {/* 金額 */}
                                    <div className="text-lg font-bold text-slate-900 mb-2">
                                        ¥{invoice.total.toLocaleString()}
                                    </div>

                                    {/* 入金状況（タップでその場から入金を登録） */}
                                    <div className="mb-3">
                                        <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleOpenPaymentPopover(invoice, e.currentTarget); }}
                                            className="inline-flex items-center gap-1.5 -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-slate-100 active:bg-slate-100 transition-colors"
                                            title="入金を登録・確認"
                                            aria-label="入金を登録・確認"
                                        >
                                            <PaymentStatusBadge summary={invoice.paymentSummary} showRemaining />
                                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                                        </button>
                                    </div>

                                    {/* ステータス（一覧から直接変更可）と支払期限 */}
                                    <div className="flex items-center justify-between">
                                        <StatusPillSelect
                                            value={invoice.status}
                                            options={INVOICE_STATUS_OPTIONS}
                                            colorClass={`${statusInfo.bg} ${statusInfo.color}`}
                                            disabled={statusUpdatingId === invoice.id}
                                            onChange={(s) => handleStatusChange(invoice, s)}
                                        />
                                        <span className="text-xs text-slate-500">
                                            期限: {formatDate(invoice.dueDate, 'short')}
                                        </span>
                                    </div>
                                    <LastUpdatedLabel updatedAt={invoice.updatedAt} updatedBy={invoice.updatedBy} />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
            <div className="flex-1 overflow-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                請求番号
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider min-w-[220px]">
                                タイトル
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                顧客名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                担当者
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                金額
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                入金状況
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                ステータス
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                支払期限
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                作成日
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-800 uppercase tracking-wider">
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {!isInitialized ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-40"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                                    <td className="px-6 py-4"><div className="h-5 bg-slate-200 rounded-full w-16"></div></td>
                                    <td className="px-6 py-4"><div className="h-6 bg-slate-200 rounded-full w-16"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4 text-right"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
                                </tr>
                            ))
                        ) : filteredInvoices.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                                    {searchTerm || statusFilter !== 'all' || assigneeIdFilter || createdFrom || createdTo ? '検索結果が見つかりませんでした' : '請求書が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            paginatedInvoices.map((invoice) => {
                                const statusInfo = getStatusInfo(invoice.status);

                                return (
                                    <tr
                                        key={invoice.id}
                                        className="hover:bg-slate-50 transition-all duration-200 cursor-pointer"
                                        onClick={() => handleOpenDetail(invoice)}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-[12px] font-semibold text-slate-600">
                                                {invoice.invoiceNumber}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 min-w-[220px]">
                                            <span className="text-[12px] text-slate-800 break-words">
                                                {invoice.title || '(タイトル未設定)'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {getCustomerName(invoice) || '−'}
                                        </td>
                                        <td className="px-6 py-4 text-[12px] text-slate-700">
                                            {getInvoiceAssigneeNames(invoice) || '−'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] font-semibold text-slate-900">
                                            ¥{invoice.total.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); handleOpenPaymentPopover(invoice, e.currentTarget); }}
                                                className="group/pay inline-flex items-center gap-1.5 -mx-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                                                title="入金を登録・確認"
                                                aria-label="入金を登録・確認"
                                            >
                                                <PaymentStatusBadge summary={invoice.paymentSummary} showRemaining />
                                                <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover/pay:text-slate-600" />
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <StatusPillSelect
                                                value={invoice.status}
                                                options={INVOICE_STATUS_OPTIONS}
                                                colorClass={`${statusInfo.bg} ${statusInfo.color}`}
                                                disabled={statusUpdatingId === invoice.id}
                                                onChange={(s) => handleStatusChange(invoice, s)}
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {formatDate(invoice.dueDate, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {formatDate(invoice.createdAt, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium" onClick={(e) => e.stopPropagation()}>
                                            {canEdit && (
                                            <>
                                            <button
                                                onClick={() => handleEdit(invoice)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 mr-2 transition-colors"
                                            >
                                                編集
                                            </button>
                                            <button
                                                onClick={() => handleDelete(invoice.id)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                            >
                                                削除
                                            </button>
                                            </>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

                {/* ページネーション */}
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

            {/* 統計情報 */}
            <div className="mt-4 flex-shrink-0 text-sm text-slate-600">
                全 {filteredInvoices.length} 件の請求書
                {(searchTerm || statusFilter !== 'all' || assigneeIdFilter || createdFrom || createdTo) && ` (${invoices.length}件中)`}
            </div>

            {/* 編集モーダル */}
            <InvoiceModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                initialData={editingInvoice || undefined}
            />

            {/* 詳細（PDFプレビュー）モーダル */}
            {companyInfo && (
                <InvoiceDetailModal
                    isOpen={isDetailModalOpen}
                    onClose={() => { setIsDetailModalOpen(false); setSelectedInvoice(null); }}
                    invoice={selectedInvoice}
                    project={detailProject}
                    companyInfo={companyInfo}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    customerName={detailCustomerInfo?.name}
                    customerHonorific={detailCustomerInfo?.honorific}
                    customerPostalCode={detailCustomerInfo?.postalCode}
                    customerAddress={detailCustomerInfo?.address}
                    onPaymentsChanged={refreshInvoices}
                />
            )}

            {/* クイック入金ポップオーバー（一覧の入金状況バッジから直接登録） */}
            {paymentPopover && popoverInvoice && (
                <InvoicePaymentQuickPopover
                    invoice={popoverInvoice}
                    anchor={paymentPopover.anchor}
                    onClose={() => setPaymentPopover(null)}
                    onChanged={refreshInvoices}
                />
            )}
        </div>
    );
}
