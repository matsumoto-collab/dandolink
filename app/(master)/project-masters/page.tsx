'use client';

import React, { useState, useMemo } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { ProjectMaster, ConstructionContentType, ScaffoldingSpec } from '@/types/calendar';
import { Plus, Edit, Trash2, Search, Calendar, MapPin, Building } from 'lucide-react';

import { ProjectMasterFormData } from '@/components/ProjectMasters/ProjectMasterForm';
import ProjectMasterDetailModal from '@/components/ProjectMaster/ProjectMasterDetailModal';
import ProjectMasterCreateModal from '@/components/ProjectMaster/ProjectMasterCreateModal';
import toast from 'react-hot-toast';

export default function ProjectMasterListPage() {
    const { projectMasters, isLoading, createProjectMaster, updateProjectMaster, deleteProjectMaster, getProjectMasterById } = useProjectMasters();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('active');
    const [detailPm, setDetailPm] = useState<ProjectMaster | null>(null);
    const [openModalInEditMode, setOpenModalInEditMode] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

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

    const handleCreate = async (data: ProjectMasterFormData) => {
        const pm = await createProjectMaster({
            title: data.title,
            customerId: data.customerId || undefined,
            customerName: data.customerName || undefined,
            constructionType: 'other',
            constructionContent: data.constructionContent as ConstructionContentType,
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
            assemblyDate: data.assemblyDate ? new Date(data.assemblyDate) : undefined,
            demolitionDate: data.demolitionDate ? new Date(data.demolitionDate) : undefined,
            estimatedAssemblyWorkers: data.estimatedAssemblyWorkers ? parseInt(data.estimatedAssemblyWorkers) : undefined,
            estimatedDemolitionWorkers: data.estimatedDemolitionWorkers ? parseInt(data.estimatedDemolitionWorkers) : undefined,
            contractAmount: data.contractAmount ? parseInt(data.contractAmount) : undefined,
            scaffoldingSpec: data.scaffoldingSpec,
            remarks: data.remarks || undefined,
            createdBy: data.createdBy.length > 0 ? data.createdBy : undefined,
        });

        // 組立日の配置を自動生成
        if (data.assemblyDate && data.assemblyForemen.length > 0) {
            await Promise.all(
                data.assemblyForemen.map((f, i) =>
                    fetch('/api/assignments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectMasterId: pm.id,
                            assignedEmployeeId: f.foremanId,
                            date: new Date(`${data.assemblyDate}T00:00:00Z`).toISOString(),
                            memberCount: f.memberCount,
                            sortOrder: i,
                            estimatedHours: 8.0,
                        }),
                    })
                )
            );
        }

        // 解体日の配置を自動生成
        if (data.demolitionDate && data.demolitionForemen.length > 0) {
            await Promise.all(
                data.demolitionForemen.map((f, i) =>
                    fetch('/api/assignments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            projectMasterId: pm.id,
                            assignedEmployeeId: f.foremanId,
                            date: new Date(`${data.demolitionDate}T00:00:00Z`).toISOString(),
                            memberCount: f.memberCount,
                            sortOrder: i,
                            estimatedHours: 8.0,
                        }),
                    })
                )
            );
        }

        toast.success('案件マスターを作成しました');
    };

    const handleUpdate = async (id: string, data: ProjectMasterFormData) => {
        await updateProjectMaster(id, {
            title: data.title,
            customerId: data.customerId || undefined,
            customerName: data.customerName || undefined,
            constructionContent: data.constructionContent as ConstructionContentType || undefined,
            postalCode: data.postalCode || undefined,
            prefecture: data.prefecture || undefined,
            city: data.city || undefined,
            location: data.location || undefined,
            plusCode: data.plusCode || undefined,
            latitude: data.latitude ?? undefined,
            longitude: data.longitude ?? undefined,
            area: data.area ? parseFloat(data.area) : undefined,
            areaRemarks: data.areaRemarks || undefined,
            assemblyDate: data.assemblyDate ? new Date(data.assemblyDate) : undefined,
            demolitionDate: data.demolitionDate ? new Date(data.demolitionDate) : undefined,
            estimatedAssemblyWorkers: data.estimatedAssemblyWorkers ? parseInt(data.estimatedAssemblyWorkers) : undefined,
            estimatedDemolitionWorkers: data.estimatedDemolitionWorkers ? parseInt(data.estimatedDemolitionWorkers) : undefined,
            contractAmount: data.contractAmount ? parseInt(data.contractAmount) : undefined,
            scaffoldingSpec: data.scaffoldingSpec as ScaffoldingSpec,
            remarks: data.remarks || undefined,
            createdBy: data.createdBy.length > 0 ? data.createdBy : undefined,
        });
        // 保存後、detailPmをストアの最新データで更新（再編集時にpm.latitudeが古い値にならないよう）
        const updated = getProjectMasterById(id);
        if (updated) setDetailPm(updated);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('この案件マスターを削除してもよろしいですか？\n関連する全ての配置も削除されます。')) return;

        try {
            await deleteProjectMaster(id);
        } catch (error) {
            console.error('Failed to delete project master:', error);
            toast.error('案件マスターの削除に失敗しました');
        }
    };

    const handleArchive = async (pm: ProjectMaster) => {
        try {
            await updateProjectMaster(pm.id, {
                status: pm.status === 'active' ? 'completed' : 'active',
            });
        } catch (error) {
            console.error('Failed to update status:', error);
        }
    };

    const getConstructionContentLabel = (content: string | undefined) => {
        switch (content) {
            case 'new_construction': return '新築';
            case 'renovation': return '改修';
            case 'large_scale': return '大規模';
            case 'other': return 'その他';
            default: return '-';
        }
    };

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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-8 h-8 border-4 border-slate-500 border-t-transparent rounded-full"></div>
            </div>
        );
    }

    return (
        <>
        <ProjectMasterCreateModal
            isOpen={isCreating}
            onClose={() => setIsCreating(false)}
            onCreate={handleCreate}
        />
        <ProjectMasterDetailModal
            pm={detailPm}
            onClose={closeModal}
            onUpdate={handleUpdate}
            initialEditMode={openModalInEditMode}
        />
        <div className="h-full flex flex-col p-3 md:p-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 md:mb-6">
                <div>
                    <h1 className="text-lg md:text-2xl font-bold text-slate-800">案件一覧</h1>
                    <p className="text-xs md:text-sm text-slate-500 mt-1">
                        {filteredMasters.length}件の案件データ
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 mb-4 md:mb-6">
                {/* Search */}
                <div className="relative w-full md:flex-1 md:max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="現場名・顧客名・場所で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                    />
                </div>

                <div className="flex items-center gap-3">
                    {/* Status Filter */}
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="flex-1 md:flex-none px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    >
                        <option value="all">全てのステータス</option>
                        <option value="active">進行中</option>
                        <option value="completed">完了</option>
                    </select>

                    {/* Create Button */}
                    <button
                        onClick={() => setIsCreating(true)}
                        className="flex items-center gap-2 px-4 md:px-5 py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white font-semibold rounded-lg hover:from-slate-800 hover:to-slate-900 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg whitespace-nowrap"
                    >
                        <Plus className="w-5 h-5" />
                        <span className="hidden sm:inline">新規案件登録</span>
                        <span className="sm:hidden">新規</span>
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-3">
                {filteredMasters.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                        <Calendar className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                        <p>案件マスターがありません</p>
                    </div>
                ) : (
                    filteredMasters.map((pm) => (
                        <div
                            key={pm.id}
                            className="bg-white rounded-lg shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                        >
                            {/* カード表示（クリックで詳細モーダルを開く） */}
                            <div
                                className="p-3 md:p-4 cursor-pointer"
                                onClick={() => openDetailModal(pm)}
                            >
                                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                    {/* メイン情報 */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-base md:text-lg font-bold text-slate-800">{pm.title}</h3>
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
                                        <div className="flex items-center gap-3 md:gap-4 mt-1 text-sm text-slate-600 flex-wrap">
                                            {pm.customerName && (
                                                <span className="flex items-center gap-1">
                                                    <Building className="w-3.5 h-3.5" />
                                                    {pm.customerName}
                                                </span>
                                            )}
                                            {(pm.prefecture || pm.city || pm.location) && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {[pm.prefecture, pm.city].filter(Boolean).join(' ')}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-1 text-slate-500">
                                                <Calendar className="w-3.5 h-3.5" />
                                                <span className="text-sm">{pm.assignmentCount ?? 0}件の配置</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* PC: アクションボタン */}
                                    <div className="hidden md:flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => openEditModal(pm)}
                                            className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            title="編集"
                                        >
                                            <Edit className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleArchive(pm)}
                                            className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${pm.status === 'active'
                                                ? 'bg-slate-100 text-slate-700 hover:bg-green-200'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                        >
                                            {pm.status === 'active' ? '完了にする' : '再開する'}
                                        </button>
                                        <button
                                            onClick={() => handleDelete(pm.id)}
                                            className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            title="削除"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* モバイル: アクションボタン行 */}
                                <div className="flex md:hidden items-center gap-2 mt-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
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
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
        </>
    );
}
