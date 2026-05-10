'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useEstimates } from '@/hooks/useEstimates';
import { useProjects } from '@/hooks/useProjects';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCompany } from '@/hooks/useCompany';
import { useCustomers } from '@/hooks/useCustomers';
import { useDebounce } from '@/hooks/useDebounce';
import { Estimate, EstimateInput } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Edit, Trash2, Search, FileText, CheckCircle, XCircle, Clock, Loader2, Link2Off, Copy, Check } from 'lucide-react';
import { useCalendarStore } from '@/stores/calendarStore';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
import { logger } from '@/lib/logger';

// 大きなモーダルコンポーネントを遅延読み込み
const ProjectModal = dynamic(
    () => import('@/components/Projects/ProjectModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);
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
    const { addProject } = useProjects();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
        ensureCompanyLoaded();
        ensureCustomersLoaded();
        fetchProjectMasters();
    }, [ensureDataLoaded, ensureCompanyLoaded, ensureCustomersLoaded, fetchProjectMasters]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [selectedEstimate, setSelectedEstimate] = useState<Estimate | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // 案件作成モーダル（見積書から案件を作成）
    const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
    const [projectModalInitialData, setProjectModalInitialData] = useState<Partial<Project>>({});
    const pendingLinkEstimateIdRef = useRef<string | null>(null);

    // プロジェクト名を取得（projectMasterIdで検索）
    const getProjectName = useCallback((projectMasterId: string) => {
        if (!projectMasterId) return null;
        const pm = projectMasters.find(p => p.id === projectMasterId);
        return pm?.title ?? null;
    }, [projectMasters]);

    // 顧客名を取得
    const getCustomerName = useCallback((customerId?: string) => {
        if (!customerId) return null;
        const c = customers.find(c => c.id === customerId);
        return c?.shortName || c?.name || null;
    }, [customers]);

    // ステータスアイコンとカラー
    const getStatusInfo = (status: Estimate['status']) => {
        switch (status) {
            case 'draft':
                return { icon: Clock, color: 'text-slate-500', bg: 'bg-slate-100', label: '下書き' };
            case 'sent':
                return { icon: FileText, color: 'text-slate-600', bg: 'bg-slate-100', label: '送付済み' };
            case 'approved':
                return { icon: CheckCircle, color: 'text-slate-600', bg: 'bg-slate-100', label: '承認済み' };
            case 'rejected':
                return { icon: XCircle, color: 'text-slate-600', bg: 'bg-slate-100', label: '却下' };
        }
    };

    // フィルタリング（useMemoでメモ化）
    const filteredEstimates = useMemo(() => {
        return estimates
            .filter(est => {
                const q = debouncedSearchTerm.toLowerCase();
                const matchesSearch = est.title.toLowerCase().includes(q) ||
                    est.estimateNumber.toLowerCase().includes(q) ||
                    (getProjectName(est.projectId ?? '') ?? '').toLowerCase().includes(q) ||
                    (getCustomerName(est.customerId) ?? '').toLowerCase().includes(q);
                const matchesStatus = statusFilter === 'all' || est.status === statusFilter;
                return matchesSearch && matchesStatus;
            })
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [estimates, debouncedSearchTerm, statusFilter, getProjectName, getCustomerName]);

    // フィルター変更時にページをリセット
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, statusFilter]);

    const totalPages = Math.ceil(filteredEstimates.length / ITEMS_PER_PAGE);
    const paginatedEstimates = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredEstimates.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredEstimates, currentPage]);

    const handleDelete = async (id: string) => {
        if (confirm('この見積書を削除してもよろしいですか?')) {
            try {
                await deleteEstimate(id);
            } catch (error) {
                logger.error('Failed to delete estimate:', error);
                toast.error(error instanceof Error ? error.message : '見積書の削除に失敗しました');
            }
        }
    };

    const handleAddNew = () => {
        setEditingEstimate(null);
        setIsModalOpen(true);
    };

    // 見積書から案件を作成するフロー
    const handleCreateProjectFromEstimate = useCallback((estimate: Estimate) => {
        pendingLinkEstimateIdRef.current = estimate.id;
        setProjectModalInitialData({
            title: estimate.title.replace(/\s*見積書\s*$/, '').trim() || estimate.title,
        });
        setIsDetailModalOpen(false);
        setIsProjectModalOpen(true);
    }, []);

    // 案件作成完了 → estimate.projectId(=projectMasterId) を自動更新
    const handleSubmitProjectFromEstimate = useCallback(async (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => {
        const beforeMasterIds = new Set(useCalendarStore.getState().projectMasters.map((m) => m.id));
        await addProject(data);
        const newMaster = useCalendarStore.getState().projectMasters.find((m) => !beforeMasterIds.has(m.id));
        const estimateId = pendingLinkEstimateIdRef.current;
        if (newMaster && estimateId) {
            try {
                await updateEstimate(estimateId, { projectId: newMaster.id } as EstimateInput);
                toast.success('見積書と案件を紐付けました');
            } catch {
                toast.error('案件の紐付けに失敗しました。手動で紐付けてください。');
            }
        } else if (estimateId && !newMaster) {
            // 既存マスターにマッチした場合、assignmentのprojectMasterIdから取得
            const newAssignment = useCalendarStore.getState().assignments.find((a) => !beforeMasterIds.has(a.id));
            const masterId = newAssignment?.projectMasterId;
            if (masterId) {
                try {
                    await updateEstimate(estimateId, { projectId: masterId } as EstimateInput);
                    toast.success('見積書と案件を紐付けました');
                } catch {
                    toast.error('案件の紐付けに失敗しました。手動で紐付けてください。');
                }
            }
        }
        pendingLinkEstimateIdRef.current = null;
        setIsProjectModalOpen(false);
    }, [addProject, updateEstimate]);

    const handleEdit = (estimate: Estimate) => {
        setEditingEstimate(estimate);
        setIsModalOpen(true);
    };

    // 見積書コピー
    const handleCopy = (estimate: Estimate) => {
        setEditingEstimate(null);
        // コピー元のデータを初期値として新規作成（番号・ステータスはリセット）
        setCopySource({
            projectId: estimate.projectId,
            customerId: estimate.customerId,
            title: estimate.title,
            items: estimate.items.map(item => ({ ...item, id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })),
            notes: estimate.notes,
        });
        setIsModalOpen(true);
    };
    const [copySource, setCopySource] = useState<Partial<EstimateInput> | null>(null);

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
            logger.error('Failed to save estimate:', error);
            toast.error(error instanceof Error ? error.message : '見積書の保存に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };


    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6 flex-shrink-0">
                <h1 className="text-2xl font-bold text-slate-800">
                    見積書一覧
                </h1>
                <p className="text-sm text-slate-500 mt-1">登録されている全ての見積書を管理できます</p>
            </div>


            {/* ツールバー */}
            <div className="mb-6 flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                {/* 検索バーとフィルター */}
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
                    {/* 検索バー */}
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="タイトル、見積番号、案件名で検索..."
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
                        <option value="approved">承認済み</option>
                        <option value="rejected">却下</option>
                    </select>
                </div>

                {/* 新規追加ボタン */}
                <Button
                    variant="primary"
                    onClick={handleAddNew}
                    leftIcon={<Plus className="w-5 h-5" />}
                >
                    <span className="hidden sm:inline">新規見積書作成</span>
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
                ) : filteredEstimates.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-lg">
                        <p className="text-slate-500">
                            {searchTerm || statusFilter !== 'all' ? '検索結果が見つかりませんでした' : '見積書が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedEstimates.map((estimate) => {
                            const statusInfo = getStatusInfo(estimate.status);
                            const StatusIcon = statusInfo.icon;

                            return (
                                <div
                                    key={estimate.id}
                                    className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer"
                                    onClick={() => {
                                        setSelectedEstimate(estimate);
                                        setIsDetailModalOpen(true);
                                    }}
                                >
                                    {/* ヘッダー: タイトルとアクション */}
                                    <div className="flex items-start justify-between mb-3 gap-2">
                                        <span className="text-base font-semibold text-slate-800 min-w-0 flex-1 break-words">
                                            {estimate.title || '(タイトル未設定)'}
                                        </span>
                                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleCopy(estimate)}
                                                className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                                title="コピーして新規作成"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleEdit(estimate)}
                                                className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                                title="編集"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(estimate.id)}
                                                className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 紐づけバッジ */}
                                    {(() => {
                                        const linked = !!getProjectName(estimate.projectId ?? '');
                                        return (
                                            <div className="mb-3">
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md ${linked ? 'bg-slate-800 text-white border border-slate-800' : 'bg-white text-slate-400 border border-slate-200'}`}
                                                >
                                                    {linked ? <Check className="w-3 h-3" strokeWidth={3} /> : <Link2Off className="w-3 h-3" />}
                                                    {linked ? '紐づけ済' : '紐づけ未'}
                                                </span>
                                            </div>
                                        );
                                    })()}

                                    {/* 顧客名 */}
                                    {getCustomerName(estimate.customerId) && (
                                        <div className="text-sm text-slate-600 mb-3">{getCustomerName(estimate.customerId)}</div>
                                    )}

                                    {/* 金額 */}
                                    <div className="text-lg font-bold text-slate-900 mb-3">
                                        ¥{estimate.total.toLocaleString()}
                                    </div>

                                    {/* ステータスと日付 */}
                                    <div className="flex items-center justify-between gap-2">
                                        {/* バッジ側はモバイルで縮められるよう min-w-0 truncate */}
                                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold min-w-0 ${statusInfo.bg} ${statusInfo.color}`}>
                                            <StatusIcon className="w-4 h-4 flex-shrink-0" />
                                            <span className="truncate">{statusInfo.label}</span>
                                        </span>
                                        {/* 有効期限が右端で見切れないよう flex-shrink-0 + whitespace-nowrap */}
                                        <span className="text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">
                                            有効期限: {formatDate(estimate.validUntil, 'short')}
                                        </span>
                                    </div>
                                    <LastUpdatedLabel updatedAt={estimate.updatedAt} updatedBy={estimate.updatedBy} />
                                </div>
                            );
                        })}
                    </div>
                )}
                {/* モバイルページネーション */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2 py-3">
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

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
            <div className="flex-1 overflow-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider min-w-[280px]">
                                タイトル
                            </th>
                            <th className="px-4 py-4 text-center text-xs font-bold text-slate-800 uppercase tracking-wider">
                                紐づけ
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                顧客名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                金額
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                粗利率
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                ステータス
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                有効期限
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
                            /* 読み込み中はスケルトン表示 */
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-64"></div></td>
                                    <td className="px-4 py-4 text-center"><div className="h-5 bg-slate-200 rounded-md w-10 mx-auto"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-14"></div></td>
                                    <td className="px-6 py-4"><div className="h-6 bg-slate-200 rounded-full w-16"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4 text-right"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
                                </tr>
                            ))
                        ) : filteredEstimates.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                                    {searchTerm || statusFilter !== 'all' ? '検索結果が見つかりませんでした' : '見積書が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            paginatedEstimates.map((estimate) => {
                                const statusInfo = getStatusInfo(estimate.status);
                                const StatusIcon = statusInfo.icon;

                                return (
                                    <tr
                                        key={estimate.id}
                                        className="hover:bg-slate-50 transition-all duration-200 cursor-pointer"
                                        onClick={() => {
                                            setSelectedEstimate(estimate);
                                            setIsDetailModalOpen(true);
                                        }}
                                    >
                                        <td className="px-6 py-4 min-w-[280px]">
                                            <span className="text-[13px] font-semibold text-slate-800 break-words">
                                                {estimate.title || '(タイトル未設定)'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap text-center">
                                            {(() => {
                                                const linked = !!getProjectName(estimate.projectId ?? '');
                                                return (
                                                    <span
                                                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md ${linked ? 'bg-slate-800 text-white border border-slate-800' : 'bg-white text-slate-400 border border-slate-200'}`}
                                                    >
                                                        {linked && <Check className="w-3 h-3" strokeWidth={3} />}
                                                        {linked ? '済' : '未'}
                                                    </span>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {getCustomerName(estimate.customerId) || '−'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] font-semibold text-slate-900">
                                            ¥{estimate.total.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px]">
                                            {estimate.costTotal != null && estimate.subtotal > 0 ? (
                                                (() => {
                                                    const rate = ((estimate.subtotal - estimate.costTotal) / estimate.subtotal) * 100;
                                                    const color = rate < 0 ? 'bg-red-100 text-red-700' : rate < 15 ? 'bg-yellow-100 text-yellow-700' : rate < 30 ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-700';
                                                    return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{rate.toFixed(1)}%</span>;
                                                })()
                                            ) : (
                                                <span className="text-xs text-slate-400">未設定</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                                                <StatusIcon className="w-4 h-4" />
                                                {statusInfo.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {formatDate(estimate.validUntil, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {formatDate(estimate.createdAt, 'full')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleCopy(estimate)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 mr-2 transition-colors"
                                            >
                                                コピー
                                            </button>
                                            <button
                                                onClick={() => handleEdit(estimate)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 mr-2 transition-colors"
                                            >
                                                編集
                                            </button>
                                            <button
                                                onClick={() => handleDelete(estimate.id)}
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
                全 {filteredEstimates.length} 件の見積書
                {(searchTerm || statusFilter !== 'all') && ` (${estimates.length}件中)`}
            </div>

            {/* 編集モーダル */}
            <EstimateModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setCopySource(null); }}
                onSubmit={handleSubmit}
                initialData={editingEstimate || copySource || undefined}
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
                    project={selectedEstimate?.projectId ? (() => {
                        const pm = projectMasters.find(p => p.id === selectedEstimate.projectId);
                        if (!pm) return null;
                        return {
                            id: pm.id, title: pm.title, startDate: new Date(), category: 'construction' as const,
                            color: '#3B82F6', customer: pm.customerName || pm.customerShortName || '',
                            customerHonorific: '御中', location: pm.location || '',
                            createdAt: pm.createdAt, updatedAt: pm.updatedAt,
                        };
                    })() : null}
                    customerName={selectedEstimate?.customerId ? customers.find(c => c.id === selectedEstimate.customerId)?.name : undefined}
                    customerHonorific={selectedEstimate?.customerId ? customers.find(c => c.id === selectedEstimate.customerId)?.honorific : undefined}
                    companyInfo={companyInfo}
                    onDelete={deleteEstimate}
                    onEdit={(estimate) => {
                        setEditingEstimate(estimate);
                        setIsModalOpen(true);
                    }}
                    onUpdateEstimate={async (id, data) => {
                        try {
                            await updateEstimate(id, { items: data.items, costTotal: data.costTotal } as Partial<EstimateInput>);
                        } catch (e) { logger.error('予算書の保存に失敗:', e); }
                    }}
                    onCreateProject={selectedEstimate ? () => handleCreateProjectFromEstimate(selectedEstimate) : undefined}
                />
            )}

            {/* 案件作成モーダル（見積書から案件を作成する場合） */}
            <ProjectModal
                isOpen={isProjectModalOpen}
                onClose={() => {
                    setIsProjectModalOpen(false);
                    pendingLinkEstimateIdRef.current = null;
                }}
                onSubmit={handleSubmitProjectFromEstimate}
                initialData={projectModalInitialData}
                title="案件登録（見積書から作成）"
            />
        </div>
    );
}
