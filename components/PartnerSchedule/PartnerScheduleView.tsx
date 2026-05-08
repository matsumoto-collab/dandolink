'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Calendar, MapPin, Clock, Users, AlertCircle } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { logger } from '@/lib/logger';
import { useMasterData } from '@/hooks/useMasterData';

interface PartnerScheduleAssignment {
    id: string;
    date: string;
    projectMasterId: string;
    projectTitle: string;
    projectName: string | null;
    customerShortName: string | null;
    location: string | null;
    prefecture: string | null;
    city: string | null;
    constructionTypeId: string | null;
    constructionContent: string | null;
    meetingTime: string | null;
    foremanId: string;
    foremanName: string;
    isOwnTeam: boolean;
    workers: { id: string; displayName: string }[];
    vehicles: { id: string; name: string }[];
    dispatchRemark: string | null;
    remarks: string | null;
}

function formatDateLabel(dateStr: string): { main: string; sub: string } {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = d.getTime() === today.getTime();
    const isTomorrow = d.getTime() === tomorrow.getTime();
    const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const main = isToday ? '今日' : isTomorrow ? '明日' : `${d.getMonth() + 1}/${d.getDate()}`;
    const sub = `${d.getMonth() + 1}/${d.getDate()} (${wd})`;
    return { main, sub };
}

function localDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export default function PartnerScheduleView() {
    const [assignments, setAssignments] = useState<PartnerScheduleAssignment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<'today' | 'tomorrow'>('today');
    const { constructionTypes } = useMasterData();

    useEffect(() => {
        let cancelled = false;
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/partner-schedule', { cache: 'no-store' });
                if (!res.ok) throw new Error(`status ${res.status}`);
                const data: PartnerScheduleAssignment[] = await res.json();
                if (!cancelled) setAssignments(data);
            } catch (e) {
                logger.error('Failed to fetch partner schedule:', e);
                if (!cancelled) setError('データの取得に失敗しました。再読込してください。');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchData();
        return () => {
            cancelled = true;
        };
    }, []);

    const constructionTypeMap = useMemo(
        () => new Map(constructionTypes.map((c) => [c.id, c])),
        [constructionTypes]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayKey = localDateKey(today);
    const tomorrowKey = localDateKey(tomorrow);

    const targetDateKey = selectedDate === 'today' ? todayKey : tomorrowKey;
    const dayAssignments = assignments.filter((a) => a.date === targetDateKey);
    const ownTeamAssignments = dayAssignments.filter((a) => a.isOwnTeam);
    const otherTeamAssignments = dayAssignments.filter((a) => !a.isOwnTeam);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loading text="予定を読み込み中..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8">
                <AlertCircle className="w-8 h-8 text-amber-500 mb-3" />
                <p className="text-slate-700">{error}</p>
            </div>
        );
    }

    const renderCard = (a: PartnerScheduleAssignment) => {
        const ct = a.constructionTypeId ? constructionTypeMap.get(a.constructionTypeId) : null;
        const projectLabel = a.projectName ?? a.projectTitle;
        const place = [a.prefecture, a.city, a.location].filter(Boolean).join(' ');
        return (
            <div
                key={a.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2"
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {ct && (
                            <span
                                className="px-2 py-0.5 rounded-md text-xs font-semibold text-white shrink-0"
                                style={{ backgroundColor: ct.color || '#64748b' }}
                            >
                                {ct.name}
                            </span>
                        )}
                        <span className="font-semibold text-slate-900 truncate">{projectLabel}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                        {a.foremanName}班
                    </span>
                </div>
                {a.customerShortName && (
                    <div className="text-sm text-slate-500">{a.customerShortName}</div>
                )}
                {place && (
                    <div className="flex items-start gap-1.5 text-sm text-slate-700">
                        <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                        <span>{place}</span>
                    </div>
                )}
                {a.meetingTime && (
                    <div className="flex items-center gap-1.5 text-sm text-slate-700">
                        <Clock className="w-4 h-4 shrink-0 text-slate-400" />
                        <span>集合 {a.meetingTime}</span>
                    </div>
                )}
                {a.workers.length > 0 && (
                    <div className="flex items-start gap-1.5 text-sm text-slate-700">
                        <Users className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                        <span>{a.workers.map((w) => w.displayName).join('、')}</span>
                    </div>
                )}
                {a.dispatchRemark && (
                    <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                        {a.dispatchRemark}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            <div className="max-w-3xl mx-auto p-4 space-y-4">
                <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1">
                    {(['today', 'tomorrow'] as const).map((key) => {
                        const label = formatDateLabel(key === 'today' ? todayKey : tomorrowKey);
                        const isActive = selectedDate === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setSelectedDate(key)}
                                className={`flex-1 flex flex-col items-center py-2 rounded-lg transition-colors ${isActive
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-700 hover:bg-slate-100'
                                    }`}
                            >
                                <span className="text-sm font-semibold">{label.main}</span>
                                <span className="text-xs opacity-70">{label.sub}</span>
                            </button>
                        );
                    })}
                </div>

                <section>
                    <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        自社の班
                    </h2>
                    {ownTeamAssignments.length === 0 ? (
                        <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-4 text-center">
                            予定はありません
                        </p>
                    ) : (
                        <div className="space-y-2">{ownTeamAssignments.map(renderCard)}</div>
                    )}
                </section>

                {otherTeamAssignments.length > 0 && (
                    <section>
                        <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                            <Users className="w-4 h-4" />
                            他班に手配
                        </h2>
                        <div className="space-y-2">{otherTeamAssignments.map(renderCard)}</div>
                    </section>
                )}
            </div>
        </div>
    );
}
