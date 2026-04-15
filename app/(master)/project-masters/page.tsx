'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useEstimates } from '@/hooks/useEstimates';
import { ProjectMaster, ScaffoldingSpec } from '@/types/calendar';
import { EstimateInput } from '@/types/estimate';
import { Plus, Edit, Trash2, Search, Calendar, MapPin, Building, Loader2 } from 'lucide-react';
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

export default function ProjectMasterListPage() {
    const { projectMasters, isLoading, createProjectMaster, updateProjectMaster, deleteProjectMaster, getProjectMasterById } = useProjectMasters();
    const { addEstimate } = useEstimates();
    const { data: session } = useSession();
    const userRole = session?.user?.role;
    const isForeman2 = userRole === 'foreman2';
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('active');
    const [detailPm, setDetailPm] = useState<ProjectMaster | null>(null);
    const [openModalInEditMode, setOpenModalInEditMode] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [isEstimateModalOpen, setIsEstimateModalOpen] = useState(false);
    const [estimateInitialData, setEstimateInitialData] = useState<{ projectId?: string; title?: string }>({});
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

    const totalPages = Math.ceil(filteredMasters.length / ITEMS_PER_PAGE);

    const paginatedMasters = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredMasters.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredMasters, currentPage]);

    const handleCreate = async (data: ProjectMasterFormData) => {
        const pm = await createProjectMaster({
            title: data.title,
            name: data.name || undefined,
            honorific: data.honorific ?? undefined,
            constructionSuffixId: data.constructionSuffixId || undefined,
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
        // null を送ることで API 側でフィールドをクリアできる（undefined だと更新対象外になる）
        const updatePayload: Record<string, unknown> = {
            title: data.title,
            name: data.name || null,
            honorific: data.honorific ?? null,
            constructionSuffixId: data.constructionSuffixId || null,
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

    const handleEstimateSubmit = useCallback(async (data: EstimateInput) => {
        try {
            await addEstimate(data);
            setIsEstimateModalOpen(false);
            toast.success('見積書を作成しました');
        } catch {
            toast.error('見積書の作成に失敗しました');
        }
    }, [addEstimate]);

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
                onCreateEstimate={isForeman2 ? undefined : handleCreateEstimate}
                readOnly={isForeman2}
            />
            <EstimateModal
                isOpen={isEstimateModalOpen}
                onClose={() => setIsEstimateModalOpen(false)}
                onSubmit={handleEstimateSubmit}
                initialData={estimateInitialData}
            />
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

                    <div className="flex items-center gap-3">
                        {/* Status Filter */}
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="flex-1 md:flex-none px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
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
                                        <h3 className="text-base font-bold text-slate-800">{pm.title}</h3>
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
                                        {pm.customerName && (
                                            <span className="flex items-center gap-1">
                                                <Building className="w-3.5 h-3.5" />
                                                {pm.customerName}
                                            </span>
                                        )}
                                        {(pm.prefecture || pm.city || pm.location) && (
                                            <span className="flex items-center gap-1">
                                                <MapPin className="w-3.5 h-3.5" />
                                                {[pm.prefecture, [pm.city, pm.location].filter(Boolean).join('-')].filter(Boolean).join(' ')}
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1 text-slate-500">
                                            <Calendar className="w-3.5 h-3.5" />
                                            {pm.assignmentCount ?? 0}件の配置
                                        </span>
                                    </div>
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
                                    所在地
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    配置数
                                </th>
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
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                                        {!isForeman2 && <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24 ml-auto"></div></td>}
                                    </tr>
                                ))
                            ) : filteredMasters.length === 0 ? (
                                <tr>
                                    <td colSpan={isForeman2 ? 5 : 6} className="px-6 py-12 text-center text-slate-500">
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
                                                    {pm.title}
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
                                            {pm.customerName || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {[pm.prefecture, [pm.city, pm.location].filter(Boolean).join('-')].filter(Boolean).join(' ') || '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {pm.assignmentCount ?? 0}件の配置
                                        </td>
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
