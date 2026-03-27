'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronDown, ChevronRight, Check, Truck, Calendar, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LoadingListResponse, LoadingListItem } from '@/types/material';

function toDateInputValue(d?: Date) {
    const date = d || new Date();
    return date.toISOString().split('T')[0];
}

export default function LoadingListPage() {
    const { data: session } = useSession();
    const [date, setDate] = useState(toDateInputValue());
    const [isConfirming, setIsConfirming] = useState(false);
    const [vehicles, setVehicles] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState('');
    const [loadingList, setLoadingList] = useState<LoadingListResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    // Fetch vehicles
    useEffect(() => {
        fetch('/api/master-data/vehicles', { cache: 'no-store' })
            .then(res => res.ok ? res.json() : [])
            .then(data => setVehicles(data))
            .catch(() => {});
    }, []);

    const fetchLoadingList = useCallback(async () => {
        if (!selectedVehicleId || !date) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/materials/loading-list?date=${date}&vehicleId=${selectedVehicleId}`, { cache: 'no-store' });
            if (res.ok) {
                setLoadingList(await res.json());
            } else {
                toast.error('積込リストの取得に失敗しました');
            }
        } catch {
            toast.error('積込リストの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [date, selectedVehicleId]);

    useEffect(() => {
        if (selectedVehicleId && date) fetchLoadingList();
    }, [selectedVehicleId, date, fetchLoadingList]);

    const toggleCheck = async (materialItemId: string, projectMasterId: string, currentChecked: boolean) => {
        try {
            const res = await fetch('/api/materials/loading-list/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date,
                    vehicleId: selectedVehicleId,
                    materialItemId,
                    projectMasterId,
                    isChecked: !currentChecked,
                }),
            });
            if (res.ok) {
                // Update local state
                setLoadingList(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        items: prev.items.map(item => {
                            if (item.materialItemId !== materialItemId) return item;
                            const newBreakdown = item.breakdown.map(b =>
                                b.projectMasterId === projectMasterId ? { ...b, isChecked: !currentChecked } : b
                            );
                            const allChecked = newBreakdown.every(b => b.isChecked);
                            return { ...item, breakdown: newBreakdown, isChecked: allChecked };
                        }),
                    };
                });
            }
        } catch {
            toast.error('チェック状態の更新に失敗しました');
        }
    };

    const isManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';

    const handleConfirmDispatch = async () => {
        if (!loadingList || !confirm('チェック済みの材料を出庫確定しますか？\n在庫から差し引かれます。')) return;
        setIsConfirming(true);
        try {
            const checkedItems: { materialItemId: string; projectMasterId: string; quantity: number }[] = [];
            for (const item of loadingList.items) {
                for (const bd of item.breakdown) {
                    if (bd.isChecked) {
                        checkedItems.push({
                            materialItemId: item.materialItemId,
                            projectMasterId: bd.projectMasterId,
                            quantity: bd.quantity,
                        });
                    }
                }
            }
            if (checkedItems.length === 0) {
                toast.error('チェック済みの材料がありません');
                return;
            }
            const res = await fetch('/api/materials/loading-list/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date, vehicleId: selectedVehicleId, items: checkedItems }),
            });
            if (res.ok) {
                toast.success('出庫確定しました。在庫が更新されました。');
                fetchLoadingList();
            } else {
                toast.error('出庫確定に失敗しました');
            }
        } catch {
            toast.error('出庫確定に失敗しました');
        } finally {
            setIsConfirming(false);
        }
    };

    const checkedCount = loadingList?.items.filter(i => i.isChecked).length ?? 0;
    const totalCount = loadingList?.items.length ?? 0;

    return (
        <div className="max-w-[1800px] mx-auto">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                    積込リスト
                </h1>
                <p className="text-sm text-slate-500 mt-1">トラック別の材料積込チェックリスト</p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500 shadow-sm"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-slate-400" />
                    <select
                        value={selectedVehicleId}
                        onChange={(e) => setSelectedVehicleId(e.target.value)}
                        className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-slate-500 shadow-sm"
                    >
                        <option value="">トラックを選択</option>
                        {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                    </select>
                </div>
                {loadingList && (
                    <>
                        <div className="px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-sm text-sm">
                            <span className="text-slate-500">進捗:</span>
                            <span className="font-bold text-slate-800 ml-1">{checkedCount}/{totalCount}</span>
                        </div>
                        {isManager && checkedCount > 0 && (
                            <button
                                onClick={handleConfirmDispatch}
                                disabled={isConfirming}
                                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl hover:shadow-md disabled:opacity-50"
                            >
                                <PackageCheck className="w-3.5 h-3.5" />
                                {isConfirming ? '処理中...' : '出庫確定'}
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Content */}
            {!selectedVehicleId ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Truck className="w-12 h-12 mb-3" />
                    <p className="text-sm">日付とトラックを選択してください</p>
                </div>
            ) : isLoading ? (
                <div className="flex justify-center py-20">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
                </div>
            ) : !loadingList || loadingList.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Package className="w-12 h-12 mb-3" />
                    <p className="text-sm">この日のこのトラックには積込材料がありません</p>
                    <p className="text-xs mt-1">案件に材料表を登録し、手配確定で車両を割り当ててください</p>
                </div>
            ) : (
                <>
                    {/* Project info */}
                    <div className="flex flex-wrap gap-2 mb-4">
                        {loadingList.projects.map(p => (
                            <span key={p.id} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                                {p.title}
                            </span>
                        ))}
                    </div>

                    {/* Desktop Table (md+) */}
                    <div className="hidden md:block">
                        <LoadingListTable
                            items={loadingList.items}
                            projects={loadingList.projects}
                            onToggleCheck={toggleCheck}
                        />
                    </div>

                    {/* Mobile Checklist (< md) */}
                    <div className="md:hidden">
                        <LoadingListChecklist
                            items={loadingList.items}
                            onToggleCheck={toggleCheck}
                        />
                    </div>
                </>
            )}
        </div>
    );
}

function Package(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/>
        </svg>
    );
}

// iPad/Desktop table view
function LoadingListTable({
    items,
    projects,
    onToggleCheck,
}: {
    items: LoadingListItem[];
    projects: { id: string; title: string }[];
    onToggleCheck: (materialItemId: string, projectMasterId: string, currentChecked: boolean) => void;
}) {
    // Group by category
    const grouped = items.reduce((acc, item) => {
        if (!acc[item.categoryName]) acc[item.categoryName] = [];
        acc[item.categoryName].push(item);
        return acc;
    }, {} as Record<string, LoadingListItem[]>);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-3 font-semibold text-slate-600">材料</th>
                        <th className="text-center px-3 py-3 font-semibold text-slate-600 w-20">合計</th>
                        {projects.map(p => (
                            <th key={p.id} className="text-center px-3 py-3 font-semibold text-slate-600 w-24 truncate">
                                {p.title}
                            </th>
                        ))}
                        <th className="text-center px-3 py-3 font-semibold text-slate-600 w-16">済</th>
                    </tr>
                </thead>
                <tbody>
                    {Object.entries(grouped).map(([categoryName, categoryItems]) => (
                        <React.Fragment key={categoryName}>
                            <tr className="bg-slate-50/50">
                                <td colSpan={3 + projects.length} className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {categoryName}
                                </td>
                            </tr>
                            {categoryItems.map(item => (
                                <tr
                                    key={item.materialItemId}
                                    className={`border-t border-slate-50 ${item.isChecked ? 'bg-green-50/50 opacity-60' : 'hover:bg-slate-50'}`}
                                >
                                    <td className={`px-4 py-3 ${item.isChecked ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                        {item.materialName}
                                        {item.spec && <span className="text-slate-400 ml-1">({item.spec})</span>}
                                        <span className="text-slate-400 text-xs ml-1">{item.unit}</span>
                                    </td>
                                    <td className="text-center font-bold text-slate-900 text-base">{item.totalQuantity}</td>
                                    {projects.map(p => {
                                        const bd = item.breakdown.find(b => b.projectMasterId === p.id);
                                        return (
                                            <td key={p.id} className="text-center text-slate-600">
                                                {bd ? bd.quantity : '-'}
                                            </td>
                                        );
                                    })}
                                    <td className="text-center">
                                        <button
                                            onClick={() => {
                                                // Toggle all breakdowns for this item
                                                item.breakdown.forEach(b => {
                                                    if (b.isChecked === item.isChecked) {
                                                        onToggleCheck(item.materialItemId, b.projectMasterId, b.isChecked);
                                                    }
                                                });
                                            }}
                                            className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-colors ${
                                                item.isChecked
                                                    ? 'bg-green-500 border-green-500 text-white'
                                                    : 'border-slate-300 hover:border-teal-500'
                                            }`}
                                        >
                                            {item.isChecked && <Check className="w-4 h-4" />}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// Smartphone checklist view
function LoadingListChecklist({
    items,
    onToggleCheck,
}: {
    items: LoadingListItem[];
    onToggleCheck: (materialItemId: string, projectMasterId: string, currentChecked: boolean) => void;
}) {
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    const toggleExpand = (id: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    // Group by category
    const grouped = items.reduce((acc, item) => {
        if (!acc[item.categoryName]) acc[item.categoryName] = [];
        acc[item.categoryName].push(item);
        return acc;
    }, {} as Record<string, LoadingListItem[]>);

    return (
        <div className="space-y-4">
            {Object.entries(grouped).map(([categoryName, categoryItems]) => (
                <div key={categoryName}>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                        {categoryName}
                    </h3>
                    <div className="space-y-2">
                        {categoryItems.map(item => (
                            <div
                                key={item.materialItemId}
                                className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
                                    item.isChecked ? 'border-green-200 bg-green-50/30' : 'border-slate-200'
                                }`}
                            >
                                <div className="flex items-center gap-3 px-4 py-3">
                                    <button
                                        onClick={() => {
                                            item.breakdown.forEach(b => {
                                                if (b.isChecked === item.isChecked) {
                                                    onToggleCheck(item.materialItemId, b.projectMasterId, b.isChecked);
                                                }
                                            });
                                        }}
                                        className={`w-10 h-10 flex-shrink-0 rounded-xl border-2 flex items-center justify-center transition-colors ${
                                            item.isChecked
                                                ? 'bg-green-500 border-green-500 text-white'
                                                : 'border-slate-300'
                                        }`}
                                    >
                                        {item.isChecked && <Check className="w-5 h-5" />}
                                    </button>
                                    <div className="flex-1 min-w-0" onClick={() => toggleExpand(item.materialItemId)}>
                                        <div className={`text-sm font-medium ${item.isChecked ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                            {item.materialName}
                                            {item.spec && <span className="text-slate-400 ml-1">({item.spec})</span>}
                                        </div>
                                        {item.breakdown.length > 1 && (
                                            <div className="flex items-center gap-1 mt-0.5">
                                                {expandedItems.has(item.materialItemId)
                                                    ? <ChevronDown className="w-3 h-3 text-slate-400" />
                                                    : <ChevronRight className="w-3 h-3 text-slate-400" />
                                                }
                                                <span className="text-xs text-slate-400">{item.breakdown.length}現場</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <span className={`text-xl font-bold ${item.isChecked ? 'text-slate-400' : 'text-slate-900'}`}>
                                            {item.totalQuantity}
                                        </span>
                                        <span className="text-xs text-slate-400 ml-0.5">{item.unit}</span>
                                    </div>
                                </div>

                                {/* Breakdown */}
                                {expandedItems.has(item.materialItemId) && item.breakdown.length > 1 && (
                                    <div className="border-t border-slate-100 px-4 py-2 space-y-1">
                                        {item.breakdown.map(b => (
                                            <div key={b.projectMasterId} className="flex items-center justify-between text-xs">
                                                <span className="text-slate-500">{b.projectTitle}</span>
                                                <span className="font-medium text-slate-700">{b.quantity}{item.unit}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
