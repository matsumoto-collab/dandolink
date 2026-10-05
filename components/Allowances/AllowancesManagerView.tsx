'use client';

/**
 * 「手当」の画面 — 管理者・マネージャー（docs/指示書_大規模手当.md の 7-3）。期間ではなく、月で見る。
 *
 *  1. 見出し・月の選択（「前の月」「次の月」・type="month"・「今月」「先月」。初期値は日本時間の今月）
 *  2. 月の状態（締め済み／未締め）と、管理者にだけ「◯月分を締める」「締めを外す」
 *  3. 締め忘れの帯（unclosedPastMonths）
 *  4. 確認待ちの帯（GET /records?status=pending ＝全部の月。1件以上のときだけ）
 *  5. 「記録を足す」「手配と見比べる」「CSV（明細）」「CSV（集計）」
 *  6. 集計の表（GET /summary?month=）
 *  7. 人の行を押すと、その人の明細
 *  8. 記録を足す
 *  9. 手配と見比べる
 * 10. 保存・取り消し・確認・まとめて付ける・締める・締めを外す・金額を直す・単価に戻す のあとは読み直して allowances_updated を送る。受けたら読み直す
 *
 * 決まりごと（だれが取り消せる・認められる・締められるか、区分、金額）は、サーバーが返す値で出し分ける。
 * 「締める」を押せるかどうかの最後の判定もサーバー（断られたら、サーバーの文言を出す）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronLeft, ChevronRight, Download, GitCompare, Loader2, Lock, Unlock, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import { ALLOWANCE_BULK_MAX, isAllowanceAdmin, isMonthEnded, isValidMonthKey, monthKeyOf, todayJstDateKey } from '@/lib/allowances';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import AllowancesSummaryTable from './AllowancesSummaryTable';
import AllowancePersonModal from './AllowancePersonModal';
import AllowancePendingModal from './AllowancePendingModal';
import AllowanceAddModal, { type AddAllowanceInput } from './AllowanceAddModal';
import AllowanceCrosscheckModal from './AllowanceCrosscheckModal';
import {
    ALLOWANCES_API,
    ALLOWANCES_UPDATED_EVENT,
    chunkArray,
    csvFilenameWithCloseState,
    errorMessageOf,
    filenameOf,
    formatJstMonthDay,
    formatMonthLabel,
    formatMonthShort,
    recordsQuery,
    shiftMonth,
    type AllowanceRecordRow,
    type SummaryData,
    type SummaryPerson,
} from './allowancesClient';

const monthInputClass =
    'h-9 px-2 border border-slate-200 rounded-xl text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500';

const currentMonthKey = () => monthKeyOf(todayJstDateKey());

export default function AllowancesManagerView() {
    const { data: session } = useSession();
    const currentUserId = session?.user?.id ?? '';
    const isAdmin = isAllowanceAdmin(session?.user?.role);

    // ---- 見ている月（初期値は日本時間の今月）
    const [month, setMonth] = useState(currentMonthKey);

    // ---- 読んだもの
    const [summary, setSummary] = useState<SummaryData | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryFailed, setSummaryFailed] = useState(false);
    const [pending, setPending] = useState<AllowanceRecordRow[]>([]);
    /** 開いている明細・見比べを読み直させる数 */
    const [reloadKey, setReloadKey] = useState(0);

    // ---- 開いているもの
    const [selectedPerson, setSelectedPerson] = useState<SummaryPerson | null>(null);
    const [pendingOpen, setPendingOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [crosscheckOpen, setCrosscheckOpen] = useState(false);

    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);
    const [downloading, setDownloading] = useState<'detail' | 'summary' | null>(null);

    // 古い読み込みの答えを捨てるための連番
    const summarySeqRef = useRef(0);
    const pendingSeqRef = useRef(0);

    const fetchSummary = useCallback(async () => {
        const seq = ++summarySeqRef.current;
        setSummaryLoading(true);
        try {
            const params = new URLSearchParams({ month });
            const res = await fetch(`${ALLOWANCES_API}/summary?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessageOf(res, `HTTP ${res.status}`));
            const data = (await res.json()) as SummaryData;
            if (seq !== summarySeqRef.current) return;
            setSummary(data);
            setSummaryFailed(false);
        } catch (e) {
            if (seq !== summarySeqRef.current) return;
            logger.error('手当の集計の取得に失敗:', e);
            setSummaryFailed(true);
            toast.error('手当の集計の取得に失敗しました');
        } finally {
            if (seq === summarySeqRef.current) setSummaryLoading(false);
        }
    }, [month]);

    /** 確認待ち（月を付けない＝全部の月） */
    const fetchPending = useCallback(async () => {
        const seq = ++pendingSeqRef.current;
        try {
            const res = await fetch(`${ALLOWANCES_API}/records?${recordsQuery({ status: 'pending' })}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as { records: AllowanceRecordRow[] };
            if (seq !== pendingSeqRef.current) return;
            setPending(body.records ?? []);
        } catch (e) {
            // 帯が出ないだけで、表は使える（トーストは集計の失敗のほうで出す）
            logger.error('手当の確認待ちの取得に失敗:', e);
        }
    }, []);

    /** 表・帯・開いている明細を読み直す */
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
    }, [fetchPending]);

    // ほかの端末・「出勤簿入力」・設定のタブで変わったら読み直す（呼ばないと、送っても届かない）
    const reloadListsRef = useRef(reloadLists);
    reloadListsRef.current = reloadLists;
    useEffect(() => {
        initBroadcastChannel();
        const cleanup = onBroadcast(ALLOWANCES_UPDATED_EVENT, () => {
            reloadListsRef.current();
        });
        return cleanup;
    }, []);

    /** 送ったあとの共通の流れ（成功）: 知らせて読み直す */
    const afterChange = () => {
        sendBroadcast(ALLOWANCES_UPDATED_EVENT, {});
        reloadLists();
    };

    /**
     * 保存の共通の流れ: 送る → 失敗ならサーバーの文言をトースト → 成功なら知らせて読み直す。
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
                // 断られた理由が「状態が変わっている」「締めてある」のこともあるので、今の状態を読み直す
                reloadLists();
                return { ok: false };
            }
            const body = await res.json().catch(() => null);
            if (successMessage) toast.success(successMessage);
            afterChange();
            return { ok: true, body };
        } catch (e) {
            logger.error('手当の保存に失敗:', e);
            toast.error(failMessage);
            return { ok: false };
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // ---- 記録を足す
    const handleAdd = async (input: AddAllowanceInput): Promise<boolean> => {
        const result = await mutate(
            `${ALLOWANCES_API}/records`,
            {
                method: 'POST',
                body: JSON.stringify({ userId: input.userId, date: input.date, itemId: input.itemId, payRole: input.payRole, note: input.note }),
            },
            '',
            '記録の保存に失敗しました',
        );
        if (result.ok) {
            const record = (result.body as { record?: AllowanceRecordRow } | null)?.record;
            toast.success(record?.status === 'pending' ? '確認待ちで保存しました' : '記録を保存しました');
        }
        return result.ok;
    };

    // ---- 取り消す（確認は呼ぶ側で挟む）
    const handleRemove = async (recordId: string): Promise<boolean> => {
        const result = await mutate(
            `${ALLOWANCES_API}/records/${encodeURIComponent(recordId)}`,
            { method: 'DELETE' },
            '記録を取り消しました',
            '記録の取り消しに失敗しました',
        );
        return result.ok;
    };

    // ---- 金額を手で直す（管理者だけ。直せるかはサーバーが返す canEditAmount で出し分ける）
    const handleEditAmount = async (recordId: string, amount: number, note: string): Promise<boolean> => {
        const result = await mutate(
            `${ALLOWANCES_API}/records/${encodeURIComponent(recordId)}`,
            { method: 'PATCH', body: JSON.stringify({ amount, note }) },
            '金額を直しました',
            '金額の保存に失敗しました',
        );
        return result.ok;
    };

    // ---- 手で直した金額を、その日の単価に戻す（確認は呼ぶ側で挟む）
    const handleResetAmount = async (recordId: string): Promise<boolean> => {
        const result = await mutate(
            `${ALLOWANCES_API}/records/${encodeURIComponent(recordId)}`,
            { method: 'PATCH', body: JSON.stringify({ resetAmount: true }) },
            '単価に戻しました',
            '単価に戻すのに失敗しました',
        );
        return result.ok;
    };

    // ---- 認める
    const handleConfirm = async (ids: string[]): Promise<boolean> => {
        if (ids.length === 0) return false;
        const result = await mutate(
            `${ALLOWANCES_API}/records`,
            { method: 'PATCH', body: JSON.stringify({ action: 'confirm', ids }) },
            '',
            '確認に失敗しました',
        );
        if (result.ok) {
            const body = result.body as { confirmed?: number; skipped?: number } | null;
            const confirmed = body?.confirmed ?? 0;
            const skipped = body?.skipped ?? 0;
            if (confirmed > 0) toast.success(`${confirmed}件を認めました`);
            if (skipped > 0) toast(`${skipped}件は認められませんでした（すでに確定・取り消し済み・自分の分・締めた月）`);
        }
        return result.ok;
    };

    // ---- 手配と見比べる: 選んだ分をまとめて付ける（1回に ALLOWANCE_BULK_MAX 件まで。超えるときは分けて送る）
    const handleBulkAdd = async (itemId: string, bulkMonth: string, keys: string[]): Promise<boolean> => {
        if (keys.length === 0 || busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        let added = 0;
        let pendingAdded = 0;
        let skipped = 0;
        let failed = false;
        try {
            for (const chunk of chunkArray(keys, ALLOWANCE_BULK_MAX)) {
                const res = await fetch(`${ALLOWANCES_API}/crosscheck`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ itemId, month: bulkMonth, keys: chunk }),
                });
                if (!res.ok) {
                    toast.error(await errorMessageOf(res, 'まとめて付けるのに失敗しました'));
                    failed = true;
                    break;
                }
                const body = (await res.json().catch(() => null)) as { added?: number; pending?: number; skipped?: number } | null;
                added += body?.added ?? 0;
                pendingAdded += body?.pending ?? 0;
                skipped += body?.skipped ?? 0;
            }
        } catch (e) {
            logger.error('手当をまとめて付けるのに失敗:', e);
            toast.error('まとめて付けるのに失敗しました');
            failed = true;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
        if (added > 0) toast.success(`${added}件付けました${pendingAdded > 0 ? `（うち確認待ち ${pendingAdded}件）` : ''}`);
        if (skipped > 0) toast(`${skipped}件は、もう付いていた などで、付けませんでした`);
        // 途中で断られても、入った分があるかもしれないので、いつも知らせて読み直す
        afterChange();
        return !failed;
    };

    // ---- 月を締める・締めを外す（管理者だけ）
    const handleClose = async () => {
        const ok = window.confirm(
            `${formatMonthLabel(month)}分を締めます。締めると、この月の手当は、足す・取り消す・認めるができなくなります（管理者は締めを外せます）。よろしいですか？`,
        );
        if (!ok) return;
        await mutate(
            `${ALLOWANCES_API}/close`,
            { method: 'POST', body: JSON.stringify({ month, action: 'close' }) },
            `${formatMonthLabel(month)}分を締めました`,
            '締めるのに失敗しました',
        );
    };
    const handleReopen = async () => {
        const ok = window.confirm(
            '締めを外すと、職長もふくめて、この月の手当をまた変えられるようになります。直し終わったら、もう一度締めてください。よろしいですか？',
        );
        if (!ok) return;
        await mutate(
            `${ALLOWANCES_API}/close`,
            { method: 'POST', body: JSON.stringify({ month, action: 'reopen' }) },
            `${formatMonthLabel(month)}分の締めを外しました`,
            '締めを外すのに失敗しました',
        );
    };

    // ---- CSV
    const handleDownload = async (type: 'detail' | 'summary', closed: boolean) => {
        if (downloading) return;
        setDownloading(type);
        try {
            const params = new URLSearchParams({ month, type });
            const res = await fetch(`${ALLOWANCES_API}/export?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, 'CSV の出力に失敗しました'));
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = csvFilenameWithCloseState(filenameOf(res, `allowances_${type}_${month}.csv`), closed);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            logger.error('手当の CSV の出力に失敗:', e);
            toast.error('CSV の出力に失敗しました');
        } finally {
            setDownloading(null);
        }
    };

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

    // 見ている月の集計（月を切り替えた直後は、前の月の集計を出さない）
    const shown = summary && summary.month === month ? summary : null;
    const noRecords = shown !== null && shown.people.length === 0;
    const activeItems = (shown?.items ?? []).filter((i) => i.isActive).map((i) => ({ id: i.id, name: i.name }));

    // 「締める」を押せないときの理由（最後の判定はサーバー）
    const closeBlockedReason = shown && !shown.closed
        ? !isMonthEnded(month)
            ? 'まだ終わっていない月は締められません'
            : shown.totals.pendingCount > 0
                ? `確認待ちが${shown.totals.pendingCount}件あります`
                : null
        : null;

    return (
        <div className="flex flex-col gap-3 max-w-[1800px] w-full mx-auto h-full min-h-0">
            {/* 1. 見出し・月の選択 ／ 2. 月の状態 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-slate-900">手当</h1>
                    {shown &&
                        (shown.closed ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-white">
                                <Lock className="w-3 h-3" />
                                締め済み（{formatJstMonthDay(shown.closed.closedAt)}・{shown.closed.closedByName}）
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-slate-600 border border-slate-300">
                                未締め
                            </span>
                        ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={() => changeMonth(shiftMonth(month, -1))} className={iconButtonClass} aria-label="前の月">
                        <ChevronLeft className="w-4 h-4" />
                        <span className="hidden sm:inline">前の月</span>
                    </button>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => changeMonth(e.target.value)}
                        className={monthInputClass}
                        aria-label="月"
                    />
                    <button type="button" onClick={() => changeMonth(shiftMonth(month, 1))} className={iconButtonClass} aria-label="次の月">
                        <span className="hidden sm:inline">次の月</span>
                        <ChevronRight className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => changeMonth(thisMonth)} className={monthButtonClass(month === thisMonth)}>
                        今月
                    </button>
                    <button type="button" onClick={() => changeMonth(lastMonth)} className={monthButtonClass(month === lastMonth)}>
                        先月
                    </button>
                </div>
            </div>

            {/* 2. 締める・締めを外す（管理者だけ） */}
            {isAdmin && shown && (
                <div className="flex items-center gap-2 flex-wrap">
                    {shown.closed ? (
                        <Button variant="outline" size="sm" leftIcon={<Unlock className="w-4 h-4" />} onClick={handleReopen} disabled={busy}>
                            締めを外す
                        </Button>
                    ) : (
                        <>
                            <Button
                                variant="secondary"
                                size="sm"
                                leftIcon={<Lock className="w-4 h-4" />}
                                onClick={handleClose}
                                disabled={busy || closeBlockedReason !== null}
                            >
                                {formatMonthShort(month)}分を締める
                            </Button>
                            {closeBlockedReason && <span className="text-xs text-slate-500">{closeBlockedReason}</span>}
                        </>
                    )}
                </div>
            )}

            {/* 3. 締め忘れの帯 */}
            {shown && shown.unclosedPastMonths.length > 0 && (
                <div className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-800 space-y-1">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {shown.unclosedPastMonths.map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => changeMonth(m)}
                                className="font-semibold underline underline-offset-2 hover:text-red-900 text-left"
                            >
                                {formatMonthLabel(m)}分が、まだ締められていません
                            </button>
                        ))}
                    </div>
                    <p className="text-xs">
                        給与に付けたら、その月を締めてください（締めるまでは、職長も日付をさかのぼって付けたり取り消したりできます）
                        {!isAdmin && '。管理者に締めてもらってください'}
                    </p>
                </div>
            )}

            {/* 4. 確認待ちの帯（全部の月） */}
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

            {/* 5. ボタン */}
            <div className="flex items-center gap-2 flex-wrap">
                <Button variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setAddOpen(true)} disabled={!shown}>
                    記録を足す
                </Button>
                <Button variant="outline" size="sm" leftIcon={<GitCompare className="w-4 h-4" />} onClick={() => setCrosscheckOpen(true)}>
                    手配と見比べる
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Download className="w-4 h-4" />}
                    onClick={() => shown && handleDownload('detail', !!shown.closed)}
                    isLoading={downloading === 'detail'}
                    disabled={!shown || downloading !== null}
                >
                    CSV（明細）
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Download className="w-4 h-4" />}
                    onClick={() => shown && handleDownload('summary', !!shown.closed)}
                    isLoading={downloading === 'summary'}
                    disabled={!shown || downloading !== null}
                >
                    CSV（集計）
                </Button>
            </div>

            {/* 6. 集計の表 */}
            <div className="flex-1 min-h-0 overflow-auto">
                {shown === null ? (
                    summaryFailed && !summaryLoading ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                            <p className="text-slate-500">手当の集計を読めませんでした</p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchSummary()}>
                                読み直す
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full py-12">
                            <Loading text="手当を読み込み中..." />
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
                        {noRecords ? (
                            <p className="text-sm text-slate-500 text-center py-12 bg-white rounded-xl border border-slate-200">この月の記録はありません</p>
                        ) : (
                            <AllowancesSummaryTable data={shown} onSelectPerson={setSelectedPerson} />
                        )}
                        <p className="text-xs text-slate-400">
                            合計に入るのは「確定」の記録だけです。人の行を押すと明細が開きます。
                        </p>
                    </div>
                )}
            </div>

            {/* 7. その人の明細 */}
            <AllowancePersonModal
                person={selectedPerson}
                month={month}
                reloadKey={reloadKey}
                busy={busy}
                onClose={() => setSelectedPerson(null)}
                onRemove={handleRemove}
                onEditAmount={handleEditAmount}
                onResetAmount={handleResetAmount}
            />

            {/* 4. 確認待ちの一覧 */}
            <AllowancePendingModal
                isOpen={pendingOpen}
                records={pending}
                busy={busy}
                onClose={() => setPendingOpen(false)}
                onConfirm={handleConfirm}
                onRemove={handleRemove}
            />

            {/* 8. 記録を足す */}
            <AllowanceAddModal
                isOpen={addOpen}
                month={month}
                people={shown?.eligiblePeople ?? []}
                items={activeItems}
                currentUserId={currentUserId}
                busy={busy}
                onClose={() => setAddOpen(false)}
                onSubmit={handleAdd}
            />

            {/* 9. 手配と見比べる */}
            <AllowanceCrosscheckModal
                isOpen={crosscheckOpen}
                month={month}
                reloadKey={reloadKey}
                busy={busy}
                onClose={() => setCrosscheckOpen(false)}
                onBulkAdd={handleBulkAdd}
                onRemove={handleRemove}
            />
        </div>
    );
}
