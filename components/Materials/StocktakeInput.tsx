'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, CloudOff, Loader2, Printer, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import CollapsibleCategory from './ui/CollapsibleCategory';
import MaterialSearchBar from './ui/MaterialSearchBar';

/** API が返す棚卸明細の 1 行 */
export interface StocktakeLineDto {
    lineId: string;
    materialItemId: string;
    name: string;
    spec: string | null;
    unit: string;
    sortOrder: number;
    /** null = まだ数えていない。0 は「数えて 0 本だった」で別物 */
    quantity: number | null;
    note: string | null;
    previousQuantity: number | null;
    previousDate: string | null;
}

export interface StocktakeCategoryDto {
    id: string;
    name: string;
    sortOrder: number;
    items: StocktakeLineDto[];
}

export interface StocktakeDetailDto {
    id: string;
    date: string;
    status: string;
    scaffoldMethod: string;
    location: { id: string; name: string };
    notes: string | null;
    createdByName: string;
    confirmedAt: string | null;
    lineCount: number;
    countedCount: number;
    categories: StocktakeCategoryDto[];
}

interface Props {
    stocktakeId: string;
    onBack: () => void;
    /** 確定できる権限があるか（admin / manager） */
    canConfirm: boolean;
}

/** 数量の編集状態。空文字 = 未入力（null）として保存する */
type QtyDraft = Record<string, string>;

const AUTOSAVE_DELAY_MS = 1200;

/** 土場で打っている途中にリロードしても消えないようにする一時保存キー */
const localDraftKey = (stocktakeId: string) => `dandolink:stocktake:${stocktakeId}`;

function formatJstDate(value: string): string {
    const d = new Date(value);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

export default function StocktakeInput({ stocktakeId, onBack, canConfirm }: Props) {
    const [detail, setDetail] = useState<StocktakeDetailDto | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [drafts, setDrafts] = useState<QtyDraft>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [uncountedOnly, setUncountedOnly] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [isConfirming, setIsConfirming] = useState(false);

    // 保存待ちの materialItemId。デバウンス中に変更が重なっても取りこぼさない
    const pendingRef = useRef<Set<string>>(new Set());
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 二重確定を防ぐ同期ロック（state だけだと連打が素通りする）
    const confirmLockRef = useRef(false);
    // 保存時に最新の入力値を読むための参照。
    // 依存配列に drafts を入れると 1 文字打つたびに保存タイマーが張り直されるため ref で持つ
    const draftsRef = useRef<QtyDraft>({});

    // --- 読み込み ---------------------------------------------------------
    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/materials/stocktakes/${stocktakeId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('取得に失敗しました');
            const data: StocktakeDetailDto = await res.json();
            setDetail(data);

            // サーバーの値を土台に、ローカルに残っている未送信の入力を重ねる
            const base: QtyDraft = {};
            for (const cat of data.categories) {
                for (const item of cat.items) {
                    base[item.materialItemId] = item.quantity === null ? '' : String(item.quantity);
                }
            }
            try {
                const cached = localStorage.getItem(localDraftKey(stocktakeId));
                if (cached && data.status !== 'confirmed') {
                    const parsed = JSON.parse(cached) as QtyDraft;
                    for (const [key, value] of Object.entries(parsed)) {
                        if (key in base && value !== base[key]) base[key] = value;
                    }
                }
            } catch {
                // localStorage が使えない環境ではサーバーの値だけで動かす
            }
            setDrafts(base);
        } catch {
            toast.error('棚卸の読み込みに失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [stocktakeId]);

    useEffect(() => {
        void load();
    }, [load]);

    const isConfirmed = detail?.status === 'confirmed';

    // --- 保存 -------------------------------------------------------------
    const flush = useCallback(async () => {
        const ids = [...pendingRef.current];
        if (ids.length === 0) return;
        pendingRef.current.clear();
        setSaveState('saving');
        try {
            const res = await fetch(`/api/materials/stocktakes/${stocktakeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lines: ids.map((materialItemId) => {
                        const raw = draftsRef.current[materialItemId] ?? '';
                        return { materialItemId, quantity: raw === '' ? null : Number(raw) };
                    }),
                }),
            });
            if (!res.ok) throw new Error('保存に失敗しました');
            setSaveState('saved');
            try {
                localStorage.removeItem(localDraftKey(stocktakeId));
            } catch {
                // 保存できていれば一時保存は不要。消せなくても実害はない
            }
        } catch {
            // 電波が届かないときは戻して次回に再送する
            for (const id of ids) pendingRef.current.add(id);
            setSaveState('error');
        }
    }, [stocktakeId]);

    useEffect(() => {
        draftsRef.current = drafts;
    }, [drafts]);

    const scheduleSave = useCallback(
        (materialItemId: string) => {
            pendingRef.current.add(materialItemId);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
        },
        [flush],
    );

    // 画面を離れる前に取りこぼしを送る
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            void flush();
        };
    }, [flush]);

    const setQuantity = useCallback(
        (materialItemId: string, raw: string) => {
            // 数字だけ通す（全角・記号・マイナスは弾く）。空文字は「未入力」として残す
            const cleaned = raw.replace(/[^0-9]/g, '');
            setDrafts((prev) => {
                const next = { ...prev, [materialItemId]: cleaned };
                try {
                    localStorage.setItem(localDraftKey(stocktakeId), JSON.stringify(next));
                } catch {
                    // 容量超過や private mode では一時保存を諦める（サーバー保存は動く）
                }
                return next;
            });
            scheduleSave(materialItemId);
        },
        [scheduleSave, stocktakeId],
    );

    const saveNow = useCallback(async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        await flush();
        if (pendingRef.current.size === 0) toast.success('保存しました');
    }, [flush]);

    // --- 確定 -------------------------------------------------------------
    const confirm = useCallback(async () => {
        if (confirmLockRef.current) return;
        const counted = Object.values(draftsRef.current).filter((v) => v !== '').length;
        const total = Object.keys(draftsRef.current).length;
        const message =
            counted < total
                ? `${total}品目のうち ${counted}品目だけ入力されています。\n数えていない品目は前回の数のまま残ります。確定しますか？`
                : `${counted}品目を確定して在庫に反映します。よろしいですか？`;
        if (!window.confirm(message)) return;

        confirmLockRef.current = true;
        setIsConfirming(true);
        try {
            if (timerRef.current) clearTimeout(timerRef.current);
            await flush();
            const res = await fetch(`/api/materials/stocktakes/${stocktakeId}/confirm`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? '確定に失敗しました');
            toast.success(`確定しました（在庫を更新: ${data.appliedCount}品目）`);
            try {
                localStorage.removeItem(localDraftKey(stocktakeId));
            } catch {
                // 一時保存が消せなくても確定済みなら次回読み込みで上書きされる
            }
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '確定に失敗しました');
        } finally {
            confirmLockRef.current = false;
            setIsConfirming(false);
        }
    }, [flush, load, stocktakeId]);

    // --- 表示用の絞り込み --------------------------------------------------
    const filteredCategories = useMemo(() => {
        if (!detail) return [];
        const term = searchTerm.trim().toLowerCase();
        return detail.categories
            .map((cat) => {
                const items = cat.items.filter((item) => {
                    if (uncountedOnly && (drafts[item.materialItemId] ?? '') !== '') return false;
                    if (!term) return true;
                    return (
                        cat.name.toLowerCase().includes(term) ||
                        item.name.toLowerCase().includes(term) ||
                        (item.spec ?? '').toLowerCase().includes(term)
                    );
                });
                return { ...cat, items };
            })
            .filter((cat) => cat.items.length > 0);
    }, [detail, drafts, searchTerm, uncountedOnly]);

    const countedCount = useMemo(() => Object.values(drafts).filter((v) => v !== '').length, [drafts]);
    const totalCount = detail?.lineCount ?? 0;
    const progress = totalCount ? Math.round((countedCount / totalCount) * 100) : 0;

    const toggleCategory = useCallback((id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    /** そのカテゴリの未入力行に前回値をまとめて入れる（変化が無かったとき用） */
    const fillCategoryWithPrevious = useCallback(
        (cat: StocktakeCategoryDto) => {
            const targets = cat.items.filter(
                (i) => (drafts[i.materialItemId] ?? '') === '' && i.previousQuantity !== null,
            );
            if (targets.length === 0) {
                toast('前回値を入れられる未入力の品目がありません');
                return;
            }
            setDrafts((prev) => {
                const next = { ...prev };
                for (const item of targets) next[item.materialItemId] = String(item.previousQuantity);
                try {
                    localStorage.setItem(localDraftKey(stocktakeId), JSON.stringify(next));
                } catch {
                    // 一時保存できなくてもサーバー保存は動く
                }
                return next;
            });
            for (const item of targets) scheduleSave(item.materialItemId);
            toast.success(`${targets.length}品目に前回値を入れました`);
        },
        [drafts, scheduleSave, stocktakeId],
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
            </div>
        );
    }
    if (!detail) {
        return (
            <div className="p-6">
                <Button variant="outline" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
                    戻る
                </Button>
                <p className="mt-4 text-sm text-slate-500">棚卸が見つかりませんでした。</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* 見出し（スクロールしても残す） */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <Button variant="ghost" size="icon" aria-label="戻る" onClick={onBack}>
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-base font-semibold text-slate-800">
                                    {formatJstDate(detail.date)}
                                </span>
                                <span className="text-sm text-slate-500">
                                    {detail.location.name} / {detail.scaffoldMethod === 'lock' ? 'ロック足場' : '通常足場'}
                                </span>
                                {isConfirmed && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-medium">
                                        <CheckCircle2 className="w-3 h-3" />
                                        確定済み
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                {countedCount} / {totalCount} 品目を入力
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <a
                            href={`/api/materials/stocktakes/${stocktakeId}/sheet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                        >
                            <Printer className="w-4 h-4" />
                            チェックシート
                        </a>
                        {!isConfirmed && (
                            <>
                                <Button variant="outline" leftIcon={<Save className="w-4 h-4" />} onClick={() => void saveNow()}>
                                    保存
                                </Button>
                                {canConfirm && (
                                    <Button
                                        variant="primary"
                                        leftIcon={<Check className="w-4 h-4" />}
                                        isLoading={isConfirming}
                                        onClick={() => void confirm()}
                                    >
                                        確定
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* 進捗と保存状態 */}
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 w-10 text-right">{progress}%</span>
                    {saveState === 'saving' && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            保存中
                        </span>
                    )}
                    {saveState === 'saved' && <span className="text-xs text-teal-600">保存済み</span>}
                    {saveState === 'error' && (
                        <span className="flex items-center gap-1 text-xs text-amber-600">
                            <CloudOff className="w-3 h-3" />
                            未送信（電波が戻ると再送されます）
                        </span>
                    )}
                </div>

                {!isConfirmed && (
                    <div className="flex items-center gap-2">
                        <div className="flex-1">
                            <MaterialSearchBar value={searchTerm} onChange={setSearchTerm} placeholder="品名で探す" />
                        </div>
                        <button
                            type="button"
                            onClick={() => setUncountedOnly((v) => !v)}
                            className={`px-3 py-2 rounded-xl text-sm border transition-colors ${
                                uncountedOnly
                                    ? 'bg-teal-50 border-teal-200 text-teal-700'
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            未入力のみ
                        </button>
                    </div>
                )}
            </div>

            {/* 明細 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {filteredCategories.length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-12">
                        {uncountedOnly ? 'すべての品目が入力済みです' : '該当する品目がありません'}
                    </p>
                )}
                {filteredCategories.map((cat) => {
                    const catCounted = cat.items.filter((i) => (drafts[i.materialItemId] ?? '') !== '').length;
                    return (
                        <CollapsibleCategory
                            key={cat.id}
                            name={cat.name}
                            itemCount={cat.items.length}
                            totalLabel={`${catCounted}件入力`}
                            isExpanded={expanded.has(cat.id) || !!searchTerm}
                            onToggle={() => toggleCategory(cat.id)}
                        >
                            {!isConfirmed && (
                                <div className="px-4 py-2 bg-slate-50/60 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => fillCategoryWithPrevious(cat)}
                                        className="text-xs text-teal-600 hover:text-teal-700 hover:underline"
                                    >
                                        未入力に前回値を入れる
                                    </button>
                                </div>
                            )}
                            {cat.items.map((item) => {
                                const value = drafts[item.materialItemId] ?? '';
                                const changed =
                                    value !== '' &&
                                    item.previousQuantity !== null &&
                                    Number(value) !== item.previousQuantity;
                                return (
                                    <div key={item.materialItemId} className="flex items-center gap-3 px-4 py-2.5">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm text-slate-700 truncate">{item.name}</p>
                                            <p className="text-xs text-slate-400">
                                                前回
                                                {item.previousQuantity === null
                                                    ? ' —'
                                                    : ` ${item.previousQuantity.toLocaleString()}${item.unit}`}
                                                {item.previousDate ? `（${formatJstDate(item.previousDate)}）` : ''}
                                            </p>
                                        </div>
                                        {changed && (
                                            <span className="text-xs text-amber-600 shrink-0">
                                                {Number(value) > item.previousQuantity!
                                                    ? `+${(Number(value) - item.previousQuantity!).toLocaleString()}`
                                                    : (Number(value) - item.previousQuantity!).toLocaleString()}
                                            </span>
                                        )}
                                        <input
                                            // type="number" はスマホで空にしたとき値が飛ぶので text + inputMode で受ける
                                            type="text"
                                            inputMode="numeric"
                                            value={value}
                                            disabled={isConfirmed}
                                            onChange={(e) => setQuantity(item.materialItemId, e.target.value)}
                                            onFocus={(e) => e.currentTarget.select()}
                                            placeholder="—"
                                            className={`w-24 h-11 text-right text-base font-medium px-3 border rounded-xl shadow-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-500 ${
                                                value === '' ? 'border-slate-200 bg-white' : 'border-teal-200 bg-teal-50/40'
                                            }`}
                                        />
                                        <span className="text-xs text-slate-400 w-6 shrink-0">{item.unit}</span>
                                    </div>
                                );
                            })}
                        </CollapsibleCategory>
                    );
                })}
            </div>
        </div>
    );
}
