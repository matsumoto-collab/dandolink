'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMasterData } from '@/hooks/useMasterData';
import { Trash2, Edit, Plus, Check, X } from 'lucide-react';
import UnitPriceMasterSettings from '@/components/Settings/UnitPriceMasterSettings';
import UserManagement from '@/components/Settings/UserManagement';
import PartnerListPage from '@/components/Settings/PartnerListPage';
import ConstructionTypeSettings from '@/components/Settings/ConstructionTypeSettings';
import ConstructionSuffixSettings from '@/components/Settings/ConstructionSuffixSettings';
import ConstructionContentSettings from '@/components/Settings/ConstructionContentSettings';
import ScaffoldingSpecSettings from '@/components/Settings/ScaffoldingSpecSettings';
import BillingTitleSettings from '@/components/Settings/BillingTitleSettings';
import MaterialMasterSettings from '@/components/Settings/MaterialMasterSettings';
import CostMasterSettings from '@/components/Settings/CostMasterSettings';
import SystemSettingsPanel from '@/components/Settings/SystemSettingsPanel';
import NotificationSettings from '@/components/Settings/NotificationSettings';
import DispatchOrderSettings from '@/components/Settings/DispatchOrderSettings';
import toast from 'react-hot-toast';

export default function SettingsPage() {
    const { data: session } = useSession();
    const {
        vehicles,
        memberCountHistory,
        addVehicle,
        updateVehicle,
        deleteVehicle,
        addMemberCountEntry,
        updateMemberCountEntry,
        deleteMemberCountEntry,
    } = useMasterData();

    const [activeTab, setActiveTab] = useState<'vehicles' | 'members' | 'constructionTypes' | 'constructionSuffixes' | 'constructionContents' | 'scaffoldingSpec' | 'billingTitles' | 'unitprices' | 'materials' | 'costmasters' | 'system' | 'notifications' | 'users' | 'partners' | 'dispatchOrder'>('vehicles');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [newItemName, setNewItemName] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Member count history form state
    const [newMemberDate, setNewMemberDate] = useState('');
    const [newMemberCount, setNewMemberCount] = useState('');
    const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
    const [editingMemberDate, setEditingMemberDate] = useState('');
    const [editingMemberCount, setEditingMemberCount] = useState('');

    // Check if user is admin
    const isUserAdmin = session?.user?.role === 'admin';

    // Build tabs array based on user permissions
    const tabs = React.useMemo(() => {
        const baseTabs: Array<{ id: 'vehicles' | 'members' | 'constructionTypes' | 'constructionSuffixes' | 'constructionContents' | 'scaffoldingSpec' | 'billingTitles' | 'unitprices' | 'materials' | 'costmasters' | 'system' | 'notifications' | 'users' | 'partners' | 'dispatchOrder'; label: string; count: number | null }> = [
            { id: 'vehicles' as const, label: '車両管理', count: null },
            { id: 'members' as const, label: '総メンバー数設定', count: null },
            { id: 'constructionTypes' as const, label: '工事種別', count: null },
            { id: 'constructionSuffixes' as const, label: '工事名称', count: null },
            { id: 'constructionContents' as const, label: '工事内容', count: null },
            { id: 'scaffoldingSpec' as const, label: '足場仕様', count: null },
            { id: 'billingTitles' as const, label: '請求関係', count: null },
            { id: 'unitprices' as const, label: '単価マスター', count: null },
            { id: 'materials' as const, label: '材料マスター', count: null },
            { id: 'costmasters' as const, label: '原価マスター', count: null },
            { id: 'system' as const, label: '協力業者費設定', count: null },
            { id: 'notifications' as const, label: '通知', count: null },
            { id: 'dispatchOrder' as const, label: '手配確定の並び', count: null },
        ];

        // Add user management tab if user is admin
        if (isUserAdmin) {
            baseTabs.push({ id: 'users' as const, label: 'ユーザー管理', count: null });
            baseTabs.push({ id: 'partners' as const, label: '協力会社', count: null });
        }

        return baseTabs;
    }, [isUserAdmin]);

    const handleAdd = () => {
        if (!newItemName.trim()) return;

        switch (activeTab) {
            case 'vehicles':
                addVehicle(newItemName.trim());
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
        }
        setDeleteConfirm(null);
    };

    const handleAddMemberCount = async () => {
        const count = parseInt(newMemberCount);
        if (!newMemberDate || isNaN(count) || count < 1) {
            toast.error('適用開始日と人数（1以上）を入力してください');
            return;
        }
        // Check for duplicate date
        const exists = memberCountHistory.some(e => e.startDate.slice(0, 10) === newMemberDate);
        if (exists) {
            toast.error('同じ日付の設定が既に存在します');
            return;
        }
        await addMemberCountEntry(newMemberDate, count);
        setNewMemberDate('');
        setNewMemberCount('');
        toast.success('メンバー数設定を追加しました');
    };

    const handleUpdateMemberCount = async () => {
        if (!editingMemberId) return;
        const count = parseInt(editingMemberCount);
        if (!editingMemberDate || isNaN(count) || count < 1) {
            toast.error('適用開始日と人数（1以上）を入力してください');
            return;
        }
        await updateMemberCountEntry(editingMemberId, editingMemberDate, count);
        setEditingMemberId(null);
        toast.success('メンバー数設定を更新しました');
    };

    const handleDeleteMemberCount = async (id: string) => {
        await deleteMemberCountEntry(id);
        setDeleteConfirm(null);
        toast.success('メンバー数設定を削除しました');
    };

    const getCurrentItems = () => {
        switch (activeTab) {
            case 'vehicles':
                return vehicles;
            default:
                return [];
        }
    };

    const getTabLabel = () => {
        switch (activeTab) {
            case 'vehicles':
                return '車両';
            default:
                return '';
        }
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50">
            <div className="flex-1 overflow-y-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-slate-800">マスター・設定</h1>
                    <p className="text-sm text-slate-500 mt-1">マスターデータを管理します</p>
                </div>

                {/* Segment Tabs */}
                <div className="flex flex-wrap gap-1.5 md:gap-2 bg-slate-100 rounded-xl p-1.5 md:p-2 mb-4 md:mb-6">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium rounded-lg
                                transition-all duration-300 whitespace-nowrap
                                ${activeTab === tab.id
                                    ? 'bg-gradient-to-r from-slate-700 to-slate-600 text-white shadow-md'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
                                }
                            `}
                        >
                            {tab.label}
                            {tab.count !== null && (
                                <span className={`ml-1 md:ml-1.5 px-1.5 py-0.5 text-xs rounded-full ${
                                    activeTab === tab.id
                                        ? 'bg-white/20 text-white'
                                        : 'bg-slate-200 text-slate-600'
                                }`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                    <div className="p-3 md:p-6 min-w-0 overflow-hidden">
                        {activeTab === 'members' ? (
                            // Member Count History Configuration
                            <div className="max-w-lg">
                                <h3 className="text-lg font-semibold text-slate-900 mb-2">総メンバー数の設定</h3>
                                <p className="text-sm text-slate-500 mb-4">適用開始日ごとにメンバー数を設定できます。入退社による人数変更を期間で管理します。</p>

                                {/* History List */}
                                <div className="space-y-2 mb-6">
                                    {memberCountHistory.map((entry) => (
                                        <div key={entry.id} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                                            {editingMemberId === entry.id ? (
                                                <>
                                                    <input
                                                        type="date"
                                                        value={editingMemberDate}
                                                        onChange={(e) => setEditingMemberDate(e.target.value)}
                                                        className="px-3 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                                                    />
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={editingMemberCount}
                                                        onChange={(e) => setEditingMemberCount(e.target.value)}
                                                        className="w-20 px-3 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                                                    />
                                                    <span className="text-sm text-slate-600">人</span>
                                                    <button onClick={handleUpdateMemberCount} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl" title="保存">
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => setEditingMemberId(null)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl" title="キャンセル">
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="flex-1 text-slate-900 text-sm">
                                                        <span className="font-medium">{entry.startDate.slice(0, 10)}</span>
                                                        <span className="mx-2 text-slate-400">〜</span>
                                                        <span className="font-bold text-lg">{entry.count}</span>
                                                        <span className="text-slate-600">人</span>
                                                    </span>
                                                    <button
                                                        onClick={() => {
                                                            setEditingMemberId(entry.id);
                                                            setEditingMemberDate(entry.startDate.slice(0, 10));
                                                            setEditingMemberCount(entry.count.toString());
                                                        }}
                                                        className="p-2 text-slate-700 hover:bg-slate-100 rounded-xl"
                                                        title="編集"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    {deleteConfirm === entry.id ? (
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleDeleteMemberCount(entry.id)} className="px-3 py-1 text-xs bg-slate-700 text-white rounded-xl hover:bg-slate-800">削除</button>
                                                            <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-xs bg-slate-300 text-slate-700 rounded-xl hover:bg-slate-400">キャンセル</button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setDeleteConfirm(entry.id)}
                                                            className="p-2 text-slate-600 hover:bg-slate-50 rounded-xl"
                                                            title="削除"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    ))}
                                    {memberCountHistory.length === 0 && (
                                        <div className="text-center py-8 text-slate-500">メンバー数設定がありません</div>
                                    )}
                                </div>

                                {/* Add New Entry */}
                                <div className="border-t border-slate-200 pt-4">
                                    <h4 className="text-sm font-medium text-slate-700 mb-3">変更を追加</h4>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <input
                                            type="date"
                                            value={newMemberDate}
                                            onChange={(e) => setNewMemberDate(e.target.value)}
                                            className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                                            placeholder="適用開始日"
                                        />
                                        <div className="flex gap-2 items-center">
                                            <input
                                                type="number"
                                                min="1"
                                                value={newMemberCount}
                                                onChange={(e) => setNewMemberCount(e.target.value)}
                                                className="w-24 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                                                placeholder="人数"
                                            />
                                            <span className="text-sm text-slate-600">人</span>
                                        </div>
                                        <button
                                            onClick={handleAddMemberCount}
                                            className="px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg text-sm"
                                        >
                                            <Plus className="w-4 h-4" />
                                            追加
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : activeTab === 'constructionTypes' ? (
                            // 工事種別マスター
                            <ConstructionTypeSettings />
                        ) : activeTab === 'constructionSuffixes' ? (
                            // 工事名称マスター
                            <ConstructionSuffixSettings />
                        ) : activeTab === 'constructionContents' ? (
                            // 工事内容マスター
                            <ConstructionContentSettings />
                        ) : activeTab === 'scaffoldingSpec' ? (
                            <ScaffoldingSpecSettings />
                        ) : activeTab === 'billingTitles' ? (
                            // 請求項目マスター
                            <BillingTitleSettings />
                        ) : activeTab === 'costmasters' ? (
                            // 原価マスター
                            <CostMasterSettings />
                        ) : activeTab === 'system' ? (
                            // 協力業者費設定
                            <SystemSettingsPanel />
                        ) : activeTab === 'notifications' ? (
                            // プッシュ通知設定
                            <NotificationSettings />
                        ) : activeTab === 'materials' ? (
                            // 材料マスター
                            <MaterialMasterSettings />
                        ) : activeTab === 'unitprices' ? (
                            // 単価マスター
                            <UnitPriceMasterSettings />
                        ) : activeTab === 'users' ? (
                            // ユーザー管理
                            <UserManagement />
                        ) : activeTab === 'partners' ? (
                            // 協力会社管理
                            <PartnerListPage />
                        ) : activeTab === 'dispatchOrder' ? (
                            // 手配確定の並び順
                            <DispatchOrderSettings />
                        ) : (
                            // List Management (Vehicles, Workers, Managers)
                            <div>
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-semibold text-slate-900">
                                        {getTabLabel()}一覧
                                    </h3>
                                </div>

                                {/* Add New Item */}
                                <div className="mb-6 flex flex-col md:flex-row gap-2">
                                    <input
                                        type="text"
                                        value={newItemName}
                                        onChange={(e) => setNewItemName(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
                                        className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder={`新しい${getTabLabel()}を追加`}
                                    />
                                    <button
                                        onClick={handleAdd}
                                        className="px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all duration-200 font-medium flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
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
                                            className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors"
                                        >
                                            {editingId === item.id ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={editingValue}
                                                        onChange={(e) => setEditingValue(e.target.value)}
                                                        onKeyPress={(e) => e.key === 'Enter' && handleSaveEdit()}
                                                        className="flex-1 px-3 py-1 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={handleSaveEdit}
                                                        className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                                        title="保存"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelEdit}
                                                        className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                                        title="キャンセル"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="flex-1 text-slate-900">
                                                        {item.name}
                                                    </span>
                                                    <button
                                                        onClick={() => handleEdit(item.id, item.name)}
                                                        className="p-2.5 text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                                                        title="編集"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    {deleteConfirm === item.id ? (
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => handleDelete(item.id)}
                                                                className="px-3 py-1 text-xs bg-slate-700 text-white rounded-xl hover:bg-slate-800 transition-colors"
                                                            >
                                                                削除
                                                            </button>
                                                            <button
                                                                onClick={() => setDeleteConfirm(null)}
                                                                className="px-3 py-1 text-xs bg-slate-300 text-slate-700 rounded-xl hover:bg-slate-400 transition-colors"
                                                            >
                                                                キャンセル
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setDeleteConfirm(item.id)}
                                                            className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
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
                                    <div className="text-center py-12 text-slate-500">
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
