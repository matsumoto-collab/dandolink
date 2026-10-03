'use client';

/**
 * 設定 ＞「評価ポイント」タブ（管理者だけ）。docs/指示書_評価ポイント.md の 7-1。
 *
 * 点数表（項目と点数）を作る・直す画面。決まりごとは lib/evaluationPoints.ts、保存は /api/evaluation-points/items 以下。
 * Phase 4 で、このタブの下に「本人への表示」の欄を足す（EvaluationPointSettings の中に section を1つ足すだけで済む形にしてある）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, sendBroadcast } from '@/lib/broadcastChannel';
import {
    EVALUATION_POINT_DESCRIPTION_MAX,
    EVALUATION_POINT_MAX,
    EVALUATION_POINT_MIN,
    EVALUATION_POINT_NAME_MAX,
    isValidPoints,
    todayJstDateKey,
    type EvaluationPointInputBy,
} from '@/lib/evaluationPoints';

// ---------------------------------------------------------------- API の形

interface PointItem {
    id: string;
    name: string;
    description: string | null;
    inputBy: string;
    isActive: boolean;
    sortOrder: number;
    currentPoints: number | null;
    upcomingRates: { id: string; points: number; effectiveFrom: string }[];
    recordCount: number;
}

interface RateHistoryRow {
    id: string;
    points: number;
    effectiveFrom: string;
    createdByName: string;
    createdAt: string;
    state: 'upcoming' | 'current' | 'past';
}

const ITEMS_URL = '/api/evaluation-points/items';

const INPUT_BY_LABEL: Record<EvaluationPointInputBy, string> = {
    foreman: '職長も付けられる',
    admin: '管理者・マネージャーだけ',
};
const inputByLabel = (value: string) => INPUT_BY_LABEL[value as EvaluationPointInputBy] ?? value;

const STATE_LABEL: Record<RateHistoryRow['state'], string> = {
    current: '今の点数',
    upcoming: '予約',
    past: '以前',
};

const inputClass =
    'w-full min-w-0 px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500';

// ---------------------------------------------------------------- 小さな部品

/** 'YYYY-MM-DD' → 「10月4日」 */
function formatMonthDay(dateKey: string): string {
    const [, m, d] = dateKey.split('-');
    return `${Number(m)}月${Number(d)}日`;
}

/** ISO の日時 → 日本時間の「2026-10-03 12:34」 */
function formatJstDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(d);
}

/** 点数の入力欄の文字 → 点数。数字以外・範囲外は null（保存の前に画面で止める） */
function parsePointsText(text: string): number | null {
    const s = text.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return isValidPoints(n) ? n : null;
}

/** 失敗した応答から、画面に出す文言を取り出す（error。無ければ文字列の details） */
async function errorMessageOf(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { error?: unknown; details?: unknown };
        if (typeof body.details === 'string' && body.details && body.error === 'Validation Error') return body.details;
        if (typeof body.error === 'string' && body.error) return body.error;
        if (typeof body.details === 'string' && body.details) return body.details;
    } catch {
        // 本文が JSON でない
    }
    return fallback;
}

/**
 * 点数の入力（数字を直接打てる欄 ＋ −／＋）。
 * input[type=number] はスマホで空にするとリセットされる事故があったので使わない。
 */
function PointsInput({ value, onChange, id, disabled }: { value: string; onChange: (v: string) => void; id?: string; disabled?: boolean }) {
    const step = (delta: number) => {
        const current = parsePointsText(value) ?? 0;
        const next = Math.min(EVALUATION_POINT_MAX, Math.max(EVALUATION_POINT_MIN, current + delta));
        onChange(String(next));
    };
    const invalid = value.trim() !== '' && parsePointsText(value) === null;
    return (
        <div className="flex items-center gap-1.5">
            <button
                type="button"
                onClick={() => step(-1)}
                disabled={disabled}
                aria-label="1点減らす"
                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
                <Minus className="w-4 h-4" />
            </button>
            <input
                id={id}
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                placeholder="0"
                aria-invalid={invalid}
                className={`h-10 w-20 px-2 text-center border rounded-xl text-sm focus:outline-none focus:ring-2 ${
                    invalid ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:ring-slate-500'
                }`}
            />
            <button
                type="button"
                onClick={() => step(1)}
                disabled={disabled}
                aria-label="1点増やす"
                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
                <Plus className="w-4 h-4" />
            </button>
            <span className="text-sm text-slate-600">点</span>
        </div>
    );
}

function InputBySelect({ value, onChange, id, disabled }: { value: EvaluationPointInputBy; onChange: (v: EvaluationPointInputBy) => void; id?: string; disabled?: boolean }) {
    return (
        <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value === 'admin' ? 'admin' : 'foreman')}
            disabled={disabled}
            className={inputClass}
        >
            <option value="foreman">{INPUT_BY_LABEL.foreman}</option>
            <option value="admin">{INPUT_BY_LABEL.admin}</option>
        </select>
    );
}

// ---------------------------------------------------------------- 本体

export default function EvaluationPointSettings() {
    return (
        <div className="min-w-0 space-y-10">
            <EvaluationPointItemsSection />
            {/* Phase 4: ここに「本人への表示」の欄を足す */}
        </div>
    );
}

/** 「評価ポイントの項目」の欄（項目の追加・一覧・点数の変更・点数の履歴） */
function EvaluationPointItemsSection() {
    const [items, setItems] = useState<PointItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);

    // 項目を追加
    const [newName, setNewName] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newPoints, setNewPoints] = useState('');
    const [newInputBy, setNewInputBy] = useState<EvaluationPointInputBy>('foreman');

    // 行ごとの開いているフォーム（1度に1つだけ）
    const [openPanel, setOpenPanel] = useState<{ itemId: string; kind: 'edit' | 'rate' | 'history' } | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // 編集
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editInputBy, setEditInputBy] = useState<EvaluationPointInputBy>('foreman');

    // 点数を変える
    const [ratePoints, setRatePoints] = useState('');
    const [rateDate, setRateDate] = useState('');

    // 点数の履歴
    const [history, setHistory] = useState<RateHistoryRow[] | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);

    const fetchItems = useCallback(async () => {
        try {
            const res = await fetch(ITEMS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setItems((await res.json()) as PointItem[]);
            setLoadFailed(false);
        } catch (error) {
            logger.error('Failed to fetch evaluation point items:', error);
            setLoadFailed(true);
            toast.error('評価ポイントの項目の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        // 変更を開いている「出勤簿入力」へ知らせるため（何回呼んでも初期化は1回）
        initBroadcastChannel();
        fetchItems();
    }, [fetchItems]);

    /**
     * 保存の共通の流れ: 送る → 失敗ならサーバーの文言をトースト → 成功なら知らせて一覧を読み直す。
     * 成功したら true。
     */
    const mutate = async (url: string, init: RequestInit, successMessage: string, failMessage: string): Promise<boolean> => {
        if (busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(url, {
                ...init,
                headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
            });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, failMessage));
                return false;
            }
            toast.success(successMessage);
            // 開いている「出勤簿入力」の項目の一覧を読み直させる
            sendBroadcast('evaluation_points_updated', {});
            await fetchItems();
            return true;
        } catch (error) {
            logger.error('Failed to save evaluation point items:', error);
            toast.error(failMessage);
            return false;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // ---- 項目を追加
    const handleAdd = async () => {
        const name = newName.trim();
        if (!name) {
            toast.error('項目名を入れてください');
            return;
        }
        if (name.length > EVALUATION_POINT_NAME_MAX) {
            toast.error(`項目名は${EVALUATION_POINT_NAME_MAX}字までです`);
            return;
        }
        if (newDescription.trim().length > EVALUATION_POINT_DESCRIPTION_MAX) {
            toast.error(`説明は${EVALUATION_POINT_DESCRIPTION_MAX}字までです`);
            return;
        }
        const points = parsePointsText(newPoints);
        if (points === null) {
            toast.error(`点数は${EVALUATION_POINT_MIN}〜${EVALUATION_POINT_MAX}の整数で入れてください`);
            return;
        }
        const ok = await mutate(
            ITEMS_URL,
            { method: 'POST', body: JSON.stringify({ name, description: newDescription.trim(), inputBy: newInputBy, points }) },
            '項目を追加しました',
            '項目の追加に失敗しました',
        );
        if (ok) {
            setNewName('');
            setNewDescription('');
            setNewPoints('');
            setNewInputBy('foreman');
        }
    };

    // ---- 行のフォームを開く・閉じる
    const closePanel = () => {
        setOpenPanel(null);
        setHistory(null);
    };

    const openEdit = (item: PointItem) => {
        setDeleteConfirmId(null);
        setOpenPanel({ itemId: item.id, kind: 'edit' });
        setEditName(item.name);
        setEditDescription(item.description ?? '');
        setEditInputBy(item.inputBy === 'admin' ? 'admin' : 'foreman');
    };

    const openRate = (item: PointItem) => {
        setDeleteConfirmId(null);
        setOpenPanel({ itemId: item.id, kind: 'rate' });
        setRatePoints(item.currentPoints != null ? String(item.currentPoints) : '');
        setRateDate(todayJstDateKey());
    };

    const openHistory = async (item: PointItem) => {
        setDeleteConfirmId(null);
        setOpenPanel({ itemId: item.id, kind: 'history' });
        setHistory(null);
        setHistoryLoading(true);
        try {
            const res = await fetch(`${ITEMS_URL}/${item.id}/rates`, { cache: 'no-store' });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, '点数の履歴の取得に失敗しました'));
                return;
            }
            setHistory((await res.json()) as RateHistoryRow[]);
        } catch (error) {
            logger.error('Failed to fetch evaluation point rates:', error);
            toast.error('点数の履歴の取得に失敗しました');
        } finally {
            setHistoryLoading(false);
        }
    };

    // ---- 編集を保存
    const handleSaveEdit = async (item: PointItem) => {
        const name = editName.trim();
        if (!name) {
            toast.error('項目名を入れてください');
            return;
        }
        if (name.length > EVALUATION_POINT_NAME_MAX) {
            toast.error(`項目名は${EVALUATION_POINT_NAME_MAX}字までです`);
            return;
        }
        if (editDescription.trim().length > EVALUATION_POINT_DESCRIPTION_MAX) {
            toast.error(`説明は${EVALUATION_POINT_DESCRIPTION_MAX}字までです`);
            return;
        }
        const ok = await mutate(
            `${ITEMS_URL}/${item.id}`,
            { method: 'PATCH', body: JSON.stringify({ name, description: editDescription.trim(), inputBy: editInputBy }) },
            '項目を更新しました',
            '項目の更新に失敗しました',
        );
        if (ok) closePanel();
    };

    // ---- 点数を変える
    const handleSaveRate = async (item: PointItem) => {
        const points = parsePointsText(ratePoints);
        if (points === null) {
            toast.error(`点数は${EVALUATION_POINT_MIN}〜${EVALUATION_POINT_MAX}の整数で入れてください`);
            return;
        }
        if (!rateDate) {
            toast.error('適用開始日を入れてください');
            return;
        }
        if (rateDate < todayJstDateKey()) {
            toast.error('適用開始日は、今日以降にしてください');
            return;
        }
        const ok = await mutate(
            `${ITEMS_URL}/${item.id}/rates`,
            { method: 'POST', body: JSON.stringify({ points, effectiveFrom: rateDate }) },
            '点数を変更しました',
            '点数の変更に失敗しました',
        );
        if (ok) closePanel();
    };

    // ---- 予約を取り消す
    const handleCancelRate = async (item: PointItem, rate: PointItem['upcomingRates'][number]) => {
        if (!window.confirm(`「${item.name}」の ${formatMonthDay(rate.effectiveFrom)}からの ${rate.points}点（予約）を取り消しますか？`)) return;
        await mutate(`${ITEMS_URL}/${item.id}/rates/${rate.id}`, { method: 'DELETE' }, '予約を取り消しました', '予約の取り消しに失敗しました');
    };

    // ---- 使う／使わない
    const handleToggleActive = async (item: PointItem) => {
        await mutate(
            `${ITEMS_URL}/${item.id}`,
            { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) },
            item.isActive ? '「使わない」にしました' : '「使う」にしました',
            '更新に失敗しました',
        );
    };

    // ---- 削除（記録が1件も無い項目だけ）
    const handleDelete = async (item: PointItem) => {
        const ok = await mutate(`${ITEMS_URL}/${item.id}`, { method: 'DELETE' }, '項目を削除しました', '項目の削除に失敗しました');
        if (ok) {
            setDeleteConfirmId(null);
            if (openPanel?.itemId === item.id) closePanel();
        }
    };

    // ---- 並べ替え（使用中の項目だけ。使っていない項目は、今の順のまま後ろに付けて送る）
    const activeItems = items.filter((i) => i.isActive);
    const inactiveItems = items.filter((i) => !i.isActive);
    const handleMove = async (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= activeItems.length) return;
        const reordered = [...activeItems];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        await mutate(
            `${ITEMS_URL}/order`,
            { method: 'PUT', body: JSON.stringify({ ids: [...reordered, ...inactiveItems].map((i) => i.id) }) },
            '並び順を変えました',
            '並べ替えに失敗しました',
        );
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
            </div>
        );
    }

    const today = todayJstDateKey();

    const renderRow = (item: PointItem, activeIndex: number | null) => {
        const panel = openPanel?.itemId === item.id ? openPanel.kind : null;
        return (
            <div
                key={item.id}
                className={`p-3 rounded-xl border transition-colors ${
                    item.isActive ? 'bg-white border-slate-200 hover:border-slate-300' : 'bg-slate-50 border-slate-200 opacity-60'
                }`}
            >
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
                    {/* 並べ替え（使用中の項目だけ） */}
                    <div className={`${activeIndex !== null ? 'flex' : 'hidden lg:flex'} lg:flex-col gap-1 shrink-0 lg:w-8`}>
                        {activeIndex !== null && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => handleMove(activeIndex, -1)}
                                    disabled={busy || activeIndex === 0}
                                    aria-label="上へ"
                                    title="上へ"
                                    className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                                >
                                    <ArrowUp className="w-4 h-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleMove(activeIndex, 1)}
                                    disabled={busy || activeIndex === activeItems.length - 1}
                                    aria-label="下へ"
                                    title="下へ"
                                    className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                                >
                                    <ArrowDown className="w-4 h-4" />
                                </button>
                            </>
                        )}
                    </div>

                    {/* 項目名・説明 */}
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 break-words">{item.name}</div>
                        {item.description && <div className="text-sm text-slate-500 break-words mt-0.5">{item.description}</div>}
                    </div>

                    {/* 今の点数・予約 */}
                    <div className="shrink-0 text-sm lg:w-48">
                        <div className="font-semibold text-slate-900">
                            {item.currentPoints != null ? `${item.currentPoints}点` : '点数なし'}
                        </div>
                        {item.upcomingRates.map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-x-2 text-xs text-amber-700 mt-0.5">
                                <span>{formatMonthDay(r.effectiveFrom)}から {r.points}点（予約）</span>
                                <button
                                    type="button"
                                    onClick={() => handleCancelRate(item, r)}
                                    disabled={busy}
                                    className="underline text-slate-600 hover:text-red-600 disabled:opacity-50"
                                >
                                    予約を取り消す
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* 付ける人・使用中か */}
                    <div className="shrink-0 flex flex-wrap items-center gap-1.5 text-xs lg:w-56">
                        <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700">{inputByLabel(item.inputBy)}</span>
                        <span className={`px-2 py-1 rounded-lg ${item.isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-200 text-slate-600'}`}>
                            {item.isActive ? '使用中' : '使わない'}
                        </span>
                    </div>

                    {/* ボタン */}
                    <div className="shrink-0 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => (panel === 'edit' ? closePanel() : openEdit(item))} disabled={busy}>
                            編集
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => (panel === 'rate' ? closePanel() : openRate(item))} disabled={busy}>
                            点数を変える
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => (panel === 'history' ? closePanel() : openHistory(item))} disabled={busy}>
                            点数の履歴
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleToggleActive(item)} disabled={busy}>
                            {item.isActive ? '使わない' : '使う'}
                        </Button>
                        {item.recordCount === 0 && (
                            deleteConfirmId === item.id ? (
                                <span className="inline-flex gap-1.5">
                                    <Button size="sm" variant="danger" onClick={() => handleDelete(item)} disabled={busy}>
                                        削除する
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setDeleteConfirmId(null)} disabled={busy}>
                                        やめる
                                    </Button>
                                </span>
                            ) : (
                                <Button size="sm" variant="dangerOutline" onClick={() => setDeleteConfirmId(item.id)} disabled={busy}>
                                    削除
                                </Button>
                            )
                        )}
                    </div>
                </div>

                {deleteConfirmId === item.id && (
                    <p className="mt-2 text-sm text-red-600">「{item.name}」を削除します。点数の履歴も一緒に消えます。よろしければ「削除する」を押してください。</p>
                )}

                {/* 編集 */}
                {panel === 'edit' && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="block text-sm">
                                <span className="text-slate-700">項目名（{EVALUATION_POINT_NAME_MAX}字まで）</span>
                                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={EVALUATION_POINT_NAME_MAX} className={`${inputClass} mt-1`} />
                            </label>
                            <label className="block text-sm">
                                <span className="text-slate-700">付ける人</span>
                                <div className="mt-1">
                                    <InputBySelect value={editInputBy} onChange={setEditInputBy} />
                                </div>
                            </label>
                        </div>
                        <label className="block text-sm">
                            <span className="text-slate-700">説明（任意。どんなときに付けるか）</span>
                            <textarea
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                maxLength={EVALUATION_POINT_DESCRIPTION_MAX}
                                rows={2}
                                className={`${inputClass} mt-1`}
                            />
                        </label>
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={() => handleSaveEdit(item)} isLoading={busy}>
                                保存
                            </Button>
                            <Button size="sm" variant="outline" onClick={closePanel} disabled={busy}>
                                キャンセル
                            </Button>
                        </div>
                    </div>
                )}

                {/* 点数を変える */}
                {panel === 'rate' && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <div className="flex flex-col md:flex-row md:items-end gap-3">
                            <div className="text-sm">
                                <label htmlFor={`rate-points-${item.id}`} className="block text-slate-700 mb-1">新しい点数</label>
                                <PointsInput id={`rate-points-${item.id}`} value={ratePoints} onChange={setRatePoints} disabled={busy} />
                            </div>
                            <label className="block text-sm">
                                <span className="block text-slate-700 mb-1">適用開始日</span>
                                <input
                                    type="date"
                                    value={rateDate}
                                    min={today}
                                    onChange={(e) => setRateDate(e.target.value)}
                                    className="h-10 px-3 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                />
                            </label>
                        </div>
                        <p className="text-sm text-slate-600">
                            適用開始日より前の日付の記録には、今までの点数が使われます。すでに付いた記録の点数は変わりません。
                        </p>
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={() => handleSaveRate(item)} isLoading={busy}>
                                変更する
                            </Button>
                            <Button size="sm" variant="outline" onClick={closePanel} disabled={busy}>
                                キャンセル
                            </Button>
                        </div>
                    </div>
                )}

                {/* 点数の履歴 */}
                {panel === 'history' && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                        {historyLoading ? (
                            <p className="text-sm text-slate-500">読み込み中…</p>
                        ) : history === null ? (
                            <p className="text-sm text-slate-500">点数の履歴を読めませんでした</p>
                        ) : history.length === 0 ? (
                            <p className="text-sm text-slate-500">点数の履歴はありません</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm bg-white rounded-lg">
                                    <thead>
                                        <tr className="text-left text-slate-600 border-b border-slate-200">
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">適用開始日</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap text-right">点数</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">設定した人</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">設定した日時</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">状態</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((r) => (
                                            <tr key={r.id} className="border-b border-slate-100 last:border-0">
                                                <td className="px-3 py-2 whitespace-nowrap">{r.effectiveFrom}</td>
                                                <td className="px-3 py-2 whitespace-nowrap text-right">{r.points}点</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{r.createdByName || '—'}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{formatJstDateTime(r.createdAt)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-md text-xs ${
                                                            r.state === 'current'
                                                                ? 'bg-teal-50 text-teal-700'
                                                                : r.state === 'upcoming'
                                                                    ? 'bg-amber-50 text-amber-700'
                                                                    : 'bg-slate-100 text-slate-500'
                                                        }`}
                                                    >
                                                        {STATE_LABEL[r.state]}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <section className="min-w-0">
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900">評価ポイントの項目</h3>
                <p className="text-sm text-slate-500 mt-1">
                    現場での行動に付ける項目と点数を決めます。点数を変えても、すでに付いた記録の点数は変わりません。
                </p>
            </div>

            {/* 項目を追加 */}
            <div className="mb-6 p-3 md:p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <h4 className="text-sm font-semibold text-slate-800">項目を追加</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block text-sm">
                        <span className="text-slate-700">項目名（必須・{EVALUATION_POINT_NAME_MAX}字まで）</span>
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            maxLength={EVALUATION_POINT_NAME_MAX}
                            placeholder="例: 洗車"
                            className={`${inputClass} mt-1 bg-white`}
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="text-slate-700">付ける人</span>
                        <div className="mt-1">
                            <InputBySelect value={newInputBy} onChange={setNewInputBy} />
                        </div>
                    </label>
                </div>
                <label className="block text-sm">
                    <span className="text-slate-700">説明（任意。どんなときに付けるか）</span>
                    <textarea
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        maxLength={EVALUATION_POINT_DESCRIPTION_MAX}
                        rows={2}
                        className={`${inputClass} mt-1 bg-white`}
                    />
                </label>
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="text-sm">
                        <label htmlFor="evaluation-point-new-points" className="block text-slate-700 mb-1">点数</label>
                        <PointsInput id="evaluation-point-new-points" value={newPoints} onChange={setNewPoints} disabled={busy} />
                    </div>
                    <Button variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={handleAdd} isLoading={busy}>
                        追加
                    </Button>
                </div>
            </div>

            {/* 項目の一覧（使用中 → 使っていない項目の順） */}
            {loadFailed && items.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    <p>項目を読めませんでした</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchItems()}>
                        読み直す
                    </Button>
                </div>
            ) : items.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    <p>項目が登録されていません</p>
                    <p className="text-sm mt-2">上のフォームから追加してください</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {activeItems.map((item, index) => renderRow(item, index))}
                    {inactiveItems.map((item) => renderRow(item, null))}
                </div>
            )}
        </section>
    );
}
