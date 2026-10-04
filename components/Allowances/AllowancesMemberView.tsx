'use client';

/**
 * 「手当」の画面 — 本人（職長・作業員。公開の設定がオンのとき）。docs/指示書_大規模手当.md の 7-4。
 *
 *  1. 注意書き（公開の設定に入っていれば、いちばん上に）
 *  2. 月の選択（「前の月」「次の月」「今月」「先月」。初期値は日本時間の今月）
 *  3. 月の状態（締めた月は「確定」、締めていない月は「まだ変わることがあります」）
 *  4. 合計の金額を大きく（「◯月分の手当　◯円」）。その下に「大規模手当（職長）　3日 × 1,500円 ＝ 4,500円」の行
 *     確認待ちがあれば「確認待ち ◯件・◯円（まだ合計に入っていません）」
 *  5. 明細（日付・手当・区分・金額・状態）
 *
 * 読むのは GET /me だけ（サーバーがセッションの本人の記録だけを返す。人の ID は送らない）。他の人の情報は出さない。
 * 知らせ（allowances_updated）では読み直さない（評価ポイントの本人の画面と同じ。全員の画面が一斉に読み直すのを避ける）。
 * スマホで見る画面なので、幅 320px でもはみ出さないように、表ではなく縦に並べる。
 * 作りは components/EvaluationPoints/EvaluationPointsMemberView.tsx と同じ（評価ポイントの部品は使わない）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { logger } from '@/lib/logger';
import { isValidMonthKey, monthKeyOf, todayJstDateKey } from '@/lib/allowances';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import {
    ALLOWANCES_API,
    PAY_ROLE_LABEL,
    STATUS_LABEL,
    errorMessageOf,
    formatMonthLabel,
    formatMonthShort,
    formatShortDate,
    myLineFormula,
    myLineLabel,
    shiftMonth,
    yen,
    type MyAllowanceData,
} from './allowancesClient';

const currentMonthKey = () => monthKeyOf(todayJstDateKey());

export default function AllowancesMemberView() {
    // ---- 見ている月（初期値は日本時間の今月）
    const [month, setMonth] = useState(currentMonthKey);

    const [data, setData] = useState<MyAllowanceData | null>(null);
    const [loading, setLoading] = useState(false);
    const [failMessage, setFailMessage] = useState<string | null>(null);

    // 古い読み込みの答えを捨てるための連番（月を続けて切り替えたとき）
    const seqRef = useRef(0);

    const fetchMine = useCallback(async () => {
        if (!isValidMonthKey(month)) return;
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const params = new URLSearchParams({ month });
            const res = await fetch(`${ALLOWANCES_API}/me?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                const message = res.status === 403 ? 'アクセス権限がありません' : await errorMessageOf(res, '手当を読めませんでした');
                if (seq !== seqRef.current) return;
                setData(null);
                setFailMessage(message);
                return;
            }
            const body = (await res.json()) as MyAllowanceData;
            if (seq !== seqRef.current) return;
            setData(body);
            setFailMessage(null);
        } catch (e) {
            if (seq !== seqRef.current) return;
            logger.error('手当（本人）の取得に失敗:', e);
            setData(null);
            setFailMessage('手当を読めませんでした');
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [month]);

    useEffect(() => {
        fetchMine();
    }, [fetchMine]);

    // ---- 月の選択
    const thisMonth = currentMonthKey();
    const lastMonth = shiftMonth(thisMonth, -1);
    const changeMonth = (next: string) => {
        if (isValidMonthKey(next)) setMonth(next);
    };

    const monthButtonClass = (active: boolean) =>
        `h-9 px-3 rounded-xl text-sm border shadow-sm transition-colors ${
            active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
        }`;
    const iconButtonClass =
        'h-9 px-2 inline-flex items-center gap-0.5 rounded-xl text-sm border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50';

    // 見ている月の答え（月を切り替えた直後は、前の月の答えを出さない）
    const shown = data && data.month === month ? data : null;
    const noRecords = shown !== null && shown.records.length === 0;

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-3 max-w-2xl w-full mx-auto min-w-0">
                {/* 1. 注意書き */}
                {shown?.notice && (
                    <div className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-900 whitespace-pre-wrap break-words">
                        {shown.notice}
                    </div>
                )}

                {/* 2. 見出し・月の選択 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h1 className="text-xl font-bold text-slate-900">手当</h1>
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <button type="button" onClick={() => changeMonth(shiftMonth(month, -1))} className={iconButtonClass} aria-label="前の月">
                            <ChevronLeft className="w-4 h-4" />
                            <span>前の月</span>
                        </button>
                        <span className="text-sm font-semibold text-slate-800 tabular-nums">{formatMonthLabel(month)}</span>
                        <button type="button" onClick={() => changeMonth(shiftMonth(month, 1))} className={iconButtonClass} aria-label="次の月">
                            <span>次の月</span>
                            <ChevronRight className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => changeMonth(thisMonth)} className={monthButtonClass(month === thisMonth)}>
                            今月
                        </button>
                        <button type="button" onClick={() => changeMonth(lastMonth)} className={monthButtonClass(month === lastMonth)}>
                            先月
                        </button>
                        {loading && shown && <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-label="更新中" />}
                    </div>
                </div>

                {shown === null ? (
                    failMessage && !loading ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                            <p className="text-slate-500">{failMessage}</p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchMine()}>
                                読み直す
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <Loading text="手当を読み込み中..." />
                        </div>
                    )
                ) : (
                    <>
                        {/* 3. 月の状態 ／ 4. 合計 */}
                        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <p className="text-sm text-slate-500">{formatMonthShort(shown.month)}分の手当</p>
                                {shown.closed ? (
                                    <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-teal-50 text-teal-700">確定</span>
                                ) : (
                                    <span className="px-2 py-0.5 rounded-md text-xs bg-white text-slate-600 border border-slate-300">
                                        まだ変わることがあります
                                    </span>
                                )}
                            </div>
                            <p className="mt-1 text-4xl font-bold text-slate-900 tabular-nums break-all">{yen(shown.totalAmount)}</p>

                            {shown.lines.length > 0 && (
                                <ul className="mt-3 flex flex-col gap-1.5">
                                    {shown.lines.map((line) => (
                                        <li
                                            key={`${line.itemId}-${line.itemName}-${line.payRole}-${line.amount}`}
                                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                                        >
                                            <span className="min-w-0 break-words text-slate-800">{myLineLabel(line)}</span>
                                            <span className="shrink-0 text-slate-900 tabular-nums">{myLineFormula(line)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {shown.pendingCount > 0 && (
                                <p className="mt-3 text-sm text-amber-700">
                                    確認待ち {shown.pendingCount}件・{yen(shown.pendingAmount)}（まだ合計に入っていません）
                                </p>
                            )}
                        </div>

                        {/* 5. 明細 */}
                        <section className="bg-white rounded-xl border border-slate-200">
                            <h2 className="px-4 pt-3 pb-2 text-sm font-semibold text-slate-800">明細</h2>
                            {noRecords ? (
                                <p className="px-4 pb-3 text-sm text-slate-500">この月の手当はありません</p>
                            ) : (
                                <ul className="divide-y divide-slate-100">
                                    {shown.records.map((r) => (
                                        <li key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                                            <span className="shrink-0 w-12 text-slate-500 tabular-nums">{formatShortDate(r.date)}</span>
                                            <span className="flex-1 min-w-0 break-words text-slate-900">
                                                {r.itemName}
                                                <span className="ml-1 text-xs text-slate-500">{PAY_ROLE_LABEL[r.payRole]}</span>
                                            </span>
                                            <span className="shrink-0 text-right text-slate-900 tabular-nums">{yen(r.amount)}</span>
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
                    </>
                )}
            </div>
        </div>
    );
}
