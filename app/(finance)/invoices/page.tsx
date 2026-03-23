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
import { Plus, Edit, Trash2, Search, FileText, CheckCircle, Clock, AlertCircle, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';

// モーダルを遅延読み込み
const InvoiceModal = dynamic(
    () => import('@/components/Invoices/InvoiceModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

const InvoiceDetailModal = dynamic(
    () => import('@/components/Invoices/InvoiceDetailModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

export default function InvoiceListPage() {
    const { invoices, isLoading, isInitialized, ensureDataLoaded, addInvoice, updateInvoice, deleteInvoice } = useInvoices();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { companyInfo } = useCompany();
    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
        ensureCustomersLoaded();
        fetchProjectMasters();
    }, [ensureDataLoaded, ensureCustomersLoaded, fetchProjectMasters]);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

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

    // 顧客名を取得
    const getCustomerName = useCallback((projectId: string) => {
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

    // 顧客情報を取得（DetailModal用）
    const getCustomerInfo = useCallback((projectId: string) => {
        if (!projectId) return { name: undefined, honorific: undefined };
        const pm = projectMasters.find(p => p.id === projectId);
        if (!pm) return { name: undefined, honorific: undefined };
        if (pm.customerId) {
            const c = customers.find(c => c.id === pm.customerId);
            return { name: c?.name, honorific: c?.honorific };
        }
        const customerName = pm.customerName || pm.customerShortName;
        if (!customerName) return { name: undefined, honorific: undefined };
        const c = customers.find(c => c.name === customerName || c.shortName === customerName);
        return { name: c?.name || customerName, honorific: c?.honorific };
    }, [projectMasters, customers]);

    // ステータスアイコンとカラー
    const getStatusInfo = (status: Invoice['status']) => {
        switch (status) {
            case 'draft':
                return { icon: Clock, color: 'text-slate-500', bg: 'bg-slate-100', label: '下書き' };
            case 'sent':
                return { icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100', label: '送付済み' };
            case 'paid':
                return { icon: CheckCircle, color: 'text-slate-600', bg: 'bg-slate-100', label: '支払済み' };
            case 'overdue':
                return { icon: AlertCircle, color: 'text-slate-600', bg: 'bg-slate-100', label: '期限超過' };
        }
    };

    // フィルタリング（useMemoでメモ化）
    const filteredInvoices = useMemo(() => {
        return invoices
            .filter(inv => {
                const matchesSearch = inv.title.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    inv.invoiceNumber.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    (getProjectName(inv) ?? '').toLowerCase().includes(debouncedSearchTerm.toLowerCase());
                const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [invoices, debouncedSearchTerm, statusFilter, getProjectName]);

    const handleDelete = async (id: string) => {
        if (confirm('この請求書を削除してもよろしいですか?')) {
            try {
                await deleteInvoice(id);
            } catch (error) {
                console.error('Failed to delete invoice:', error);
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
            console.error('Failed to save invoice:', error);
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
        <div className="p-4 sm:p-6 h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-slate-800 mb-2">
                    請求書一覧
                </h1>
                <p className="text-slate-600">登録されている全ての請求書を管理できます</p>
            </div>


            {/* ツールバー */}
            <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                {/* 検索バーとフィルター */}
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
                    {/* 検索バー */}
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="請求番号、案件名で検索..."
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
                        <option value="sent">送付済み</option>
                        <option value="paid">支払済み</option>
                        <option value="overdue">期限超過</option>
                    </select>
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
                {!isInitialized || isLoading ? (
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
                        {filteredInvoices.map((invoice) => {
                            const statusInfo = getStatusInfo(invoice.status);
                            const StatusIcon = statusInfo.icon;

                            return (
                                <div
                                    key={invoice.id}
                                    className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow"
                                >
                                    {/* ヘッダー: 請求番号とアクション */}
                                    <div className="flex items-start justify-between mb-3">
                                        <button
                                            onClick={() => handleOpenDetail(invoice)}
                                            className="text-base font-semibold text-slate-600 hover:text-slate-700 hover:underline transition-colors"
                                        >
                                            {invoice.invoiceNumber}
                                        </button>
                                        <div className="flex gap-2">
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

                                    {/* 案件名 */}
                                    {getProjectName(invoice) ? (
                                        <button
                                            onClick={() => handleOpenDetail(invoice)}
                                            className="text-sm text-slate-700 hover:text-slate-600 hover:underline transition-colors mb-3 block text-left"
                                        >
                                            {getProjectName(invoice)}
                                        </button>
                                    ) : (
                                        <div className="text-sm text-slate-500 mb-3">案件未紐付け</div>
                                    )}

                                    {/* 顧客名 */}
                                    {getCustomerName(invoice.projectId || '') && (
                                        <div className="text-sm text-slate-600 mb-3">{getCustomerName(invoice.projectId || '')}</div>
                                    )}

                                    {/* 金額 */}
                                    <div className="text-lg font-bold text-slate-900 mb-3">
                                        ¥{invoice.total.toLocaleString()}
                                    </div>

                                    {/* ステータスと支払期限 */}
                                    <div className="flex items-center justify-between">
                                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                                            <StatusIcon className="w-4 h-4" />
                                            {statusInfo.label}
                                        </span>
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
            <div className="hidden md:block flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                請求番号
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                案件名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                顧客名
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
                        {!isInitialized || isLoading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
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
                                <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                                    {searchTerm || statusFilter !== 'all' ? '検索結果が見つかりませんでした' : '請求書が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            filteredInvoices.map((invoice) => {
                                const statusInfo = getStatusInfo(invoice.status);
                                const StatusIcon = statusInfo.icon;

                                return (
                                    <tr
                                        key={invoice.id}
                                        className="hover:bg-slate-50 transition-all duration-200"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <button
                                                onClick={() => handleOpenDetail(invoice)}
                                                className="text-sm font-semibold text-slate-600 hover:text-slate-700 hover:underline transition-colors"
                                            >
                                                {invoice.invoiceNumber}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getProjectName(invoice) ? (
                                                <button
                                                    onClick={() => handleOpenDetail(invoice)}
                                                    className="text-sm text-slate-700 hover:text-slate-600 hover:underline transition-colors"
                                                >
                                                    {getProjectName(invoice)}
                                                </button>
                                            ) : (
                                                <span className="text-sm text-slate-500">案件未紐付け</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                            {getCustomerName(invoice.projectId || '') || '−'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                                            ¥{invoice.total.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                                                <StatusIcon className="w-4 h-4" />
                                                {statusInfo.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                            {formatDate(invoice.dueDate, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700">
                                            {formatDate(invoice.createdAt, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleOpenDetail(invoice)}
                                                className="text-slate-600 hover:text-slate-700 mr-4 transition-colors"
                                                title="PDFプレビュー"
                                            >
                                                <Download className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleEdit(invoice)}
                                                className="text-slate-600 hover:text-slate-700 mr-4 transition-colors"
                                                title="編集"
                                            >
                                                <Edit className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(invoice.id)}
                                                className="text-slate-600 hover:text-slate-700 transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* 統計情報 */}
            <div className="mt-4 text-sm text-slate-600">
                全 {filteredInvoices.length} 件の請求書
                {(searchTerm || statusFilter !== 'all') && ` (${invoices.length}件中)`}
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
                    customerName={selectedInvoice ? getCustomerInfo(selectedInvoice.projectId || '').name : undefined}
                    customerHonorific={selectedInvoice ? getCustomerInfo(selectedInvoice.projectId || '').honorific : undefined}
                />
            )}
        </div>
    );
}
