'use client';

/**
 * 「評価ポイント」の画面 — 管理者・マネージャー（docs/指示書_評価ポイント.md の 7-3）。
 *
 *  1. 見出し・期間（開始日〜終了日・「今月」「先月」。初期値は今月）
 *  2. 「記録を足す」「CSV（明細）」「CSV（集計）」
 *  3. 確認待ちの帯（GET /records?status=pending ＝全期間。1件以上のときだけ）
 *  4. 集計の表（GET /summary）
 *  5. 人の行を押すと、その人の明細
 *  6. 記録を足す
 *  7. 記録が1件も無い期間は「この期間の記録はありません」
 *  8. 保存・取り消し・確認のあとは読み直して evaluation_points_updated を送る。受けたら読み直す
 *
 * 決まりごと（だれが取り消せる・認められるか）はサーバーが canRemove・canConfirm で返す。画面で決め直さない。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Download, Loader2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import { todayJstDateKey } from '@/lib/evaluationPoints';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import EvaluationPointsSummaryTable from './EvaluationPointsSummaryTable';
import EvaluationPointPersonModal from './EvaluationPointPersonModal';
import EvaluationPointPendingModal from './EvaluationPointPendingModal';
import EvaluationPointAddModal, { type AddRecordInput } from './EvaluationPointAddModal';
import {
    EVALUATION_POINTS_API,
    EVALUATION_POINTS_UPDATED_EVENT,
    errorMessageOf,
    filenameOf,
    monthRangeOf,
    type ItemOption,
    type PointRecord,
    type SummaryData,
    type SummaryPerson,
} from './evaluationPointsClient';

const dateInputClass =
    'h-9 px-2 border border-slate-200 rounded-xl text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500';

export default function EvaluationPointsManagerView() {
    const { data: session } = useSession();
    const currentUserId = session?.user?.id ?? '';

    // ---- 期間（初期値は今月の1日〜末日）
    const [startDate, setStartDate] = useState(() => monthRangeOf(todayJstDateKey()).startDate);
    const [endDate, setEndDate] = useState(() => monthRangeOf(todayJstDateKey()).endDate);
    const periodValid = !!startDate && !!endDate && startDate <= endDate;

    // ---- 読んだもの
    const [summary, setSummary] = useState<SummaryData | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryFailed, setSummaryFailed] = useState(false);
    const [pending, setPending] = useState<PointRecord[]>([]);
    const [items, setItems] = useState<ItemOption[]>([]);
    const [itemsFailed, setItemsFailed] = useState(false);
    /** 開いている明細を読み直させる数 */
    const [reloadKey, setReloadKey] = useState(0);

    // ---- 開いているもの
    const [selectedPerson, setSelectedPerson] = useState<SummaryPerson | null>(null);
    const [pendingOpen, setPendingOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);

    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [downloading, setDownloading] = useState<'detail' | 'summary' | null>(null);

    // 古い読み込みの答えを捨てるための連番
    const summarySeqRef = useRef(0);
    const pendingSeqRef = useRef(0);

    const fetchSummary = useCallback(async () => {
        if (!periodValid) return;
        const seq = ++summarySeqRef.current;
        setSummaryLoading(true);
        try {
            const params = new URLSearchParams({ startDate, endDate });
            const res = await fetch(`${EVALUATION_POINTS_API}/summary?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessageOf(res, `HTTP ${res.status}`));
            const data = (await res.json()) as SummaryData;
            if (seq !== summarySeqRef.current) return;
            setSummary(data);
            setSummaryFailed(false);
        } catch (e) {
            if (seq !== summarySeqRef.current) return;
            logger.error('評価ポイントの集計の取得に失敗:', e);
            setSummaryFailed(true);
            toast.error('評価ポイントの集計の取得に失敗しました');
        } finally {
            if (seq === summarySeqRef.current) setSummaryLoading(false);
        }
    }, [periodValid, startDate, endDate]);

    /** 確認待ち（期間を付けない＝全期間） */
    const fetchPending = useCallback(async () => {
        const seq = ++pendingSeqRef.current;
        try {
            const res = await fetch(`${EVALUATION_POINTS_API}/records?status=pending`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as { records: PointRecord[] };
            if (seq !== pendingSeqRef.current) return;
            setPending(body.records ?? []);
        } catch (e) {
            // 帯が出ないだけで、表は使える（トーストは集計の失敗のほうで出す）
            logger.error('評価ポイントの確認待ちの取得に失敗:', e);
        }
    }, []);

    /** 「記録を足す」の項目（GET /items は配列そのものを返す） */
    const fetchItems = useCallback(async () => {
        try {
            const res = await fetch(`${EVALUATION_POINTS_API}/items`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setItems((await res.json()) as ItemOption[]);
            setItemsFailed(false);
        } catch (e) {
            logger.error('評価ポイントの項目の取得に失敗:', e);
            setItemsFailed(true);
        }
    }, []);

    /** 表・確認待ち・開いている明細を読み直す */
    const reloadLists = useCallback(() => {
        fetchSummary();
        fetchPending();
        setReloadKey((k) => k + 1);
    }, [fetchSummary, fetchPending]);

    useEffect(() => {
        fetchSummary();
    }, [fetchSummary]);

    useEffect(() => {
        fetchPending();
        fetchItems();
    }, [fetchPending, fetchItems]);

    // ほかの端末・「出勤簿入力」・設定のタブで変わったら読み直す（呼ばないと、送っても届かない）
    const reloadListsRef = useRef(reloadLists);
    reloadListsRef.current = reloadLists;
    useEffect(() => {
        initBroadcastChannel();
        const cleanup = onBroadcast(EVALUATION_POINTS_UPDATED_EVENT, () => {
            reloadListsRef.current();
            fetchItems();
        });
        return cleanup;
    }, [fetchItems]);

    /**
     * 保存の共通の流れ: 送る → 失敗ならサーバーの文言をトースト → 成功なら知らせて読み直す。
     * 成功したら true。
     */
    const mutate = async (url: string, init: RequestInit, successMessage: string, failMessage: string): Promise<{ ok: boolean; body?: unknown }> => {
        if (busyRef.current) return { ok: false };
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(url, {
                ...init,
                headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
            });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, failMessage));
                // 断られた理由が「状態が変わっている」のこともあるので、今の状態を読み直す
                reloadLists();
                return { ok: false };
            }
            const body = await res.json().catch(() => null);
            if (successMessage) toast.success(successMessage);
            sendBroadcast(EVALUATION_POINTS_UPDATED_EVENT, {});
            reloadLists();
            return { ok: true, body };
        } catch (e) {
            logger.error('評価ポイントの保存に失敗:', e);
            toast.error(failMessage);
            return { ok: false };
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // ---- 記録を足す
    const handleAdd = async (input: AddRecordInput): Promise<boolean> => {
        const result = await mutate(
            `${EVALUATION_POINTS_API}/records`,
            { method: 'POST', body: JSON.stringify({ userId: input.userId, date: input.date, itemId: input.itemId, note: input.note }) },
            '',
            '記録の保存に失敗しました',
        );
        if (result.ok) {
            const record = (result.body as { record?: PointRecord } | null)?.record;
            toast.success(record?.status === 'pending' ? '確認待ちで保存しました' : '記録を保存しました');
        }
        return result.ok;
    };

    // ---- 取り消す（確認は呼ぶ側で挟む）
    const handleRemove = async (record: PointRecord): Promise<boolean> => {
        const result = await mutate(
            `${EVALUATION_POINTS_API}/records/${encodeURIComponent(record.id)}`,
            { method: 'DELETE' },
            '記録を取り消しました',
            '記録の取り消しに失敗しました',
        );
        return result.ok;
    };

    // ---- 認める
    const handleConfirm = async (ids: string[]): Promise<boolean> => {
        if (ids.length === 0) return false;
        const result = await mutate(
            `${EVALUATION_POINTS_API}/records`,
            { method: 'PATCH', body: JSON.stringify({ action: 'confirm', ids }) },
            '',
            '確認に失敗しました',
        );
        if (result.ok) {
            const body = result.body as { confirmed?: number; skipped?: number } | null;
            const confirmed = body?.confirmed ?? 0;
            const skipped = body?.skipped ?? 0;
            if (confirmed > 0) toast.success(`${confirmed}件を認めました`);
            if (skipped > 0) toast(`${skipped}件は認められませんでした（すでに確定・取り消し済み）`);
        }
        return result.ok;
    };

    // ---- CSV
    const handleDownload = async (type: 'detail' | 'summary') => {
        if (!periodValid) {
            toast.error('期間を正しく入れてください');
            return;
        }
        if (downloading) return;
        setDownloading(type);
        try {
            const params = new URLSearchParams({ startDate, endDate, type });
            const res = await fetch(`${EVALUATION_POINTS_API}/export?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, 'CSV の出力に失敗しました'));
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filenameOf(res, `evaluation_points_${type}_${startDate}_${endDate}.csv`);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            logger.error('評価ポイントの CSV の出力に失敗:', e);
            toast.error('CSV の出力に失敗しました');
        } finally {
            setDownloading(null);
        }
    };

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

    const noRecords = summary !== null && summary.totals.totalCount + summary.totals.pendingCount === 0;

    return (
        <div className="flex flex-col gap-3 max-w-[1800px] w-full mx-auto h-full min-h-0">
            {/* 1. 見出し・期間 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h1 className="text-xl font-bold text-slate-900">評価ポイント</h1>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex items-center gap-1.5">
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className={dateInputClass}
                            aria-label="開始日"
                        />
                        <span className="text-slate-500 text-sm">〜</span>
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
                </div>
            </div>
            {!periodValid && <p className="text-sm text-red-600">開始日は終了日以前の日付にしてください</p>}

            {/* 2. ボタン */}
            <div className="flex items-center gap-2 flex-wrap">
                <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setAddOpen(true)} disabled={!summary}>
                    記録を足す
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Download className="w-4 h-4" />}
                    onClick={() => handleDownload('detail')}
                    isLoading={downloading === 'detail'}
                    disabled={!periodValid || downloading !== null}
                >
                    CSV（明細）
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Download className="w-4 h-4" />}
                    onClick={() => handleDownload('summary')}
                    isLoading={downloading === 'summary'}
                    disabled={!periodValid || downloading !== null}
                >
                    CSV（集計）
                </Button>
            </div>

            {/* 3. 確認待ちの帯（全期間） */}
            {pending.length > 0 && (
                <button
                    type="button"
                    onClick={() => setPendingOpen(true)}
                    className="w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
                >
                    <span className="font-semibold">確認待ち {pending.length}件</span>
                    <span className="text-xs">押すと一覧が開きます</span>
                </button>
            )}

            {/* 4. 集計の表 */}
            <div className="flex-1 min-h-0 overflow-auto">
                {summary === null ? (
                    summaryFailed ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                            <p className="text-slate-500">評価ポイントの集計を読めませんでした</p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchSummary()}>
                                読み直す
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full py-12">
                            <Loading text="評価ポイントを読み込み中..." />
                        </div>
                    )
                ) : (
                    <div className="relative flex flex-col gap-3">
                        {summaryLoading && (
                            <div className="sticky top-2 z-30 flex justify-center pointer-events-none">
                                <div className="inline-flex items-center gap-1.5 bg-white/95 border border-slate-200 rounded-full shadow px-3 py-1 text-xs text-slate-600">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    更新中...
                                </div>
                            </div>
                        )}
                        <EvaluationPointsSummaryTable data={summary} onSelectPerson={setSelectedPerson} />
                        {/* 7. 記録が1件も無い期間 */}
                        {noRecords && <p className="text-sm text-slate-500 text-center py-4">この期間の記録はありません</p>}
                        <p className="text-xs text-slate-400">
                            合計に入るのは「確定」の記録だけです。セルにマウスを乗せると点数の合計が出ます。人の行を押すと明細が開きます。
                        </p>
                    </div>
                )}
            </div>

            {/* 5. その人の明細 */}
            <EvaluationPointPersonModal
                person={selectedPerson}
                startDate={summary?.startDate ?? startDate}
                endDate={summary?.endDate ?? endDate}
                reloadKey={reloadKey}
                busy={busy}
                onClose={() => setSelectedPerson(null)}
                onRemove={handleRemove}
            />

            {/* 3. 確認待ちの一覧 */}
            <EvaluationPointPendingModal
                isOpen={pendingOpen}
                records={pending}
                busy={busy}
                onClose={() => setPendingOpen(false)}
                onConfirm={handleConfirm}
                onRemove={handleRemove}
            />

            {/* 6. 記録を足す */}
            <EvaluationPointAddModal
                isOpen={addOpen}
                people={summary?.eligiblePeople ?? []}
                items={items}
                itemsFailed={itemsFailed}
                currentUserId={currentUserId}
                busy={busy}
                onClose={() => setAddOpen(false)}
                onSubmit={handleAdd}
            />
        </div>
    );
}
