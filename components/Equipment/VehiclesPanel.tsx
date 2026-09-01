'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Truck, AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { expiryStatus } from '@/lib/equipment';
import { ExpiryBadge } from './ExpiryBadge';
import { VehicleDetailModal } from './VehicleDetailModal';
import { EquipmentVehicle, fmtDate, fmtYen } from './types';

/**
 * 機材台帳の「車両」タブ。
 * 車両そのもの（名前・日額・有効/無効）の追加や改名は従来どおり 設定＞車両管理 が担当で、
 * ここでは「車検・保険などの詳細」「整備・修理の履歴と書類の写真」「使用履歴」を扱う。
 */
export function VehiclesPanel({ canEdit }: { canEdit: boolean }) {
    const [vehicles, setVehicles] = useState<EquipmentVehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const fetchVehicles = useCallback(async () => {
        try {
            const res = await fetch('/api/equipment/vehicles', { cache: 'no-store' });
            if (!res.ok) throw new Error('failed');
            setVehicles(await res.json());
        } catch (e) {
            logger.error('Failed to fetch equipment vehicles:', e);
            toast.error('車両の読み込みに失敗しました');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchVehicles();
    }, [fetchVehicles]);

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return vehicles
            .filter((v) => (showInactive ? true : v.isActive))
            .filter((v) => {
                if (!q) return true;
                const hay = [v.name, v.profile?.registrationNumber, v.profile?.vehicleType].filter(Boolean).join(' ').toLowerCase();
                return hay.includes(q);
            });
    }, [vehicles, query, showInactive]);

    // 期限が切れている／30日以内の車両（有効な車両のみ数える）
    const alerts = useMemo(() => {
        const rows = vehicles.filter((v) => v.isActive);
        const near = (d: string | null | undefined) => {
            const s = expiryStatus(d);
            return s === 'expired' || s === 'danger';
        };
        return {
            inspection: rows.filter((v) => near(v.profile?.inspectionExpiry)),
            insurance: rows.filter((v) => near(v.profile?.insuranceExpiry) || near(v.profile?.jibaisekiExpiry)),
        };
    }, [vehicles]);

    const selected = vehicles.find((v) => v.id === selectedId) ?? null;

    return (
        <div>
            {(alerts.inspection.length > 0 || alerts.insurance.length > 0) && (
                <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                            {alerts.inspection.length > 0 && (
                                <div>
                                    <span className="font-medium">車検</span>が切れている／30日以内：
                                    {alerts.inspection.map((v) => v.name).join('、')}
                                </div>
                            )}
                            {alerts.insurance.length > 0 && (
                                <div>
                                    <span className="font-medium">保険</span>が切れている／30日以内：
                                    {alerts.insurance.map((v) => v.name).join('、')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="車両名・車番・車種で検索"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                    />
                    使わなくなった車両も表示
                </label>
                <button
                    type="button"
                    onClick={fetchVehicles}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                    <RefreshCw className="h-4 w-4" />
                    更新
                </button>
            </div>

            {loading ? (
                <div className="py-16 text-center text-slate-500">読み込み中...</div>
            ) : visible.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-500">
                    該当する車両がありません
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map((v) => (
                        <button
                            key={v.id}
                            type="button"
                            onClick={() => setSelectedId(v.id)}
                            className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <Truck className="h-4 w-4 shrink-0 text-slate-400" />
                                        <span className="truncate font-medium text-slate-800">{v.name}</span>
                                        {!v.isActive && (
                                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">未使用</span>
                                        )}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-slate-500">
                                        {[v.profile?.vehicleType, v.profile?.registrationNumber].filter(Boolean).join('　') || '車種・車番は未登録'}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-1.5">
                                <ExpiryBadge label="車検" date={v.profile?.inspectionExpiry} />
                                <ExpiryBadge label="任意保険" date={v.profile?.insuranceExpiry} />
                            </div>

                            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                                <span>
                                    整備 {v.maintenance.count}件
                                    {v.maintenance.lastDate ? `（最終 ${fmtDate(v.maintenance.lastDate)}）` : ''}
                                </span>
                                <span className="font-medium text-slate-700">{fmtYen(v.maintenance.totalAmount)}</span>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {selected && (
                <VehicleDetailModal
                    vehicle={selected}
                    canEdit={canEdit}
                    onClose={() => setSelectedId(null)}
                    onChanged={fetchVehicles}
                />
            )}
        </div>
    );
}
