'use client';

import React, { useState, useMemo } from 'react';
import { useProjectMasters } from '@/contexts/ProjectMasterContext';
import { ProjectMaster, ConstructionContentType, ScaffoldingSpec } from '@/types/calendar';
import { Plus, Edit2, Trash2, Search, Calendar, ChevronDown, ChevronUp, MapPin, Building } from 'lucide-react';
import { ProjectMasterForm, ProjectMasterFormData, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';
import ProjectProfitDisplay from '@/components/ProjectMaster/ProjectProfitDisplay';
import toast from 'react-hot-toast';

export default function ProjectMasterListPage() {
    const { projectMasters, isLoading, createProjectMaster, updateProjectMaster, deleteProjectMaster } = useProjectMasters();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('active');
    const [expandedId, setExpandedId] = useState<string | null>(null);
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

    const formatDate = (date: Date | string | undefined) => {
        if (!date) return '-';
        const d = new Date(date);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
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
        <div className="h-full flex flex-col p-6 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">案件マスター管理</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {filteredMasters.length}件の案件マスター
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4 mb-6">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="現場名・顧客名・場所で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                </div>

                {/* Status Filter */}
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-blue-800 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-5 h-5" />
                    新規案件マスター
                </button>
            </div>

            {/* Create Form */}
            {isCreating && (
                <div className="mb-6 p-6 bg-white rounded-xl shadow-lg border border-gray-200 max-h-[70vh] overflow-y-auto">
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
                                // Edit Form
                                <div className="p-6 max-h-[70vh] overflow-y-auto">
                                    <h3 className="text-lg font-bold text-gray-800 mb-4">案件マスター編集</h3>
                                    <ProjectMasterForm
                                        formData={formData}
                                        setFormData={setFormData}
                                        onSubmit={handleUpdate}
                                        onCancel={() => {
                                            setEditingId(null);
                                            setFormData(DEFAULT_FORM_DATA);
                                        }}
                                        isEdit={true}
                                    />
                                </div>
                            ) : (
                                // Normal display
                                <>
                                    <div className="p-4 flex items-center gap-4">
                                        {/* Main info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-lg font-bold text-gray-800">{pm.title}</h3>
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
                                            <div className="flex items-center gap-4 mt-1 text-sm text-gray-600 flex-wrap">
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
                                            </div>
                                        </div>

                                        {/* Assignment count */}
                                        <div className="flex items-center gap-2 text-gray-500">
                                            <Calendar className="w-4 h-4" />
                                            <span className="text-sm font-medium">
                                                {pm.assignments?.length || 0}件の配置
                                            </span>
                                        </div>

                                        {/* Expand button */}
                                        <button
                                            onClick={() => setExpandedId(expandedId === pm.id ? null : pm.id)}
                                            className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            {expandedId === pm.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                        </button>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleEdit(pm)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="編集"
                                            >
                                                <Edit2 className="w-5 h-5" />
                                            </button>
                                            <button
                                                onClick={() => handleArchive(pm)}
                                                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${pm.status === 'active'
                                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                    }`}
                                            >
                                                {pm.status === 'active' ? '完了にする' : '再開する'}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(pm.id)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expanded details */}
                                    {expandedId === pm.id && (
                                        <div className="px-4 pb-4 border-t border-gray-100">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                                                <div>
                                                    <span className="text-gray-500">組立日</span>
                                                    <p className="font-medium">{formatDate(pm.assemblyDate)}</p>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">解体日</span>
                                                    <p className="font-medium">{formatDate(pm.demolitionDate)}</p>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">予定組立人工</span>
                                                    <p className="font-medium">{pm.estimatedAssemblyWorkers || '-'}名</p>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">予定解体人工</span>
                                                    <p className="font-medium">{pm.estimatedDemolitionWorkers || '-'}名</p>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">面積</span>
                                                    <p className="font-medium">{pm.area ? `${pm.area}m²` : '-'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">請負金額</span>
                                                    <p className="font-medium">{pm.contractAmount ? `¥${pm.contractAmount.toLocaleString()}` : '-'}</p>
                                                </div>
                                                <div className="col-span-2">
                                                    <span className="text-gray-500">備考</span>
                                                    <p className="font-medium">{pm.remarks || '-'}</p>
                                                </div>
                                            </div>
                                            {pm.assignments && pm.assignments.length > 0 && (
                                                <div className="mt-4">
                                                    <span className="text-sm text-gray-500">最近の配置:</span>
                                                    <div className="flex flex-wrap gap-2 mt-2">
                                                        {pm.assignments.slice(0, 5).map((a) => (
                                                            <span
                                                                key={a.id}
                                                                className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded"
                                                            >
                                                                {formatDate(a.date)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* 利益サマリー */}
                                            <div className="mt-4">
                                                <ProjectProfitDisplay projectMasterId={pm.id} />
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
