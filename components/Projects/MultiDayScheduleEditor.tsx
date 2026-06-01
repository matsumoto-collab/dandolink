'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DailySchedule, ConstructionType } from '@/types/calendar';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchableSelect from '@/components/ui/SearchableSelect';

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

function formatDateDisplay(date: Date): string {
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()}(${DOW_JP[d.getDay()]})`;
}

function toDateKey(date: Date): string {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

interface ForemanOption {
    id: string;
    displayName: string;
    role?: string;
}

// 共通ドロップダウン（単一/複数選択切替）
interface SelectDropdownOption {
    id: string;
    label: string;
    subLabel?: string;
    subLabelTone?: 'info' | 'warn';
}

interface SelectDropdownProps {
    options: SelectDropdownOption[];
    selected: string[];
    onChange: (selected: string[]) => void;
    multiple?: boolean;
    placeholder?: string;
    emptyOptionLabel?: string; // 単一選択時の「選択なし」相当
    className?: string;
}

function SelectDropdown({
    options,
    selected,
    onChange,
    multiple = false,
    placeholder = '選択',
    emptyOptionLabel,
    className = '',
}: SelectDropdownProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const selectedSet = new Set(selected);
    const selectedLabels = options.filter(o => selectedSet.has(o.id)).map(o => o.label);

    const buttonText = (() => {
        if (selectedLabels.length === 0) return placeholder;
        if (!multiple) return selectedLabels[0];
        if (selectedLabels.length <= 2) return selectedLabels.join('、');
        return `${selectedLabels[0]} 他${selectedLabels.length - 1}件`;
    })();

    const toggle = (id: string) => {
        if (multiple) {
            onChange(selectedSet.has(id) ? selected.filter(s => s !== id) : [...selected, id]);
        } else {
            onChange(selectedSet.has(id) ? [] : [id]);
            setOpen(false);
        }
    };

    return (
        <div ref={ref} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 ${selectedLabels.length === 0 ? 'text-slate-400' : 'text-slate-700'}`}
            >
                <span className="truncate text-left">{buttonText}</span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
            {open && (
                <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
                    {!multiple && emptyOptionLabel && (
                        <button
                            type="button"
                            onClick={() => { onChange([]); setOpen(false); }}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 ${selectedLabels.length === 0 ? 'bg-slate-50 font-medium text-slate-700' : 'text-slate-500'}`}
                        >
                            <span className="w-4 h-4 shrink-0">{selectedLabels.length === 0 && <Check className="w-4 h-4 text-slate-700" />}</span>
                            <span>{emptyOptionLabel}</span>
                        </button>
                    )}
                    {options.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-400">候補がありません</div>
                    ) : (
                        options.map(o => {
                            const isSelected = selectedSet.has(o.id);
                            const toneClass = o.subLabelTone === 'warn'
                                ? 'bg-amber-100 text-amber-700 border-amber-200'
                                : 'bg-indigo-50 text-indigo-700 border-indigo-200';
                            return (
                                <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => toggle(o.id)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 ${isSelected ? 'bg-slate-50 font-medium text-slate-700' : 'text-slate-700'}`}
                                >
                                    <span className="w-4 h-4 shrink-0">{isSelected && <Check className="w-4 h-4 text-slate-700" />}</span>
                                    <span className="truncate flex-1">{o.label}</span>
                                    {o.subLabel && (
                                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 border rounded-full ${toneClass}`}>
                                            {o.subLabel}
                                        </span>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

interface VehicleOption {
    id: string;
    name: string;
}

interface ConstructionTypeOption {
    id: string;
    name: string;
    /** SearchableSelect で色サンプル表示するために任意で受け取る */
    color?: string;
}

export interface DayExistingInfo {
    foremanId: string;
    foremanName: string;
    memberCount: number;
    projectTitle?: string;
}

interface MultiDayScheduleEditorProps {
    type: ConstructionType;
    dailySchedules: DailySchedule[];
    onChange: (schedules: DailySchedule[]) => void;
    foremen?: ForemanOption[];
    vehicles?: VehicleOption[];
    constructionTypes?: ConstructionTypeOption[];
    existingDayMap?: Record<string, DayExistingInfo[]>;
    vehicleUsageByDate?: Record<string, Record<string, number>>;
    getTotalMembersForDate?: (dateStr: string) => number;
    getVacationCountForDate?: (dateStr: string) => number;
}

export default function MultiDayScheduleEditor({
    type,
    dailySchedules,
    onChange,
    foremen = [],
    vehicles = [],
    constructionTypes = [],
    existingDayMap = {},
    vehicleUsageByDate = {},
    getTotalMembersForDate,
    getVacationCountForDate,
}: MultiDayScheduleEditorProps) {
    const [mode, setMode] = useState<'range' | 'individual'>('range');
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [defaultLeader, setDefaultLeader] = useState('');
    const [defaultMemberCount, setDefaultMemberCount] = useState(0);
    const [defaultType, setDefaultType] = useState<ConstructionType>(type);
    const [bulkType, setBulkType] = useState<ConstructionType>('');

    // SearchableSelect 用の options（カラーサンプル付き）
    const typeOptions = useMemo(
        () => constructionTypes.map((t) => ({ id: t.id, label: t.name, color: t.color })),
        [constructionTypes]
    );

    const generateFromRange = (weekdaysOnly = false) => {
        if (!rangeStart || !rangeEnd) {
            toast.error('開始日と終了日を入力してください');
            return;
        }
        const start = new Date(rangeStart);
        const end = new Date(rangeEnd);
        if (start > end) {
            toast.error('開始日は終了日より前にしてください');
            return;
        }
        const newSchedules: DailySchedule[] = [];
        const current = new Date(start);
        while (current <= end) {
            const dow = current.getDay();
            if (!weekdaysOnly || (dow !== 0 && dow !== 6)) {
                newSchedules.push({
                    date: new Date(current),
                    assignedEmployeeId: defaultLeader || undefined,
                    memberCount: defaultMemberCount,
                    estimatedHours: 8,
                    workers: [],
                    trucks: [],
                    remarks: '',
                    sortOrder: 0,
                    constructionType: defaultType || type,
                });
            }
            current.setDate(current.getDate() + 1);
        }
        onChange(newSchedules);
    };

    const addIndividualDay = () => {
        onChange([...dailySchedules, {
            date: new Date(),
            assignedEmployeeId: undefined,
            memberCount: 0,
            estimatedHours: 8,
            workers: [],
            trucks: [],
            remarks: '',
            sortOrder: 0,
            constructionType: defaultType || type,
        }]);
    };

    const applyBulkType = () => {
        if (!bulkType) {
            toast.error('適用する工事種別を選択してください');
            return;
        }
        onChange(dailySchedules.map(s => ({ ...s, constructionType: bulkType })));
        toast.success('全日程の工事種別を更新しました');
    };

    const removeSchedule = (index: number) => {
        onChange(dailySchedules.filter((_, i) => i !== index));
    };

    const updateSchedule = (index: number, updates: Partial<DailySchedule>) => {
        onChange(dailySchedules.map((s, i) => i === index ? { ...s, ...updates } : s));
    };

    // 特定日の残り人数を計算（休暇分も控除）
    const getRemainingForDate = (date: Date): number => {
        const key = toDateKey(date);
        const existing = existingDayMap[key] || [];
        const byForeman = new Map<string, number>();
        existing.forEach(e => {
            byForeman.set(e.foremanId, Math.max(byForeman.get(e.foremanId) ?? 0, e.memberCount));
        });
        let used = 0;
        byForeman.forEach(v => { used += v; });
        const total = getTotalMembersForDate ? getTotalMembersForDate(key) : 0;
        const vacation = getVacationCountForDate ? getVacationCountForDate(key) : 0;
        return total - used - vacation;
    };

    // 職長ごとに集約。協力業者(partner)は案件数で表示、それ以外は最大人数を採用（0名は除外）
    const foremanRoleMap = new Map(foremen.map(f => [f.id, f.role]));
    const getExistingByForeman = (date: Date): { foremanId: string; foremanName: string; memberCount: number; projectCount: number; titles: string[]; isPartner: boolean }[] => {
        const list = existingDayMap[toDateKey(date)] || [];
        const map = new Map<string, { foremanId: string; foremanName: string; memberCount: number; projectCount: number; titles: string[]; isPartner: boolean }>();
        list.forEach(e => {
            const isPartner = foremanRoleMap.get(e.foremanId) === 'partner';
            const cur = map.get(e.foremanId);
            if (!cur) {
                map.set(e.foremanId, {
                    foremanId: e.foremanId,
                    foremanName: e.foremanName,
                    memberCount: e.memberCount,
                    projectCount: 1,
                    titles: e.projectTitle ? [e.projectTitle] : [],
                    isPartner,
                });
            } else {
                cur.memberCount = Math.max(cur.memberCount, e.memberCount);
                cur.projectCount += 1;
                if (e.projectTitle && !cur.titles.includes(e.projectTitle)) cur.titles.push(e.projectTitle);
            }
        });
        // 案件があれば0名でも表示（人数未設定アサインも既存配置として可視化する）
        return Array.from(map.values()).filter(e => e.projectCount > 0);
    };

    const getVacationForDate = (date: Date): number => {
        return getVacationCountForDate ? getVacationCountForDate(toDateKey(date)) : 0;
    };

    return (
        <div className="space-y-4">
            {/* モード選択 */}
            <div className="flex gap-2 border-b pb-3">
                <button
                    type="button"
                    onClick={() => setMode('range')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${mode === 'range' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                    期間指定
                </button>
                <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${mode === 'individual' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                    個別選択
                </button>
            </div>

            {/* 期間指定モード */}
            {mode === 'range' && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">開始日</label>
                            <input
                                type="date"
                                value={rangeStart}
                                onChange={(e) => setRangeStart(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">終了日</label>
                            <input
                                type="date"
                                value={rangeEnd}
                                onChange={(e) => setRangeEnd(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </div>
                    </div>
                    {constructionTypes.length > 0 && (
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">工事種別（デフォルト）</label>
                            <SearchableSelect
                                options={typeOptions}
                                value={defaultType}
                                onChange={(v) => setDefaultType(v)}
                                placeholder="未設定"
                                emptyLabel="未設定"
                                size="md"
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">職長（デフォルト）</label>
                            <SelectDropdown
                                options={foremen.map(f => ({ id: f.id, label: f.displayName }))}
                                selected={defaultLeader ? [defaultLeader] : []}
                                onChange={(ids) => setDefaultLeader(ids[0] ?? '')}
                                placeholder="選択なし"
                                emptyOptionLabel="選択なし"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">人数（デフォルト）</label>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setDefaultMemberCount(v => Math.max(0, v - 1))} className="w-9 h-9 flex items-center justify-center border border-slate-300 rounded-md text-slate-600 active:bg-slate-100">−</button>
                                <span className="w-10 text-center font-medium">{defaultMemberCount}</span>
                                <button type="button" onClick={() => setDefaultMemberCount(v => v + 1)} className="w-9 h-9 flex items-center justify-center border border-slate-300 rounded-md text-slate-600 active:bg-slate-100">＋</button>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => generateFromRange(false)}
                            className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors font-medium text-sm"
                        >
                            期間を生成
                        </button>
                        <button
                            type="button"
                            onClick={() => generateFromRange(true)}
                            className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-700 transition-colors font-medium text-sm"
                        >
                            平日のみ生成
                        </button>
                    </div>
                </div>
            )}

            {/* 個別選択モード */}
            {mode === 'individual' && (
                <div className="bg-slate-50 p-4 rounded-lg">
                    <button
                        type="button"
                        onClick={addIndividualDay}
                        className="w-full px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        日程を追加
                    </button>
                </div>
            )}

            {/* 日程リスト */}
            {dailySchedules.length > 0 && (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-medium text-slate-700">
                            登録済みの日程（{dailySchedules.length}日間）
                        </h4>
                        {constructionTypes.length > 0 && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs text-slate-500">一括変更:</span>
                                <SearchableSelect
                                    options={typeOptions}
                                    value={bulkType}
                                    onChange={(v) => setBulkType(v)}
                                    placeholder="種別を選択"
                                    emptyLabel="種別を選択"
                                    size="sm"
                                    minWidth="160px"
                                    className="w-40"
                                />
                                <button
                                    type="button"
                                    onClick={applyBulkType}
                                    className="px-3 py-1 text-xs bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors font-medium"
                                >
                                    全日程に適用
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                        {dailySchedules.map((schedule, index) => {
                            const existing = getExistingByForeman(schedule.date);
                            const vacationCount = getVacationForDate(schedule.date);
                            const remaining = getRemainingForDate(schedule.date);
                            const selectedTrucks = schedule.trucks || [];
                            const dateKeyForRow = toDateKey(schedule.date);
                            const foremanCountForRow = new Map<string, number>();
                            (existingDayMap[dateKeyForRow] || []).forEach(e => {
                                foremanCountForRow.set(e.foremanId, (foremanCountForRow.get(e.foremanId) ?? 0) + 1);
                            });
                            const vehicleUsageForRow = vehicleUsageByDate[dateKeyForRow] || {};
                            const foremanOptions: SelectDropdownOption[] = foremen.map(f => {
                                const count = foremanCountForRow.get(f.id) ?? 0;
                                return {
                                    id: f.id,
                                    label: f.displayName,
                                    subLabel: count > 0 ? `${count}件` : undefined,
                                    subLabelTone: 'info',
                                };
                            });
                            const vehicleOptions: SelectDropdownOption[] = vehicles.map(v => {
                                const count = vehicleUsageForRow[v.name] ?? 0;
                                return {
                                    id: v.name,
                                    label: v.name,
                                    subLabel: count > 0 ? '使用中' : undefined,
                                    subLabelTone: 'warn',
                                };
                            });

                            return (
                                <div
                                    key={index}
                                    className="bg-white border border-slate-200 rounded-lg p-3 space-y-2.5"
                                >
                                    {/* 日付ヘッダー + 種別 + 削除ボタン */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <span className="text-base font-bold text-slate-700 shrink-0">
                                                {formatDateDisplay(schedule.date)}
                                            </span>
                                            {mode === 'individual' && (
                                                <input
                                                    type="date"
                                                    value={toDateKey(schedule.date)}
                                                    onChange={(e) => updateSchedule(index, { date: new Date(e.target.value) })}
                                                    className="px-2 py-1 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
                                                />
                                            )}
                                            {constructionTypes.length > 0 && (
                                                <SearchableSelect
                                                    options={typeOptions}
                                                    value={schedule.constructionType ?? ''}
                                                    onChange={(v) => updateSchedule(index, { constructionType: v })}
                                                    placeholder="種別を選択"
                                                    emptyLabel="種別を選択"
                                                    size="sm"
                                                    minWidth="140px"
                                                    className="ml-auto w-40"
                                                />
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeSchedule(index)}
                                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors shrink-0"
                                            title="削除"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* 既存職長（職長ごと集約） + 休暇 + 残り人数 */}
                                    <div className="flex items-center flex-wrap gap-1.5 text-xs min-h-[24px]">
                                        {existing.length > 0 ? (
                                            existing.map((e) => (
                                                <span
                                                    key={e.foremanId}
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 border rounded-full ${e.isPartner ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-100 border-slate-200 text-slate-700'}`}
                                                    title={e.titles.join(' / ')}
                                                >
                                                    <span className="font-medium">{e.foremanName}</span>
                                                    <span className={e.isPartner ? 'text-indigo-600' : 'text-slate-600'}>
                                                        {e.isPartner ? `${e.projectCount}件` : `${e.memberCount}名`}
                                                    </span>
                                                </span>
                                            ))
                                        ) : (
                                            <span className="text-slate-300">配置なし</span>
                                        )}
                                        {vacationCount > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-full">
                                                休暇 {vacationCount}名
                                            </span>
                                        )}
                                        <span className={`ml-auto font-bold px-2 py-0.5 rounded-full text-xs text-white shadow-sm ${remaining < 0 ? 'bg-rose-600' : remaining === 0 ? 'bg-slate-400' : 'bg-slate-600'}`}>
                                            残り {remaining}名
                                        </span>
                                    </div>

                                    {/* 職長 */}
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">職長</label>
                                        <SelectDropdown
                                            options={foremanOptions}
                                            selected={schedule.assignedEmployeeId ? [schedule.assignedEmployeeId] : []}
                                            onChange={(ids) => updateSchedule(index, { assignedEmployeeId: ids[0] || undefined })}
                                            placeholder="選択なし"
                                            emptyOptionLabel="選択なし"
                                        />
                                    </div>

                                    {/* 人数 + 予定作業時間 */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">人数</label>
                                            <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => updateSchedule(index, { memberCount: Math.max(0, schedule.memberCount - 1) })} className="w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 active:bg-slate-100 flex-shrink-0">−</button>
                                                <span className="flex-1 text-center text-sm font-medium">{schedule.memberCount}</span>
                                                <button type="button" onClick={() => updateSchedule(index, { memberCount: schedule.memberCount + 1 })} className="w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 active:bg-slate-100 flex-shrink-0">＋</button>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">予定作業時間</label>
                                            <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => updateSchedule(index, { estimatedHours: Math.max(0, Math.round(((schedule.estimatedHours ?? 8) - 0.5) * 10) / 10) })} className="w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 active:bg-slate-100 flex-shrink-0">−</button>
                                                <span className="flex-1 text-center text-sm font-medium">{schedule.estimatedHours ?? 8}h</span>
                                                <button type="button" onClick={() => updateSchedule(index, { estimatedHours: Math.min(24, Math.round(((schedule.estimatedHours ?? 8) + 0.5) * 10) / 10) })} className="w-8 h-8 flex items-center justify-center border border-slate-300 rounded text-slate-600 active:bg-slate-100 flex-shrink-0">＋</button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 車両 */}
                                    {vehicles.length > 0 && (
                                        <div>
                                            <label className="block text-xs text-slate-500 mb-1">車両</label>
                                            <SelectDropdown
                                                options={vehicleOptions}
                                                selected={selectedTrucks}
                                                onChange={(names) => updateSchedule(index, { trucks: names })}
                                                multiple
                                                placeholder="車両を選択"
                                            />
                                            {selectedTrucks.length > 0 && (
                                                <div className="mt-1.5 flex flex-wrap gap-1">
                                                    {selectedTrucks.map((t, i) => (
                                                        <span key={i} className="text-xs px-2 py-0.5 bg-slate-700 text-white rounded-full">
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* 備考 */}
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">備考</label>
                                        <input
                                            type="text"
                                            value={schedule.remarks || ''}
                                            onChange={(e) => updateSchedule(index, { remarks: e.target.value })}
                                            className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="備考"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
