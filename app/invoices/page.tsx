'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useInvoices } from '@/contexts/InvoiceContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useDebounce } from '@/hooks/useDebounce';
import { Invoice, InvoiceInput } from '@/types/invoice';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit2, Trash2, Search, FileText, CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';

// モーダルを遅延読み込み
const InvoiceModal = dynamic(
    () => import('@/components/Invoices/InvoiceModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

export default function InvoiceListPage() {
    const { invoices, ensureDataLoaded, addInvoice, updateInvoice, deleteInvoice } = useInvoices();
    const { projects } = useProjects();

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
    }, [ensureDataLoaded]);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // プロジェクト名を取得（useCallbackでメモ化）
    const getProjectName = useCallback((projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        return project?.title || '不明な案件';
    }, [projects]);

    // ステータスアイコンとカラー
    const getStatusInfo = (status: Invoice['status']) => {
        switch (status) {
            case 'draft':
                return { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100', label: '下書き' };
            case 'sent':
                return { icon: FileText, color: 'text-blue-600', bg: 'bg-blue-100', label: '送付済み' };
            case 'paid':
                return { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', label: '支払済み' };
            case 'overdue':
                return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100', label: '期限超過' };
        }
    };

    // フィルタリング（useMemoでメモ化）
    const filteredInvoices = useMemo(() => {
        return invoices
            .filter(inv => {
                const matchesSearch = inv.title.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    inv.invoiceNumber.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    getProjectName(inv.projectId).toLowerCase().includes(debouncedSearchTerm.toLowerCase());
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
                alert(error instanceof Error ? error.message : '請求書の削除に失敗しました');
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
            alert(error instanceof Error ? error.message : '請求書の保存に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    // 統計情報（useMemoでメモ化）
    const stats = useMemo(() => ({
        total: invoices.length,
        draft: invoices.filter(i => i.status === 'draft').length,
        sent: invoices.filter(i => i.status === 'sent').length,
        paid: invoices.filter(i => i.status === 'paid').length,
        overdue: invoices.filter(i => i.status === 'overdue').length,
        totalAmount: invoices.filter(i => i.status !== 'draft').reduce((sum, i) => sum + i.total, 0),
        unpaidAmount: invoices.filter(i => i.status === 'sent' || i.status === 'overdue').reduce((sum, i) => sum + i.total, 0),
    }), [invoices]);

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-gray-50 to-white w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent mb-2">
                    請求書一覧
                </h1>
                <p className="text-gray-600">登録されている全ての請求書を管理できます</p>
            </div>

            {/* 統計カード */}
            <div className="grid grid-cols-5 gap-4 mb-6">
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600 mb-1">全体</div>
                    <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-blue-600 mb-1">送付済み</div>
                    <div className="text-2xl font-bold text-blue-600">{stats.sent}</div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-green-600 mb-1">支払済み</div>
                    <div className="text-2xl font-bold text-green-600">{stats.paid}</div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-red-600 mb-1">期限超過</div>
                    <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-200">
                    <div className="text-sm text-orange-600 mb-1">未回収</div>
                    <div className="text-lg font-bold text-orange-600">¥{stats.unpaidAmount.toLocaleString()}</div>
                </div>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex items-center justify-between gap-4">
                {/* 検索バー */}
                <div className="flex-1 max-w-md relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="請求番号、案件名で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                    />
                </div>

                {/* ステータスフィルター */}
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                >
                    <option value="all">全てのステータス</option>
                    <option value="draft">下書き</option>
                    <option value="sent">送付済み</option>
                    <option value="paid">支払済み</option>
                    <option value="overdue">期限超過</option>
                </select>

                {/* 新規追加ボタン */}
                <button
                    onClick={handleAddNew}
                    className="
                        flex items-center gap-2 px-5 py-2.5
                        bg-gradient-to-r from-blue-600 to-blue-700
                        text-white font-semibold rounded-lg
                        hover:from-blue-700 hover:to-blue-800
                        active:scale-95
                        transition-all duration-200 shadow-md hover:shadow-lg
                    "
                >
                    <Plus className="w-5 h-5" />
                    新規請求書作成
                </button>
            </div>

            {/* テーブル */}
            <div className="flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gradient-to-r from-gray-100 to-gray-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                請求番号
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                案件名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                金額
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                ステータス
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                支払期限
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                作成日
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-gray-800 uppercase tracking-wider">
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {filteredInvoices.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
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
                                        className="hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-200"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm font-semibold text-gray-900">
                                                {invoice.invoiceNumber}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                            {getProjectName(invoice.projectId)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                            ¥{invoice.total.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                                                <StatusIcon className="w-4 h-4" />
                                                {statusInfo.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                            {formatDate(invoice.dueDate, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                            {formatDate(invoice.createdAt, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleEdit(invoice)}
                                                className="text-blue-600 hover:text-blue-800 mr-4 transition-colors"
                                                title="編集"
                                            >
                                                <Edit2 className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(invoice.id)}
                                                className="text-red-600 hover:text-red-800 transition-colors"
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
            <div className="mt-4 text-sm text-gray-600">
                全 {filteredInvoices.length} 件の請求書
                {(searchTerm || statusFilter !== 'all') && ` (${invoices.length}件中)`}
            </div>

            {/* モーダル */}
            <InvoiceModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                initialData={editingInvoice || undefined}
            />
        </div>
    );
}
