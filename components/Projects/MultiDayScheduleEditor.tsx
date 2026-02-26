'use client';

import React, { useState } from 'react';
import { DailySchedule, ConstructionType } from '@/types/calendar';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';

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
}

interface VehicleOption {
    id: string;
    name: string;
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
    existingDayMap?: Record<string, DayExistingInfo[]>;
    totalMembers?: number;
}

export default function MultiDayScheduleEditor({
    type: _type,
    dailySchedules,
    onChange,
    foremen = [],
    vehicles = [],
    existingDayMap = {},
    totalMembers = 0,
}: MultiDayScheduleEditorProps) {
    const [mode, setMode] = useState<'range' | 'individual'>('range');
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [defaultLeader, setDefaultLeader] = useState('');
    const [defaultMemberCount, setDefaultMemberCount] = useState(0);

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
        }]);
    };

    const removeSchedule = (index: number) => {
        onChange(dailySchedules.filter((_, i) => i !== index));
    };

    const updateSchedule = (index: number, updates: Partial<DailySchedule>) => {
        onChange(dailySchedules.map((s, i) => i === index ? { ...s, ...updates } : s));
    };

    // 特定日の残り人数を計算
    const getRemainingForDate = (date: Date): number => {
        const key = toDateKey(date);
        const existing = existingDayMap[key] || [];
        const byForeman = new Map<string, number>();
        existing.forEach(e => {
            byForeman.set(e.foremanId, Math.max(byForeman.get(e.foremanId) ?? 0, e.memberCount));
        });
        let used = 0;
        byForeman.forEach(v => { used += v; });
        return totalMembers - used;
    };

    const getExistingForDate = (date: Date): DayExistingInfo[] => {
        return existingDayMap[toDateKey(date)] || [];
    };

    return (
        <div className="space-y-4">
            {/* モード選択 */}
            <div className="flex gap-2 border-b pb-3">
                <button
                    type="button"
                    onClick={() => setMode('range')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${mode === 'range' ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                    期間指定
                </button>
                <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-sm ${mode === 'individual' ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                    個別選択
                </button>
            </div>

            {/* 期間指定モード */}
            {mode === 'range' && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">開始日</label>
                            <input
                                type="date"
                                value={rangeStart}
                                onChange={(e) => setRangeStart(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">終了日</label>
                            <input
                                type="date"
                                value={rangeEnd}
                                onChange={(e) => setRangeEnd(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">職長（デフォルト）</label>
                            <select
                                value={defaultLeader}
                                onChange={(e) => setDefaultLeader(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            >
                                <option value="">選択なし</option>
                                {foremen.map((f) => (
                                    <option key={f.id} value={f.id}>{f.displayName}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">人数（デフォルト）</label>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setDefaultMemberCount(v => Math.max(0, v - 1))} className="w-9 h-9 flex items-center justify-center border border-gray-300 rounded-md text-gray-600 active:bg-gray-100">−</button>
                                <span className="w-10 text-center font-medium">{defaultMemberCount}</span>
                                <button type="button" onClick={() => setDefaultMemberCount(v => v + 1)} className="w-9 h-9 flex items-center justify-center border border-gray-300 rounded-md text-gray-600 active:bg-gray-100">＋</button>
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => generateFromRange(false)}
                            className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors font-medium text-sm"
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
                        className="w-full px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        日程を追加
                    </button>
                </div>
            )}

            {/* 日程リスト */}
            {dailySchedules.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-700">
                        登録済みの日程（{dailySchedules.length}日間）
                    </h4>
                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                        {dailySchedules.map((schedule, index) => {
                            const existing = getExistingForDate(schedule.date);
                            const remaining = getRemainingForDate(schedule.date);
                            const selectedTrucks = schedule.trucks || [];

                            return (
                                <div
                                    key={index}
                                    className="bg-white border border-gray-200 rounded-lg p-3 space-y-2.5"
                                >
                                    {/* 日付ヘッダー + 削除ボタン */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="text-base font-bold text-slate-700 shrink-0">
                                                {formatDateDisplay(schedule.date)}
                                            </span>
                                            {mode === 'individual' && (
                                                <input
                                                    type="date"
                                                    value={toDateKey(schedule.date)}
                                                    onChange={(e) => updateSchedule(index, { date: new Date(e.target.value) })}
                                                    className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
                                                />
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeSchedule(index)}
                                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors shrink-0"
                                            title="削除"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>

                                    {/* 既存職長バッジ + 残り人数 */}
                                    <div className="flex items-center flex-wrap gap-1.5 text-xs min-h-[24px]">
                                        {existing.length > 0 ? (
                                            <>
                                                <span className="text-gray-400">既存:</span>
                                                {existing.map((e, i) => (
                                                    <span
                                                        key={i}
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 rounded-full"
                                                    >
                                                        {e.foremanName}
                                                        {e.projectTitle && <span className="text-slate-500">{e.projectTitle}</span>}
                                                        <span className="font-medium">{e.memberCount}名</span>
                                                    </span>
                                                ))}
                                            </>
                                        ) : (
                                            <span className="text-gray-300 text-xs">配置なし</span>
                                        )}
                                        <span className={`ml-auto font-bold px-2 py-0.5 rounded-full text-xs text-white shadow-sm ${remaining < 0 ? 'bg-slate-700' : remaining === 0 ? 'bg-slate-400' : 'bg-slate-600'}`}>
                                            残り {remaining}名
                                        </span>
                                    </div>

                                    {/* 職長 */}
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">職長</label>
                                        <select
                                            value={schedule.assignedEmployeeId || ''}
                                            onChange={(e) => updateSchedule(index, { assignedEmployeeId: e.target.value || undefined })}
                                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        >
                                            <option value="">選択なし</option>
                                            {foremen.map((f) => (
                                                <option key={f.id} value={f.id}>{f.displayName}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* 人数 + 予定作業時間 */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">人数</label>
                                            <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => updateSchedule(index, { memberCount: Math.max(0, schedule.memberCount - 1) })} className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded text-gray-600 active:bg-gray-100 flex-shrink-0">−</button>
                                                <span className="flex-1 text-center text-sm font-medium">{schedule.memberCount}</span>
                                                <button type="button" onClick={() => updateSchedule(index, { memberCount: schedule.memberCount + 1 })} className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded text-gray-600 active:bg-gray-100 flex-shrink-0">＋</button>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">予定作業時間</label>
                                            <div className="flex items-center gap-1">
                                                <button type="button" onClick={() => updateSchedule(index, { estimatedHours: Math.max(0, Math.round(((schedule.estimatedHours ?? 8) - 0.5) * 10) / 10) })} className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded text-gray-600 active:bg-gray-100 flex-shrink-0">−</button>
                                                <span className="flex-1 text-center text-sm font-medium">{schedule.estimatedHours ?? 8}h</span>
                                                <button type="button" onClick={() => updateSchedule(index, { estimatedHours: Math.min(24, Math.round(((schedule.estimatedHours ?? 8) + 0.5) * 10) / 10) })} className="w-8 h-8 flex items-center justify-center border border-gray-300 rounded text-gray-600 active:bg-gray-100 flex-shrink-0">＋</button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 車両 */}
                                    {vehicles.length > 0 && (
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">車両</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {vehicles.map((v) => {
                                                    const checked = selectedTrucks.includes(v.name);
                                                    return (
                                                        <label
                                                            key={v.id}
                                                            className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border transition-colors select-none cursor-pointer hover:bg-gray-100 ${
                                                                checked
                                                                    ? 'bg-slate-100 border-slate-400 text-slate-700 font-medium'
                                                                    : 'bg-gray-50 border-gray-200 text-gray-600'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => {
                                                                    const next = checked
                                                                        ? selectedTrucks.filter(t => t !== v.name)
                                                                        : [...selectedTrucks, v.name];
                                                                    updateSchedule(index, { trucks: next });
                                                                }}
                                                                className="w-3 h-3"
                                                            />
                                                            {v.name}
                                                        </label>
                                                    );
                                                })}
                                            </div>
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
                                        <label className="block text-xs text-gray-500 mb-1">備考</label>
                                        <input
                                            type="text"
                                            value={schedule.remarks || ''}
                                            onChange={(e) => updateSchedule(index, { remarks: e.target.value })}
                                            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
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
