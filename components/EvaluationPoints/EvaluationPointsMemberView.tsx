'use client';

/**
 * 「評価ポイント」の画面 — 本人（職長・作業員。公開の設定がオンのとき）。docs/指示書_評価ポイント.md の 7-4。
 *
 *  1. 注意書き（公開の設定に入っていれば、いちばん上に）
 *  2. 期間（開始日〜終了日・「今月」「先月」。初期値は今月）
 *  3. 合計点を大きく。確認待ちがあれば「確認待ち ◯件（まだ合計に入っていません）」
 *  4. 項目ごとの回数と点数
 *  5. 明細（日付・項目・点数・状態）
 *
 * 読むのは GET /me だけ（サーバーがセッションの本人の記録だけを返す）。他の人の情報・順位は出さない。
 * スマホで見る画面なので、幅 320px でもはみ出さないように、表ではなく縦に並べる。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';
import { todayJstDateKey } from '@/lib/evaluationPoints';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import EvaluationThanksPanel from './EvaluationThanksPanel';
import {
    EVALUATION_POINTS_API,
    STATUS_LABEL,
    errorMessageOf,
    formatShortDate,
    monthRangeOf,
    type MyPointsData,
} from './evaluationPointsClient';

const dateInputClass =
    'h-9 min-w-0 flex-1 sm:flex-none px-2 border border-slate-200 rounded-xl text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500';

export default function EvaluationPointsMemberView() {
    // ---- 期間（初期値は今月の1日〜末日）
    const [startDate, setStartDate] = useState(() => monthRangeOf(todayJstDateKey()).startDate);
    const [endDate, setEndDate] = useState(() => monthRangeOf(todayJstDateKey()).endDate);
    const periodValid = !!startDate && !!endDate && startDate <= endDate;

    const [data, setData] = useState<MyPointsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [failMessage, setFailMessage] = useState<string | null>(null);

    // 古い読み込みの答えを捨てるための連番（期間を続けて切り替えたとき）
    const seqRef = useRef(0);

    const fetchMine = useCallback(async () => {
        if (!periodValid) return;
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const params = new URLSearchParams({ startDate, endDate });
            const res = await fetch(`${EVALUATION_POINTS_API}/me?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                const message = res.status === 403 ? 'アクセス権限がありません' : await errorMessageOf(res, '評価ポイントを読めませんでした');
                if (seq !== seqRef.current) return;
                setData(null);
                setFailMessage(message);
                return;
            }
            const body = (await res.json()) as MyPointsData;
            if (seq !== seqRef.current) return;
            setData(body);
            setFailMessage(null);
        } catch (e) {
            if (seq !== seqRef.current) return;
            logger.error('評価ポイント（本人）の取得に失敗:', e);
            setData(null);
            setFailMessage('評価ポイントを読めませんでした');
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [periodValid, startDate, endDate]);

    useEffect(() => {
        fetchMine();
    }, [fetchMine]);

    // ---- 期間
    const setMonth = (offset: number) => {
        const r = monthRangeOf(todayJstDateKey(), offset);
        setStartDate(r.startDate);
        setEndDate(r.endDate);
    };
    const thisMonth = monthRangeOf(todayJstDateKey());
    const lastMonth = monthRangeOf(todayJstDateKey(), -1);
    const isThisMonth = startDate === thisMonth.startDate && endDate === thisMonth.endDate;
    const isLastMonth = startDate === lastMonth.startDate && endDate === lastMonth.endDate;

    const monthButtonClass = (active: boolean) =>
        `h-9 px-3 rounded-xl text-sm border shadow-sm transition-colors ${
            active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
        }`;

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-3 max-w-2xl w-full mx-auto min-w-0">
                {/* 1. 注意書き */}
                {data?.notice && (
                    <div className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900 whitespace-pre-wrap break-words">
                        {data.notice}
                    </div>
                )}

                {/* 2. 見出し・期間 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h1 className="text-xl font-bold text-slate-900">評価ポイント</h1>
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 w-full sm:w-auto">
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className={dateInputClass}
                                aria-label="開始日"
                            />
                            <span className="text-slate-500 text-sm shrink-0">〜</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className={dateInputClass}
                                aria-label="終了日"
                            />
                        </div>
                        <button type="button" onClick={() => setMonth(0)} className={monthButtonClass(isThisMonth)}>
                            今月
                        </button>
                        <button type="button" onClick={() => setMonth(-1)} className={monthButtonClass(isLastMonth)}>
                            先月
                        </button>
                        {loading && data && <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-label="更新中" />}
                    </div>
                </div>
                {!periodValid && <p className="text-sm text-red-600">開始日は終了日以前の日付にしてください</p>}

                {data === null ? (
                    failMessage ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                            <p className="text-slate-500">{failMessage}</p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchMine()}>
                                読み直す
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <Loading text="評価ポイントを読み込み中..." />
                        </div>
                    )
                ) : (
                    <>
                        {/* 3. 合計点 */}
                        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4">
                            <p className="text-sm text-slate-500">合計点（{formatShortDate(data.startDate)}〜{formatShortDate(data.endDate)}）</p>
                            <p className="mt-1 flex items-baseline gap-1 flex-wrap">
                                <span className="text-4xl font-bold text-slate-900 tabular-nums break-all">{data.totalPoints}</span>
                                <span className="text-lg font-semibold text-slate-700">点</span>
                                <span className="ml-2 text-sm text-slate-500">{data.totalCount}回</span>
                            </p>
                            {data.pendingCount > 0 && (
                                <p className="mt-2 text-sm text-amber-700">
                                    確認待ち {data.pendingCount}件（まだ合計に入っていません）
                                </p>
                            )}
                        </div>

                        {/* 4. 項目ごと */}
                        <section className="bg-white rounded-xl border border-slate-200">
                            <h2 className="px-4 pt-3 pb-2 text-sm font-semibold text-slate-800">項目ごと</h2>
                            {data.byItem.length === 0 ? (
                                <p className="px-4 pb-3 text-sm text-slate-500">確定した記録はありません</p>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {data.byItem.map((row) => (
                                        <li key={row.itemId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                                            <span className="flex-1 min-w-0 break-words text-slate-900">{row.itemName}</span>
                                            <span className="shrink-0 text-slate-500 tabular-nums">{row.count}回</span>
                                            <span className="shrink-0 w-16 text-right font-semibold text-slate-900 tabular-nums">{row.points}点</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {/* 5. 明細 */}
                        <section className="bg-white rounded-xl border border-slate-200">
                            <h2 className="px-4 pt-3 pb-2 text-sm font-semibold text-slate-800">明細</h2>
                            {data.records.length === 0 ? (
                                <p className="px-4 pb-3 text-sm text-slate-500">この期間の記録はありません</p>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {data.records.map((r) => (
                                        <li key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                                            <span className="shrink-0 w-12 text-slate-500 tabular-nums">{formatShortDate(r.date)}</span>
                                            <span className="flex-1 min-w-0 break-words text-slate-900">{r.itemName}</span>
                                            <span className="shrink-0 text-right text-slate-900 tabular-nums">{r.points}点</span>
                                            <span
                                                className={`shrink-0 px-2 py-0.5 rounded-md text-xs ${
                                                    r.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-teal-50 text-teal-700'
                                                }`}
                                            >
                                                {STATUS_LABEL[r.status]}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <p className="text-xs text-slate-400 pb-2">
                            合計に入るのは「確定」の記録だけです。「確認待ち」は、管理者・マネージャーが認めると合計に入ります。
                        </p>

                        {/* 「ありがとう」の欄（「使わない」で1件も無いあいだは何も出ない） */}
                        <EvaluationThanksPanel />
                    </>
                )}
            </div>
        </div>
    );
}
