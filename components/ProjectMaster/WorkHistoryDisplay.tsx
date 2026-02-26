'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, User, Users, Truck, Wrench } from 'lucide-react';
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
            <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
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
            <div className="text-sm text-gray-500 py-2">
                作業履歴がありません
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                作業履歴 ({history.length}件)
            </h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
                {history.map((item) => (
                    <div
                        key={item.id}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-gray-800">
                                {formatDate(item.date)}
                            </span>
                            <span
                                className="px-2 py-0.5 text-xs font-medium rounded-full"
                                style={{
                                    backgroundColor: `${getConstructionTypeInfo(item.constructionType).color}30`,
                                    color: getConstructionTypeInfo(item.constructionType).color,
                                }}
                            >
                                {getConstructionTypeInfo(item.constructionType).label}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-gray-600">
                            <div className="flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-gray-400" />
                                <span className="font-medium">{item.foremanName}</span>
                                {item.memberCount > 0 && (
                                    <span className="ml-1 text-xs text-gray-500">({item.memberCount}名)</span>
                                )}
                            </div>
                            {item.workerNames.length > 0 && (
                                <div className="flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5 text-gray-400" />
                                    <span>{item.workerNames.join(', ')}</span>
                                </div>
                            )}
                            {item.vehicleNames.length > 0 && (
                                <div className="flex items-center gap-1">
                                    <Truck className="w-3.5 h-3.5 text-gray-400" />
                                    <span>{item.vehicleNames.join(', ')}</span>
                                </div>
                            )}
                        </div>
                        {item.remarks && (
                            <div className="mt-2 text-xs text-gray-500 flex items-start gap-1">
                                <Wrench className="w-3 h-3 mt-0.5" />
                                <span>{item.remarks}</span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
