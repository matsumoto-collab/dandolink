'use client';

import React, { useState, useEffect, useMemo } from 'react';
// アイコン不使用（ラベルテキストのみ）
import { useMasterData } from '@/hooks/useMasterData';
import { DEFAULT_CONSTRUCTION_TYPE_COLORS, DEFAULT_CONSTRUCTION_TYPE_LABELS } from '@/types/calendar';
import { logger } from '@/lib/logger';

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
    toolIds?: string[];
    toolNames?: string[];
    isConfirmed: boolean;
    remarks?: string;
    workTimeMinutes?: number | null;
    /** 過去データ（段取日報から取り込んだ作業履歴） */
    isBackfilled?: boolean;
    backfillCategory?: '自社' | '外注' | null;
    backfillHeadcountFilled?: boolean;
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
                logger.error('作業履歴の取得に失敗しました', err);
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
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-2 space-y-2">
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
                            className="px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs"
                        >
                            {/* 1行目: 日付 + 工事種別 + 職長 + 人数 + 作業時間 */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-slate-800 text-sm">
                                    {formatDate(item.date)}
                                </span>
                                {item.isBackfilled ? (
                                    // 過去データは工事種別を持たないので、代わりに過去データの印を出す
                                    <span
                                        className="px-1.5 py-0.5 font-medium rounded-full leading-none bg-slate-100 text-slate-500"
                                        style={{ fontSize: '10px' }}
                                        title="DandoLink 導入前の段取日報から取り込んだ作業履歴"
                                    >
                                        過去
                                    </span>
                                ) : (
                                    <span
                                        className="px-1.5 py-0.5 font-medium rounded-full leading-none"
                                        style={{
                                            backgroundColor: `${ctInfo.color}30`,
                                            color: '#000000',
                                            fontSize: '10px',
                                        }}
                                    >
                                        {ctInfo.label}
                                    </span>
                                )}
                                <span className="text-slate-600">
                                    {item.foremanName}
                                    {item.memberCount > 0 && <span className="text-slate-400 ml-0.5">({item.memberCount}名)</span>}
                                </span>
                                {item.backfillCategory === '外注' && (
                                    <span className="text-slate-400" title="外注の人数は人工に数えません（外注費として原価側で扱うため）">外注</span>
                                )}
                                {item.backfillHeadcountFilled && (
                                    <span className="text-slate-400" title="段取日報で空欄だった人数を、直前の同じ職長の人数で補ったもの">補完</span>
                                )}
                                {item.workTimeMinutes != null && (
                                    <span className="text-slate-400">{formatMinutes(item.workTimeMinutes)}</span>
                                )}
                            </div>
                            {/* 2行目: メンバー・車両・電動工具・備考（ある場合のみ） */}
                            {(item.workerNames.length > 0 || item.vehicleNames.length > 0 || (item.toolNames?.length ?? 0) > 0 || item.remarks) && (
                                <div className="mt-1 text-slate-500 leading-tight truncate">
                                    {item.workerNames.length > 0 && (
                                        <span>メンバー: {item.workerNames.join('、')}</span>
                                    )}
                                    {item.vehicleNames.length > 0 && (
                                        <span className="ml-2">車両: {item.vehicleNames.join('、')}</span>
                                    )}
                                    {(item.toolNames?.length ?? 0) > 0 && (
                                        <span className="ml-2">電動工具: {item.toolNames!.join('、')}</span>
                                    )}
                                    {item.remarks && (
                                        <span className="ml-2">備考: {item.remarks}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
