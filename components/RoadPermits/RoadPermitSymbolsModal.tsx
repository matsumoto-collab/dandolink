'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Check, FileUp, Pencil, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import { sendBroadcast } from '@/lib/broadcastChannel';
import SymbolThumbnail from '@/components/RoadPermits/Drawing/SymbolThumbnail';
import {
    defaultBarCountNote,
    defaultBarPitchMm,
    formatSymbolSize,
    sortRoadPermitSymbols,
} from '@/lib/roadPermit/symbols/normalize';
import {
    ROAD_PERMIT_SYMBOL_CATEGORIES,
    ROAD_PERMIT_SYMBOL_CATEGORY_LABELS,
    ROAD_PERMIT_SYMBOL_COUNT_UNITS,
} from '@/types/roadPermitSymbol';
import type {
    ParseJwwResponse,
    ParsedJwwBlock,
    RoadPermitSymbolCategory,
    RoadPermitSymbolCreatePayload,
    RoadPermitSymbolDto,
    RoadPermitSymbolUpdatePayload,
    RoadPermitSymbolsResponse,
} from '@/types/roadPermitSymbol';
import { ROAD_PERMIT_INPUT_CLASS, errorMessage } from './roadPermitUi';

interface RoadPermitSymbolsModalProps {
    onClose: () => void;
    /** 記号を登録・変更したとき（親が記号を読み直すなど） */
    onChanged?: () => void;
}

type Tab = 'list' | 'import';

/** 入力欄の中身（名前・分類・数量の数え方・コーンバー・出どころ）。登録と変更で同じ形 */
interface SymbolForm {
    name: string;
    category: RoadPermitSymbolCategory;
    countLabel: string;
    countUnit: string;
    countNote: string;
    isConeBar: boolean;
    /** コーンの間隔（mm）。文字で持つ（スマホで数の欄が空になる事故を避ける） */
    barPitch: string;
    sourceNote: string;
}

const UNIT_LIST_ID = 'road-permit-symbol-units';

function toHalfWidthDigits(s: string): string {
    return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** コーンの間隔の入力 → 数。空・読めない・0 以下なら null */
function parsePitch(s: string): number | null {
    const t = toHalfWidthDigits(s.trim()).replace(/,/g, '');
    if (!/^\d{1,6}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= 100_000 ? n : null;
}

function formFromSymbol(s: RoadPermitSymbolDto): SymbolForm {
    return {
        name: s.name,
        category: s.category,
        countLabel: s.countLabel,
        countUnit: s.countUnit,
        countNote: s.countNote,
        isConeBar: s.barPitchMm != null,
        barPitch: s.barPitchMm != null ? String(s.barPitchMm) : String(defaultBarPitchMm(s.lengthMm, s.widthMm)),
        sourceNote: s.sourceNote,
    };
}

function formFromBlock(b: ParsedJwwBlock): SymbolForm {
    return {
        name: b.name,
        category: 'other',
        countLabel: '',
        countUnit: '',
        countNote: '',
        isConeBar: false,
        barPitch: String(defaultBarPitchMm(b.lengthMm, b.widthMm)),
        sourceNote: '',
    };
}

/** 入力の確かめ。問題があれば画面に出す文、無ければ null */
function formProblem(f: SymbolForm): string | null {
    if (f.name.trim() === '') return '名前を入れてください';
    if (f.isConeBar && parsePitch(f.barPitch) == null) return 'コーンの間隔を 1 以上の整数（mm）で入れてください';
    return null;
}

/** 数量の数え方の表示（例「カラーコーン ／個」。空なら「数えない」） */
function countText(s: Pick<RoadPermitSymbolDto, 'countLabel' | 'countUnit' | 'countNote'>): string {
    if (!s.countLabel) return '数えない';
    const note = s.countNote ? `（${s.countNote}）` : '';
    return `${s.countLabel}${note} ／${s.countUnit || '—'}`;
}

/**
 * 「記号の登録」画面（docs/指示書_道路申請_Phase2b_記号.md §4）。
 * - 一覧: 下絵・名前・分類・数量の数え方・大きさ・出どころ・使う／使わない・並び順（同じ分類の中で上下）。「変更」で名前などを直す（形は変えない）
 * - JWW から取り込む: ファイルを選ぶ → ブロックの下絵が並ぶ → チェックしたものを 1 件ずつ入力して「登録」
 * 保存できたら road_permit_symbols_updated を送る（作図画面のパレットが読み直す）。
 */
export default function RoadPermitSymbolsModal({ onClose, onChanged }: RoadPermitSymbolsModalProps) {
    const [tab, setTab] = useState<Tab>('list');
    const [symbols, setSymbols] = useState<RoadPermitSymbolDto[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // 二重押しを防ぐ同期ロック（state の反映を待たずに止める）
    const lockRef = useRef(false);

    // 一覧の「変更」
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<SymbolForm | null>(null);

    // 取り込み
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [parsed, setParsed] = useState<ParseJwwResponse | null>(null);
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [drafts, setDrafts] = useState<Record<string, SymbolForm>>({});
    const [registered, setRegistered] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const res = await fetch('/api/road-permits/symbols', { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, '記号の読み込みに失敗しました'));
            const json = (await res.json()) as RoadPermitSymbolsResponse;
            setSymbols(sortRoadPermitSymbols(json.symbols));
        } catch (e) {
            logger.error('道路申請の記号の読み込み失敗:', e);
            setLoadError(e instanceof Error ? e.message : '記号の読み込みに失敗しました');
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const pendingImports = useMemo(
        () => Object.keys(checked).filter((k) => checked[k] && !registered[k]).length,
        [checked, registered],
    );
    const isDirty = editingId !== null || pendingImports > 0;

    const requestClose = useCallback(() => {
        if (lockRef.current) return;
        if (isDirty && !window.confirm('登録・保存していない入力があります。閉じますか？')) return;
        onClose();
    }, [isDirty, onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            requestClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [requestClose]);

    /** 保存の共通処理（ロック・broadcast・親への知らせ）。成功なら true */
    const runSave = async (fn: () => Promise<RoadPermitSymbolDto | null>, failMessage: string): Promise<RoadPermitSymbolDto | null> => {
        if (lockRef.current) return null;
        lockRef.current = true;
        setBusy(true);
        try {
            const dto = await fn();
            if (dto) {
                sendBroadcast('road_permit_symbols_updated', { id: dto.id });
                onChanged?.();
            }
            return dto;
        } catch (e) {
            logger.error(`道路申請の記号: ${failMessage}`, e);
            toast.error(e instanceof Error ? e.message : failMessage);
            return null;
        } finally {
            lockRef.current = false;
            setBusy(false);
        }
    };

    const putSymbol = async (id: string, patch: RoadPermitSymbolUpdatePayload, fail: string): Promise<RoadPermitSymbolDto> => {
        const res = await fetch(`/api/road-permits/symbols/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(await errorMessage(res, fail));
        return (await res.json()) as RoadPermitSymbolDto;
    };

    const replaceSymbol = (dto: RoadPermitSymbolDto) =>
        setSymbols((list) => (list ? sortRoadPermitSymbols(list.map((s) => (s.id === dto.id ? dto : s))) : list));

    // ------------------------------------------------------------ 一覧の操作

    const toggleActive = async (s: RoadPermitSymbolDto) => {
        const dto = await runSave(() => putSymbol(s.id, { isActive: !s.isActive }, '使う／使わないの保存に失敗しました'), '使う／使わないの保存に失敗しました');
        if (dto) replaceSymbol(dto);
    };

    /** 同じ分類の中で 1 つ上／下と入れ替える（並び順を 0,1,2… に振り直して、変わったものだけ保存） */
    const move = async (s: RoadPermitSymbolDto, dir: -1 | 1) => {
        if (!symbols) return;
        const group = symbols.filter((x) => x.category === s.category);
        const i = group.findIndex((x) => x.id === s.id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= group.length) return;
        const next = group.slice();
        [next[i], next[j]] = [next[j], next[i]];
        const changes = next.map((x, idx) => ({ x, idx })).filter(({ x, idx }) => x.sortOrder !== idx);
        const fail = '並び順の保存に失敗しました';
        const updated: RoadPermitSymbolDto[] = [];
        const last = await runSave(async () => {
            for (const { x, idx } of changes) updated.push(await putSymbol(x.id, { sortOrder: idx }, fail));
            return updated[updated.length - 1] ?? null;
        }, fail);
        if (updated.length > 0) {
            setSymbols((list) => {
                if (!list) return list;
                const map = new Map(updated.map((u) => [u.id, u]));
                return sortRoadPermitSymbols(list.map((x) => map.get(x.id) ?? x));
            });
        }
        // 途中で失敗したら、画面の並びを DB にそろえ直す
        if (!last && changes.length > 0) void load();
    };

    const startEdit = (s: RoadPermitSymbolDto) => {
        if (editingId && editingId !== s.id && !window.confirm('変更中の記号があります。保存せずに別の記号を開きますか？')) return;
        setEditingId(s.id);
        setEditForm(formFromSymbol(s));
    };

    const saveEdit = async () => {
        if (!editingId || !editForm) return;
        const problem = formProblem(editForm);
        if (problem) {
            toast.error(problem);
            return;
        }
        const patch: RoadPermitSymbolUpdatePayload = {
            name: editForm.name.trim(),
            category: editForm.category,
            countLabel: editForm.countLabel.trim(),
            countUnit: editForm.countUnit.trim(),
            countNote: editForm.countNote.trim(),
            barPitchMm: editForm.isConeBar ? parsePitch(editForm.barPitch) : null,
            sourceNote: editForm.sourceNote.trim(),
        };
        const dto = await runSave(() => putSymbol(editingId, patch, '記号の保存に失敗しました'), '記号の保存に失敗しました');
        if (dto) {
            replaceSymbol(dto);
            setEditingId(null);
            setEditForm(null);
            toast.success('記号を保存しました');
        }
    };

    // ------------------------------------------------------------ 取り込み

    const handleFile = async (file: File | undefined) => {
        if (!file || lockRef.current) return;
        if (pendingImports > 0 && !window.confirm('登録していないチェックがあります。別のファイルを読みますか？')) return;
        lockRef.current = true;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/road-permits/symbols/parse', { method: 'POST', body: fd });
            // 413＝サーバーの受け取れる大きさ（Vercel は約 4.5MB）を超えた。応答は JSON ではない
            if (res.status === 413) throw new Error('ファイルが大きすぎて送れませんでした（4.5MB まで）');
            if (!res.ok) throw new Error(await errorMessage(res, 'JWW の読み込みに失敗しました'));
            const json = (await res.json()) as ParseJwwResponse;
            setParsed(json);
            setChecked({});
            setDrafts({});
            setRegistered({});
        } catch (e) {
            logger.error('道路申請の記号: JWW の読み込み失敗', e);
            toast.error(e instanceof Error ? e.message : 'JWW の読み込みに失敗しました');
        } finally {
            lockRef.current = false;
            setBusy(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const toggleBlock = (b: ParsedJwwBlock) => {
        setChecked((c) => ({ ...c, [b.key]: !c[b.key] }));
        setDrafts((d) => (d[b.key] ? d : { ...d, [b.key]: formFromBlock(b) }));
    };

    const updateDraft = (key: string, patch: Partial<SymbolForm>) =>
        setDrafts((d) => (d[key] ? { ...d, [key]: { ...d[key], ...patch } } : d));

    const registerBlock = async (b: ParsedJwwBlock) => {
        const f = drafts[b.key];
        if (!f || !parsed) return;
        const problem = formProblem(f);
        if (problem) {
            toast.error(problem);
            return;
        }
        const payload: RoadPermitSymbolCreatePayload = {
            name: f.name.trim(),
            category: f.category,
            countLabel: f.countLabel.trim(),
            countUnit: f.countUnit.trim(),
            countNote: f.countNote.trim(),
            geometry: b.geometry,
            lengthMm: b.lengthMm,
            widthMm: b.widthMm,
            barPitchMm: f.isConeBar ? parsePitch(f.barPitch) : null,
            sourceFile: parsed.fileName,
            sourceBlock: b.rawName,
            sourceNote: f.sourceNote.trim(),
        };
        const fail = '記号の登録に失敗しました';
        const dto = await runSave(async () => {
            const res = await fetch('/api/road-permits/symbols', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await errorMessage(res, fail));
            return (await res.json()) as RoadPermitSymbolDto;
        }, fail);
        if (dto) {
            setRegistered((r) => ({ ...r, [b.key]: dto.id }));
            setSymbols((list) => sortRoadPermitSymbols([...(list ?? []), dto]));
            toast.success(`「${dto.name}」を登録しました`);
        }
    };

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pwa-modal-offset-safe">
            <div className="absolute inset-0 bg-black/50" onClick={requestClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="記号の登録"
                className="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl"
            >
                <datalist id={UNIT_LIST_ID}>
                    {ROAD_PERMIT_SYMBOL_COUNT_UNITS.map((u) => (
                        <option key={u} value={u} />
                    ))}
                </datalist>

                {/* ヘッダー */}
                <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-slate-900">記号の登録</h2>
                        <p className="mt-0.5 text-xs text-slate-500">図面の右の「記号」に出る記号です。JWW から取り込んで登録します</p>
                    </div>
                    <button
                        type="button"
                        onClick={requestClose}
                        title="閉じる"
                        aria-label="閉じる"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* タブ */}
                <div className="flex flex-shrink-0 gap-1 border-b border-slate-200 px-4 pt-2" role="tablist">
                    {(
                        [
                            ['list', `一覧${symbols ? `（${symbols.length}）` : ''}`],
                            ['import', 'JWW から取り込む'],
                        ] as const
                    ).map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={tab === id}
                            onClick={() => setTab(id)}
                            className={`-mb-px rounded-t-md border px-3 py-1.5 text-sm ${
                                tab === id ? 'border-slate-200 border-b-white bg-white font-semibold text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* 本文 */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {tab === 'list' ? (
                        <ListView
                            symbols={symbols}
                            loadError={loadError}
                            busy={busy}
                            editingId={editingId}
                            editForm={editForm}
                            onReload={() => void load()}
                            onToggleActive={(s) => void toggleActive(s)}
                            onMove={(s, d) => void move(s, d)}
                            onStartEdit={startEdit}
                            onChangeEdit={(p) => setEditForm((f) => (f ? { ...f, ...p } : f))}
                            onCancelEdit={() => {
                                setEditingId(null);
                                setEditForm(null);
                            }}
                            onSaveEdit={() => void saveEdit()}
                            onGoImport={() => setTab('import')}
                        />
                    ) : (
                        <div className="space-y-3">
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                大きさが図に書かれた寸法と合っているか確かめてください（トラックの幅はミラーのぶん大きく出ます）。
                                登録したあとは形を変えられません。
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".jww,.jws"
                                    className="hidden"
                                    aria-label="JWW のファイル"
                                    data-testid="symbol-file-input"
                                    onChange={(e) => void handleFile(e.target.files?.[0])}
                                />
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={busy}
                                    isLoading={busy && !parsed}
                                    leftIcon={<FileUp className="h-4 w-4" />}
                                >
                                    ファイルを選ぶ（.jww）
                                </Button>
                                {parsed && (
                                    <span className="text-sm text-slate-600">
                                        {parsed.fileName}・ブロック {parsed.blocks.length} 個
                                    </span>
                                )}
                            </div>

                            {parsed && parsed.warnings.length > 0 && (
                                <ul className="list-disc space-y-0.5 rounded-md border border-slate-200 bg-slate-50 py-2 pl-7 pr-3 text-xs text-slate-700">
                                    {parsed.warnings.map((w, i) => (
                                        <li key={i}>{w}</li>
                                    ))}
                                </ul>
                            )}

                            {parsed && (
                                <>
                                    <p className="text-xs text-slate-500">登録したいものにチェックを入れ、名前などを入れて「登録」を押してください（1 件ずつ）</p>
                                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        {parsed.blocks.map((b) => (
                                            <ImportBlockCard
                                                key={b.key}
                                                block={b}
                                                checked={!!checked[b.key]}
                                                draft={drafts[b.key]}
                                                registeredId={registered[b.key]}
                                                busy={busy}
                                                onToggle={() => toggleBlock(b)}
                                                onChange={(p) => updateDraft(b.key, p)}
                                                onRegister={() => void registerBlock(b)}
                                            />
                                        ))}
                                    </ul>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* フッター */}
                <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
                    <Button type="button" variant="outline" size="sm" onClick={requestClose} disabled={busy}>
                        閉じる
                    </Button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

interface ListViewProps {
    symbols: RoadPermitSymbolDto[] | null;
    loadError: string | null;
    busy: boolean;
    editingId: string | null;
    editForm: SymbolForm | null;
    onReload: () => void;
    onToggleActive: (s: RoadPermitSymbolDto) => void;
    onMove: (s: RoadPermitSymbolDto, dir: -1 | 1) => void;
    onStartEdit: (s: RoadPermitSymbolDto) => void;
    onChangeEdit: (patch: Partial<SymbolForm>) => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void;
    onGoImport: () => void;
}

function ListView(props: ListViewProps) {
    const { symbols, loadError, busy, editingId, editForm } = props;
    if (!symbols) {
        if (loadError) {
            return (
                <div className="flex flex-col items-center gap-2 py-8">
                    <p className="text-sm text-red-600">{loadError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={props.onReload}>
                        読み直す
                    </Button>
                </div>
            );
        }
        return <p className="py-8 text-center text-sm text-slate-500">記号を読み込み中…</p>;
    }
    if (symbols.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-8">
                <p className="text-sm text-slate-500">記号はまだありません。「JWW から取り込む」で登録してください</p>
                <Button type="button" variant="outline" size="sm" onClick={props.onGoImport} leftIcon={<FileUp className="h-4 w-4" />}>
                    JWW から取り込む
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <p className="text-xs text-slate-500">
                形は変えられません（直したいときは取り込み直して別の記号にしてください）。「使わない」にした記号は、図面の右の「記号」から消えるだけで、過去の図面には出続けます。
            </p>
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {symbols.map((s) => {
                    const group = symbols.filter((x) => x.category === s.category);
                    const gi = group.findIndex((x) => x.id === s.id);
                    const isEditing = editingId === s.id && editForm;
                    return (
                        <li key={s.id} className={`px-3 py-2 ${s.isActive ? '' : 'bg-slate-50'}`} data-testid="symbol-row">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex-shrink-0 rounded border border-slate-200 bg-white">
                                    <SymbolThumbnail geometry={s.geometry} size={56} title={s.name} />
                                </div>
                                <div className="min-w-[10rem] flex-1">
                                    <div className={`text-sm font-medium ${s.isActive ? 'text-slate-900' : 'text-slate-400'}`}>{s.name}</div>
                                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                                        <span>{ROAD_PERMIT_SYMBOL_CATEGORY_LABELS[s.category]}</span>
                                        <span>{countText(s)}</span>
                                        <span>{formatSymbolSize(s)}</span>
                                        {s.barPitchMm != null && <span>コーンの間隔 {s.barPitchMm.toLocaleString('ja-JP')}</span>}
                                        {s.sourceNote && <span>出どころ: {s.sourceNote}</span>}
                                    </div>
                                </div>
                                <div className="flex flex-shrink-0 items-center gap-1">
                                    <label className="mr-1 flex cursor-pointer items-center gap-1 text-xs text-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={s.isActive}
                                            disabled={busy}
                                            onChange={() => props.onToggleActive(s)}
                                            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                        />
                                        使う
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => props.onMove(s, -1)}
                                        disabled={busy || gi <= 0}
                                        title="上へ（同じ分類の中）"
                                        aria-label={`${s.name}を上へ`}
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                    >
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => props.onMove(s, 1)}
                                        disabled={busy || gi < 0 || gi >= group.length - 1}
                                        title="下へ（同じ分類の中）"
                                        aria-label={`${s.name}を下へ`}
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                    >
                                        <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => props.onStartEdit(s)}
                                        disabled={busy || !!isEditing}
                                        leftIcon={<Pencil className="h-3.5 w-3.5" />}
                                    >
                                        変更
                                    </Button>
                                </div>
                            </div>
                            {isEditing && (
                                <div className="mt-2 rounded-md border border-teal-200 bg-teal-50/40 p-2">
                                    <SymbolFormFields form={editForm} lengthMm={s.lengthMm} widthMm={s.widthMm} onChange={props.onChangeEdit} idPrefix={`edit-${s.id}`} />
                                    <div className="mt-2 flex justify-end gap-2">
                                        <Button type="button" variant="outline" size="sm" onClick={props.onCancelEdit} disabled={busy}>
                                            やめる
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="primary"
                                            size="sm"
                                            onClick={props.onSaveEdit}
                                            disabled={busy}
                                            isLoading={busy}
                                            leftIcon={<Save className="h-4 w-4" />}
                                        >
                                            保存
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 取り込みの 1 ブロック
// ---------------------------------------------------------------------------

interface ImportBlockCardProps {
    block: ParsedJwwBlock;
    checked: boolean;
    draft: SymbolForm | undefined;
    registeredId: string | undefined;
    busy: boolean;
    onToggle: () => void;
    onChange: (patch: Partial<SymbolForm>) => void;
    onRegister: () => void;
}

function ImportBlockCard({ block: b, checked, draft, registeredId, busy, onToggle, onChange, onRegister }: ImportBlockCardProps) {
    const showForm = checked && draft && !registeredId;
    return (
        <li
            className={`rounded-md border p-2 ${registeredId ? 'border-teal-300 bg-teal-50' : checked ? 'border-teal-400 bg-white' : 'border-slate-200 bg-white'} ${
                showForm ? 'sm:col-span-2 lg:col-span-3' : ''
            }`}
            data-testid="import-block"
        >
            <label className="flex cursor-pointer items-start gap-2">
                <input
                    type="checkbox"
                    checked={checked || !!registeredId}
                    disabled={!!registeredId}
                    onChange={onToggle}
                    aria-label={`${b.name}を登録する`}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <div className="flex-shrink-0 rounded border border-slate-200 bg-white">
                    <SymbolThumbnail geometry={b.geometry} size={72} title={b.name} />
                </div>
                <div className="min-w-0 flex-1 text-xs text-slate-600">
                    <div className="truncate text-sm font-medium text-slate-900" title={b.rawName}>
                        {b.name}
                    </div>
                    <div>大きさ {formatSymbolSize(b)}</div>
                    <div>線の本数 {b.primitiveCount.toLocaleString('ja-JP')}</div>
                    {b.simplified && (
                        <div className="text-amber-700">
                            簡略化しました（{b.simplified.before.toLocaleString('ja-JP')} → {b.simplified.after.toLocaleString('ja-JP')} 本）
                        </div>
                    )}
                    {b.scaleApplied !== 1 && <div className="text-amber-700">倍率 {b.scaleApplied} を掛けました</div>}
                    {b.nearbyTexts.length > 0 && <div className="truncate" title={b.nearbyTexts.join(' / ')}>近くの文字: {b.nearbyTexts.join(' / ')}</div>}
                    {registeredId && (
                        <div className="mt-0.5 flex items-center gap-1 font-medium text-teal-700">
                            <Check className="h-3.5 w-3.5" />
                            登録しました
                        </div>
                    )}
                </div>
            </label>
            {showForm && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                    <SymbolFormFields form={draft} lengthMm={b.lengthMm} widthMm={b.widthMm} onChange={onChange} idPrefix={`import-${b.key}`} />
                    <div className="mt-2 flex justify-end">
                        <Button type="button" variant="primary" size="sm" onClick={onRegister} disabled={busy} isLoading={busy} leftIcon={<Save className="h-4 w-4" />}>
                            登録
                        </Button>
                    </div>
                </div>
            )}
        </li>
    );
}

// ---------------------------------------------------------------------------
// 入力欄（登録・変更で共通）
// ---------------------------------------------------------------------------

interface SymbolFormFieldsProps {
    form: SymbolForm;
    lengthMm: number;
    widthMm: number;
    onChange: (patch: Partial<SymbolForm>) => void;
    idPrefix: string;
}

function SymbolFormFields({ form, lengthMm, widthMm, onChange, idPrefix }: SymbolFormFieldsProps) {
    const label = 'mb-0.5 block text-xs font-medium text-slate-600';
    return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
                <label htmlFor={`${idPrefix}-name`} className={label}>
                    名前（図面・凡例に出る）
                </label>
                <input id={`${idPrefix}-name`} type="text" value={form.name} onChange={(e) => onChange({ name: e.target.value })} className={ROAD_PERMIT_INPUT_CLASS} />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-category`} className={label}>
                    分類
                </label>
                <select
                    id={`${idPrefix}-category`}
                    value={form.category}
                    onChange={(e) => onChange({ category: e.target.value as RoadPermitSymbolCategory })}
                    className={ROAD_PERMIT_INPUT_CLASS}
                >
                    {ROAD_PERMIT_SYMBOL_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                            {ROAD_PERMIT_SYMBOL_CATEGORY_LABELS[c]}
                        </option>
                    ))}
                </select>
            </div>
            <div>
                <label htmlFor={`${idPrefix}-source`} className={label}>
                    出どころ（一覧にだけ出る）
                </label>
                <input
                    id={`${idPrefix}-source`}
                    type="text"
                    value={form.sourceNote}
                    placeholder="例: 配布元の名前"
                    onChange={(e) => onChange({ sourceNote: e.target.value })}
                    className={ROAD_PERMIT_INPUT_CLASS}
                />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-countLabel`} className={label}>
                    数量の名前（空なら数えない）
                </label>
                <input
                    id={`${idPrefix}-countLabel`}
                    type="text"
                    value={form.countLabel}
                    placeholder="例: カラーコーン"
                    onChange={(e) => onChange({ countLabel: e.target.value })}
                    className={ROAD_PERMIT_INPUT_CLASS}
                />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-countUnit`} className={label}>
                    単位
                </label>
                <input
                    id={`${idPrefix}-countUnit`}
                    type="text"
                    list={UNIT_LIST_ID}
                    value={form.countUnit}
                    placeholder="例: 個"
                    onChange={(e) => onChange({ countUnit: e.target.value })}
                    className={ROAD_PERMIT_INPUT_CLASS}
                />
            </div>
            <div>
                <label htmlFor={`${idPrefix}-countNote`} className={label}>
                    添え字（数量の文の括弧）
                </label>
                <input
                    id={`${idPrefix}-countNote`}
                    type="text"
                    value={form.countNote}
                    placeholder="例: 1.5m"
                    onChange={(e) => onChange({ countNote: e.target.value })}
                    className={ROAD_PERMIT_INPUT_CLASS}
                />
            </div>
            <div>
                <label className="mb-0.5 flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
                    <input
                        type="checkbox"
                        checked={form.isConeBar}
                        onChange={(e) => {
                            const on = e.target.checked;
                            onChange({
                                isConeBar: on,
                                ...(on && form.barPitch.trim() === '' ? { barPitch: String(defaultBarPitchMm(lengthMm, widthMm)) } : {}),
                                ...(on && form.countNote.trim() === '' ? { countNote: defaultBarCountNote(lengthMm) } : {}),
                            });
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    コーンバーとして使う
                </label>
                {form.isConeBar && (
                    <div className="flex items-center gap-1">
                        <input
                            id={`${idPrefix}-barPitch`}
                            type="text"
                            inputMode="numeric"
                            value={form.barPitch}
                            aria-label="コーンの間隔（mm）"
                            onChange={(e) => onChange({ barPitch: e.target.value })}
                            className={ROAD_PERMIT_INPUT_CLASS}
                        />
                        <span className="whitespace-nowrap text-xs text-slate-500">mm（コーンの間隔）</span>
                    </div>
                )}
            </div>
        </div>
    );
}
