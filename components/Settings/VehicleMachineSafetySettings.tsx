'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Plus, Search, Trash2, Truck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { MACHINE_CATEGORIES, VEHICLE_USAGE_OPTIONS } from '@/lib/safetyDocuments';
import type { MachineDto, VehicleSafetyProfileDto, VehicleSafetyTargetDto } from '@/types/safety';
import { logger } from '@/lib/logger';

/**
 * 設定 > 車両・機械 安全情報（安全書類 Phase 2）。
 * - 車両: 既存の車両マスター（設定 > 車両管理）に安全書類用の情報を1:1で付与する
 * - 機械: 持込機械マスターの CRUD（クレーン等の区分含む）
 */

const INPUT_CLASS =
    'w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm text-sm';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600 mb-1';

// ───────────────────────── 車両フォーム ─────────────────────────

interface VehicleFormState {
    vehicleType: string;
    registrationNumber: string;
    usage: string;
    inspectionExpiry: string;
    jibaisekiCompany: string;
    jibaisekiExpiry: string;
    insuranceCompany: string;
    insuranceExpiry: string;
    insurancePersonal: string;
    insuranceObjective: string;
    insurancePassenger: string;
    defaultDriverName: string;
    notes: string;
}

const EMPTY_VEHICLE_FORM: VehicleFormState = {
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
};

const isoToDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

function vehicleDtoToForm(profile: VehicleSafetyProfileDto | null): VehicleFormState {
    if (!profile) return { ...EMPTY_VEHICLE_FORM };
    return {
        vehicleType: profile.vehicleType ?? '',
        registrationNumber: profile.registrationNumber ?? '',
        usage: profile.usage ?? '',
        inspectionExpiry: isoToDateInput(profile.inspectionExpiry),
        jibaisekiCompany: profile.jibaisekiCompany ?? '',
        jibaisekiExpiry: isoToDateInput(profile.jibaisekiExpiry),
        insuranceCompany: profile.insuranceCompany ?? '',
        insuranceExpiry: isoToDateInput(profile.insuranceExpiry),
        insurancePersonal: profile.insurancePersonal ?? '',
        insuranceObjective: profile.insuranceObjective ?? '',
        insurancePassenger: profile.insurancePassenger ?? '',
        defaultDriverName: profile.defaultDriverName ?? '',
        notes: profile.notes ?? '',
    };
}

// ───────────────────────── 機械フォーム ─────────────────────────

interface MachineFormState {
    name: string;
    category: string;
    model: string;
    serialNumber: string;
    maker: string;
    capacity: string;
    ownerName: string;
    defaultOperatorName: string;
    inspectionDate: string;
    inspectionExpiry: string;
    certificateNumber: string;
    notes: string;
}

const EMPTY_MACHINE_FORM: MachineFormState = {
    name: '',
    category: 'general',
    model: '',
    serialNumber: '',
    maker: '',
    capacity: '',
    ownerName: '',
    defaultOperatorName: '',
    inspectionDate: '',
    inspectionExpiry: '',
    certificateNumber: '',
    notes: '',
};

function machineDtoToForm(machine: MachineDto): MachineFormState {
    return {
        name: machine.name,
        category: machine.category,
        model: machine.model ?? '',
        serialNumber: machine.serialNumber ?? '',
        maker: machine.maker ?? '',
        capacity: machine.capacity ?? '',
        ownerName: machine.ownerName ?? '',
        defaultOperatorName: machine.defaultOperatorName ?? '',
        inspectionDate: isoToDateInput(machine.inspectionDate),
        inspectionExpiry: isoToDateInput(machine.inspectionExpiry),
        certificateNumber: machine.certificateNumber ?? '',
        notes: machine.notes ?? '',
    };
}

export default function VehicleMachineSafetySettings() {
    const [subTab, setSubTab] = useState<'vehicles' | 'machines'>('vehicles');

    // ── 車両 ──
    const [vehicleTargets, setVehicleTargets] = useState<VehicleSafetyTargetDto[]>([]);
    const [isVehiclesLoading, setIsVehiclesLoading] = useState(true);
    const [vehicleSearch, setVehicleSearch] = useState('');
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
    const [vehicleForm, setVehicleForm] = useState<VehicleFormState>({ ...EMPTY_VEHICLE_FORM });
    const [isVehicleDirty, setIsVehicleDirty] = useState(false);
    const [isVehicleSaving, setIsVehicleSaving] = useState(false);

    // ── 機械 ──
    const [machines, setMachines] = useState<MachineDto[]>([]);
    const [isMachinesLoading, setIsMachinesLoading] = useState(true);
    const [machineSearch, setMachineSearch] = useState('');
    /** null=未選択 / 'new'=新規作成 / その他=編集対象ID */
    const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
    const [machineForm, setMachineForm] = useState<MachineFormState>({ ...EMPTY_MACHINE_FORM });
    const [isMachineDirty, setIsMachineDirty] = useState(false);
    const [isMachineSaving, setIsMachineSaving] = useState(false);

    const fetchVehicles = useCallback(async () => {
        try {
            const res = await fetch('/api/vehicle-safety-profiles', { cache: 'no-store' });
            if (!res.ok) throw new Error();
            setVehicleTargets(await res.json());
        } catch {
            toast.error('車両一覧の取得に失敗しました');
        } finally {
            setIsVehiclesLoading(false);
        }
    }, []);

    const fetchMachines = useCallback(async () => {
        try {
            const res = await fetch('/api/machines', { cache: 'no-store' });
            if (!res.ok) throw new Error();
            setMachines(await res.json());
        } catch {
            toast.error('機械一覧の取得に失敗しました');
        } finally {
            setIsMachinesLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchVehicles();
        fetchMachines();
    }, [fetchVehicles, fetchMachines]);

    // ───────── 車両 ─────────

    const selectedVehicle = useMemo(
        () => vehicleTargets.find((v) => v.vehicleId === selectedVehicleId) ?? null,
        [vehicleTargets, selectedVehicleId]
    );

    const filteredVehicles = useMemo(() => {
        const q = vehicleSearch.trim();
        if (!q) return vehicleTargets;
        return vehicleTargets.filter(
            (v) => v.name.includes(q) || (v.profile?.registrationNumber ?? '').includes(q)
        );
    }, [vehicleTargets, vehicleSearch]);

    const selectVehicle = (target: VehicleSafetyTargetDto) => {
        if (target.vehicleId === selectedVehicleId) return;
        if (isVehicleDirty && !confirm('保存されていない変更があります。破棄して切り替えますか？')) return;
        setSelectedVehicleId(target.vehicleId);
        setVehicleForm(vehicleDtoToForm(target.profile));
        setIsVehicleDirty(false);
    };

    const updateVehicleForm = (patch: Partial<VehicleFormState>) => {
        setVehicleForm((prev) => ({ ...prev, ...patch }));
        setIsVehicleDirty(true);
    };

    const handleSaveVehicle = async () => {
        if (!selectedVehicle) return;
        setIsVehicleSaving(true);
        try {
            const res = await fetch(`/api/vehicle-safety-profiles?vehicleId=${selectedVehicle.vehicleId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(vehicleForm),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '保存に失敗しました');
            }
            const profile: VehicleSafetyProfileDto = await res.json();
            setVehicleTargets((prev) =>
                prev.map((v) => (v.vehicleId === selectedVehicle.vehicleId ? { ...v, profile } : v))
            );
            setIsVehicleDirty(false);
            toast.success('車両の安全情報を保存しました');
        } catch (error) {
            logger.error('車両安全情報保存エラー:', error);
            toast.error(error instanceof Error ? error.message : '保存に失敗しました');
        } finally {
            setIsVehicleSaving(false);
        }
    };

    // ───────── 機械 ─────────

    const filteredMachines = useMemo(() => {
        const q = machineSearch.trim();
        if (!q) return machines;
        return machines.filter(
            (m) => m.name.includes(q) || (m.model ?? '').includes(q) || (m.maker ?? '').includes(q)
        );
    }, [machines, machineSearch]);

    const selectMachine = (id: string | 'new') => {
        if (id === selectedMachineId) return;
        if (isMachineDirty && !confirm('保存されていない変更があります。破棄して切り替えますか？')) return;
        setSelectedMachineId(id);
        if (id === 'new') {
            setMachineForm({ ...EMPTY_MACHINE_FORM });
        } else {
            const machine = machines.find((m) => m.id === id);
            setMachineForm(machine ? machineDtoToForm(machine) : { ...EMPTY_MACHINE_FORM });
        }
        setIsMachineDirty(false);
    };

    const updateMachineForm = (patch: Partial<MachineFormState>) => {
        setMachineForm((prev) => ({ ...prev, ...patch }));
        setIsMachineDirty(true);
    };

    const handleSaveMachine = async () => {
        if (!selectedMachineId) return;
        if (!machineForm.name.trim()) {
            toast.error('機械名を入力してください');
            return;
        }
        setIsMachineSaving(true);
        try {
            const isNew = selectedMachineId === 'new';
            const res = await fetch(isNew ? '/api/machines' : `/api/machines/${selectedMachineId}`, {
                method: isNew ? 'POST' : 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(machineForm),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '保存に失敗しました');
            }
            const machine: MachineDto = await res.json();
            if (isNew) {
                setMachines((prev) => [...prev, machine]);
                setSelectedMachineId(machine.id);
            } else {
                setMachines((prev) => prev.map((m) => (m.id === machine.id ? machine : m)));
            }
            setIsMachineDirty(false);
            toast.success('機械を保存しました');
        } catch (error) {
            logger.error('機械保存エラー:', error);
            toast.error(error instanceof Error ? error.message : '保存に失敗しました');
        } finally {
            setIsMachineSaving(false);
        }
    };

    const handleDeleteMachine = async (machine: MachineDto) => {
        if (!confirm(`「${machine.name}」を削除しますか？\n（作成済みの書類には影響しません）`)) return;
        try {
            const res = await fetch(`/api/machines/${machine.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '削除に失敗しました');
            }
            setMachines((prev) => prev.filter((m) => m.id !== machine.id));
            if (selectedMachineId === machine.id) {
                setSelectedMachineId(null);
                setIsMachineDirty(false);
            }
            toast.success('機械を削除しました');
        } catch (error) {
            logger.error('機械削除エラー:', error);
            toast.error(error instanceof Error ? error.message : '削除に失敗しました');
        }
    };

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">車両・機械 安全情報</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        車両届・持込機械届に記載する情報を管理します。すべて任意入力です。
                    </p>
                </div>
                {/* サブタブ */}
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                    <button
                        type="button"
                        onClick={() => setSubTab('vehicles')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            subTab === 'vehicles' ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-600'
                        }`}
                    >
                        <Truck className="w-4 h-4" />
                        車両
                    </button>
                    <button
                        type="button"
                        onClick={() => setSubTab('machines')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            subTab === 'machines' ? 'bg-white text-slate-900 font-medium shadow-sm' : 'text-slate-600'
                        }`}
                    >
                        <Wrench className="w-4 h-4" />
                        機械
                    </button>
                </div>
            </div>

            {subTab === 'vehicles' ? (
                <div className="flex flex-col lg:flex-row gap-4">
                    {/* 左: 車両一覧 */}
                    <div className="lg:w-72 shrink-0">
                        <div className="relative mb-2">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={vehicleSearch}
                                onChange={(e) => setVehicleSearch(e.target.value)}
                                placeholder="車名・登録番号で検索"
                                className={`${INPUT_CLASS} pl-9`}
                            />
                        </div>
                        <div className="border border-slate-200 rounded-xl p-1.5 max-h-[520px] overflow-y-auto bg-white">
                            {isVehiclesLoading ? (
                                <p className="text-sm text-slate-400 text-center py-6">読み込み中...</p>
                            ) : filteredVehicles.length === 0 ? (
                                <p className="text-sm text-slate-400 text-center py-6 px-2">
                                    車両がありません（設定 &gt; 車両管理 で登録してください）
                                </p>
                            ) : (
                                <ul>
                                    {filteredVehicles.map((v) => (
                                        <li key={v.vehicleId}>
                                            <button
                                                type="button"
                                                onClick={() => selectVehicle(v)}
                                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                                                    v.vehicleId === selectedVehicleId
                                                        ? 'bg-teal-50 text-teal-800 font-medium'
                                                        : 'text-slate-700 hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="flex-1 min-w-0 truncate">
                                                    {v.name}
                                                    {v.profile?.registrationNumber ? (
                                                        <span className="text-xs text-slate-400">（{v.profile.registrationNumber}）</span>
                                                    ) : null}
                                                </span>
                                                {v.profile ? (
                                                    <Check className="w-3.5 h-3.5 text-teal-600 shrink-0" aria-label="登録済み" />
                                                ) : (
                                                    <span className="w-3.5 h-3.5 shrink-0" />
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* 右: 車両フォーム */}
                    <div className="flex-1 min-w-0">
                        {!selectedVehicle ? (
                            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-300 rounded-xl text-slate-400 gap-2">
                                <AlertTriangle className="w-6 h-6" />
                                <p className="text-sm">左の一覧から車両を選択してください</p>
                            </div>
                        ) : (
                            <div className="bg-white border border-slate-200 rounded-xl">
                                <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-slate-900">{selectedVehicle.name}</div>
                                        <div className="text-xs text-slate-500">
                                            車両届に記載する情報
                                            {isVehicleDirty && <span className="ml-2 text-amber-600">未保存の変更があります</span>}
                                        </div>
                                    </div>
                                    <Button size="sm" onClick={handleSaveVehicle} isLoading={isVehicleSaving}>
                                        保存
                                    </Button>
                                </div>
                                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL_CLASS}>車種・型式</label>
                                        <input type="text" value={vehicleForm.vehicleType} onChange={(e) => updateVehicleForm({ vehicleType: e.target.value })} placeholder="例: 2tダンプ" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>登録番号（車番）</label>
                                        <input type="text" value={vehicleForm.registrationNumber} onChange={(e) => updateVehicleForm({ registrationNumber: e.target.value })} placeholder="例: 名古屋 100 あ 12-34" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>用途</label>
                                        <select value={vehicleForm.usage} onChange={(e) => updateVehicleForm({ usage: e.target.value })} className={INPUT_CLASS}>
                                            <option value="">未設定</option>
                                            {VEHICLE_USAGE_OPTIONS.map((u) => (
                                                <option key={u} value={u}>{u}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>車検満了日</label>
                                        <input type="date" value={vehicleForm.inspectionExpiry} onChange={(e) => updateVehicleForm({ inspectionExpiry: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>自賠責保険 会社</label>
                                        <input type="text" value={vehicleForm.jibaisekiCompany} onChange={(e) => updateVehicleForm({ jibaisekiCompany: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>自賠責保険 満了日</label>
                                        <input type="date" value={vehicleForm.jibaisekiExpiry} onChange={(e) => updateVehicleForm({ jibaisekiExpiry: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>任意保険 会社</label>
                                        <input type="text" value={vehicleForm.insuranceCompany} onChange={(e) => updateVehicleForm({ insuranceCompany: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>任意保険 満了日</label>
                                        <input type="date" value={vehicleForm.insuranceExpiry} onChange={(e) => updateVehicleForm({ insuranceExpiry: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>対人賠償</label>
                                        <input type="text" value={vehicleForm.insurancePersonal} onChange={(e) => updateVehicleForm({ insurancePersonal: e.target.value })} placeholder="例: 無制限" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>対物賠償</label>
                                        <input type="text" value={vehicleForm.insuranceObjective} onChange={(e) => updateVehicleForm({ insuranceObjective: e.target.value })} placeholder="例: 無制限" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>搭乗者傷害</label>
                                        <input type="text" value={vehicleForm.insurancePassenger} onChange={(e) => updateVehicleForm({ insurancePassenger: e.target.value })} placeholder="例: 1,000万円" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>既定の運転者</label>
                                        <input type="text" value={vehicleForm.defaultDriverName} onChange={(e) => updateVehicleForm({ defaultDriverName: e.target.value })} placeholder="書類作成時の初期値" className={INPUT_CLASS} />
                                    </div>
                                    <div className="sm:col-span-2">
                                        <label className={LABEL_CLASS}>備考</label>
                                        <textarea value={vehicleForm.notes} onChange={(e) => updateVehicleForm({ notes: e.target.value })} rows={2} className={INPUT_CLASS} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex flex-col lg:flex-row gap-4">
                    {/* 左: 機械一覧 */}
                    <div className="lg:w-72 shrink-0">
                        <div className="flex gap-2 mb-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={machineSearch}
                                    onChange={(e) => setMachineSearch(e.target.value)}
                                    placeholder="機械名・型式で検索"
                                    className={`${INPUT_CLASS} pl-9`}
                                />
                            </div>
                            <Button size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => selectMachine('new')}>
                                追加
                            </Button>
                        </div>
                        <div className="border border-slate-200 rounded-xl p-1.5 max-h-[520px] overflow-y-auto bg-white">
                            {isMachinesLoading ? (
                                <p className="text-sm text-slate-400 text-center py-6">読み込み中...</p>
                            ) : filteredMachines.length === 0 ? (
                                <p className="text-sm text-slate-400 text-center py-6 px-2">
                                    機械がありません。「追加」から登録してください
                                </p>
                            ) : (
                                <ul>
                                    {filteredMachines.map((m) => (
                                        <li key={m.id}>
                                            <div
                                                className={`flex items-center gap-2 rounded-lg ${
                                                    m.id === selectedMachineId ? 'bg-teal-50' : 'hover:bg-slate-50'
                                                }`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => selectMachine(m.id)}
                                                    className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-sm ${
                                                        m.id === selectedMachineId ? 'text-teal-800 font-medium' : 'text-slate-700'
                                                    }`}
                                                >
                                                    <span className="flex-1 min-w-0 truncate">{m.name}</span>
                                                    {m.category === 'crane' && (
                                                        <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full shrink-0">
                                                            クレーン等
                                                        </span>
                                                    )}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteMachine(m)}
                                                    className="p-1.5 mr-1 text-slate-300 hover:text-red-600 shrink-0"
                                                    aria-label="機械を削除"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* 右: 機械フォーム */}
                    <div className="flex-1 min-w-0">
                        {!selectedMachineId ? (
                            <div className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-300 rounded-xl text-slate-400 gap-2">
                                <AlertTriangle className="w-6 h-6" />
                                <p className="text-sm">左の一覧から機械を選択するか、「追加」で新規登録してください</p>
                            </div>
                        ) : (
                            <div className="bg-white border border-slate-200 rounded-xl">
                                <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-slate-900">
                                            {selectedMachineId === 'new' ? '機械の新規登録' : machineForm.name || '機械の編集'}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            持込機械届・クレーン等使用届に記載する情報
                                            {isMachineDirty && <span className="ml-2 text-amber-600">未保存の変更があります</span>}
                                        </div>
                                    </div>
                                    <Button size="sm" onClick={handleSaveMachine} isLoading={isMachineSaving}>
                                        保存
                                    </Button>
                                </div>
                                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL_CLASS}>機械名 *</label>
                                        <input type="text" value={machineForm.name} onChange={(e) => updateMachineForm({ name: e.target.value })} placeholder="例: 高所作業車 / ユニック" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>区分</label>
                                        <select value={machineForm.category} onChange={(e) => updateMachineForm({ category: e.target.value })} className={INPUT_CLASS}>
                                            {MACHINE_CATEGORIES.map((c) => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>型式</label>
                                        <input type="text" value={machineForm.model} onChange={(e) => updateMachineForm({ model: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>製造番号</label>
                                        <input type="text" value={machineForm.serialNumber} onChange={(e) => updateMachineForm({ serialNumber: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>メーカー</label>
                                        <input type="text" value={machineForm.maker} onChange={(e) => updateMachineForm({ maker: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>能力（吊上荷重・出力等）</label>
                                        <input type="text" value={machineForm.capacity} onChange={(e) => updateMachineForm({ capacity: e.target.value })} placeholder="例: 2.93t吊" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>所有会社（リース元等）</label>
                                        <input type="text" value={machineForm.ownerName} onChange={(e) => updateMachineForm({ ownerName: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>既定の取扱者・オペレーター</label>
                                        <input type="text" value={machineForm.defaultOperatorName} onChange={(e) => updateMachineForm({ defaultOperatorName: e.target.value })} placeholder="書類作成時の初期値" className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>定期自主検査 実施日</label>
                                        <input type="date" value={machineForm.inspectionDate} onChange={(e) => updateMachineForm({ inspectionDate: e.target.value })} className={INPUT_CLASS} />
                                    </div>
                                    {machineForm.category === 'crane' && (
                                        <>
                                            <div>
                                                <label className={LABEL_CLASS}>検査証番号</label>
                                                <input type="text" value={machineForm.certificateNumber} onChange={(e) => updateMachineForm({ certificateNumber: e.target.value })} className={INPUT_CLASS} />
                                            </div>
                                            <div>
                                                <label className={LABEL_CLASS}>検査証有効期限</label>
                                                <input type="date" value={machineForm.inspectionExpiry} onChange={(e) => updateMachineForm({ inspectionExpiry: e.target.value })} className={INPUT_CLASS} />
                                            </div>
                                        </>
                                    )}
                                    <div className="sm:col-span-2">
                                        <label className={LABEL_CLASS}>備考</label>
                                        <textarea value={machineForm.notes} onChange={(e) => updateMachineForm({ notes: e.target.value })} rows={2} className={INPUT_CLASS} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
