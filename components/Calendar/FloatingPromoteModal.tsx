'use client';

import React, { useMemo, useState } from 'react';
import { CalendarEvent, Project, Employee } from '@/types/calendar';
import { formatDateKey } from '@/utils/employeeUtils';
import { TentativeBadge } from './tentativeStyle';
import { X, Users, Pencil, ArrowRight } from 'lucide-react';

interface FloatingPromoteModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** 対象の浮きイベント */
    event: CalendarEvent | null;
    /** 同週の全プロジェクト（班別の埋まり具合の計算に使用） */
    projects: Project[];
    /** 表示中の職長リスト */
    foremen: Employee[];
    /** 班を選んで昇格（既存PATCHで履歴・通知が自動で乗る） */
    onPromote: (eventId: string, foremanId: string) => Promise<void>;
    /** 詳細編集（ProjectModal を開く） */
    onEdit: (eventId: string) => void;
    isReadOnly?: boolean;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 浮きカードをタップしたときの昇格モーダル。
 * その日の班ごとの埋まり具合（人数・仮予定のみか）を提示し、班を選んで
 * 浮き→通常配置に昇格させる。判断はあくまで人間が行い、ここは材料の提示まで。
 */
export default function FloatingPromoteModal({
    isOpen,
    onClose,
    event,
    projects,
    foremen,
    onPromote,
    onEdit,
    isReadOnly = false,
}: FloatingPromoteModalProps) {
    const [promotingId, setPromotingId] = useState<string | null>(null);

    // その日の班ごとの状況（合計人数・件数・全件仮予定か）
    const foremanStats = useMemo(() => {
        if (!event) return new Map<string, { members: number; count: number; allTentative: boolean }>();
        const dateKey = formatDateKey(event.startDate);
        const map = new Map<string, { members: number; count: number; allTentative: boolean }>();
        projects.forEach((p) => {
            const fid = p.assignedEmployeeId;
            if (!fid || fid === 'unassigned') return;
            if (formatDateKey(p.startDate) !== dateKey) return;
            const cur = map.get(fid) ?? { members: 0, count: 0, allTentative: true };
            cur.members += p.memberCount ?? 0;
            cur.count += 1;
            if (p.dateStatus !== 'tentative') cur.allTentative = false;
            map.set(fid, cur);
        });
        return map;
    }, [event, projects]);

    if (!isOpen || !event) return null;

    const d = event.startDate;
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
    const isTentative = event.dateStatus === 'tentative';

    const handlePromote = async (foremanId: string) => {
        if (promotingId) return;
        setPromotingId(foremanId);
        try {
            await onPromote(event.id, foremanId);
            onClose();
        } finally {
            setPromotingId(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
                {/* ヘッダー */}
                <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-red-600 mb-0.5">浮いている現場（班未定）</div>
                        <div className="font-bold text-slate-900 truncate">
                            {isTentative && <TentativeBadge />}
                            {event.title}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-sm text-slate-600">
                            <span className="font-medium">
                                {dateLabel}
                                {isTentative && <span className="ml-1 text-amber-600 text-xs font-bold">(日付も仮)</span>}
                            </span>
                            <span className="flex items-center gap-0.5">
                                <Users className="w-3.5 h-3.5" />
                                {event.memberCount ?? 0}人
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 flex-shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 班リスト */}
                <div className="flex-1 overflow-y-auto p-3">
                    {isReadOnly ? (
                        <p className="text-sm text-slate-500 text-center py-6">閲覧専用のため班の割り当てはできません</p>
                    ) : (
                        <>
                            <p className="text-xs text-slate-500 mb-2">
                                班を選ぶとこの現場を割り当てます（担当職長には自動で通知されます）
                            </p>
                            <div className="space-y-1.5">
                                {foremen.map((f) => {
                                    const stat = foremanStats.get(f.id);
                                    const busy = stat && stat.members > 0;
                                    return (
                                        <button
                                            key={f.id}
                                            type="button"
                                            disabled={promotingId !== null}
                                            onClick={() => handlePromote(f.id)}
                                            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                                                promotingId === f.id
                                                    ? 'border-teal-400 bg-teal-50'
                                                    : 'border-slate-200 hover:border-teal-300 hover:bg-teal-50/50'
                                            } ${promotingId !== null && promotingId !== f.id ? 'opacity-50' : ''}`}
                                        >
                                            <div className="min-w-0">
                                                <div className="font-medium text-slate-800 text-sm">{f.name}</div>
                                                <div className="text-xs text-slate-500">
                                                    {busy
                                                        ? <>この日 {stat!.count}件・{stat!.members}人{stat!.allTentative && <span className="text-amber-600 font-medium">（すべて仮予定）</span>}</>
                                                        : <span className="text-emerald-600 font-medium">この日の予定なし</span>}
                                                </div>
                                            </div>
                                            <ArrowRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                        </button>
                                    );
                                })}
                                {foremen.length === 0 && (
                                    <p className="text-sm text-slate-500 text-center py-6">表示中の職長がいません</p>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* フッター */}
                <div className="px-4 py-3 border-t border-slate-200 flex justify-between items-center">
                    <button
                        type="button"
                        onClick={() => {
                            onClose();
                            onEdit(event.id);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
                    >
                        <Pencil className="w-3.5 h-3.5" />
                        内容を編集
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-slate-600 text-sm hover:bg-slate-100"
                    >
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
}
