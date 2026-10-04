'use client';

/**
 * 設定 ＞「手当」タブ（管理者だけ）。docs/指示書_大規模手当.md の 7-1。
 *
 * 手当（今は「大規模手当」の1つ）の、名前・説明・使う／使わない・金額（適用開始日つきの履歴）を扱う画面。
 * その下に「本人への表示」の欄（公開の設定）。保存は /api/allowances/items 以下と /api/allowances/settings。
 *
 * 決まりごと（金額を足してよいか・どの金額を使うか・状態）はサーバーが決める。画面は API が返す値で出し分けるだけ。
 * 作りは components/Settings/EvaluationPointSettings.tsx（評価ポイントの設定タブ）に合わせてある。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, sendBroadcast } from '@/lib/broadcastChannel';
import { normalizeConstructionContent } from '@/lib/constructionContent';
import {
    ALLOWANCE_AMOUNT_MAX,
    ALLOWANCE_AMOUNT_MIN,
    ALLOWANCE_DESCRIPTION_MAX,
    ALLOWANCE_NAME_MAX,
    ALLOWANCE_NOTE_MAX,
    ALLOWANCES_UPDATED_EVENT,
    todayJstDateKey,
} from '@/lib/allowances';
import { allowanceRateWarnings, type AllowanceRateWarning } from '@/lib/allowanceRateWarnings';

// ---------------------------------------------------------------- API の形

interface AllowanceItem {
    id: string;
    name: string;
    description: string | null;
    constructionContent: string;
    isActive: boolean;
    sortOrder: number;
    startDate: string | null;
    current: { foremanAmount: number; memberAmount: number } | null;
    upcomingRates: { id: string; foremanAmount: number; memberAmount: number; effectiveFrom: string }[];
    recordCount: number;
}

interface RateHistoryRow {
    id: string;
    foremanAmount: number;
    memberAmount: number;
    effectiveFrom: string;
    createdByName: string;
    createdAt: string;
    state: 'upcoming' | 'current' | 'past';
    replaced: boolean;
}

const ITEMS_URL = '/api/allowances/items';
const SETTINGS_URL = '/api/allowances/settings';
const CONSTRUCTION_CONTENTS_URL = '/api/master-data/construction-contents';

const STATE_LABEL: Record<RateHistoryRow['state'], string> = {
    current: '今の金額',
    upcoming: '予約',
    past: '以前',
};

const inputClass =
    'w-full min-w-0 px-3 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500';

// ---------------------------------------------------------------- 小さな部品

/** 金額 → 「1,500円」 */
function yen(amount: number): string {
    return `${amount.toLocaleString('ja-JP')}円`;
}

/** 'YYYY-MM-DD' → 「10月4日」 */
function formatMonthDay(dateKey: string): string {
    const [, m, d] = dateKey.split('-');
    return `${Number(m)}月${Number(d)}日`;
}

/** 'YYYY-MM-DD' → 「2026年9月1日」 */
function formatYearMonthDay(dateKey: string): string {
    const [y, m, d] = dateKey.split('-');
    return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

/** ISO の日時 → 日本時間の「2026-10-03 12:34」 */
function formatJstDateTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(d);
}

/** 金額の入力欄の文字 → 金額。数字以外・0〜100,000 の外は null（保存の前に画面で止める） */
function parseAmountText(text: string): number | null {
    const s = text.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < ALLOWANCE_AMOUNT_MIN || n > ALLOWANCE_AMOUNT_MAX) return null;
    return n;
}

/**
 * 失敗した応答から、画面に出す文言を取り出す。
 * 400・403・404 はサーバーの文言（error。無ければ文字列の details）をそのまま出す。それ以外は fallback。
 */
async function errorMessageOf(res: Response, fallback: string): Promise<string> {
    if (res.status !== 400 && res.status !== 403 && res.status !== 404) return fallback;
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

/** 金額の入力（数字を直接打てる欄。input[type=number] はスマホで空にするとリセットされる事故があったので使わない） */
function AmountInput({ value, onChange, id, disabled }: { value: string; onChange: (v: string) => void; id?: string; disabled?: boolean }) {
    const invalid = value.trim() !== '' && parseAmountText(value) === null;
    return (
        <div className="flex items-center gap-1.5">
            <input
                id={id}
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                placeholder="0"
                aria-invalid={invalid}
                className={`h-10 w-28 px-3 text-right border rounded-xl text-sm focus:outline-none focus:ring-2 ${
                    invalid ? 'border-red-400 focus:ring-red-400' : 'border-slate-300 focus:ring-slate-500'
                }`}
            />
            <span className="text-sm text-slate-600">円</span>
        </div>
    );
}

// ---------------------------------------------------------------- 本体

export default function AllowanceSettings() {
    return (
        <div className="min-w-0 space-y-10">
            <AllowanceItemsSection />
            <AllowanceVisibilitySection />
        </div>
    );
}

/** 「金額を変える」の確認のモーダルに出す中身 */
interface RateConfirm {
    item: AllowanceItem;
    foremanAmount: number;
    memberAmount: number;
    effectiveFrom: string;
    warnings: AllowanceRateWarning[];
}

/** 手当の一覧（編集・使う／使わない・金額を変える・金額の履歴） */
function AllowanceItemsSection() {
    const [items, setItems] = useState<AllowanceItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    // 使用中の工事内容の名前（normalizeConstructionContent を通したもの）。読めなかったときは null（注意を出さない）
    const [contentNames, setContentNames] = useState<Set<string> | null>(null);

    // 古い読み込みの答えを捨てるための連番
    const itemsSeqRef = useRef(0);
    const contentsSeqRef = useRef(0);
    const historySeqRef = useRef(0);

    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);

    // 行ごとの開いているフォーム（1度に1つだけ）
    const [openPanel, setOpenPanel] = useState<{ itemId: string; kind: 'edit' | 'rate' | 'history' } | null>(null);

    // 編集
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');

    // 金額を変える
    const [rateForeman, setRateForeman] = useState('');
    const [rateMember, setRateMember] = useState('');
    const [rateDate, setRateDate] = useState('');
    const [rateConfirm, setRateConfirm] = useState<RateConfirm | null>(null);

    // 金額の履歴
    const [history, setHistory] = useState<RateHistoryRow[] | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);

    const fetchItems = useCallback(async () => {
        const seq = ++itemsSeqRef.current;
        try {
            const res = await fetch(ITEMS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as AllowanceItem[];
            if (seq !== itemsSeqRef.current) return;
            setItems(body);
            setLoadFailed(false);
        } catch (error) {
            if (seq !== itemsSeqRef.current) return;
            logger.error('Failed to fetch allowance items:', error);
            setLoadFailed(true);
            toast.error('手当の取得に失敗しました');
        } finally {
            if (seq === itemsSeqRef.current) setIsLoading(false);
        }
    }, []);

    /** 工事内容の名前の確かめ用。読めなかったときは注意を出さない（null のまま） */
    const fetchConstructionContents = useCallback(async () => {
        const seq = ++contentsSeqRef.current;
        try {
            const res = await fetch(CONSTRUCTION_CONTENTS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body: unknown = await res.json();
            if (seq !== contentsSeqRef.current) return;
            if (!Array.isArray(body)) {
                setContentNames(null);
                return;
            }
            const names = new Set<string>();
            for (const row of body) {
                const name = typeof row === 'object' && row !== null ? (row as { name?: unknown }).name : null;
                const normalized = typeof name === 'string' ? normalizeConstructionContent(name) : null;
                if (normalized) names.add(normalized);
            }
            setContentNames(names);
        } catch (error) {
            if (seq !== contentsSeqRef.current) return;
            logger.error('Failed to fetch construction contents:', error);
            setContentNames(null);
        }
    }, []);

    const fetchHistory = useCallback(async (itemId: string) => {
        const seq = ++historySeqRef.current;
        setHistoryLoading(true);
        try {
            const res = await fetch(`${ITEMS_URL}/${itemId}/rates`, { cache: 'no-store' });
            if (!res.ok) {
                const message = await errorMessageOf(res, '金額の履歴の取得に失敗しました');
                if (seq === historySeqRef.current) toast.error(message);
                return;
            }
            const body = (await res.json()) as RateHistoryRow[];
            if (seq !== historySeqRef.current) return;
            setHistory(body);
        } catch (error) {
            if (seq !== historySeqRef.current) return;
            logger.error('Failed to fetch allowance rates:', error);
            toast.error('金額の履歴の取得に失敗しました');
        } finally {
            if (seq === historySeqRef.current) setHistoryLoading(false);
        }
    }, []);

    useEffect(() => {
        // 変更を開いている「出勤簿入力」と「手当」の画面へ知らせるため（何回呼んでも初期化は1回）
        initBroadcastChannel();
        fetchItems();
        fetchConstructionContents();
    }, [fetchItems, fetchConstructionContents]);

    /**
     * 保存の共通の流れ: 送る → 失敗ならサーバーの文言をトースト → 成功なら知らせて一覧を読み直す。
     * 成功したら応答の本文（JSON で読めなければ {}）、失敗したら null。成功のトーストは呼ぶ側で出す。
     */
    const mutate = async (url: string, init: RequestInit, failMessage: string): Promise<Record<string, unknown> | null> => {
        if (busyRef.current) return null;
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(url, {
                ...init,
                headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
            });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, failMessage));
                return null;
            }
            const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
            // 開いている「出勤簿入力」と「手当」の画面を読み直させる
            sendBroadcast(ALLOWANCES_UPDATED_EVENT, {});
            await fetchItems();
            return body;
        } catch (error) {
            logger.error('Failed to save allowance items:', error);
            toast.error(failMessage);
            return null;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // ---- 行のフォームを開く・閉じる
    const closePanel = () => {
        historySeqRef.current++;
        setOpenPanel(null);
        setHistory(null);
        setHistoryLoading(false);
    };

    const openEdit = (item: AllowanceItem) => {
        closePanel();
        setOpenPanel({ itemId: item.id, kind: 'edit' });
        setEditName(item.name);
        setEditDescription(item.description ?? '');
    };

    const openRate = (item: AllowanceItem) => {
        closePanel();
        setOpenPanel({ itemId: item.id, kind: 'rate' });
        setRateForeman(item.current ? String(item.current.foremanAmount) : '');
        setRateMember(item.current ? String(item.current.memberAmount) : '');
        setRateDate(todayJstDateKey());
    };

    const openHistory = (item: AllowanceItem) => {
        closePanel();
        setOpenPanel({ itemId: item.id, kind: 'history' });
        void fetchHistory(item.id);
    };

    // ---- 編集（名前・説明）を保存
    const handleSaveEdit = async (item: AllowanceItem) => {
        const name = editName.trim();
        if (!name || name.length > ALLOWANCE_NAME_MAX) {
            toast.error(`名前は1〜${ALLOWANCE_NAME_MAX}字で入れてください`);
            return;
        }
        if (editDescription.trim().length > ALLOWANCE_DESCRIPTION_MAX) {
            toast.error(`説明は${ALLOWANCE_DESCRIPTION_MAX}字までの文字で入れてください`);
            return;
        }
        const body = await mutate(
            `${ITEMS_URL}/${item.id}`,
            { method: 'PATCH', body: JSON.stringify({ name, description: editDescription.trim() }) },
            '手当の更新に失敗しました',
        );
        if (body) {
            toast.success('手当を更新しました');
            closePanel();
        }
    };

    // ---- 使う／使わない（どちらも確認を挟む）
    const handleToggleActive = async (item: AllowanceItem) => {
        const message = item.isActive
            ? '『使わない』にすると、新しく付けられなくなります（付いている記録は残ります）。よろしいですか？'
            : '『使う』にすると、対象の現場に入った日の『出勤簿入力』に、手当のボタンが出ます。よろしいですか？';
        if (!window.confirm(message)) return;
        const body = await mutate(
            `${ITEMS_URL}/${item.id}`,
            { method: 'PATCH', body: JSON.stringify({ isActive: !item.isActive }) },
            '更新に失敗しました',
        );
        if (body) toast.success(item.isActive ? '「使わない」にしました' : '「使う」にしました');
    };

    // ---- 金額を変える: 「変更する」→ 画面で確かめる → 確認のモーダル
    const handleRequestRate = (item: AllowanceItem) => {
        if (busyRef.current) return;
        const foremanAmount = parseAmountText(rateForeman);
        const memberAmount = parseAmountText(rateMember);
        if (foremanAmount === null || memberAmount === null) {
            toast.error(`金額は ${ALLOWANCE_AMOUNT_MIN}〜${ALLOWANCE_AMOUNT_MAX.toLocaleString('ja-JP')} の整数で入れてください`);
            return;
        }
        if (!rateDate) {
            toast.error('適用開始日を入れてください');
            return;
        }
        setRateConfirm({
            item,
            foremanAmount,
            memberAmount,
            effectiveFrom: rateDate,
            warnings: allowanceRateWarnings({
                foremanAmount,
                memberAmount,
                current: item.current,
                effectiveFrom: rateDate,
                today: todayJstDateKey(),
            }),
        });
    };

    // ---- 確認のモーダルの「この金額で変更する」
    const handleSubmitRate = async () => {
        if (!rateConfirm) return;
        const { item, foremanAmount, memberAmount, effectiveFrom } = rateConfirm;
        const body = await mutate(
            `${ITEMS_URL}/${item.id}/rates`,
            { method: 'POST', body: JSON.stringify({ foremanAmount, memberAmount, effectiveFrom }) },
            '金額の変更に失敗しました',
        );
        if (!body) return;
        const repriced = typeof body.repriced === 'number' ? body.repriced : 0;
        toast.success(repriced > 0 ? `金額を変えました。すでに付いていた記録 ${repriced}件の金額も変わりました` : '金額を変えました');
        setRateConfirm(null);
        closePanel();
    };

    // ---- 予約を取り消す（一覧の行からも、金額の履歴からも）
    const handleCancelRate = async (item: AllowanceItem, rate: { id: string; foremanAmount: number; memberAmount: number; effectiveFrom: string }) => {
        if (
            !window.confirm(
                `「${item.name}」の ${formatMonthDay(rate.effectiveFrom)}からの 職長 ${yen(rate.foremanAmount)}・職長以外 ${yen(rate.memberAmount)}（予約）を取り消しますか？`,
            )
        ) {
            return;
        }
        const body = await mutate(`${ITEMS_URL}/${item.id}/rates/${rate.id}`, { method: 'DELETE' }, '予約の取り消しに失敗しました');
        if (!body) return;
        toast.success('予約を取り消しました');
        // 金額の履歴を開いていれば、それも読み直す
        if (openPanel?.itemId === item.id && openPanel.kind === 'history') void fetchHistory(item.id);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
            </div>
        );
    }

    const renderRow = (item: AllowanceItem) => {
        const panel = openPanel?.itemId === item.id ? openPanel.kind : null;
        const targetContent = normalizeConstructionContent(item.constructionContent);
        const contentMissing = contentNames !== null && (targetContent === null || !contentNames.has(targetContent));
        return (
            <div
                key={item.id}
                className={`p-3 rounded-xl border transition-colors ${
                    item.isActive ? 'bg-white border-slate-200 hover:border-slate-300' : 'bg-slate-50 border-slate-200'
                }`}
            >
                <div className="flex flex-col lg:flex-row lg:items-start gap-2 lg:gap-3">
                    {/* 名前・説明・対象の現場 */}
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 break-words">{item.name}</div>
                        {item.description && <div className="text-sm text-slate-500 break-words mt-0.5">{item.description}</div>}
                        <div className="text-xs text-slate-600 mt-1">
                            対象の現場: 工事内容が『{item.constructionContent}』の現場
                        </div>
                    </div>

                    {/* 今の金額・始まりの日・予約 */}
                    <div className="shrink-0 text-sm lg:w-72">
                        <div className="font-semibold text-slate-900">
                            {item.current
                                ? `職長 ${yen(item.current.foremanAmount)}・職長以外 ${yen(item.current.memberAmount)}`
                                : '金額がありません'}
                        </div>
                        {item.startDate && <div className="text-xs text-slate-500 mt-0.5">{formatYearMonthDay(item.startDate)}から</div>}
                        {item.upcomingRates.map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-x-2 text-xs text-amber-700 mt-0.5">
                                <span>
                                    {formatMonthDay(r.effectiveFrom)}から 職長 {yen(r.foremanAmount)}・職長以外 {yen(r.memberAmount)}（予約）
                                </span>
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

                    {/* 使用中か・記録の件数 */}
                    <div className="shrink-0 flex flex-wrap items-center gap-1.5 text-xs lg:w-40">
                        <span className={`px-2 py-1 rounded-lg ${item.isActive ? 'bg-teal-50 text-teal-700' : 'bg-slate-200 text-slate-600'}`}>
                            {item.isActive ? '使用中' : '使わない'}
                        </span>
                        <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700">記録 {item.recordCount.toLocaleString('ja-JP')}件</span>
                    </div>

                    {/* ボタン */}
                    <div className="shrink-0 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => (panel === 'edit' ? closePanel() : openEdit(item))} disabled={busy}>
                            編集
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => (panel === 'rate' ? closePanel() : openRate(item))} disabled={busy}>
                            金額を変える
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => (panel === 'history' ? closePanel() : openHistory(item))} disabled={busy}>
                            金額の履歴
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => handleToggleActive(item)} disabled={busy}>
                            {item.isActive ? '使わない' : '使う'}
                        </Button>
                    </div>
                </div>

                {/* 工事内容の名前の確かめ */}
                {contentMissing && (
                    <p className="mt-2 flex items-start gap-1.5 text-sm text-red-600">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                            設定の『工事内容』に『{item.constructionContent}』がありません。名前を変えると、新しい案件に手当のボタンが出なくなります。
                        </span>
                    </p>
                )}

                {/* 編集 */}
                {panel === 'edit' && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <label className="block text-sm">
                            <span className="text-slate-700">名前（{ALLOWANCE_NAME_MAX}字まで）</span>
                            <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                maxLength={ALLOWANCE_NAME_MAX}
                                className={`${inputClass} mt-1 bg-white`}
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="text-slate-700">説明（任意・{ALLOWANCE_DESCRIPTION_MAX}字まで）</span>
                            <textarea
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                maxLength={ALLOWANCE_DESCRIPTION_MAX}
                                rows={2}
                                className={`${inputClass} mt-1 bg-white`}
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

                {/* 金額を変える */}
                {panel === 'rate' && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                        <div className="flex flex-col md:flex-row md:items-end gap-3">
                            <div className="text-sm">
                                <label htmlFor={`allowance-rate-foreman-${item.id}`} className="block text-slate-700 mb-1">職長の金額</label>
                                <AmountInput id={`allowance-rate-foreman-${item.id}`} value={rateForeman} onChange={setRateForeman} disabled={busy} />
                            </div>
                            <div className="text-sm">
                                <label htmlFor={`allowance-rate-member-${item.id}`} className="block text-slate-700 mb-1">職長以外の金額</label>
                                <AmountInput id={`allowance-rate-member-${item.id}`} value={rateMember} onChange={setRateMember} disabled={busy} />
                            </div>
                            <label className="block text-sm">
                                <span className="block text-slate-700 mb-1">適用開始日</span>
                                <input
                                    type="date"
                                    value={rateDate}
                                    min={item.startDate ?? undefined}
                                    onChange={(e) => setRateDate(e.target.value)}
                                    disabled={busy}
                                    className="h-10 px-3 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                                />
                            </label>
                        </div>
                        <p className="text-sm text-slate-600">
                            適用開始日より前の日付の記録には、今までの金額が使われます。打ちまちがえたときは、同じ適用開始日で、正しい金額を入れ直してください。
                        </p>
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={() => handleRequestRate(item)} isLoading={busy}>
                                変更する
                            </Button>
                            <Button size="sm" variant="outline" onClick={closePanel} disabled={busy}>
                                キャンセル
                            </Button>
                        </div>
                    </div>
                )}

                {/* 金額の履歴 */}
                {panel === 'history' && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                        {historyLoading && history === null ? (
                            <p className="text-sm text-slate-500">読み込み中…</p>
                        ) : history === null ? (
                            <p className="text-sm text-slate-500">金額の履歴を読めませんでした</p>
                        ) : history.length === 0 ? (
                            <p className="text-sm text-slate-500">金額の履歴はありません</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm bg-white rounded-lg">
                                    <thead>
                                        <tr className="text-left text-slate-600 border-b border-slate-200">
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">適用開始日</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap text-right">職長</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap text-right">職長以外</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">設定した人</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">設定した日時</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap">状態</th>
                                            <th className="px-3 py-2 font-medium whitespace-nowrap"><span className="sr-only">操作</span></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((r) => (
                                            <tr
                                                key={r.id}
                                                className={`border-b border-slate-100 last:border-0 ${r.replaced ? 'text-slate-400' : ''}`}
                                            >
                                                <td className="px-3 py-2 whitespace-nowrap">{formatYearMonthDay(r.effectiveFrom)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap text-right">{yen(r.foremanAmount)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap text-right">{yen(r.memberAmount)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{r.createdByName || '—'}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{formatJstDateTime(r.createdAt)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-md text-xs ${
                                                            r.replaced
                                                                ? 'bg-slate-100 text-slate-400'
                                                                : r.state === 'current'
                                                                    ? 'bg-teal-50 text-teal-700'
                                                                    : r.state === 'upcoming'
                                                                        ? 'bg-amber-50 text-amber-700'
                                                                        : 'bg-slate-100 text-slate-500'
                                                        }`}
                                                    >
                                                        {STATE_LABEL[r.state]}
                                                        {r.replaced ? '（置きかえ済み）' : ''}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    {r.state === 'upcoming' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCancelRate(item, r)}
                                                            disabled={busy}
                                                            className="underline text-slate-600 hover:text-red-600 disabled:opacity-50"
                                                        >
                                                            取り消す
                                                        </button>
                                                    )}
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
                <h3 className="text-lg font-semibold text-slate-900">手当</h3>
                <p className="text-sm text-slate-500 mt-1">
                    現場の手当の金額と、使う・使わないを決めます。金額を変えると、適用開始日からあとの、締めていない月の記録は新しい金額になります（締めた月は変わりません）。
                </p>
            </div>

            {loadFailed && items.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    <p>手当を読めませんでした</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchItems()}>
                        読み直す
                    </Button>
                </div>
            ) : items.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                    <p>手当が登録されていません</p>
                </div>
            ) : (
                <div className="space-y-2">{items.map((item) => renderRow(item))}</div>
            )}

            {rateConfirm && (
                <RateConfirmModal
                    confirm={rateConfirm}
                    busy={busy}
                    onSubmit={handleSubmitRate}
                    onCancel={() => {
                        if (!busyRef.current) setRateConfirm(null);
                    }}
                />
            )}
        </section>
    );
}

/** 「金額を変える」で、送る前に必ず出す確認の画面（window.confirm では文を並べられないため） */
function RateConfirmModal({
    confirm,
    busy,
    onSubmit,
    onCancel,
}: {
    confirm: RateConfirm;
    busy: boolean;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    const { item, foremanAmount, memberAmount, effectiveFrom, warnings } = confirm;
    const current = item.current;
    const repriceWarning = warnings.find((w) => w.code === 'starts_on_or_before_today');
    const otherWarnings = warnings.filter((w) => w.code !== 'starts_on_or_before_today');
    const nowText = (amount: number | undefined) => (amount === undefined ? '（今はなし）' : `（今は ${yen(amount)}）`);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onCancel]);

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="allowance-rate-confirm-title"
                className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5 space-y-4"
                onClick={(e) => e.stopPropagation()}
            >
                <h4 id="allowance-rate-confirm-title" className="text-base font-semibold text-slate-900">
                    「{item.name}」の金額を変えます
                </h4>
                <p className="text-sm text-slate-900">
                    {formatYearMonthDay(effectiveFrom)}から　職長 {yen(foremanAmount)}
                    {nowText(current?.foremanAmount)}・職長以外 {yen(memberAmount)}
                    {nowText(current?.memberAmount)}
                </p>
                {repriceWarning && (
                    <p className="text-sm text-red-600">
                        適用開始日が今日以前です。
                        <strong className="font-bold">この日からあとの、すでに付いている記録（締めていない月）の金額も、新しい金額に変わります。</strong>
                    </p>
                )}
                {otherWarnings.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-sm text-red-600">
                        {otherWarnings.map((w) => (
                            <li key={w.code}>{w.message}</li>
                        ))}
                    </ul>
                )}
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={onCancel} disabled={busy}>
                        やめる
                    </Button>
                    <Button variant="primary" onClick={onSubmit} isLoading={busy}>
                        この金額で変更する
                    </Button>
                </div>
            </div>
        </div>
    );
}

/**
 * 「本人への表示」の欄（公開の設定。docs/指示書_大規模手当.md の 7-1 の 5）。
 * オンにすると、職長・作業員のメニューに「手当」が出て、自分の日数と金額だけが見える。
 */
function AllowanceVisibilitySection() {
    const [showToMembers, setShowToMembers] = useState(false);
    const [notice, setNotice] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    // 古い読み込みの答えを捨てるための連番
    const seqRef = useRef(0);

    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);

    const fetchSetting = useCallback(async () => {
        const seq = ++seqRef.current;
        setIsLoading(true);
        try {
            const res = await fetch(SETTINGS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as { showToMembers?: unknown; memberNotice?: unknown };
            if (seq !== seqRef.current) return;
            setShowToMembers(body.showToMembers === true);
            setNotice(typeof body.memberNotice === 'string' ? body.memberNotice : '');
            setLoadFailed(false);
        } catch (error) {
            if (seq !== seqRef.current) return;
            logger.error('Failed to fetch allowance setting:', error);
            setLoadFailed(true);
            toast.error('本人への表示の設定の取得に失敗しました');
        } finally {
            if (seq === seqRef.current) setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSetting();
    }, [fetchSetting]);

    const handleSave = async () => {
        const trimmed = notice.trim();
        if (trimmed.length > ALLOWANCE_NOTE_MAX) {
            toast.error(`注意書きは${ALLOWANCE_NOTE_MAX}字までの文字で入れてください`);
            return;
        }
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
            // スイッチと注意書きの両方を送る（注意書きを省くと、サーバーは今の注意書きを残すため）
            const res = await fetch(SETTINGS_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ showToMembers, memberNotice: trimmed === '' ? null : trimmed }),
            });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, '本人への表示の保存に失敗しました'));
                return;
            }
            const body = (await res.json()) as { showToMembers?: unknown; memberNotice?: unknown };
            // 保存した中身を出す（読み込み中の古い答えは捨てる）
            seqRef.current++;
            setShowToMembers(body.showToMembers === true);
            setNotice(typeof body.memberNotice === 'string' ? body.memberNotice : '');
            toast.success('本人への表示を保存しました');
            sendBroadcast(ALLOWANCES_UPDATED_EVENT, {});
        } catch (error) {
            logger.error('Failed to save allowance setting:', error);
            toast.error('本人への表示の保存に失敗しました');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    return (
        <section className="min-w-0">
            <div className="mb-4">
                <h3 className="text-lg font-semibold text-slate-900">本人への表示</h3>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
                </div>
            ) : loadFailed ? (
                <div className="text-center py-8 text-slate-500">
                    <p>設定を読めませんでした</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchSetting()}>
                        読み直す
                    </Button>
                </div>
            ) : (
                <div className="p-3 md:p-4 rounded-xl border border-slate-200 bg-white space-y-4">
                    {/* スイッチ */}
                    <div className="flex items-start gap-3">
                        <button
                            type="button"
                            role="switch"
                            id="allowance-show-to-members"
                            aria-checked={showToMembers}
                            aria-labelledby="allowance-show-to-members-label"
                            onClick={() => setShowToMembers((v) => !v)}
                            disabled={busy}
                            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 ${
                                showToMembers ? 'bg-teal-600' : 'bg-slate-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    showToMembers ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                            />
                        </button>
                        <div className="min-w-0">
                            <label
                                id="allowance-show-to-members-label"
                                htmlFor="allowance-show-to-members"
                                className="block text-sm font-medium text-slate-900 cursor-pointer"
                            >
                                職長・作業員に、自分の手当の日数と金額を見せる
                            </label>
                            <p className="text-sm text-slate-500 mt-1">
                                オンにすると、職長と作業員のメニューに『手当』が出ます。見えるのは自分の分だけです。
                            </p>
                        </div>
                    </div>

                    {/* 注意書き */}
                    <label className="block text-sm">
                        <span className="text-slate-700">本人の画面に出す注意書き（任意・{ALLOWANCE_NOTE_MAX}字まで）</span>
                        <textarea
                            value={notice}
                            onChange={(e) => setNotice(e.target.value)}
                            maxLength={ALLOWANCE_NOTE_MAX}
                            rows={2}
                            disabled={busy}
                            className={`${inputClass} mt-1`}
                        />
                    </label>

                    <div>
                        <Button variant="primary" onClick={handleSave} isLoading={busy}>
                            保存
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
