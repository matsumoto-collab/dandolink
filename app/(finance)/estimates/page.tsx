'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useEstimates } from '@/hooks/useEstimates';
import { useProjects } from '@/hooks/useProjects';
import { useCompany } from '@/hooks/useCompany';
import { useDebounce } from '@/hooks/useDebounce';
import { Estimate, EstimateInput } from '@/types/estimate';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit, Trash2, Search, FileText, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

// 大きなモーダルコンポーネントを遅延読み込み
const EstimateModal = dynamic(
    () => import('@/components/Estimates/EstimateModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);
const EstimateDetailModal = dynamic(
    () => import('@/components/Estimates/EstimateDetailModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

export default function EstimateListPage() {
    const { estimates, isLoading, isInitialized, ensureDataLoaded, addEstimate, updateEstimate, deleteEstimate } = useEstimates();
    const { projects } = useProjects();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
        ensureCompanyLoaded();
    }, [ensureDataLoaded, ensureCompanyLoaded]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // プロジェクト名を取得（useCallbackでメモ化）
    const getProjectName = useCallback((projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        return project?.title || '不明な案件';
    }, [projects]);

    // ステータスアイコンとカラー
    const getStatusInfo = (status: Estimate['status']) => {
        switch (status) {
            case 'draft':
                return { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-100', label: '下書き' };
            case 'sent':
                return { icon: FileText, color: 'text-blue-600', bg: 'bg-blue-100', label: '送付済み' };
            case 'approved':
                return { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', label: '承認済み' };
            case 'rejected':
                return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100', label: '却下' };
        }
    };

    // フィルタリング（useMemoでメモ化）
    const filteredEstimates = useMemo(() => {
        return estimates
            .filter(est => {
                const matchesSearch = est.title.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    est.estimateNumber.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
                    getProjectName(est.projectId ?? '').toLowerCase().includes(debouncedSearchTerm.toLowerCase());
                const matchesStatus = statusFilter === 'all' || est.status === statusFilter;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [estimates, debouncedSearchTerm, statusFilter, getProjectName]);

    const handleDelete = async (id: string) => {
        if (confirm('この見積書を削除してもよろしいですか?')) {
            try {
                await deleteEstimate(id);
            } catch (error) {
                console.error('Failed to delete estimate:', error);
                toast.error(error instanceof Error ? error.message : '見積書の削除に失敗しました');
            }
        }
    };

    const handleAddNew = () => {
        setEditingEstimate(null);
        setIsModalOpen(true);
    };

    const handleEdit = (estimate: Estimate) => {
        setEditingEstimate(estimate);
        setIsModalOpen(true);
    };

    const handleSubmit = async (data: EstimateInput) => {
        try {
            setIsSubmitting(true);
            if (editingEstimate) {
                await updateEstimate(editingEstimate.id, data);
            } else {
                await addEstimate(data);
            }
            setIsModalOpen(false);
            setEditingEstimate(null);
        } catch (error) {
            console.error('Failed to save estimate:', error);
            toast.error(error instanceof Error ? error.message : '見積書の保存に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };


    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-gray-50 to-white w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent mb-2">
                    見積書一覧
                </h1>
                <p className="text-gray-600">登録されている全ての見積書を管理できます</p>
            </div>


            {/* ツールバー */}
            <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                {/* 検索バーとフィルター */}
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
                    {/* 検索バー */}
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="見積番号、案件名で検索..."
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
                        <option value="approved">承認済み</option>
                        <option value="rejected">却下</option>
                    </select>
                </div>

                {/* 新規追加ボタン */}
                <button
                    onClick={handleAddNew}
                    className="
                        flex items-center justify-center gap-2 px-5 py-2.5
                        bg-gradient-to-r from-blue-600 to-blue-700
                        text-white font-semibold rounded-lg
                        hover:from-blue-700 hover:to-blue-800
                        active:scale-95
                        transition-all duration-200 shadow-md hover:shadow-lg
                    "
                >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">新規見積書作成</span>
                    <span className="sm:hidden">新規作成</span>
                </button>
            </div>

            {/* モバイルカードビュー */}
            <div className="md:hidden flex-1 overflow-auto">
                {!isInitialized || isLoading ? (
                    <div className="grid grid-cols-1 gap-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="bg-white border border-gray-200 rounded-lg p-4 animate-pulse">
                                <div className="h-5 bg-gray-200 rounded w-32 mb-3"></div>
                                <div className="h-4 bg-gray-200 rounded w-48 mb-2"></div>
                                <div className="h-6 bg-gray-200 rounded w-24 mb-2"></div>
                                <div className="h-5 bg-gray-200 rounded-full w-20"></div>
                            </div>
                        ))}
                    </div>
                ) : filteredEstimates.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg">
                        <p className="text-gray-500">
                            {searchTerm || statusFilter !== 'all' ? '検索結果が見つかりませんでした' : '見積書が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredEstimates.map((estimate) => {
                            const statusInfo = getStatusInfo(estimate.status);
                            const StatusIcon = statusInfo.icon;

                            return (
                                <div
                                    key={estimate.id}
                                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow"
                                >
                                    {/* ヘッダー: 見積番号とアクション */}
                                    <div className="flex items-start justify-between mb-3">
                                        <button
                                            onClick={() => {
                                                setSelectedEstimate(estimate);
                                                setIsDetailModalOpen(true);
                                            }}
                                            className="text-base font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                                        >
                                            {estimate.estimateNumber}
                                        </button>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleEdit(estimate)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="編集"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(estimate.id)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 案件名 */}
                                    <button
                                        onClick={() => {
                                            setSelectedEstimate(estimate);
                                            setIsDetailModalOpen(true);
                                        }}
                                        className="text-sm text-gray-700 hover:text-blue-600 hover:underline transition-colors mb-3 block text-left"
                                    >
                                        {getProjectName(estimate.projectId ?? '')}
                                    </button>

                                    {/* 金額 */}
                                    <div className="text-lg font-bold text-gray-900 mb-3">
                                        ¥{estimate.total.toLocaleString()}
                                    </div>

                                    {/* ステータスと日付 */}
                                    <div className="flex items-center justify-between">
                                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                                            <StatusIcon className="w-4 h-4" />
                                            {statusInfo.label}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            有効期限: {formatDate(estimate.validUntil, 'short')}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:block flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gradient-to-r from-gray-100 to-gray-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                見積番号
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
                                有効期限
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
                        {!isInitialized || isLoading ? (
                            /* 読み込み中はスケルトン表示 */
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                                    <td className="px-6 py-4"><div className="h-6 bg-gray-200 rounded-full w-16"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4 text-right"><div className="h-4 bg-gray-200 rounded w-16 ml-auto"></div></td>
                                </tr>
                            ))
                        ) : filteredEstimates.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                                    {searchTerm || statusFilter !== 'all' ? '検索結果が見つかりませんでした' : '見積書が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            filteredEstimates.map((estimate) => {
                                const statusInfo = getStatusInfo(estimate.status);
                                const StatusIcon = statusInfo.icon;

                                return (
                                    <tr
                                        key={estimate.id}
                                        className="hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-200"
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <button
                                                onClick={() => {
                                                    setSelectedEstimate(estimate);
                                                    setIsDetailModalOpen(true);
                                                }}
                                                className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                                            >
                                                {estimate.estimateNumber}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <button
                                                onClick={() => {
                                                    setSelectedEstimate(estimate);
                                                    setIsDetailModalOpen(true);
                                                }}
                                                className="text-sm text-gray-700 hover:text-blue-600 hover:underline transition-colors"
                                            >
                                                {getProjectName(estimate.projectId ?? '')}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                            ¥{estimate.total.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                                                <StatusIcon className="w-4 h-4" />
                                                {statusInfo.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                            {formatDate(estimate.validUntil, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                            {formatDate(estimate.createdAt, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleEdit(estimate)}
                                                className="text-blue-600 hover:text-blue-800 mr-4 transition-colors"
                                                title="編集"
                                            >
                                                <Edit className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(estimate.id)}
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
                全 {filteredEstimates.length} 件の見積書
                {(searchTerm || statusFilter !== 'all') && ` (${estimates.length}件中)`}
            </div>

            {/* 編集モーダル */}
            <EstimateModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                initialData={editingEstimate || undefined}
            />

            {/* 詳細モーダル */}
            {companyInfo && (
                <EstimateDetailModal
                    isOpen={isDetailModalOpen}
                    onClose={() => {
                        setIsDetailModalOpen(false);
                        setSelectedEstimate(null);
                    }}
                    estimate={selectedEstimate}
                    project={selectedEstimate ? projects.find(p => p.id === selectedEstimate.projectId) || null : null}
                    companyInfo={companyInfo}
                    onDelete={deleteEstimate}
                    onEdit={(estimate) => {
                        setEditingEstimate(estimate);
                        setIsModalOpen(true);
                    }}
                />
            )}
        </div>
    );
}
