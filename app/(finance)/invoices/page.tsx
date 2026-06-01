'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useInvoices } from '@/hooks/useInvoices';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCompany } from '@/hooks/useCompany';
import { useCustomers } from '@/hooks/useCustomers';
import { useDebounce } from '@/hooks/useDebounce';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit, Trash2, Search, FileText, CheckCircle, Clock, AlertCircle, Loader2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import StatusPillSelect, { type StatusOption } from '@/components/ui/StatusPillSelect';
import toast from 'react-hot-toast';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
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

// 一覧から直接変更できるステータス選択肢（getStatusInfo が扱う 5 種。cancelled は UI 非対応のため除外）
const INVOICE_STATUS_OPTIONS: StatusOption[] = [
    { value: 'draft', label: '下書き' },
    { value: 'confirmed', label: '担当確認済み' },
    { value: 'sent', label: '送付済み' },
    { value: 'paid', label: '支払済み' },
    { value: 'overdue', label: '期限超過' },
];

export default function InvoiceListPage() {
    const { invoices, isInitialized, ensureDataLoaded, addInvoice, updateInvoice, deleteInvoice } = useInvoices();
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

    // ステータスアイコンとカラー
    const getStatusInfo = (status: Invoice['status']) => {
        switch (status) {
            case 'draft':
                return { icon: Clock, color: 'text-slate-500', bg: 'bg-slate-100', label: '下書き' };
            case 'confirmed':
                return { icon: UserCheck, color: 'text-slate-600', bg: 'bg-slate-100', label: '担当確認済み' };
            case 'sent':
                return { icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100', label: '送付済み' };
            case 'paid':
                return { icon: CheckCircle, color: 'text-slate-600', bg: 'bg-slate-100', label: '支払済み' };
            case 'overdue':
                return { icon: AlertCircle, color: 'text-slate-600', bg: 'bg-slate-100', label: '期限超過' };
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

    // 請求書に紐づく案件マスタ ID（複数案件 projectMasters + レガシー projectId を集約）
    const getInvoiceProjectIds = useCallback((invoice: Invoice): string[] => {
        const ids = new Set<string>();
        if (invoice.projectMasters) {
            for (const pm of invoice.projectMasters) if (pm.id) ids.add(pm.id);
        }
        if (invoice.projectId) ids.add(invoice.projectId);
        return Array.from(ids);
    }, []);

    // 請求書に含まれる案件担当者の User ID（ユニーク）
    const getInvoiceAssigneeIds = useCallback((invoice: Invoice): string[] => {
        const set = new Set<string>();
        for (const pid of getInvoiceProjectIds(invoice)) {
            for (const aid of (projectAssigneeIds.get(pid) ?? [])) set.add(aid);
        }
        return Array.from(set);
    }, [getInvoiceProjectIds, projectAssigneeIds]);

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
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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

    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6 flex-shrink-0">
                <h1 className="text-2xl font-bold text-slate-800">
                    請求書一覧
                </h1>
                <p className="text-sm text-slate-500 mt-1">登録されている全ての請求書を管理できます</p>
            </div>


            {/* ツールバー */}
            <div className="mb-6 flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                {/* 検索バーとフィルター */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 flex-1">
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
                        className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="all">全てのステータス</option>
                        <option value="draft">下書き</option>
                        <option value="confirmed">担当確認済み</option>
                        <option value="sent">送付済み</option>
                        <option value="paid">支払済み</option>
                        <option value="overdue">期限超過</option>
                    </select>

                    {/* 案件担当者フィルター */}
                    <select
                        value={assigneeIdFilter}
                        onChange={(e) => setAssigneeIdFilter(e.target.value)}
                        className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="">全ての担当者</option>
                        {assigneeOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                    </select>

                    {/* 作成日フィルター（範囲） */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-slate-500 whitespace-nowrap">作成日</span>
                        <input
                            type="date"
                            value={createdFrom}
                            max={createdTo || undefined}
                            onChange={(e) => setCreatedFrom(e.target.value)}
                            aria-label="作成日（開始）"
                            className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm text-sm"
                        />
                        <span className="text-slate-400">〜</span>
                        <input
                            type="date"
                            value={createdTo}
                            min={createdFrom || undefined}
                            onChange={(e) => setCreatedTo(e.target.value)}
                            aria-label="作成日（終了）"
                            className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm text-sm"
                        />
                        {(createdFrom || createdTo) && (
                            <button
                                type="button"
                                onClick={() => { setCreatedFrom(''); setCreatedTo(''); }}
                                className="text-xs text-slate-500 hover:text-slate-700 underline whitespace-nowrap"
                            >
                                クリア
                            </button>
                        )}
                    </div>
                </div>

                {/* 新規追加ボタン */}
                <Button
                    variant="primary"
                    onClick={handleAddNew}
                    leftIcon={<Plus className="w-5 h-5" />}
                >
                    <span className="hidden sm:inline">新規請求書作成</span>
                    <span className="sm:hidden">新規作成</span>
                </Button>
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
                                    <div className="text-lg font-bold text-slate-900 mb-3">
                                        ¥{invoice.total.toLocaleString()}
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
                                    <td className="px-6 py-4"><div className="h-6 bg-slate-200 rounded-full w-16"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4 text-right"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
                                </tr>
                            ))
                        ) : filteredInvoices.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
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
                    project={selectedInvoice ? getProjectForInvoice(selectedInvoice.projectId || '') : null}
                    companyInfo={companyInfo}
                    onDelete={handleDelete}
                    onEdit={handleEdit}
                    customerName={selectedInvoice ? getCustomerInfo(selectedInvoice).name : undefined}
                    customerHonorific={selectedInvoice ? getCustomerInfo(selectedInvoice).honorific : undefined}
                    customerPostalCode={selectedInvoice ? getCustomerInfo(selectedInvoice).postalCode : undefined}
                    customerAddress={selectedInvoice ? getCustomerInfo(selectedInvoice).address : undefined}
                />
            )}
        </div>
    );
}
