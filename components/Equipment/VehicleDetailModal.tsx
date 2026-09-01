'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import { MaintenanceTab } from './MaintenanceTab';
import { ExpiryBadge } from './ExpiryBadge';
import { EquipmentVehicle, VehicleProfile, VehicleUsage, fmtDate, toDateInput } from './types';

interface Props {
    vehicle: EquipmentVehicle;
    canEdit: boolean;
    onClose: () => void;
    /** 台帳一覧を取り直す（期限や整備件数の表示を合わせるため） */
    onChanged: () => void;
}

type TabKey = 'profile' | 'maintenance' | 'usage';

const emptyProfile = (): VehicleProfile => ({
    vehicleType: '',
    registrationNumber: '',
    usage: '',
    inspectionExpiry: '',
    jibaisekiCompany: '',
    jibaisekiExpiry: '',
    insuranceCompany: '',
    insuranceExpiry: '',
    insurancePersonal: '',
    insuranceObjective: '',
    insurancePassenger: '',
    defaultDriverName: '',
    notes: '',
});

/** 車両1台の詳細。基本情報・整備履歴・使用履歴を切り替えて見る。 */
export function VehicleDetailModal({ vehicle, canEdit, onClose, onChanged }: Props) {
    const [tab, setTab] = useState<TabKey>('profile');
    const [form, setForm] = useState<VehicleProfile>(() => ({ ...emptyProfile(), ...(vehicle.profile ?? {}) }));
    const [saving, setSaving] = useState(false);
    const [usage, setUsage] = useState<VehicleUsage[]>([]);
    const [usageLoading, setUsageLoading] = useState(false);

    useEffect(() => {
        setForm({ ...emptyProfile(), ...(vehicle.profile ?? {}) });
    }, [vehicle.id, vehicle.profile]);

    const fetchUsage = useCallback(async () => {
        setUsageLoading(true);
        try {
            const res = await fetch(`/api/equipment/vehicles/${vehicle.id}/usage`, { cache: 'no-store' });
            if (!res.ok) throw new Error('failed');
            setUsage(await res.json());
        } catch (e) {
            logger.error('Failed to fetch vehicle usage:', e);
            toast.error('使用履歴の読み込みに失敗しました');
        } finally {
            setUsageLoading(false);
        }
    }, [vehicle.id]);

    useEffect(() => {
        if (tab === 'usage' && usage.length === 0 && !usageLoading) fetchUsage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const set = (key: keyof VehicleProfile, value: string) => setForm((p) => ({ ...p, [key]: value }));

    const saveProfile = async () => {
        setSaving(true);
        try {
            const res = await fetch(`/api/equipment/vehicles/${vehicle.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '保存に失敗しました');
            }
            toast.success('車両情報を保存しました');
            onChanged();
        } catch (e) {
            logger.error('Failed to save vehicle profile:', e);
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const field = (label: string, key: keyof VehicleProfile, type: 'text' | 'date' = 'text', placeholder?: string) => (
        <label className="text-xs text-slate-600">
            {label}
            <input
                type={type}
                value={type === 'date' ? toDateInput(form[key]) : form[key] ?? ''}
                onChange={(e) => set(key, e.target.value)}
                disabled={!canEdit}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
        </label>
    );

    const tabs: { key: TabKey; label: string }[] = [
        { key: 'profile', label: '基本情報' },
        { key: 'maintenance', label: '整備・修理' },
        { key: 'usage', label: '使用履歴' },
    ];

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                role="dialog"
                aria-modal="true"
                className="relative bg-white flex flex-col w-full h-full lg:h-[90vh] lg:rounded-lg lg:shadow-xl lg:max-w-4xl lg:mx-4"
            >
                <div className="flex-shrink-0 border-b border-slate-200 px-4 py-4 md:px-6 lg:rounded-t-lg">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm text-slate-500">機材台帳（車両）</div>
                            <h2 className="truncate text-xl font-semibold text-slate-800">{vehicle.name}</h2>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <ExpiryBadge label="車検" date={form.inspectionExpiry} />
                                <ExpiryBadge label="自賠責" date={form.jibaisekiExpiry} />
                                <ExpiryBadge label="任意保険" date={form.insuranceExpiry} />
                            </div>
                        </div>
                        <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="mt-3 flex gap-1">
                        {tabs.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setTab(t.key)}
                                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                                    tab === t.key ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                    {tab === 'profile' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                {field('車種・型式', 'vehicleType', 'text', '例: 三菱 中型トラック（キャンター）')}
                                {field('車番（登録番号）', 'registrationNumber', 'text', '例: 愛媛100す7459')}
                                {field('用途', 'usage', 'text', '例: 工事用 / 通勤用')}
                                {field('主に乗る人', 'defaultDriverName')}
                                {field('車検満了日', 'inspectionExpiry', 'date')}
                                <div className="hidden sm:block" />
                                {field('自賠責 保険会社', 'jibaisekiCompany')}
                                {field('自賠責 満了日', 'jibaisekiExpiry', 'date')}
                                {field('任意保険 保険会社', 'insuranceCompany')}
                                {field('任意保険 満了日', 'insuranceExpiry', 'date')}
                                {field('対人賠償', 'insurancePersonal', 'text', '例: 無制限')}
                                {field('対物賠償', 'insuranceObjective', 'text', '例: 無制限')}
                                {field('搭乗者傷害', 'insurancePassenger')}
                            </div>
                            <label className="block text-xs text-slate-600">
                                備考
                                <textarea
                                    value={form.notes ?? ''}
                                    onChange={(e) => set('notes', e.target.value)}
                                    disabled={!canEdit}
                                    rows={3}
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                />
                            </label>
                            <p className="text-[11px] text-slate-500">
                                車両の追加・名前の変更・日額の設定は 設定 ＞ 車両管理 で行います。
                            </p>
                            {canEdit && (
                                <div className="flex justify-end">
                                    <Button variant="primary" onClick={saveProfile} isLoading={saving}>保存</Button>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'maintenance' && (
                        <MaintenanceTab targetType="vehicle" targetId={vehicle.id} showOdometer canEdit={canEdit} onChanged={onChanged} />
                    )}

                    {tab === 'usage' && (
                        <div>
                            <p className="mb-3 text-xs text-slate-500">
                                日々の配置から自動で出しています（この画面での入力は不要です）。直近100件まで表示します。
                            </p>
                            {usageLoading ? (
                                <div className="py-10 text-center text-slate-500">読み込み中...</div>
                            ) : usage.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
                                    この車両を使った配置の記録がありません
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[520px] text-sm">
                                        <thead>
                                            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                                                <th className="py-2 pr-3">日付</th>
                                                <th className="py-2 pr-3">現場</th>
                                                <th className="py-2 pr-3">職長</th>
                                                <th className="py-2">作業員</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {usage.map((u) => (
                                                <tr key={u.id} className="border-b border-slate-100">
                                                    <td className="whitespace-nowrap py-2 pr-3 text-slate-700">{fmtDate(u.date)}</td>
                                                    <td className="py-2 pr-3 text-slate-700">{u.projectName}</td>
                                                    <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{u.foremanName || '—'}</td>
                                                    <td className="py-2 text-slate-600">{u.workerNames.join('、') || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
