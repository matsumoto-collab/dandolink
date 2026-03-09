'use client';

import React, { useState, useEffect, useMemo } from 'react';
// アイコン不使用（ラベルテキストのみ）
import { useMasterData } from '@/hooks/useMasterData';
import { DEFAULT_CONSTRUCTION_TYPE_COLORS, DEFAULT_CONSTRUCTION_TYPE_LABELS } from '@/types/calendar';

interface WorkHistoryItem {
    id: string;
    date: string;
    foremanId: string;
    foremanName: string;
    constructionType: string;
    constructionContent?: string;
    memberCount: number;
    workerIds: string[];
    workerNames: string[];
    vehicleIds: string[];
    vehicleNames: string[];
    isConfirmed: boolean;
    remarks?: string;
    workTimeMinutes?: number | null;
}

interface WorkHistoryDisplayProps {
    projectMasterId: string;
}

export default function WorkHistoryDisplay({ projectMasterId }: WorkHistoryDisplayProps) {
    const { constructionTypes } = useMasterData();

    // 工事種別の情報を取得するヘルパー関数
    const getConstructionTypeInfo = useMemo(() => {
        return (ct: string) => {
            const masterType = constructionTypes.find(t => t.id === ct || t.name === ct);
            if (masterType) {
                return { color: masterType.color, label: masterType.name };
            }
            return {
                color: DEFAULT_CONSTRUCTION_TYPE_COLORS[ct] || '#a8c8e8',
                label: DEFAULT_CONSTRUCTION_TYPE_LABELS[ct] || ct || '未設定',
            };
        };
    }, [constructionTypes]);
    const [history, setHistory] = useState<WorkHistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                setIsLoading(true);
                const res = await fetch(`/api/project-masters/${projectMasterId}/history`);
                if (!res.ok) throw new Error('Failed to fetch history');
                const data = await res.json();
                setHistory(data);
            } catch (err) {
                setError('作業履歴の取得に失敗しました');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        };

        if (projectMasterId) {
            fetchHistory();
        }
    }, [projectMasterId]);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${weekDays[d.getDay()]})`;
    };

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                <div className="animate-spin w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full"></div>
                <span>作業履歴を読み込み中...</span>
            </div>
        );
    }

    if (error) {
        return <div className="text-sm text-slate-500 py-2">{error}</div>;
    }

    if (history.length === 0) {
        return (
            <div className="text-sm text-slate-500 py-2">
                作業履歴がありません
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div className="text-xs text-slate-500 text-right">{history.length}件</div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
                {history.map((item) => {
                    const ctInfo = getConstructionTypeInfo(item.constructionType);
                    const formatMinutes = (m: number) => {
                        const h = Math.floor(m / 60);
                        const min = m % 60;
                        return min > 0 ? `${h}時間${min}分` : `${h}時間`;
                    };
                    return (
                        <div
                            key={item.id}
                            className="p-3 bg-white rounded-xl border border-slate-200 text-sm"
                        >
                            {/* 日付 + 工事種別 */}
                            <div className="flex items-center justify-between mb-2.5">
                                <span className="font-semibold text-slate-800">
                                    {formatDate(item.date)}
                                </span>
                                <span
                                    className="px-2 py-0.5 text-xs font-medium rounded-full"
                                    style={{
                                        backgroundColor: `${ctInfo.color}30`,
                                        color: '#000000',
                                    }}
                                >
                                    {ctInfo.label}
                                </span>
                            </div>

                            {/* 詳細グリッド */}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                                <div>
                                    <span className="text-slate-400">職長</span>
                                    <p className="text-slate-700 font-medium">
                                        {item.foremanName}
                                        {item.memberCount > 0 && <span className="text-slate-400 font-normal ml-1">({item.memberCount}名)</span>}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-slate-400">作業時間</span>
                                    <p className="text-slate-700 font-medium">
                                        {item.workTimeMinutes != null ? formatMinutes(item.workTimeMinutes) : '−'}
                                    </p>
                                </div>
                                {item.workerNames.length > 0 && (
                                    <div>
                                        <span className="text-slate-400">メンバー</span>
                                        <p className="text-slate-700">{item.workerNames.join('、')}</p>
                                    </div>
                                )}
                                {item.vehicleNames.length > 0 && (
                                    <div>
                                        <span className="text-slate-400">車両</span>
                                        <p className="text-slate-700">{item.vehicleNames.join('、')}</p>
                                    </div>
                                )}
                            </div>

                            {/* 備考 */}
                            {item.remarks && (
                                <p className="mt-2 text-xs text-slate-500 border-t border-slate-100 pt-1.5">
                                    {item.remarks}
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
