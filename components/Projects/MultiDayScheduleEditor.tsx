'use client';

import React, { useState } from 'react';
import { DailySchedule, ConstructionType } from '@/types/calendar';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface ForemanOption {
    id: string;
    displayName: string;
}

interface MultiDayScheduleEditorProps {
    type: ConstructionType;
    dailySchedules: DailySchedule[];
    onChange: (schedules: DailySchedule[]) => void;
    foremen?: ForemanOption[];
}

export default function MultiDayScheduleEditor({
    type: _type,
    dailySchedules,
    onChange,
    foremen = [],
}: MultiDayScheduleEditorProps) {
    const [mode, setMode] = useState<'range' | 'individual'>('range');

    // 期間指定モード用の状態
    const [rangeStart, setRangeStart] = useState('');
    const [rangeEnd, setRangeEnd] = useState('');
    const [defaultLeader, setDefaultLeader] = useState('');
    const [defaultMemberCount, setDefaultMemberCount] = useState(0);

    // 期間から日程を生成
    const generateFromRange = () => {
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
            newSchedules.push({
                date: new Date(current),
                assignedEmployeeId: defaultLeader || undefined,
                memberCount: defaultMemberCount,
                workers: [],
                trucks: [],
                remarks: '',
                sortOrder: 0,
            });
            current.setDate(current.getDate() + 1);
        }

        onChange(newSchedules);
    };

    // 平日のみ生成
    const generateWeekdaysOnly = () => {
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
            const dayOfWeek = current.getDay();
            // 0: 日曜, 6: 土曜を除外
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                newSchedules.push({
                    date: new Date(current),
                    assignedEmployeeId: defaultLeader || undefined,
                    memberCount: defaultMemberCount,
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

    // 個別の日程を追加
    const addIndividualDay = () => {
        const newSchedule: DailySchedule = {
            date: new Date(),
            assignedEmployeeId: undefined,
            memberCount: 0,
            workers: [],
            trucks: [],
            remarks: '',
            sortOrder: 0,
        };
        onChange([...dailySchedules, newSchedule]);
    };

    // 日程を削除
    const removeSchedule = (index: number) => {
        onChange(dailySchedules.filter((_, i) => i !== index));
    };

    // 日程を更新
    const updateSchedule = (index: number, updates: Partial<DailySchedule>) => {
        const updated = dailySchedules.map((schedule, i) =>
            i === index ? { ...schedule, ...updates } : schedule
        );
        onChange(updated);
    };

    return (
        <div className="space-y-4">
            {/* モード選択 */}
            <div className="flex gap-2 border-b pb-3">
                <button
                    type="button"
                    onClick={() => setMode('range')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${mode === 'range'
                        ? 'bg-slate-700 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    期間指定
                </button>
                <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${mode === 'individual'
                        ? 'bg-slate-700 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    個別選択
                </button>
            </div>

            {/* 期間指定モード */}
            {mode === 'range' && (
                <div className="space-y-3 bg-slate-50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                開始日
                            </label>
                            <input
                                type="date"
                                value={rangeStart}
                                onChange={(e) => setRangeStart(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                終了日
                            </label>
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
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                職長（デフォルト）
                            </label>
                            <select
                                value={defaultLeader}
                                onChange={(e) => setDefaultLeader(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            >
                                <option value="">選択なし</option>
                                {foremen.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.displayName}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                人数（デフォルト）
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={defaultMemberCount}
                                onChange={(e) => setDefaultMemberCount(parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={generateFromRange}
                            className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors font-medium"
                        >
                            期間を生成
                        </button>
                        <button
                            type="button"
                            onClick={generateWeekdaysOnly}
                            className="flex-1 px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-700 transition-colors font-medium"
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
                        className="w-full px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors font-medium flex items-center justify-center gap-2"
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
                        登録済みの日程 ({dailySchedules.length}日間)
                    </h4>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        {dailySchedules.map((schedule, index) => (
                            <div
                                key={index}
                                className="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg hover:border-slate-400 transition-colors"
                            >
                                <div className="flex-1 grid grid-cols-4 gap-2">
                                    <div>
                                        <label className="block text-xs text-gray-600 mb-1">
                                            日付
                                        </label>
                                        <input
                                            type="date"
                                            value={schedule.date.toISOString().split('T')[0]}
                                            onChange={(e) =>
                                                updateSchedule(index, {
                                                    date: new Date(e.target.value),
                                                })
                                            }
                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-600 mb-1">
                                            職長
                                        </label>
                                        <select
                                            value={schedule.assignedEmployeeId || ''}
                                            onChange={(e) =>
                                                updateSchedule(index, {
                                                    assignedEmployeeId: e.target.value || undefined,
                                                })
                                            }
                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        >
                                            <option value="">選択なし</option>
                                            {foremen.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {f.displayName}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-600 mb-1">
                                            人数
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            value={schedule.memberCount}
                                            onChange={(e) =>
                                                updateSchedule(index, {
                                                    memberCount: parseInt(e.target.value) || 0,
                                                })
                                            }
                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-600 mb-1">
                                            備考
                                        </label>
                                        <input
                                            type="text"
                                            value={schedule.remarks || ''}
                                            onChange={(e) =>
                                                updateSchedule(index, {
                                                    remarks: e.target.value,
                                                })
                                            }
                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="備考"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeSchedule(index)}
                                    className="p-2 text-slate-600 hover:bg-slate-50 rounded-md transition-colors"
                                    title="削除"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
