'use client';

/**
 * 評価ポイント「ありがとう」の欄（送る・もらった・送った）。作業員・職長・マネージャー・管理者に共通。
 *
 * 読むのは GET /api/evaluation-points/thanks/me（見ている月の初日〜末日）だけ。サーバーがセッションの本人の分だけを返す。
 * 決まりごと（送れるか・取り消せるか・点数を見せるか）は、応答の active・remainingToday・sentTodayToIds・canRemove・showPoints で出し分ける。
 *
 * 「使わない」のあいだ、今の画面を変えないための決まり:
 *  - 初めて読めるまで（読み込み中・失敗）は何も描かない（失敗は logger.error だけ）
 *  - 読めて、active が false で、もらった・送ったが両方 0件なら何も描かない
 *  - 一度出したら、月を切り替えても出したままにする（0件の月へ動いたときに、月の切り替えごと消えないように）
 * showStatus（「ありがとう」だけの画面）のときは、読み込み中・失敗・0件でも欄を出す。
 *
 * 送った・取り消したあとは、欄を読み直して evaluation_points_updated を送る（ほかの端末の管理者の集計を読み直させる）。
 * この欄そのものは、知らせを受けて読み直さない（全員の画面が一斉に読み直すのを避ける）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, sendBroadcast } from '@/lib/broadcastChannel';
import { todayJstDateKey } from '@/lib/evaluationPoints';
import { Button } from '@/components/ui/Button';
import EvaluationThanksSendModal from './EvaluationThanksSendModal';
import { EVALUATION_POINTS_UPDATED_EVENT, errorMessageOf, formatShortDate } from './evaluationPointsClient';
import {
    THANKS_API,
    formatThanksMonthLabel,
    isValidThanksMonthKey,
    receivedHeadingLabel,
    remainingTodayLabel,
    sentHeadingLabel,
    shiftThanksMonth,
    thanksMonthKeyOf,
    thanksMonthRange,
    type MyThanksData,
    type MyThanksSentRow,
} from './evaluationThanksClient';

interface Props {
    /** true なら、読み込み中・失敗・0件でも欄を出す（「ありがとう」だけの画面用） */
    showStatus?: boolean;
    /** 親が読み直させたいときに変える数（管理者の画面で「ありがとう」を取り消したあと） */
    reloadKey?: number;
    /** 送った・取り消したあとに呼ぶ（同じ画面の集計を読み直すため。知らせは自分には届かない） */
    onChanged?: () => void;
}

const currentMonthKey = () => thanksMonthKeyOf(todayJstDateKey());

const monthButtonClass = (active: boolean) =>
    `h-9 px-3 rounded-xl text-sm border shadow-sm transition-colors ${
        active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
    }`;
const iconButtonClass =
    'h-9 px-2 inline-flex items-center gap-0.5 rounded-xl text-sm border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50';

export default function EvaluationThanksPanel({ showStatus = false, reloadKey = 0, onChanged }: Props) {
    const [month, setMonth] = useState(currentMonthKey);
    const range = thanksMonthRange(month);

    const [data, setData] = useState<MyThanksData | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    /** 一度でも欄を出したか（出したら、0件の月へ動いても出したまま） */
    const [everVisible, setEverVisible] = useState(false);

    const [sendOpen, setSendOpen] = useState(false);
    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);

    // 古い読み込みの答えを捨てるための連番（月を続けて切り替えたとき）
    const seqRef = useRef(0);

    const { startDate, endDate } = range;
    const load = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const params = new URLSearchParams({ startDate, endDate });
            const res = await fetch(`${THANKS_API}/me?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessageOf(res, `HTTP ${res.status}`));
            const body = (await res.json()) as MyThanksData;
            if (seq !== seqRef.current) return;
            setData(body);
            setFailed(false);
            if (body.active || body.received.length > 0 || body.sent.length > 0) setEverVisible(true);
        } catch (e) {
            if (seq !== seqRef.current) return;
            // 「使わない」のあいだに画面を変えないため、トーストは出さない
            logger.error('「ありがとう」の取得に失敗:', e);
            setFailed(true);
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => {
        load();
    }, [load, reloadKey]);

    useEffect(() => {
        // 送った・取り消したことを、ほかの端末の管理者の画面へ知らせるため（何回呼んでも初期化は1回）
        initBroadcastChannel();
    }, []);

    const afterChange = () => {
        sendBroadcast(EVALUATION_POINTS_UPDATED_EVENT, {});
        onChanged?.();
    };

    // ---- 送る
    const handleSend = async (input: { toUserId: string; toUserName: string; message: string }): Promise<boolean> => {
        if (busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(THANKS_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // 送る人・日付は送らない（サーバーが決める）
                body: JSON.stringify({ toUserId: input.toUserId, message: input.message }),
            });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, '「ありがとう」を送れませんでした'));
                // 断られた理由が「状態が変わっている」のこともあるので、今の状態を読み直す（モーダルは開いたまま）
                load();
                return false;
            }
            toast.success(`${input.toUserName}さんに『ありがとう』を送りました`);
            setSendOpen(false);
            load();
            afterChange();
            return true;
        } catch (e) {
            logger.error('「ありがとう」を送るのに失敗:', e);
            toast.error('「ありがとう」を送れませんでした');
            return false;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // ---- 取り消す
    const handleRemove = async (row: MyThanksSentRow) => {
        if (busyRef.current) return;
        if (!window.confirm(`${row.toUserName}さんへの『ありがとう』を取り消しますか？`)) return;
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(`${THANKS_API}/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, '「ありがとう」の取り消しに失敗しました'));
                load();
                return;
            }
            toast.success('「ありがとう」を取り消しました');
            load();
            afterChange();
        } catch (e) {
            logger.error('「ありがとう」の取り消しに失敗:', e);
            toast.error('「ありがとう」の取り消しに失敗しました');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // ---- 月
    const thisMonth = currentMonthKey();
    const changeMonth = (next: string) => {
        if (isValidThanksMonthKey(next)) setMonth(next);
    };

    // 見ている月の答え（月を切り替えた直後は、前の月の答えを出さない）
    const shown = data && data.startDate === range.startDate && data.endDate === range.endDate ? data : null;
    const shownHasContent = !!shown && (shown.active || shown.received.length > 0 || shown.sent.length > 0);

    // 「使わない」で1件も無いあいだ・初めて読めるまでは、何も描かない（今の画面を変えない）
    if (!showStatus && !everVisible && !shownHasContent) return null;

    return (
        <section className="bg-white rounded-xl border border-slate-200 min-w-0">
            {/* 見出し・月の切り替え */}
            <div className="px-4 pt-3 pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-800 inline-flex items-center gap-1.5">
                    <Heart className="w-4 h-4 text-rose-500" aria-hidden="true" />
                    ありがとう
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <button type="button" onClick={() => changeMonth(shiftThanksMonth(month, -1))} className={iconButtonClass} aria-label="前の月">
                        <ChevronLeft className="w-4 h-4" />
                        <span>前の月</span>
                    </button>
                    <span className="text-sm font-semibold text-slate-800 tabular-nums px-1">{formatThanksMonthLabel(month)}</span>
                    <button type="button" onClick={() => changeMonth(shiftThanksMonth(month, 1))} className={iconButtonClass} aria-label="次の月">
                        <span>次の月</span>
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => changeMonth(thisMonth)} className={monthButtonClass(month === thisMonth)}>
                        今月
                    </button>
                    {loading && shown && <Loader2 className="w-4 h-4 animate-spin text-slate-400" aria-label="更新中" />}
                </div>
            </div>

            {shown === null ? (
                failed && !loading ? (
                    <div className="px-4 pb-4 text-center">
                        <p className="text-sm text-slate-500">「ありがとう」を読めませんでした</p>
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => load()}>
                            読み直す
                        </Button>
                    </div>
                ) : (
                    <p className="px-4 pb-4 text-sm text-slate-500 text-center">読み込み中…</p>
                )
            ) : (
                <div className="pb-2">
                    {/* 送る */}
                    <div className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {shown.active ? (
                            <>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    leftIcon={<Heart className="w-4 h-4" />}
                                    onClick={() => setSendOpen(true)}
                                    disabled={busy || shown.remainingToday <= 0}
                                >
                                    ありがとうを送る
                                </Button>
                                <span className="text-xs text-slate-500">{remainingTodayLabel(shown.remainingToday, shown.dailyLimit)}</span>
                            </>
                        ) : (
                            <span className="text-xs text-slate-500">『ありがとう』は、今は使っていません</span>
                        )}
                    </div>

                    {/* もらった */}
                    <div className="border-t border-slate-100">
                        <h3 className="px-4 pt-3 pb-1 text-sm font-semibold text-slate-800">
                            {receivedHeadingLabel(shown.received.length, shown.showPoints ? shown.receivedPoints : null)}
                        </h3>
                        {shown.received.length === 0 ? (
                            <p className="px-4 pb-3 text-sm text-slate-500">この月は、まだありません</p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {shown.received.map((r) => (
                                    <li key={r.id} className="flex items-start gap-2 px-4 py-2.5 text-sm">
                                        <span className="shrink-0 w-11 text-slate-500 tabular-nums">{formatShortDate(r.date)}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="break-words text-slate-900">{r.fromUserName}さんから</p>
                                            {r.message && <p className="mt-0.5 break-words whitespace-pre-wrap text-slate-600">{r.message}</p>}
                                        </div>
                                        {shown.showPoints && r.points !== null && (
                                            <span className="shrink-0 text-slate-900 tabular-nums">+{r.points}点</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* 送った */}
                    <div className="border-t border-slate-100">
                        <h3 className="px-4 pt-3 pb-1 text-sm font-semibold text-slate-800">{sentHeadingLabel(shown.sent.length)}</h3>
                        {shown.sent.length === 0 ? (
                            <p className="px-4 pb-3 text-sm text-slate-500">この月は、まだありません</p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {shown.sent.map((r) => (
                                    <li key={r.id} className="flex items-start gap-2 px-4 py-2.5 text-sm">
                                        <span className="shrink-0 w-11 text-slate-500 tabular-nums">{formatShortDate(r.date)}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="break-words text-slate-900">{r.toUserName}さんへ</p>
                                            {r.message && <p className="mt-0.5 break-words whitespace-pre-wrap text-slate-600">{r.message}</p>}
                                        </div>
                                        {r.canRemove && (
                                            <Button size="sm" variant="dangerOutline" className="shrink-0" onClick={() => handleRemove(r)} disabled={busy}>
                                                取り消す
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* 相手・今日送った相手は月に関係しない（今日の分）ので、いちばん新しい答えを使う */}
            {data && (
                <EvaluationThanksSendModal
                    isOpen={sendOpen}
                    recipients={data.recipients}
                    sentTodayToIds={data.sentTodayToIds}
                    busy={busy}
                    onClose={() => setSendOpen(false)}
                    onSubmit={handleSend}
                />
            )}
        </section>
    );
}
