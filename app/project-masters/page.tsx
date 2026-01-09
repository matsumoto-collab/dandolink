'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useProjectMasters } from '@/contexts/ProjectMasterContext';
import { ProjectMaster } from '@/types/calendar';
import { Plus, Edit2, Trash2, Search, Calendar, ChevronDown, ChevronUp, User } from 'lucide-react';

interface ManagerUser {
    id: string;
    displayName: string;
    role: string;
}

export default function ProjectMasterListPage() {
    const { projectMasters, isLoading, createProjectMaster, updateProjectMaster, deleteProjectMaster } = useProjectMasters();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState<string>('all');
    const [filterStatus, setFilterStatus] = useState<string>('active');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        customer: '',
        constructionType: 'assembly',
        location: '',
        description: '',
        remarks: '',
        createdBy: [] as string[],
    });

    // Admin/Manager users for project manager selection
    const [managers, setManagers] = useState<ManagerUser[]>([]);
    const [isLoadingManagers, setIsLoadingManagers] = useState(true);

    // Fetch admin/manager users
    useEffect(() => {
        const fetchManagers = async () => {
            setIsLoadingManagers(true);
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const users = await res.json();
                    // Filter only admin and manager roles
                    const filtered = users.filter((u: ManagerUser) =>
                        u.role === 'admin' || u.role === 'manager'
                    );
                    setManagers(filtered);
                }
            } catch (error) {
                console.error('Failed to fetch managers:', error);
            } finally {
                setIsLoadingManagers(false);
            }
        };
        fetchManagers();
    }, []);

    // Filter and sort
    const filteredMasters = useMemo(() => {
        let results = projectMasters;

        // Status filter
        if (filterStatus !== 'all') {
            results = results.filter(pm => pm.status === filterStatus);
        }

        // Type filter
        if (filterType !== 'all') {
            results = results.filter(pm => pm.constructionType === filterType);
        }

        // Search
        if (searchTerm.trim()) {
            const lower = searchTerm.toLowerCase();
            results = results.filter(pm =>
                pm.title.toLowerCase().includes(lower) ||
                pm.customer?.toLowerCase().includes(lower) ||
                pm.location?.toLowerCase().includes(lower)
            );
        }

        // Sort by updated date
        return results.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }, [projectMasters, searchTerm, filterType, filterStatus]);

    const handleCreate = async () => {
        if (!formData.title.trim()) {
            alert('現場名は必須です');
            return;
        }

        try {
            await createProjectMaster({
                title: formData.title,
                customer: formData.customer || undefined,
                constructionType: formData.constructionType as 'assembly' | 'demolition' | 'other',
                status: 'active',
                location: formData.location || undefined,
                description: formData.description || undefined,
                remarks: formData.remarks || undefined,
                createdBy: formData.createdBy.length > 0 ? formData.createdBy : undefined,
            });
            setIsCreating(false);
            setFormData({
                title: '',
                customer: '',
                constructionType: 'assembly',
                location: '',
                description: '',
                remarks: '',
                createdBy: [],
            });
        } catch (error) {
            console.error('Failed to create project master:', error);
            alert('案件マスターの作成に失敗しました');
        }
    };

    const handleEdit = (pm: ProjectMaster) => {
        setEditingId(pm.id);
        setFormData({
            title: pm.title,
            customer: pm.customer || '',
            constructionType: pm.constructionType || 'assembly',
            location: pm.location || '',
            description: pm.description || '',
            remarks: pm.remarks || '',
            createdBy: Array.isArray(pm.createdBy) ? pm.createdBy : (pm.createdBy ? [pm.createdBy] : []),
        });
    };

    const handleUpdate = async () => {
        if (!editingId || !formData.title.trim()) return;

        try {
            await updateProjectMaster(editingId, {
                title: formData.title,
                customer: formData.customer || undefined,
                constructionType: formData.constructionType as 'assembly' | 'demolition' | 'other',
                location: formData.location || undefined,
                description: formData.description || undefined,
                remarks: formData.remarks || undefined,
                createdBy: formData.createdBy.length > 0 ? formData.createdBy : undefined,
            });
            setEditingId(null);
            setFormData({
                title: '',
                customer: '',
                constructionType: 'assembly',
                location: '',
                description: '',
                remarks: '',
                createdBy: [],
            });
        } catch (error) {
            console.error('Failed to update project master:', error);
            alert('案件マスターの更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('この案件マスターを削除してもよろしいですか？\n関連する全ての配置も削除されます。')) return;

        try {
            await deleteProjectMaster(id);
        } catch (error) {
            console.error('Failed to delete project master:', error);
            alert('案件マスターの削除に失敗しました');
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

    const formatDate = (date: Date | string) => {
        const d = new Date(date);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-gray-50 to-white w-full max-w-[1800px] mx-auto">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent mb-2">
                    案件マスター管理
                </h1>
                <p className="text-gray-600">案件の基本情報を管理します。カレンダーへの配置はこの情報を元に行われます。</p>
            </div>

            {/* Toolbar */}
            <div className="mb-6 flex flex-wrap items-center gap-4">
                {/* Search */}
                <div className="flex-1 min-w-[200px] max-w-md relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="現場名、顧客名、場所で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                    />
                </div>

                {/* Type Filter */}
                <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                >
                    <option value="all">全工事種別</option>
                    <option value="assembly">組立</option>
                    <option value="demolition">解体</option>
                    <option value="other">その他</option>
                </select>

                {/* Status Filter */}
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                >
                    <option value="active">進行中</option>
                    <option value="completed">完了</option>
                    <option value="all">全て</option>
                </select>

                {/* Add Button */}
                <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-blue-800 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                    <Plus className="w-5 h-5" />
                    新規案件マスター
                </button>
            </div>

            {/* Create Form */}
            {isCreating && (
                <div className="mb-6 p-6 bg-white rounded-xl shadow-lg border border-gray-200">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">新規案件マスター作成</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">現場名 *</label>
                            <input
                                type="text"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="例: 松本様邸"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">元請会社</label>
                            <input
                                type="text"
                                value={formData.customer}
                                onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="例: 〇〇建設"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">工事種別</label>
                            <select
                                value={formData.constructionType}
                                onChange={(e) => setFormData({ ...formData, constructionType: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="assembly">組立</option>
                                <option value="demolition">解体</option>
                                <option value="other">その他</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">場所</label>
                            <input
                                type="text"
                                value={formData.location}
                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="例: 東京都渋谷区..."
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
                            <input
                                type="text"
                                value={formData.remarks}
                                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="md:col-span-3">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                <User className="inline w-4 h-4 mr-1" />
                                案件担当者
                            </label>
                            <div className="flex flex-wrap gap-2 min-h-[50px]">
                                {isLoadingManagers ? (
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                                        <span className="text-sm">担当者を読み込み中...</span>
                                    </div>
                                ) : managers.length > 0 ? (
                                    managers.map(manager => (
                                        <label key={manager.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                                            <input
                                                type="checkbox"
                                                checked={formData.createdBy.includes(manager.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormData({ ...formData, createdBy: [...formData.createdBy, manager.id] });
                                                    } else {
                                                        setFormData({ ...formData, createdBy: formData.createdBy.filter(id => id !== manager.id) });
                                                    }
                                                }}
                                                className="w-4 h-4 text-blue-600 rounded"
                                            />
                                            <span className="text-sm text-gray-700">{manager.displayName}</span>
                                            <span className={`text-xs px-1.5 py-0.5 rounded ${manager.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {manager.role === 'admin' ? '管理者' : 'マネージャー'}
                                            </span>
                                        </label>
                                    ))
                                ) : (
                                    <span className="text-sm text-gray-500">担当者が見つかりません</span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={handleCreate}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            作成
                        </button>
                        <button
                            onClick={() => setIsCreating(false)}
                            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                            キャンセル
                        </button>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-auto space-y-3">
                {filteredMasters.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        <p className="text-lg font-medium">案件マスターがありません</p>
                        <p className="text-sm mt-2">「新規案件マスター」ボタンから作成してください</p>
                    </div>
                ) : (
                    filteredMasters.map((pm) => (
                        <div
                            key={pm.id}
                            className={`bg-white rounded-xl shadow-md border ${pm.status === 'completed' ? 'border-gray-200 opacity-70' : 'border-gray-200'} overflow-hidden`}
                        >
                            {/* Main row */}
                            {editingId === pm.id ? (
                                // Edit form
                                <div className="p-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">現場名 *</label>
                                            <input
                                                type="text"
                                                value={formData.title}
                                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">元請会社</label>
                                            <input
                                                type="text"
                                                value={formData.customer}
                                                onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">工事種別</label>
                                            <select
                                                value={formData.constructionType}
                                                onChange={(e) => setFormData({ ...formData, constructionType: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="assembly">組立</option>
                                                <option value="demolition">解体</option>
                                                <option value="other">その他</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">場所</label>
                                            <input
                                                type="text"
                                                value={formData.location}
                                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
                                            <input
                                                type="text"
                                                value={formData.remarks}
                                                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                        <div className="md:col-span-3">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                <User className="inline w-4 h-4 mr-1" />
                                                案件担当者
                                            </label>
                                            <div className="flex flex-wrap gap-2 min-h-[50px]">
                                                {isLoadingManagers ? (
                                                    <div className="flex items-center gap-2 text-gray-500">
                                                        <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                                                        <span className="text-sm">担当者を読み込み中...</span>
                                                    </div>
                                                ) : managers.length > 0 ? (
                                                    managers.map(manager => (
                                                        <label key={manager.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                                                            <input
                                                                type="checkbox"
                                                                checked={formData.createdBy.includes(manager.id)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setFormData({ ...formData, createdBy: [...formData.createdBy, manager.id] });
                                                                    } else {
                                                                        setFormData({ ...formData, createdBy: formData.createdBy.filter(id => id !== manager.id) });
                                                                    }
                                                                }}
                                                                className="w-4 h-4 text-blue-600 rounded"
                                                            />
                                                            <span className="text-sm text-gray-700">{manager.displayName}</span>
                                                            <span className={`text-xs px-1.5 py-0.5 rounded ${manager.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                                {manager.role === 'admin' ? '管理者' : 'マネージャー'}
                                                            </span>
                                                        </label>
                                                    ))
                                                ) : (
                                                    <span className="text-sm text-gray-500">担当者が見つかりません</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 mt-4">
                                        <button
                                            onClick={handleUpdate}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                        >
                                            更新
                                        </button>
                                        <button
                                            onClick={() => setEditingId(null)}
                                            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                                        >
                                            キャンセル
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // Normal display
                                <div className="p-4 flex items-center gap-4">
                                    {/* Main info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-lg font-bold text-gray-800 truncate">{pm.title}</h3>
                                            {pm.status === 'completed' && (
                                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                                                    完了
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                                            {pm.customer && <span>元請: {pm.customer}</span>}
                                            {pm.location && <span>場所: {pm.location}</span>}
                                        </div>
                                    </div>

                                    {/* Assignment count */}
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <Calendar className="w-4 h-4" />
                                        <span className="text-sm font-medium">
                                            {pm.assignments?.length || 0}件の配置
                                        </span>
                                    </div>

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
                                        <button
                                            onClick={() => setExpandedId(expandedId === pm.id ? null : pm.id)}
                                            className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            {expandedId === pm.id ? (
                                                <ChevronUp className="w-5 h-5" />
                                            ) : (
                                                <ChevronDown className="w-5 h-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Expanded assignments */}
                            {expandedId === pm.id && pm.assignments && pm.assignments.length > 0 && (
                                <div className="border-t border-gray-200 bg-gray-50 p-4">
                                    <h4 className="text-sm font-bold text-gray-700 mb-3">配置一覧</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {pm.assignments.map((assignment) => (
                                            <div
                                                key={assignment.id}
                                                className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-medium text-gray-800">
                                                        {formatDate(assignment.date)}
                                                    </span>
                                                    {assignment.isDispatchConfirmed && (
                                                        <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">
                                                            手配確定
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    {assignment.memberCount || 0}人 / 職長ID: {assignment.assignedEmployeeId?.substring(0, 8) || '未割当'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Stats */}
            <div className="mt-4 text-sm text-gray-600">
                全 {filteredMasters.length} 件の案件マスター
                {searchTerm && ` (${projectMasters.length}件中)`}
            </div>
        </div>
    );
}
