'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarPlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import type { PaymentSchedule } from '@/types/paymentSchedule';
import type { JoyoStatementRow } from '@/types/joyoStatement';
import { errorMessage, formatMdWeek, yen } from './joyoUi';

interface AddJoyoToScheduleModalProps {
    /** 発行済みの明細がある行 */
    row: JoyoStatementRow;
    onClose: () => void;
    /** 追加が成功したあとに一覧（GET）を取り直す */
    onAdded: () => Promise<void>;
}

/** 同じ支払日の既存リスト（listKey ごとのまとまり） */
interface SameDateList {
    listKey: string | null;
    count: number;
    total: number;
    minCreatedAt: string;
}

/** 名前の比べ方: 空白（全角も）を除いて比べる */
const squash = (s: string | null | undefined) => (s ?? '').replace(/[\s　]/g, '');

/**
 * 支払明細書を支払予定に追加するモーダル（指示書 8-4）。
 * components/PaymentSchedules/AddToScheduleModal.tsx の「追加先リスト」にならう。違う点は2つ:
 *   - 支払日は変えられない（明細の支払日。サーバーも明細の支払日を使うので送らない）
 *   - 追加先の初期値は件数のいちばん多い既存リスト（10日の振込リストにまとめて入れることが多いため）
 * 振込先マスターの行はここから作らない（同じ人の行が増えた原因が自動登録とみられるため）。
 */
export default function AddJoyoToScheduleModal({ row, onClose, onAdded }: AddJoyoToScheduleModalProps) {
    const { contractor, statement } = row;
    const payee = contractor.payee;
    const paymentDate = statement?.paymentDate ?? '';
    const total = statement?.total ?? 0;
    // 振込先が無い・利用停止なら追加できない（サーバーも断る）
    const payeeUsable = !!payee && payee.isActive;

    const [sameDateLists, setSameDateLists] = useState<SameDateList[]>([]);
    const [sameDateItems, setSameDateItems] = useState<PaymentSchedule[]>([]);
    const [loadingLists, setLoadingLists] = useState(true);
    // 追加先: 'new'＝新しいリストを作る／それ以外＝sameDateLists のインデックス
    const [targetList, setTargetList] = useState<string>('new');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // 二重押しを防ぐ同期ロック
    const lockRef = useRef(false);

    // 同じ支払日の既存リストを取る（追加先の選択肢と、二重の注意に使う）
    useEffect(() => {
        let cancelled = false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
            setLoadingLists(false);
            return;
        }
        (async () => {
            try {
                const res = await fetch(`/api/payment-schedules?from=${paymentDate}&to=${paymentDate}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`status ${res.status}`);
                const items: PaymentSchedule[] = await res.json();
                const groups = new Map<string, SameDateList>();
                for (const it of items) {
                    const gk = it.listKey ?? '';
                    let g = groups.get(gk);
                    if (!g) {
                        g = { listKey: it.listKey ?? null, count: 0, total: 0, minCreatedAt: it.createdAt };
                        groups.set(gk, g);
                    }
                    g.count += 1;
                    g.total += Number(it.amount);
                    if (it.createdAt < g.minCreatedAt) g.minCreatedAt = it.createdAt;
                }
                const lists = Array.from(groups.values()).sort((a, b) => a.minCreatedAt.localeCompare(b.minCreatedAt));
                if (cancelled) return;
                setSameDateItems(items);
                setSameDateLists(lists);
                // 初期値＝件数のいちばん多い既存リスト（同数なら先に作られたほう）。無ければ新しいリスト
                if (lists.length > 0) {
                    let best = 0;
                    lists.forEach((g, i) => {
                        if (g.count > lists[best].count) best = i;
                    });
                    setTargetList(String(best));
                } else {
                    setTargetList('new');
                }
            } catch (e) {
                logger.error('同じ支払日の支払予定の取得に失敗:', e);
                if (!cancelled) {
                    setSameDateItems([]);
                    setSameDateLists([]);
                    setTargetList('new');
                }
            } finally {
                if (!cancelled) setLoadingLists(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [paymentDate]);

    // 同じ人あてとみられる行（payeeId が同じ／名前が振込先名か宛名と同じ／金額が同じ のどれか）
    const lookalikes = useMemo(() => {
        const names = [squash(payee?.name), squash(contractor.recipientName)].filter((n) => n !== '');
        return sameDateItems.filter((it) => {
            if (payee && it.payeeId && it.payeeId === payee.id) return true;
            const n = squash(it.payeeName);
            if (n !== '' && names.includes(n)) return true;
            return Number(it.amount) === total;
        });
    }, [sameDateItems, payee, contractor.recipientName, total]);

    // Esc で閉じる（下の編集画面まで閉じないよう止める）
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (!lockRef.current) onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const handleSubmit = async () => {
        if (lockRef.current || !statement || !payeeUsable) return;
        lockRef.current = true;
        setSubmitting(true);
        setError(null);
        try {
            const selected = targetList !== 'new' ? sameDateLists[Number(targetList)] : null;
            const res = await fetch(`/api/joyo-statements/${statement.id}/add-to-schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // 支払日は送らない（サーバーが明細の支払日を使う）
                body: JSON.stringify({
                    createNewList: !selected,
                    targetListKey: selected ? selected.listKey : null,
                }),
            });
            if (!res.ok) {
                const msg = await errorMessage(res, '支払予定への追加に失敗しました');
                setError(msg);
                toast.error(msg);
                return;
            }
            toast.success('支払予定に追加しました');
            await onAdded();
            onClose();
        } catch (e) {
            logger.error('支払明細書の支払予定追加に失敗:', e);
            setError('支払予定への追加に失敗しました');
            toast.error('支払予定への追加に失敗しました');
        } finally {
            lockRef.current = false;
            setSubmitting(false);
        }
    };

    if (typeof document === 'undefined') return null;

    // 編集モーダル（z-[100]）・全画面プレビュー（z-[110]）より前に出す
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
            <div className="absolute inset-0" onClick={() => !lockRef.current && onClose()} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="支払予定に追加"
                className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-xl"
            >
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">支払予定に追加</h2>
                    <button type="button" onClick={onClose} disabled={submitting} className="rounded p-1 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5 p-6">
                    {error && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                    )}

                    {/* 追加内容の確認 */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-baseline justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                    <div className="truncate text-base font-semibold text-slate-900">
                                        {payee ? payee.name : '（振込先が登録されていません）'}
                                    </div>
                                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                        振込
                                    </span>
                                </div>
                                {payee?.bankLabel && <div className="mt-0.5 text-xs text-slate-600">{payee.bankLabel}</div>}
                                <div className="mt-0.5 text-xs text-slate-500">
                                    {contractor.recipientName} ／ {row.statement ? `${row.statement.year}年${row.statement.month}月分` : ''}
                                </div>
                            </div>
                            <div className="shrink-0 text-right">
                                <div className="text-xl font-bold text-slate-900">{yen(total)}</div>
                                <div className="mt-0.5 text-xs text-slate-600">支払日 {paymentDate ? formatMdWeek(paymentDate) : '—'}</div>
                            </div>
                        </div>
                        <p className="mt-3 border-t border-slate-200 pt-2.5 text-xs text-slate-500">
                            支払日は明細の支払日です（ここでは変えられません。変えるときは発行を取り消して直してください）。
                        </p>
                    </div>

                    {/* 振込先の注意 */}
                    {!payeeUsable && (
                        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>
                                {payee ? '登録されている振込先が利用停止になっています。' : '振込先が登録されていません。'}
                                『対象者・書類の設定』で振込先を選んでください。
                            </span>
                        </div>
                    )}
                    {payeeUsable && payee && !payee.hasAccount && (
                        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>この振込先には口座が登録されていません。</span>
                        </div>
                    )}

                    {/* 同じ人あてとみられる行 */}
                    {lookalikes.length > 0 && (
                        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>
                                この支払日に、同じ人あてとみられる行がすでにあります（
                                {lookalikes.map((it) => `${it.payeeName} ${yen(Number(it.amount))}`).join('、')}
                                ）。二重にならないか確かめてください。
                            </span>
                        </div>
                    )}

                    {/* 追加先リスト */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">追加先リスト</label>
                        {loadingLists ? (
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                同じ日のリストを読み込んでいます...
                            </div>
                        ) : (
                            <>
                                <select
                                    value={targetList}
                                    onChange={(e) => setTargetList(e.target.value)}
                                    disabled={submitting}
                                    className="w-full rounded border border-slate-300 px-3 py-2"
                                >
                                    {sameDateLists.map((g, i) => (
                                        <option key={i} value={String(i)}>
                                            {`リスト${i + 1}（${g.count}件・合計 ¥${g.total.toLocaleString('ja-JP')}）に追加`}
                                        </option>
                                    ))}
                                    <option value="new">新しいリストを作る</option>
                                </select>
                                <p className="mt-1 text-xs text-slate-500">
                                    {sameDateLists.length > 0
                                        ? '同じ支払日のリストがあります。件数のいちばん多いリストを選んであります。'
                                        : 'この支払日のリストはまだありません。新しいリストを作ります。'}
                                </p>
                            </>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={handleSubmit}
                            isLoading={submitting}
                            disabled={!payeeUsable || !statement || loadingLists}
                            leftIcon={<CalendarPlus className="h-4 w-4" />}
                        >
                            支払予定に追加
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
