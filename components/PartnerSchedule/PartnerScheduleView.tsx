'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Calendar, MapPin, Clock, Users, AlertCircle, ChevronRight } from 'lucide-react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import Loading from '@/components/ui/Loading';
import { logger } from '@/lib/logger';
import { useMasterData } from '@/hooks/useMasterData';
import WorkStatusReportSection from '@/components/Projects/WorkStatusReportSection';
import { assignmentToProject } from '@/stores/calendarSlices/types';
import { Project } from '@/types/calendar';

// 案件詳細（週間タブのカードを押したときと同じ閲覧専用モーダル）
const ProjectModal = dynamic(() => import('@/components/Projects/ProjectModal'), { ssr: false });

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
    workStartedAt: string | null;
    workEndedAt: string | null;
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

function localDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function buildDateOptions(): { key: string; main: string; sub: string; offset: number }[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const offsets = [-1, 0, 1, 2, 3, 4, 5];
    return offsets.map((offset) => {
        const d = new Date(today);
        d.setDate(d.getDate() + offset);
        const key = localDateKey(d);
        const wd = WEEKDAY[d.getDay()];
        let main: string;
        if (offset === -1) main = '昨日';
        else if (offset === 0) main = '今日';
        else if (offset === 1) main = '明日';
        else main = `${d.getMonth() + 1}/${d.getDate()}`;
        const sub = `${d.getMonth() + 1}/${d.getDate()} (${wd})`;
        return { key, main, sub, offset };
    });
}

export default function PartnerScheduleView() {
    const { data: session } = useSession();
    const role = session?.user?.role;
    const userId = session?.user?.id ?? null;
    const companyId = session?.user?.companyId ?? null;

    const [assignments, setAssignments] = useState<PartnerScheduleAssignment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // 案件詳細モーダル（カードタップで開く。週間タブと同じ閲覧専用表示）
    const [detailProject, setDetailProject] = useState<Project | null>(null);
    const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
    const dateOptions = useMemo(() => buildDateOptions(), []);
    const [selectedKey, setSelectedKey] = useState<string>(() => {
        const todayOpt = dateOptions.find((d) => d.offset === 0);
        return todayOpt?.key ?? dateOptions[0].key;
    });
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

    const countsByDate = useMemo(() => {
        const m = new Map<string, number>();
        for (const a of assignments) m.set(a.date, (m.get(a.date) ?? 0) + 1);
        return m;
    }, [assignments]);

    const handleWorkStatusUpdated = useCallback(
        (assignmentId: string, next: { workStartedAt: Date | null; workEndedAt: Date | null }) => {
            setAssignments((prev) =>
                prev.map((a) =>
                    a.id === assignmentId
                        ? {
                              ...a,
                              workStartedAt: next.workStartedAt ? next.workStartedAt.toISOString() : null,
                              workEndedAt: next.workEndedAt ? next.workEndedAt.toISOString() : null,
                          }
                        : a
                )
            );
        },
        []
    );

    // カードタップ → 配置の完全データを取得して詳細モーダルを開く（週間タブのカードと同じ表示）
    const handleOpenDetail = useCallback(async (assignmentId: string) => {
        setLoadingDetailId(assignmentId);
        try {
            const res = await fetch(`/api/assignments/${assignmentId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = await res.json();
            // ストアの parseAssignmentResponse と同様、date を Date 化してから変換する
            const project = assignmentToProject({ ...data, date: new Date(data.date) });
            setDetailProject(project);
        } catch (e) {
            logger.error('Failed to fetch assignment detail:', e);
            toast.error('案件詳細の取得に失敗しました');
        } finally {
            setLoadingDetailId(null);
        }
    }, []);

    const dayAssignments = assignments.filter((a) => a.date === selectedKey);
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

    // partner_member は companyId が必要、partner は userId が assignedEmployeeId と一致するときのみ
    const canPressWorkStatus = (a: PartnerScheduleAssignment): boolean => {
        if (!a.isOwnTeam) return false;
        if (role === 'partner') return !!userId && a.foremanId === userId;
        if (role === 'partner_member') return !!companyId && a.foremanId === companyId;
        return false;
    };

    const renderCard = (a: PartnerScheduleAssignment) => {
        const ct = a.constructionTypeId ? constructionTypeMap.get(a.constructionTypeId) : null;
        const projectLabel = a.projectName ?? a.projectTitle;
        const place = [a.prefecture, a.city, a.location].filter(Boolean).join(' ');
        const workStartedAt = a.workStartedAt ? new Date(a.workStartedAt) : null;
        const workEndedAt = a.workEndedAt ? new Date(a.workEndedAt) : null;
        return (
            <div
                key={a.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2"
            >
                {/* 上部（案件情報）はタップで詳細表示（週間タブのカードと同じ）。報告ボタンとは領域を分ける */}
                <button
                    type="button"
                    onClick={() => handleOpenDetail(a.id)}
                    disabled={loadingDetailId === a.id}
                    className="w-full text-left space-y-2 rounded-lg transition-opacity active:opacity-60 disabled:opacity-60"
                    aria-label={`${projectLabel} の詳細を表示`}
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
                        <span className="flex items-center gap-1 shrink-0">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                {a.foremanName}班
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-300" />
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
                </button>
                {canPressWorkStatus(a) && (
                    <div className="pt-2">
                        <WorkStatusReportSection
                            assignmentId={a.id}
                            projectMasterId={a.projectMasterId}
                            title={projectLabel}
                            workStartedAt={workStartedAt}
                            workEndedAt={workEndedAt}
                            onUpdated={(next) => handleWorkStatusUpdated(a.id, next)}
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            <div className="max-w-3xl mx-auto p-4 space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-1 overflow-x-auto">
                    <div className="flex gap-1 min-w-max">
                        {dateOptions.map((opt) => {
                            const isActive = selectedKey === opt.key;
                            const count = countsByDate.get(opt.key) ?? 0;
                            return (
                                <button
                                    key={opt.key}
                                    onClick={() => setSelectedKey(opt.key)}
                                    className={`flex-1 min-w-[68px] flex flex-col items-center py-2 px-3 rounded-lg transition-colors ${isActive
                                        ? 'bg-slate-800 text-white'
                                        : 'text-slate-700 hover:bg-slate-100'
                                        }`}
                                >
                                    <span className="text-sm font-semibold">{opt.main}</span>
                                    <span className="text-xs opacity-70">{opt.sub}</span>
                                    {count > 0 && (
                                        <span
                                            className={`mt-0.5 text-[10px] px-1.5 rounded-full ${isActive
                                                ? 'bg-white/20 text-white'
                                                : 'bg-slate-200 text-slate-700'
                                                }`}
                                        >
                                            {count}件
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
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

            {/* 案件詳細モーダル（閲覧専用。週間タブのカードタップと同じ表示） */}
            {detailProject && (
                <ProjectModal
                    isOpen={!!detailProject}
                    onClose={() => setDetailProject(null)}
                    onSubmit={async () => undefined}
                    initialData={detailProject}
                    readOnly
                />
            )}
        </div>
    );
}
