'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronLeft, ChevronRight, Loader2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import Loading from '@/components/ui/Loading';
import InfoTip from '@/components/ui/InfoTip';
import { ValueAddedJudgementBadge } from '@/components/ui/ValueAddedBadge';
import { DEFAULT_VALUE_ADDED_SETTINGS, type ValueAddedJudgement } from '@/lib/valueAdded';
import {
    emptyOwnCrewVolumeTotals,
    type OwnCrewVolumeGroup,
    type OwnCrewVolumeTotals,
} from '@/lib/ownCrewVolume';
import OwnCrewVolumeTable from './OwnCrewVolumeTable';

const ALL_FOREMEN = 'all';

interface ForemanOption {
    id: string;
    displayName: string;
}

interface OwnCrewVolumeResponse {
    year: number;
    month: number;
    foremen: ForemanOption[];
    groups: OwnCrewVolumeGroup[];
    totals: OwnCrewVolumeTotals;
    settings: {
        revenueRate: number;
        assemblyRate: number;
        demolitionRate: number;
        breakevenPerManday: number | null;
        /** 注意（黄色）判定の下限。自社情報の設定値 */
        judgeWarningRatio: number;
    };
}

function todayJstYm(): { year: number; month: number } {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' });
    const [y, m] = f.format(new Date()).split('-').map(Number);
    return { year: y, month: m };
}

function ymLabel(year: number, month: number): string {
    return `令和${year - 2018}年 ${month}月`;
}

function yen(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

/**
 * 最低ラインとの比較。lib/valueAdded.ts の judgeBy と同じ規則
 * （しきい値以上＝良好／しきい値×注意割合以上＝注意／それ未満＝要改善）。
 * 注意割合は自社情報の設定値（API の settings.judgeWarningRatio）を使う。
 */
function judgePerManday(value: number | null, threshold: number | null, warningRatio: number): ValueAddedJudgement {
    if (value === null || threshold === null || !(threshold > 0)) return 'unknown';
    if (value >= threshold) return 'good';
    if (value >= threshold * warningRatio) return 'warning';
    return 'bad';
}

function MetricCard({
    label,
    value,
    sub,
    tip,
    badge,
}: {
    label: string;
    value: string;
    sub?: string;
    tip?: React.ReactNode;
    badge?: React.ReactNode;
}) {
    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-4 py-3">
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
                {label}
                {tip}
            </div>
            <div className="mt-1 flex items-baseline gap-2 flex-wrap">
                <span className="text-xl font-bold text-slate-900 tabular-nums">{value}</span>
                {badge}
            </div>
            {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
        </div>
    );
}

export default function OwnCrewVolumePage() {
    const { data: session } = useSession();
    const role = (session?.user?.role ?? '').toLowerCase();
    const canView = role === 'admin' || role === 'manager';

    const initial = todayJstYm();
    const [year, setYear] = useState<number>(initial.year);
    const [month, setMonth] = useState<number>(initial.month);
    const [foremanId, setForemanId] = useState<string>(ALL_FOREMEN);
    const [foremen, setForemen] = useState<ForemanOption[]>([]);
    const [groups, setGroups] = useState<OwnCrewVolumeGroup[]>([]);
    const [totals, setTotals] = useState<OwnCrewVolumeTotals>(() => emptyOwnCrewVolumeTotals());
    const [breakeven, setBreakeven] = useState<number | null>(null);
    const [warningRatio, setWarningRatio] = useState<number>(DEFAULT_VALUE_ADDED_SETTINGS.judgeWarningRatio);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const fetchRows = useCallback(async () => {
        if (!canView) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({ year: String(year), month: String(month), foremanId });
            const res = await fetch(`/api/own-crew-volume?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = (await res.json()) as OwnCrewVolumeResponse;
            setForemen(data.foremen ?? []);
            setGroups(data.groups ?? []);
            setTotals(data.totals ?? emptyOwnCrewVolumeTotals());
            setBreakeven(data.settings?.breakevenPerManday ?? null);
            setWarningRatio(data.settings?.judgeWarningRatio ?? DEFAULT_VALUE_ADDED_SETTINGS.judgeWarningRatio);
            // 月を変えて選択中の職長がその月にいなければ「全班」に戻す
            if (foremanId !== ALL_FOREMEN && !(data.foremen ?? []).some((f) => f.id === foremanId)) {
                setForemanId(ALL_FOREMEN);
            }
        } catch (e) {
            logger.error('自社班の出来高取得失敗:', e);
            toast.error('自社班の出来高の取得に失敗しました');
        } finally {
            setLoading(false);
            setLoaded(true);
        }
    }, [canView, year, month, foremanId]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const goPrev = () => {
        if (month === 1) { setYear((y) => y - 1); setMonth(12); } else { setMonth((m) => m - 1); }
    };
    const goNext = () => {
        if (month === 12) { setYear((y) => y + 1); setMonth(1); } else { setMonth((m) => m + 1); }
    };

    const monthLabel = useMemo(() => ymLabel(year, month), [year, month]);
    const judgement = judgePerManday(totals.perManday, breakeven, warningRatio);

    if (!canView) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">権限がありません</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 max-w-[1800px] w-full mx-auto h-full min-h-0">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h1 className="text-xl font-bold text-slate-900">自社班の出来高</h1>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex items-center bg-white rounded-xl border border-slate-200 shadow-sm">
                        <button
                            type="button"
                            onClick={goPrev}
                            className="px-2 py-2 text-slate-600 hover:bg-slate-50 rounded-l-xl"
                            aria-label="前の月"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-3 py-2 text-sm font-semibold text-slate-700 tabular-nums min-w-[120px] text-center">
                            {monthLabel}
                        </span>
                        <button
                            type="button"
                            onClick={goNext}
                            className="px-2 py-2 text-slate-600 hover:bg-slate-50 rounded-r-xl"
                            aria-label="次の月"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="inline-flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-slate-400" />
                        <select
                            value={foremanId}
                            onChange={(e) => setForemanId(e.target.value)}
                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white shadow-sm focus:ring-2 focus:ring-slate-500"
                            aria-label="班（職長）"
                        >
                            <option value={ALL_FOREMEN}>全班</option>
                            {foremen.map((f) => (
                                <option key={f.id} value={f.id}>{f.displayName}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
                {loading && !loaded ? (
                    <div className="flex items-center justify-center h-full">
                        <Loading text="自社班の出来高を読み込み中..." />
                    </div>
                ) : (
                    <div className="relative flex flex-col gap-3">
                        {loading && (
                            <div className="sticky top-2 z-20 flex justify-center pointer-events-none">
                                <div className="inline-flex items-center gap-1.5 bg-white/95 border border-slate-200 rounded-full shadow px-3 py-1 text-xs text-slate-600">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    更新中...
                                </div>
                            </div>
                        )}
                        <OwnCrewVolumeTable
                            groups={groups}
                            totals={totals}
                            grouped={foremanId === ALL_FOREMEN}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <MetricCard
                                label="一人当たりの稼ぎ"
                                value={yen(totals.perManday)}
                                sub={`稼ぎ ${yen(totals.earnings)} ÷ ${totals.manDays} 人工`}
                                badge={
                                    breakeven != null && judgement !== 'unknown'
                                        ? <ValueAddedJudgementBadge judgement={judgement} size="sm" />
                                        : undefined
                                }
                                tip={
                                    <InfoTip title="一人当たりの稼ぎ">
                                        稼ぎの合計 ÷ 人工の合計。
                                        {breakeven != null
                                            ? `最低ライン（${yen(breakeven)}／人工）と比べています。`
                                            : '最低ラインは自社情報で設定すると比較できます。'}
                                    </InfoTip>
                                }
                            />
                            <MetricCard
                                label="人件費1円あたりの稼ぎ"
                                value={totals.productivityRatio != null ? `${totals.productivityRatio.toFixed(2)} 倍` : '—'}
                                sub={`稼ぎ ${yen(totals.earnings)} ÷ 人件費 ${yen(totals.laborCost)}`}
                                tip={
                                    <InfoTip title="人件費1円あたりの稼ぎ">
                                        稼ぎの合計 ÷ 人件費の合計。払った人件費 1 円に対して、いくら会社に残ったかです。
                                    </InfoTip>
                                }
                            />
                            <MetricCard
                                label="自社でやった得"
                                value={yen(totals.makeVsBuy)}
                                sub={`外注換算 ${yen(totals.outsourcingEquivalent)} − 人件費 ${yen(totals.laborCost)}`}
                                badge={
                                    totals.makeVsBuy < 0
                                        ? <span className="text-xs font-medium text-red-600">外注のほうが安い</span>
                                        : undefined
                                }
                                tip={
                                    <InfoTip title="自社でやった得">
                                        外注換算の合計 − 人件費の合計。プラスなら自社でやったほうが安く済んでいます。
                                    </InfoTip>
                                }
                            />
                        </div>

                        {totals.unbilledRowCount > 0 && (
                            <p className="text-xs text-slate-400">
                                未請求 {totals.unbilledRowCount} 行を含みます（見積・契約金額を売上と見なした仮の数字です）。
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
