'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMasterData } from '@/hooks/useMasterData';
import { Trash2, Edit, Plus, Check, X } from 'lucide-react';
import UnitPriceMasterSettings from '@/components/Settings/UnitPriceMasterSettings';
import UserManagement from '@/components/Settings/UserManagement';
import CompanyInfoSettings from '@/components/Settings/CompanyInfoSettings';
import ConstructionTypeSettings from '@/components/Settings/ConstructionTypeSettings';
import toast from 'react-hot-toast';

export default function SettingsPage() {
    const { data: session } = useSession();
    const {
        vehicles,
        workers,
        managers,
        totalMembers,
        addVehicle,
        updateVehicle,
        deleteVehicle,
        addWorker,
        updateWorker,
        deleteWorker,
        addManager,
        updateManager,
        deleteManager,
        updateTotalMembers,
    } = useMasterData();

    const [activeTab, setActiveTab] = useState<'vehicles' | 'workers' | 'managers' | 'members' | 'constructionTypes' | 'unitprices' | 'company' | 'users'>('vehicles');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [newItemName, setNewItemName] = useState('');
    const [newTotalMembers, setNewTotalMembers] = useState(totalMembers.toString());
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Check if user is admin
    const isUserAdmin = session?.user?.role === 'admin';

    // Build tabs array based on user permissions
    const tabs = React.useMemo(() => {
        const baseTabs: Array<{ id: 'vehicles' | 'workers' | 'managers' | 'members' | 'constructionTypes' | 'unitprices' | 'company' | 'users'; label: string; count: number | null }> = [
            { id: 'vehicles' as const, label: '車両管理', count: vehicles.length },
            { id: 'workers' as const, label: '職人管理', count: workers.length },
            { id: 'managers' as const, label: '案件担当者管理', count: managers.length },
            { id: 'members' as const, label: '総メンバー数設定', count: null },
            { id: 'constructionTypes' as const, label: '工事種別', count: null },
            { id: 'unitprices' as const, label: '単価マスター', count: null },
            { id: 'company' as const, label: '会社情報', count: null },
        ];

        // Add user management tab if user is admin
        if (isUserAdmin) {
            baseTabs.push({ id: 'users' as const, label: 'ユーザー管理', count: null });
        }

        return baseTabs;
    }, [isUserAdmin, vehicles.length, workers.length, managers.length]);

    const handleAdd = () => {
        if (!newItemName.trim()) return;

        switch (activeTab) {
            case 'vehicles':
                addVehicle(newItemName.trim());
                break;
            case 'workers':
                addWorker(newItemName.trim());
                break;
            case 'managers':
                addManager(newItemName.trim());
                break;
        }
        setNewItemName('');
    };

    const handleEdit = (id: string, currentName: string) => {
        setEditingId(id);
        setEditingValue(currentName);
    };

    const handleSaveEdit = () => {
        if (!editingValue.trim() || !editingId) return;

        switch (activeTab) {
            case 'vehicles':
                updateVehicle(editingId, editingValue.trim());
                break;
            case 'workers':
                updateWorker(editingId, editingValue.trim());
                break;
            case 'managers':
                updateManager(editingId, editingValue.trim());
                break;
        }
        setEditingId(null);
        setEditingValue('');
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditingValue('');
    };

    const handleDelete = (id: string) => {
        switch (activeTab) {
            case 'vehicles':
                deleteVehicle(id);
                break;
            case 'workers':
                deleteWorker(id);
                break;
            case 'managers':
                deleteManager(id);
                break;
        }
        setDeleteConfirm(null);
    };

    const handleSaveTotalMembers = () => {
        const count = parseInt(newTotalMembers);
        if (!isNaN(count) && count > 0) {
            updateTotalMembers(count);
            toast.success('総メンバー数を更新しました');
        }
    };

    const getCurrentItems = () => {
        switch (activeTab) {
            case 'vehicles':
                return vehicles;
            case 'workers':
                return workers;
            case 'managers':
                return managers;
            default:
                return [];
        }
    };

    const getTabLabel = () => {
        switch (activeTab) {
            case 'vehicles':
                return '車両';
            case 'workers':
                return '職人';
            case 'managers':
                return '案件担当者';
            default:
                return '';
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
            <div className="p-3 sm:p-6 lg:p-8">
                {/* Header */}
                <div className="mb-4 md:mb-8">
                    <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-slate-700 to-slate-900 bg-clip-text text-transparent">マスター・設定</h1>
                    <p className="text-sm md:text-base text-slate-600 mt-1 md:mt-2">マスターデータを管理します</p>
                </div>

                {/* Tabs */}
                <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                    <div className="border-b border-slate-200">
                        <nav className="flex -mb-px overflow-x-auto scrollbar-hide">
                            {tabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`
                                        px-3 md:px-6 py-3 md:py-4 text-xs md:text-sm font-medium border-b-2 transition-all duration-300 whitespace-nowrap flex-shrink-0
                                        ${activeTab === tab.id
                                            ? 'border-slate-700 text-slate-900 bg-gradient-to-t from-slate-100 to-transparent'
                                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                                        }
                                    `}
                                >
                                    {tab.label}
                                    {tab.count !== null && (
                                        <span className="ml-1 md:ml-2 px-1.5 md:px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Tab Content */}
                    <div className="p-3 md:p-6">
                        {activeTab === 'members' ? (
                            // Total Members Configuration
                            <div className="max-w-md">
                                <h3 className="text-lg font-semibold text-slate-900 mb-4">総メンバー数の設定</h3>
                                <div className="bg-gradient-to-r from-slate-100 to-slate-50 border border-slate-300 rounded-lg p-4 mb-4">
                                    <p className="text-sm text-slate-700">
                                        現在の設定: <span className="font-bold text-xl">{totalMembers}</span>人
                                    </p>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            新しい人数
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="number"
                                                min="1"
                                                value={newTotalMembers}
                                                onChange={(e) => setNewTotalMembers(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                placeholder="人数を入力"
                                            />
                                            <span className="flex items-center text-slate-600">人</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSaveTotalMembers}
                                        className="w-full px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-600 text-white rounded-md hover:from-slate-800 hover:to-slate-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg"
                                    >
                                        保存
                                    </button>
                                </div>
                            </div>
                        ) : activeTab === 'constructionTypes' ? (
                            // 工事種別マスター
                            <ConstructionTypeSettings />
                        ) : activeTab === 'unitprices' ? (
                            // 単価マスター
                            <UnitPriceMasterSettings />
                        ) : activeTab === 'company' ? (
                            // 会社情報
                            <CompanyInfoSettings />
                        ) : activeTab === 'users' ? (
                            // ユーザー管理
                            <UserManagement />
                        ) : (
                            // List Management (Vehicles, Workers, Managers)
                            <div>
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-semibold text-slate-900">
                                        {getTabLabel()}一覧
                                    </h3>
                                </div>

                                {/* Add New Item */}
                                <div className="mb-6 flex gap-2">
                                    <input
                                        type="text"
                                        value={newItemName}
                                        onChange={(e) => setNewItemName(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                                        className="flex-1 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder={`新しい${getTabLabel()}を追加`}
                                    />
                                    <button
                                        onClick={handleAdd}
                                        className="px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-600 text-white rounded-md hover:from-slate-800 hover:to-slate-700 transition-all duration-200 font-medium flex items-center gap-2 shadow-md hover:shadow-lg"
                                    >
                                        <Plus className="w-4 h-4" />
                                        追加
                                    </button>
                                </div>

                                {/* Items List */}
                                <div className="space-y-2">
                                    {getCurrentItems().map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                                        >
                                            {editingId === item.id ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={editingValue}
                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                        onKeyPress={(e) => e.key === 'Enter' && handleSaveEdit()}
                                                        className="flex-1 px-3 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={handleSaveEdit}
                                                        className="p-2 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                                                        title="保存"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelEdit}
                                                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                                                        title="キャンセル"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="flex-1 text-slate-900">{item.name}</span>
                                                    <button
                                                        onClick={() => handleEdit(item.id, item.name)}
                                                        className="p-2 text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                                                        title="編集"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    {deleteConfirm === item.id ? (
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => handleDelete(item.id)}
                                                                className="px-3 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                                                            >
                                                                削除
                                                            </button>
                                                            <button
                                                                onClick={() => setDeleteConfirm(null)}
                                                                className="px-3 py-1 text-xs bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors"
                                                            >
                                                                キャンセル
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setDeleteConfirm(item.id)}
                                                            className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                            title="削除"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {getCurrentItems().length === 0 && (
                                    <div className="text-center py-12 text-gray-500">
                                        {getTabLabel()}が登録されていません
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
