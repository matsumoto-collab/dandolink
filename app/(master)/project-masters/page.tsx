'use client';

import React, { useState, useMemo } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { ProjectMaster, ConstructionContentType, ScaffoldingSpec } from '@/types/calendar';
import { Plus, Edit, Trash2, Search, Calendar, MapPin, Building } from 'lucide-react';
import { ProjectMasterForm, ProjectMasterFormData, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';
import ProjectMasterDetailModal from '@/components/ProjectMaster/ProjectMasterDetailModal';
import toast from 'react-hot-toast';

export default function ProjectMasterListPage() {
    const { projectMasters, isLoading, createProjectMaster, updateProjectMaster, deleteProjectMaster } = useProjectMasters();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('active');
    const [detailPm, setDetailPm] = useState<ProjectMaster | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form state - using new extended form data
    const [formData, setFormData] = useState<ProjectMasterFormData>(DEFAULT_FORM_DATA);

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

    const handleCreate = async () => {
        if (!formData.title.trim()) {
            toast.error('現場名は必須です');
            return;
        }
        if (!formData.constructionContent) {
            toast.error('工事内容は必須です');
            return;
        }
        if (formData.createdBy.length === 0) {
            toast.error('案件責任者は必須です');
            return;
        }
        if (!formData.customerName) {
            toast.error('元請けは必須です');
            return;
        }

        try {
            await createProjectMaster({
                title: formData.title,
                customerId: formData.customerId || undefined,
                customerName: formData.customerName || undefined,
                constructionType: 'other', // Default, will be set when adding to calendar
                constructionContent: formData.constructionContent as ConstructionContentType,
                status: 'active',
                // 住所情報
                postalCode: formData.postalCode || undefined,
                prefecture: formData.prefecture || undefined,
                city: formData.city || undefined,
                location: formData.location || undefined,
                plusCode: formData.plusCode || undefined,
                // 工事情報
                area: formData.area ? parseFloat(formData.area) : undefined,
                areaRemarks: formData.areaRemarks || undefined,
                assemblyDate: formData.assemblyDate ? new Date(formData.assemblyDate) : undefined,
                demolitionDate: formData.demolitionDate ? new Date(formData.demolitionDate) : undefined,
                estimatedAssemblyWorkers: formData.estimatedAssemblyWorkers ? parseInt(formData.estimatedAssemblyWorkers) : undefined,
                estimatedDemolitionWorkers: formData.estimatedDemolitionWorkers ? parseInt(formData.estimatedDemolitionWorkers) : undefined,
                contractAmount: formData.contractAmount ? parseInt(formData.contractAmount) : undefined,
                // 足場仕様
                scaffoldingSpec: formData.scaffoldingSpec,
                remarks: formData.remarks || undefined,
                createdBy: formData.createdBy.length > 0 ? formData.createdBy : undefined,
            });
            setIsCreating(false);
            setFormData(DEFAULT_FORM_DATA);
        } catch (error) {
            console.error('Failed to create project master:', error);
            toast.error('案件マスターの作成に失敗しました');
        }
    };

    const handleEdit = (pm: ProjectMaster) => {
        setEditingId(pm.id);
        setFormData({
            title: pm.title,
            customerId: pm.customerId || '',
            customerName: pm.customerName || '',
            constructionContent: pm.constructionContent || '',
            postalCode: pm.postalCode || '',
            prefecture: pm.prefecture || '',
            city: pm.city || '',
            location: pm.location || '',
            plusCode: pm.plusCode || '',
            area: pm.area?.toString() || '',
            areaRemarks: pm.areaRemarks || '',
            assemblyDate: pm.assemblyDate ? new Date(pm.assemblyDate).toISOString().split('T')[0] : '',
            demolitionDate: pm.demolitionDate ? new Date(pm.demolitionDate).toISOString().split('T')[0] : '',
            estimatedAssemblyWorkers: pm.estimatedAssemblyWorkers?.toString() || '',
            estimatedDemolitionWorkers: pm.estimatedDemolitionWorkers?.toString() || '',
            contractAmount: pm.contractAmount?.toString() || '',
            scaffoldingSpec: pm.scaffoldingSpec || DEFAULT_FORM_DATA.scaffoldingSpec,
            remarks: pm.remarks || '',
            createdBy: Array.isArray(pm.createdBy) ? pm.createdBy : (pm.createdBy ? [pm.createdBy] : []),
        });
    };

    const handleUpdate = async () => {
        if (!editingId || !formData.title.trim()) return;

        try {
            await updateProjectMaster(editingId, {
                title: formData.title,
                customerId: formData.customerId || undefined,
                customerName: formData.customerName || undefined,
                constructionContent: formData.constructionContent as ConstructionContentType || undefined,
                // 住所情報
                postalCode: formData.postalCode || undefined,
                prefecture: formData.prefecture || undefined,
                city: formData.city || undefined,
                location: formData.location || undefined,
                plusCode: formData.plusCode || undefined,
                // 工事情報
                area: formData.area ? parseFloat(formData.area) : undefined,
                areaRemarks: formData.areaRemarks || undefined,
                assemblyDate: formData.assemblyDate ? new Date(formData.assemblyDate) : undefined,
                demolitionDate: formData.demolitionDate ? new Date(formData.demolitionDate) : undefined,
                estimatedAssemblyWorkers: formData.estimatedAssemblyWorkers ? parseInt(formData.estimatedAssemblyWorkers) : undefined,
                estimatedDemolitionWorkers: formData.estimatedDemolitionWorkers ? parseInt(formData.estimatedDemolitionWorkers) : undefined,
                contractAmount: formData.contractAmount ? parseInt(formData.contractAmount) : undefined,
                // 足場仕様
                scaffoldingSpec: formData.scaffoldingSpec as ScaffoldingSpec,
                remarks: formData.remarks || undefined,
                createdBy: formData.createdBy.length > 0 ? formData.createdBy : undefined,
            });
            setEditingId(null);
            setFormData(DEFAULT_FORM_DATA);
        } catch (error) {
            console.error('Failed to update project master:', error);
            toast.error('案件マスターの更新に失敗しました');
        }
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
            </div>
        );
    }

    return (
        <>
        <ProjectMasterDetailModal
            pm={detailPm}
            onClose={() => setDetailPm(null)}
            onEdit={handleEdit}
        />
        <div className="h-full flex flex-col p-3 md:p-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 md:mb-6">
                <div>
                    <h1 className="text-lg md:text-2xl font-bold text-gray-800">案件マスター管理</h1>
                    <p className="text-xs md:text-sm text-gray-500 mt-1">
                        {filteredMasters.length}件の案件マスター
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 mb-4 md:mb-6">
                {/* Search */}
                <div className="relative w-full md:flex-1 md:max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="現場名・顧客名・場所で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                <div className="flex items-center gap-3">
                    {/* Status Filter */}
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="flex-1 md:flex-none px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="all">全てのステータス</option>
                        <option value="active">進行中</option>
                        <option value="completed">完了</option>
                    </select>

                    {/* Create Button */}
                    <button
                        onClick={() => {
                            setIsCreating(true);
                            setEditingId(null);
                            setFormData(DEFAULT_FORM_DATA);
                        }}
                        className="flex items-center gap-2 px-4 md:px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-blue-800 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg whitespace-nowrap"
                    >
                        <Plus className="w-5 h-5" />
                        <span className="hidden sm:inline">新規案件マスター</span>
                        <span className="sm:hidden">新規</span>
                    </button>
                </div>
            </div>

            {/* Create Form */}
            {isCreating && (
                <div className="mb-4 md:mb-6 p-3 md:p-6 bg-white rounded-xl shadow-lg border border-gray-200 max-h-[70vh] overflow-y-auto">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">新規案件マスター作成</h3>
                    <ProjectMasterForm
                        formData={formData}
                        setFormData={setFormData}
                        onSubmit={handleCreate}
                        onCancel={() => {
                            setIsCreating(false);
                            setFormData(DEFAULT_FORM_DATA);
                        }}
                        isEdit={false}
                    />
                </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-3">
                {filteredMasters.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p>案件マスターがありません</p>
                    </div>
                ) : (
                    filteredMasters.map((pm) => (
                        <div
                            key={pm.id}
                            className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
                        >
                            {editingId === pm.id ? (
                                // 編集フォーム
                                <div className="p-3 md:p-6 max-h-[70vh] overflow-y-auto">
                                    <h3 className="text-base md:text-lg font-bold text-gray-800 mb-3 md:mb-4">案件マスター編集</h3>
                                    <ProjectMasterForm
                                        formData={formData}
                                        setFormData={setFormData}
                                        onSubmit={handleUpdate}
                                        onCancel={() => {
                                            setEditingId(null);
                                            setFormData(DEFAULT_FORM_DATA);
                                        }}
                                        isEdit={true}
                                        projectMasterId={pm.id}
                                    />
                                </div>
                            ) : (
                                // カード表示（クリックで詳細モーダルを開く）
                                <div
                                    className="p-3 md:p-4 cursor-pointer"
                                    onClick={() => setDetailPm(pm)}
                                >
                                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                        {/* メイン情報 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-base md:text-lg font-bold text-gray-800">{pm.title}</h3>
                                                {pm.constructionContent && (
                                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                                        {getConstructionContentLabel(pm.constructionContent)}
                                                    </span>
                                                )}
                                                {pm.status === 'completed' && (
                                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                                                        完了
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 md:gap-4 mt-1 text-sm text-gray-600 flex-wrap">
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
                                                <span className="flex items-center gap-1 text-gray-500">
                                                    <Calendar className="w-3.5 h-3.5" />
                                                    <span className="text-sm">{pm.assignments?.length || 0}件の配置</span>
                                                </span>
                                            </div>
                                        </div>

                                        {/* PC: アクションボタン */}
                                        <div className="hidden md:flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleEdit(pm)}
                                                className="p-2.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="編集"
                                            >
                                                <Edit className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleArchive(pm)}
                                                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${pm.status === 'active'
                                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {pm.status === 'active' ? '完了にする' : '再開する'}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(pm.id)}
                                                className="p-2.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* モバイル: アクションボタン行 */}
                                    <div className="flex md:hidden items-center gap-2 mt-2 pt-2 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={() => handleEdit(pm)}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        >
                                            <Edit className="w-4 h-4" />
                                            編集
                                        </button>
                                        <button
                                            onClick={() => handleArchive(pm)}
                                            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${pm.status === 'active'
                                                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                                }`}
                                        >
                                            {pm.status === 'active' ? '完了にする' : '再開する'}
                                        </button>
                                        <button
                                            onClick={() => handleDelete(pm.id)}
                                            className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
        </>
    );
}
