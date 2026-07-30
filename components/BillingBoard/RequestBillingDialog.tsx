'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText, Plus, Minus, List, FileDown, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { newBillingItemId, flattenEstimateItems } from '@/lib/billing/estimateToBillingItems';
import type { Estimate } from '@/types/estimate';
import type { InvoiceItem, BillingTitle } from '@/types/invoice';

// PDF プレビューは重い（pdfjs）ので、見積書を開いたときだけ読み込む
const LivePdfPreview = dynamic(
    () => import('@/components/ui/LivePdfPreview').then((m) => ({ default: m.LivePdfPreview })),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">プレビューを読み込み中…</div>
        ),
    },
);

const yen = (n: number | null) => (n == null ? '—' : `¥${Math.round(n).toLocaleString()}`);
const yenSigned = (n: number) =>
    n < 0 ? `-¥${Math.abs(n).toLocaleString()}` : `¥${Math.round(n).toLocaleString()}`;

/** 案件の利益サマリー（GET /api/project-masters/[id]/profit の抜粋。すべて税抜）。 */
export interface RequestBillingProfit {
    revenue: number; // 売上（請求 → 見積 → 足場工事金額 のフォールバック＋手動上書き）
    totalCost: number; // 原価合計
    grossProfit: number; // 粗利（売上 − 原価）
    profitMargin: number; // 利益率（%）
}

/** 「請求する」ダイアログの確定結果。 */
export type RequestBillingResult =
    | { kind: 'estimate' } // 見積どおり（明細展開・複数は呼び出し側でピッカー）
    | { kind: 'amount'; amount: number; note: string } // 金額指定（出来高・残額すべて）
    | { kind: 'items'; items: InvoiceItem[] }; // 請求項目で明細をつくる（見積と違う名称・代表的な行）

interface RequestBillingDialogProps {
    open: boolean;
    projectTitle: string;
    estimateAmount: number | null;
    invoicedAmount: number;
    remainingAmount: number | null;
    /** 見積の合計（税抜・全見積の subtotal 合算）。未取得/無しは null。 */
    estimateTotal: number | null;
    estimateCount: number;
    /** プレビュー & 「見積から引用」用の見積一覧（renderEstimatePdf 未指定なら「見積書を確認」非表示）。 */
    estimates?: Estimate[];
    /** 請求項目マスタ（設定＞請求項目一覧）。「請求項目から追加」で使用。 */
    billingTitles?: BillingTitle[];
    /** 見積 1 件を PDF Blob にする（親が案件・自社情報を解決）。 */
    renderEstimatePdf?: (estimate: Estimate) => Promise<Blob | null>;
    /** 見積書を編集する（親が見積編集モーダルを開く）。未指定なら編集ボタンを出さない。 */
    onEditEstimate?: (estimate: Estimate) => void;
    /** 案件の利益サマリー（税抜）。未取得は null、取得失敗も null（何も表示しない）。 */
    profit?: RequestBillingProfit | null;
    /** 利益サマリーの読込中フラグ。 */
    profitLoading?: boolean;
    submitting?: boolean;
    onClose: () => void;
    onConfirm: (result: RequestBillingResult) => void;
}

type Choice = 'amount' | 'remaining' | 'estimate' | 'items';
type Unit = 'yen' | 'pct';

const NOTE_PRESETS = ['着手金', '中間金', '完成', '出来高'];
const ITEM_INPUT = 'rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500';

/**
 * 数値入力（マイナス・小数対応）。入力途中の空欄を保持し、空欄は 0 として扱う。
 * `parseInt('') || N` 方式だとスマホで空にした瞬間に値がリセットされる問題を避けるため、
 * ローカル文字列 state を併用する（ItemRow.DecimalInput と同方針。bundle 軽量化のためここに内製）。
 */
function NumInput({
    value,
    onChange,
    className,
    placeholder,
}: {
    value: number;
    onChange: (n: number) => void;
    className: string;
    placeholder?: string;
}) {
    const [local, setLocal] = useState(value === 0 ? '' : String(value));
    useEffect(() => {
        setLocal(value === 0 ? '' : String(value));
    }, [value]);
    return (
        <input
            type="text"
            inputMode="decimal"
            value={local}
            onChange={(e) => {
                const v = e.target.value;
                if (v === '' || /^-?\d*\.?\d*$/.test(v)) {
                    setLocal(v);
                    const n = Number(v);
                    if (v !== '' && !isNaN(n) && !v.endsWith('.')) onChange(n);
                }
            }}
            onBlur={() => {
                const n = local === '' ? 0 : Number(local);
                if (!isNaN(n)) {
                    onChange(n);
                    setLocal(n === 0 ? '' : String(n));
                }
            }}
            className={className}
            placeholder={placeholder}
        />
    );
}

/**
 * 「請求する」時に請求金額を指定するダイアログ（Phase 4 + 請求項目エディタ）。
 * 表示順・既定は 見積どおり（既定）→ 請求項目 → 残額すべて → 金額・比率（見積が無い案件のみ金額・比率が既定）。
 * - 見積どおり：見積明細を展開（複数見積は呼び出し側でピッカー）。
 * - 残額すべて：見積金額 − 既請求 の残額を 1 行で請求対象。
 * - 金額・比率で指定（出来高）：¥ または 見積金額×% で金額を決め、摘要（着手金 等）を付ける → 1 行で請求対象。
 * - 請求項目で明細をつくる：見積と違う名称（請求項目一覧）で代表的な明細を組む。見積から引用して
 *   不要な行を削除・1 行にまとめることも可能。
 * 残額は発行（請求書化）後に自動で繰り越される（partial 表示）ため、出来高は複数回に分けられる。
 */
export default function RequestBillingDialog({
    open,
    projectTitle,
    estimateAmount,
    invoicedAmount,
    remainingAmount,
    estimateTotal,
    estimateCount,
    estimates = [],
    billingTitles = [],
    renderEstimatePdf,
    onEditEstimate,
    profit,
    profitLoading,
    submitting,
    onClose,
    onConfirm,
}: RequestBillingDialogProps) {
    const hasEstimates = estimateCount > 0;
    const hasEstimate = estimateAmount != null;
    const remaining = remainingAmount ?? estimateAmount ?? 0;

    const [choice, setChoice] = useState<Choice>('amount');
    const [unit, setUnit] = useState<Unit>('yen');
    const [yenInput, setYenInput] = useState<string>('');
    const [pctInput, setPctInput] = useState<string>('');
    const [note, setNote] = useState<string>('');
    const [showPreview, setShowPreview] = useState(false);
    const [selectedEstimateId, setSelectedEstimateId] = useState<string>('');
    // 請求項目エディタ
    const [customItems, setCustomItems] = useState<InvoiceItem[]>([]);
    const [billingTitleMenuOpen, setBillingTitleMenuOpen] = useState(false);
    const canPreview = !!renderEstimatePdf && estimates.length > 0;

    // 開くたびに初期化（既定＝見積どおり。見積が無い案件のみ金額指定。金額欄には残額を prefill）
    useEffect(() => {
        if (!open) return;
        setChoice(estimateCount > 0 ? 'estimate' : 'amount');
        setUnit('yen');
        setYenInput(remaining > 0 ? String(Math.round(remaining)) : '');
        setPctInput('');
        setNote('');
        setShowPreview(false);
        setCustomItems([]);
        setBillingTitleMenuOpen(false);
        const approved = estimates.find((e) => e.status === 'approved');
        setSelectedEstimateId(approved?.id ?? estimates[0]?.id ?? '');
        // remaining/estimates は props 由来。open 立ち上がり時のみ初期化したいので open のみ依存。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // 比率→金額（契約×%）
    const amountFromInputs = useMemo(() => {
        if (unit === 'pct') {
            const pct = Number(pctInput);
            if (!hasEstimate || !Number.isFinite(pct) || pct <= 0) return 0;
            return Math.round((estimateAmount as number) * (pct / 100));
        }
        const v = Number(yenInput);
        return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
    }, [unit, pctInput, yenInput, hasEstimate, estimateAmount]);

    const itemsSubtotal = useMemo(
        () => customItems.reduce((s, it) => s + (it.amount || 0), 0),
        [customItems],
    );

    // ── 請求項目エディタの操作 ───────────────────────────────
    const addItem = () =>
        setCustomItems((p) => [
            ...p,
            { id: newBillingItemId(), description: '', quantity: 1, unit: '式', unitPrice: 0, amount: 0, taxType: 'standard' },
        ]);
    const addDiscount = () =>
        setCustomItems((p) => [
            ...p,
            { id: newBillingItemId(), description: '値引き', quantity: -1, unit: '', unitPrice: 0, amount: 0, taxType: 'standard' },
        ]);
    const updateItem = (id: string, field: 'description' | 'quantity' | 'unit' | 'unitPrice', value: string | number) =>
        setCustomItems((p) =>
            p.map((it) => {
                if (it.id !== id) return it;
                const u = { ...it, [field]: value } as InvoiceItem;
                if (field === 'quantity' || field === 'unitPrice') {
                    u.amount = Math.round((u.quantity || 0) * (u.unitPrice || 0));
                }
                return u;
            }),
        );
    const removeItem = (id: string) => setCustomItems((p) => p.filter((it) => it.id !== id));
    const addFromBillingTitle = (bt: BillingTitle) => {
        setCustomItems((p) => [
            ...p,
            {
                id: newBillingItemId(),
                description: bt.name,
                quantity: bt.quantity ?? 1,
                unit: bt.unit || '式',
                unitPrice: 0,
                amount: 0,
                taxType: 'standard',
            },
        ]);
        setBillingTitleMenuOpen(false);
    };
    const loadFromEstimate = () => {
        if (estimates.length === 0) {
            toast.error('この案件に紐づく見積書がありません');
            return;
        }
        const latest = [...estimates].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];
        const loaded = flattenEstimateItems(latest.items ?? []);
        if (loaded.length === 0) {
            toast.error('見積書に明細がありません');
            return;
        }
        setCustomItems((p) => [...p, ...loaded]);
        toast.success(`${latest.estimateNumber} の明細を読み込みました（不要な行は削除・まとめてください）`);
    };

    if (!open) return null;

    const selectedEstimate = estimates.find((e) => e.id === selectedEstimateId) ?? null;
    // 編集対象の見積：プレビューで選択中 → 承認済み → 先頭。1件しか無い案件でも編集ボタンを出せるようにする。
    const editTarget =
        selectedEstimate ?? estimates.find((e) => e.status === 'approved') ?? estimates[0] ?? null;
    const hasItemContent = customItems.some((it) => it.description.trim() !== '' || (it.amount || 0) !== 0);
    const resolvedAmount =
        choice === 'remaining'
            ? Math.max(0, Math.round(remaining))
            : choice === 'amount'
              ? amountFromInputs
              : choice === 'items'
                ? itemsSubtotal
                : 0;
    const canConfirm =
        choice === 'estimate' ? hasEstimates : choice === 'items' ? hasItemContent : resolvedAmount > 0;
    const afterRemaining = hasEstimate ? (remainingAmount ?? 0) - resolvedAmount : null;

    const handleConfirm = () => {
        if (choice === 'estimate') {
            onConfirm({ kind: 'estimate' });
            return;
        }
        if (choice === 'items') {
            const valid = customItems.filter((it) => it.description.trim() !== '' || (it.amount || 0) !== 0);
            if (valid.length === 0) return;
            onConfirm({ kind: 'items', items: valid });
            return;
        }
        if (resolvedAmount <= 0) return;
        onConfirm({ kind: 'amount', amount: resolvedAmount, note: choice === 'amount' ? note.trim() : '' });
    };

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 lg:left-48"
            onClick={onClose}
        >
            <div
                className={`flex gap-3 transition-[max-width] duration-200 ${
                    showPreview
                        ? 'h-[88vh] w-full max-w-6xl'
                        : choice === 'items'
                          ? 'w-full max-w-2xl'
                          : 'w-full max-w-md'
                }`}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className={`flex flex-col rounded-xl bg-white p-5 shadow-xl ${
                        showPreview ? 'w-full max-w-md shrink-0 overflow-y-auto lg:w-[400px]' : 'max-h-[88vh] w-full overflow-y-auto'
                    }`}
                >
                <h3 className="text-base font-bold text-slate-900">請求金額を指定</h3>
                <p className="mt-0.5 truncate text-sm text-slate-500">{projectTitle}</p>

                {/* 金額サマリ */}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span>
                        見積金額 <span className="font-semibold text-slate-800">{yen(estimateAmount)}</span>
                    </span>
                    <span>
                        既請求 <span className="font-semibold text-slate-800">{yen(invoicedAmount)}</span>
                    </span>
                    <span>
                        残 <span className="font-semibold text-slate-900">{yen(remainingAmount)}</span>
                    </span>
                </div>

                {/* 利益サマリー（税抜）。取得失敗時は何も出さない（エラーは出さない）。 */}
                {profitLoading ? (
                    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">利益を読込中…</div>
                ) : profit ? (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span>
                            売上 <span className="font-semibold text-slate-800">{yen(profit.revenue)}</span>
                        </span>
                        <span>
                            原価 <span className="font-semibold text-slate-800">{yen(profit.totalCost)}</span>
                        </span>
                        <span>
                            粗利{' '}
                            <span className={`font-semibold ${profit.grossProfit < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                {yenSigned(profit.grossProfit)}
                            </span>
                        </span>
                        <span>
                            利益率{' '}
                            <span className={`font-semibold ${profit.profitMargin < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                {profit.profitMargin}%
                            </span>
                        </span>
                        <span className="w-full text-[10px] text-slate-400">すべて税抜（案件詳細の利益タブと同じ計算）</span>
                    </div>
                ) : null}

                {(canPreview || (onEditEstimate && editTarget)) && (
                    <div className="mt-3 flex gap-2">
                        {canPreview && (
                            <button
                                type="button"
                                onClick={() => setShowPreview((v) => !v)}
                                className="hidden flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:inline-flex"
                            >
                                <FileText className="h-4 w-4" />
                                {showPreview ? '見積書を隠す' : '見積書を確認'}
                            </button>
                        )}
                        {onEditEstimate && editTarget && (
                            <button
                                type="button"
                                onClick={() => onEditEstimate(editTarget)}
                                title={`${editTarget.estimateNumber} を編集`}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                <Pencil className="h-4 w-4" />
                                見積書を編集
                            </button>
                        )}
                    </div>
                )}

                <div className="mt-4 space-y-3">
                    {/* 見積どおり（既定） */}
                    {hasEstimates && (
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="radio"
                                checked={choice === 'estimate'}
                                onChange={() => setChoice('estimate')}
                            />
                            <span className="text-sm text-slate-800">
                                見積どおり（{estimateTotal != null ? yen(estimateTotal) : '見積から'}
                                {estimateCount > 1 ? `・${estimateCount}件` : ''}）
                            </span>
                        </label>
                    )}

                    {/* 請求項目で明細をつくる（見積と違う名称・代表的な行） */}
                    <label className="flex cursor-pointer items-start gap-2">
                        <input
                            type="radio"
                            checked={choice === 'items'}
                            onChange={() => setChoice('items')}
                            className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-800">請求項目で明細をつくる</div>
                            <div className="text-xs text-slate-500">
                                見積と違う名称・代表的な明細で請求できます（請求項目一覧から）。
                            </div>
                            <div className={`mt-2 ${choice === 'items' ? '' : 'pointer-events-none opacity-50'}`}>
                                {/* ツールバー */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setBillingTitleMenuOpen((v) => !v)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <List className="h-3.5 w-3.5" /> 請求項目から追加
                                    </button>
                                    {estimates.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={loadFromEstimate}
                                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                        >
                                            <FileDown className="h-3.5 w-3.5" /> 見積から引用
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={addDiscount}
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <Minus className="h-3.5 w-3.5" /> 値引き
                                    </button>
                                    <button
                                        type="button"
                                        onClick={addItem}
                                        className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-700"
                                    >
                                        <Plus className="h-3.5 w-3.5" /> 行追加
                                    </button>
                                </div>

                                {/* 請求項目マスタ（インライン展開・クリップ回避のため絶対配置にしない） */}
                                {billingTitleMenuOpen && (
                                    <div className="mt-1.5 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                                        {billingTitles.length > 0 ? (
                                            <ul className="max-h-44 overflow-y-auto">
                                                {billingTitles.map((bt) => (
                                                    <li key={bt.id}>
                                                        <button
                                                            type="button"
                                                            onClick={() => addFromBillingTitle(bt)}
                                                            className="w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                                                        >
                                                            {bt.name}
                                                            {(bt.quantity != null || bt.unit) && (
                                                                <span className="ml-1 text-slate-400">
                                                                    ({bt.quantity != null ? bt.quantity : ''}
                                                                    {bt.unit ? ` ${bt.unit}` : ''})
                                                                </span>
                                                            )}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="px-2 py-1.5 text-xs text-slate-500">
                                                請求項目マスタがありません（設定 ＞ 請求項目一覧で追加）
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 明細リスト */}
                                {customItems.length === 0 ? (
                                    <p className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-400">
                                        「請求項目から追加」「見積から引用」「行追加」で明細を作成してください。
                                        <br />
                                        見積と違う名称・代表的な 1 行にまとめられます。
                                    </p>
                                ) : (
                                    <div className="mt-2 space-y-2">
                                        {customItems.map((it) => (
                                            <div key={it.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                                                <div className="flex items-start gap-1.5">
                                                    <input
                                                        type="text"
                                                        value={it.description}
                                                        onChange={(e) => updateItem(it.id, 'description', e.target.value)}
                                                        placeholder="品目・内容"
                                                        className={`min-w-0 flex-1 ${ITEM_INPUT}`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeItem(it.id)}
                                                        className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                                        aria-label="削除"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                                <div className="mt-1.5 flex items-center gap-1.5">
                                                    <NumInput
                                                        value={it.quantity}
                                                        onChange={(n) => updateItem(it.id, 'quantity', n)}
                                                        className={`w-14 ${ITEM_INPUT}`}
                                                        placeholder="数量"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={it.unit || ''}
                                                        onChange={(e) => updateItem(it.id, 'unit', e.target.value)}
                                                        placeholder="単位"
                                                        className={`w-14 ${ITEM_INPUT}`}
                                                    />
                                                    <span className="text-slate-400">×</span>
                                                    <div className="flex items-center gap-0.5">
                                                        <span className="text-slate-400">¥</span>
                                                        <NumInput
                                                            value={it.unitPrice}
                                                            onChange={(n) => updateItem(it.id, 'unitPrice', n)}
                                                            className={`w-24 ${ITEM_INPUT}`}
                                                            placeholder="単価"
                                                        />
                                                    </div>
                                                    <span
                                                        className={`ml-auto whitespace-nowrap font-medium tabular-nums ${
                                                            it.amount < 0 ? 'text-red-600' : 'text-slate-800'
                                                        }`}
                                                    >
                                                        {yenSigned(it.amount)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm">
                                            <span className="text-slate-500">小計（税抜）</span>
                                            <span className="font-semibold text-slate-900">{yen(itemsSubtotal)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </label>

                    {/* 残額すべて */}
                    {hasEstimate && (
                        <label className="flex cursor-pointer items-center gap-2">
                            <input
                                type="radio"
                                checked={choice === 'remaining'}
                                onChange={() => setChoice('remaining')}
                            />
                            <span className="text-sm text-slate-800">残額すべて（{yen(remainingAmount)}）</span>
                        </label>
                    )}

                    {/* 金額・比率で指定 */}
                    <label className="flex cursor-pointer items-start gap-2">
                        <input
                            type="radio"
                            checked={choice === 'amount'}
                            onChange={() => setChoice('amount')}
                            className="mt-1"
                        />
                        <div className="flex-1">
                            <div className="text-sm font-medium text-slate-800">金額・比率で指定（出来高）</div>
                            <div className={`mt-2 space-y-2 ${choice === 'amount' ? '' : 'pointer-events-none opacity-50'}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                                        <button
                                            type="button"
                                            onClick={() => setUnit('yen')}
                                            className={`rounded px-2 py-0.5 text-xs ${unit === 'yen' ? 'bg-teal-600 text-white' : 'text-slate-600'}`}
                                        >
                                            金額
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setUnit('pct')}
                                            disabled={!hasEstimate}
                                            className={`rounded px-2 py-0.5 text-xs disabled:opacity-40 ${unit === 'pct' ? 'bg-teal-600 text-white' : 'text-slate-600'}`}
                                            title={hasEstimate ? '' : '見積金額が未設定のため比率は使えません'}
                                        >
                                            比率
                                        </button>
                                    </div>
                                    {unit === 'yen' ? (
                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-400">¥</span>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                value={yenInput}
                                                onChange={(e) => setYenInput(e.target.value)}
                                                placeholder="300000"
                                                className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                value={pctInput}
                                                onChange={(e) => setPctInput(e.target.value)}
                                                placeholder="30"
                                                className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            />
                                            <span className="text-slate-400">%</span>
                                            <span className="text-xs text-slate-500">→ {yen(amountFromInputs)}</span>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <input
                                        type="text"
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        placeholder="摘要（例: 着手金）"
                                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                    />
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {NOTE_PRESETS.map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setNote(p)}
                                                className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </label>
                </div>

                {/* 持ち越しプレビュー */}
                {choice !== 'estimate' && afterRemaining != null && resolvedAmount > 0 && (
                    <p className="mt-3 text-xs text-slate-500">
                        今回 {yen(resolvedAmount)} を請求対象に追加。
                        {afterRemaining > 0
                            ? `残 ${yen(afterRemaining)} は次回へ持ち越し。`
                            : afterRemaining === 0
                              ? '残額すべてを請求します。'
                              : `見積金額を ${yen(-afterRemaining)} 超過します。`}
                    </p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        キャンセル
                    </Button>
                    <Button type="button" variant="primary" onClick={handleConfirm} disabled={!canConfirm || submitting}>
                        {submitting ? '追加中…' : '請求対象に追加'}
                    </Button>
                </div>
                </div>

                {showPreview && (
                    <div className="hidden min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-xl lg:flex">
                        {(estimates.length > 1 || (onEditEstimate && selectedEstimate)) && (
                            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 p-2">
                                <span className="px-1 text-xs text-slate-500">見積:</span>
                                {estimates.length > 1 &&
                                    estimates.map((e) => (
                                    <button
                                        key={e.id}
                                        type="button"
                                        onClick={() => setSelectedEstimateId(e.id)}
                                        title={e.title || e.estimateNumber}
                                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                            selectedEstimateId === e.id
                                                ? 'bg-teal-600 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                    >
                                        {e.estimateNumber}
                                        {e.status === 'approved' ? ' ✓' : ''}
                                    </button>
                                ))}
                                {onEditEstimate && selectedEstimate && (
                                    <button
                                        type="button"
                                        onClick={() => onEditEstimate(selectedEstimate)}
                                        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <Pencil className="h-3.5 w-3.5" /> この見積を編集
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="min-h-0 flex-1">
                            {selectedEstimate && renderEstimatePdf ? (
                                <LivePdfPreview
                                    // 見積を編集して保存したらプレビューも作り直す（updatedAt を seed に含める）
                                    seed={`${selectedEstimate.id}:${new Date(selectedEstimate.updatedAt).getTime()}`}
                                    renderPdf={() => renderEstimatePdf(selectedEstimate)}
                                    debounceMs={250}
                                    initialDelayMs={0}
                                />
                            ) : (
                                <div className="flex h-full items-center justify-center text-sm text-slate-400">
                                    見積書がありません
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
