'use client';

/**
 * 道路申請の「図面」タブ（JWW 風の作図画面）。指示書 docs/指示書_道路申請_Phase2.md §2・画面イメージ docs/道路申請_作図画面イメージ.html。
 * - 上＝コントロールバー（いまの操作の設定）／左＝操作ボタン／中央＝用紙（DrawingCanvas）／右＝レイヤと設定／下＝ステータスバー
 * - 状態と操作は editorModel.ts の reducer。この画面は描いて、出来事を action にして渡すだけ
 * - 図形・レイヤ・設定が変わるたびに onChange（保存は編集画面の「保存」ボタン。自動保存はしない）
 */
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Lock, Printer, Redo2, Undo2, Unlock } from 'lucide-react';
import type {
    DrawingEntity,
    DrawingLayerId,
    DrawingScale,
    HatchPattern,
    LineType,
    LineWidth,
    PaperOrientation,
    PaperSize,
    RoadPermitDrawing,
} from '@/types/roadPermitDrawing';
import { DRAWING_SCALES } from '@/types/roadPermitDrawing';
import type { RoadPermitValues } from '@/types/roadPermit';
import { DRAWING_LAYER_COLORS, emptyRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import { originToFit, paperLabel, scaleLabel } from '@/lib/roadPermit/drawing/paper';
import { entitiesBBox } from '@/lib/roadPermit/drawing/geometry';
import {
    COMMAND_LABELS,
    DIMENSION_TOOL_LABELS,
    DRAW_COMMANDS,
    EDIT_COMMANDS,
    MEASURE_COMMANDS,
    editorReducer,
    guidance,
    initialEditorState,
    realToScreen,
    titleBlockDefaults,
    zoomPercent,
    type AttributePatch,
    type CommandId,
    type DimensionToolMode,
    type EditorAction,
    type EditorState,
} from './editorModel';

const DrawingCanvas = dynamic(() => import('./DrawingCanvas'), {
    ssr: false,
    loading: () => <div className="absolute inset-0 flex items-center justify-center bg-slate-300 text-sm text-slate-600">用紙を読み込んでいます…</div>,
});

export interface DrawingEditorProps {
    value: RoadPermitDrawing | null;
    onChange: (next: RoadPermitDrawing) => void;
    /** 表題欄の既定（場所・路線名・期間・作成）を出すため */
    values: RoadPermitValues;
}

const LINE_TYPE_LABELS: Record<LineType, string> = { solid: '実線', dashed: '破線', dashdot: '一点鎖線', dotted: '点線' };
const LINE_WIDTH_LABELS: Record<LineWidth, string> = { thin: '細', normal: '普通', thick: '太' };
const HATCH_LABELS: Record<HatchPattern, string> = { diagonal: '斜線', cross: '格子', solid: '塗りつぶし' };

const ctlInput = 'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500';
const ctlLabel = 'flex items-center gap-1 whitespace-nowrap text-sm text-slate-700';
const panelTitle = 'border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-800';

function isTypingTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

export default function DrawingEditor({ value, onChange, values }: DrawingEditorProps) {
    const [state, dispatch] = useReducer(editorReducer, undefined, () => initialEditorState(value ?? emptyRoadPermitDrawing()));
    const [spaceDown, setSpaceDown] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // ---- 親（編集画面の form）との同期 ----
    // 自分で出した図面は覚えておき、親から違うもの（保存後にサーバーが整えたもの・別の申請）が来たら取り込む
    const lastRef = useRef<RoadPermitDrawing>(state.drawing);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        if (state.drawing === lastRef.current) return;
        lastRef.current = state.drawing;
        onChangeRef.current(state.drawing);
    }, [state.drawing]);
    useEffect(() => {
        if (!value || value === lastRef.current) return;
        lastRef.current = value;
        dispatch({ type: 'replaceDrawing', drawing: value });
    }, [value]);

    const { drawing } = state;

    // ---- キーボード ----
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (isTypingTarget(e.target)) return;
        const key = e.key;
        if (key === 'Escape') {
            e.preventDefault();
            dispatch({ type: 'esc' });
        } else if (key === 'Enter') {
            e.preventDefault();
            dispatch({ type: 'finish' });
        } else if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'Z')) {
            e.preventDefault();
            dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || key === 'Y')) {
            e.preventDefault();
            dispatch({ type: 'redo' });
        } else if (key === 'Delete' || key === 'Backspace') {
            e.preventDefault();
            dispatch({ type: 'deleteSelection' });
        } else if (key === ' ') {
            e.preventDefault();
            setSpaceDown(true);
        }
    };
    const onKeyUp = (e: React.KeyboardEvent) => {
        if (e.key === ' ') setSpaceDown(false);
    };

    // 最初に開いたとき、キーを受けられるようにしておく
    useEffect(() => {
        rootRef.current?.focus({ preventScroll: true });
    }, []);

    const startCommand = (c: CommandId) => {
        dispatch({ type: 'command', command: c });
        rootRef.current?.focus({ preventScroll: true });
    };

    const fitToPaper = () => {
        const bb = entitiesBBox(drawing.entities);
        if (!bb) {
            dispatch({ type: 'setMessage', message: 'まだ図形がありません' });
            return;
        }
        dispatch({ type: 'setOrigin', origin: originToFit(bb, drawing) });
        dispatch({ type: 'setMessage', message: '図形を用紙の真ん中に収めました（入りきらないときは縮尺を変えてください）' });
    };

    return (
        <div
            ref={rootRef}
            data-drawing-root
            tabIndex={0}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={() => setSpaceDown(false)}
            className="flex h-full min-h-[480px] flex-col bg-slate-200 outline-none"
        >
            <ControlBar state={state} dispatch={dispatch} />

            <div className="flex min-h-0 flex-1">
                <ToolPanel state={state} onCommand={startCommand} dispatch={dispatch} />

                {/* 中央: 用紙 */}
                <div className="relative min-w-0 flex-1">
                    <DrawingCanvas state={state} dispatch={dispatch} values={values} spaceDown={spaceDown} />
                    {state.prompt && <TextPrompt state={state} dispatch={dispatch} onDone={() => rootRef.current?.focus({ preventScroll: true })} />}
                </div>

                <SidePanel state={state} dispatch={dispatch} values={values} onFit={fitToPaper} />
            </div>

            <StatusBar state={state} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// 上: コントロールバー
// ---------------------------------------------------------------------------

function NumField({
    label,
    value,
    onChange,
    onEnter,
    unit,
    width = 'w-20',
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    onEnter?: () => void;
    unit?: string;
    width?: string;
    placeholder?: string;
}) {
    return (
        <label className={ctlLabel}>
            {label}
            <input
                type="text"
                inputMode="decimal"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        onEnter?.();
                    }
                }}
                className={`${ctlInput} ${width}`}
            />
            {unit && <span className="text-xs text-slate-500">{unit}</span>}
        </label>
    );
}

function LayerSelect({ value, onChange, layers }: { value: DrawingLayerId; onChange: (id: DrawingLayerId) => void; layers: RoadPermitDrawing['layers'] }) {
    return (
        <select value={value} onChange={(e) => onChange(Number(e.target.value) as DrawingLayerId)} className={ctlInput}>
            {layers.map((l) => (
                <option key={l.id} value={l.id}>
                    {l.id} {l.name}
                </option>
            ))}
        </select>
    );
}

function StyleFields({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
    const { settings, drawing } = state;
    return (
        <>
            <label className={ctlLabel}>
                線種
                <select value={settings.lineType} onChange={(e) => dispatch({ type: 'setSettings', patch: { lineType: e.target.value as LineType } })} className={ctlInput}>
                    {(Object.keys(LINE_TYPE_LABELS) as LineType[]).map((k) => (
                        <option key={k} value={k}>
                            {LINE_TYPE_LABELS[k]}
                        </option>
                    ))}
                </select>
            </label>
            <label className={ctlLabel}>
                太さ
                <select value={settings.lineWidth} onChange={(e) => dispatch({ type: 'setSettings', patch: { lineWidth: e.target.value as LineWidth } })} className={ctlInput}>
                    {(Object.keys(LINE_WIDTH_LABELS) as LineWidth[]).map((k) => (
                        <option key={k} value={k}>
                            {LINE_WIDTH_LABELS[k]}
                        </option>
                    ))}
                </select>
            </label>
            <label className={ctlLabel}>
                書込レイヤ
                <LayerSelect value={drawing.currentLayer} layers={drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
            </label>
        </>
    );
}

function TextHeightField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    return (
        <label className={ctlLabel}>
            文字の大きさ
            <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={ctlInput}>
                {[2, 2.5, 3, 3.5, 4, 5, 7, 10].map((v) => (
                    <option key={v} value={v}>
                        {v} mm
                    </option>
                ))}
            </select>
        </label>
    );
}

function ControlBar({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
    const { command, settings } = state;
    const set = (patch: Partial<EditorState['settings']>) => dispatch({ type: 'setSettings', patch });
    const numeric = () => dispatch({ type: 'numeric' });
    const lengthAngle = (
        <>
            <NumField label="長さ" value={settings.length} onChange={(v) => set({ length: v })} onEnter={numeric} unit="mm" placeholder="自由" />
            <NumField label="角度" value={settings.angle} onChange={(v) => set({ angle: v })} onEnter={numeric} unit="°" width="w-14" placeholder="自由" />
        </>
    );

    let fields: React.ReactNode = null;
    switch (command) {
        case 'line':
        case 'polyline':
            fields = (
                <>
                    {lengthAngle}
                    <StyleFields state={state} dispatch={dispatch} />
                </>
            );
            break;
        case 'double':
            fields = (
                <>
                    <NumField label="幅" value={settings.doubleWidth} onChange={(v) => set({ doubleWidth: v })} unit="mm" />
                    {lengthAngle}
                    <StyleFields state={state} dispatch={dispatch} />
                </>
            );
            break;
        case 'circle':
            fields = (
                <>
                    <NumField label="半径" value={settings.length} onChange={(v) => set({ length: v })} onEnter={numeric} unit="mm" placeholder="自由" />
                    <StyleFields state={state} dispatch={dispatch} />
                </>
            );
            break;
        case 'rect':
        case 'arc':
            fields = <StyleFields state={state} dispatch={dispatch} />;
            break;
        case 'text':
            fields = (
                <>
                    <TextHeightField value={settings.textHeight} onChange={(v) => set({ textHeight: v })} />
                    <NumField label="角度" value={settings.angle} onChange={(v) => set({ angle: v })} unit="°" width="w-14" placeholder="0" />
                    <label className={ctlLabel}>
                        書込レイヤ
                        <LayerSelect value={state.drawing.currentLayer} layers={state.drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
                    </label>
                </>
            );
            break;
        case 'leader':
            fields = (
                <>
                    <TextHeightField value={settings.textHeight} onChange={(v) => set({ textHeight: v })} />
                    <StyleFields state={state} dispatch={dispatch} />
                </>
            );
            break;
        case 'dimension':
            fields = (
                <>
                    <div className="flex overflow-hidden rounded border border-slate-300">
                        {(Object.keys(DIMENSION_TOOL_LABELS) as DimensionToolMode[]).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => {
                                    set({ dimMode: m });
                                    dispatch({ type: 'command', command: 'dimension' });
                                }}
                                className={`px-2 py-0.5 text-sm ${settings.dimMode === m ? 'bg-teal-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                            >
                                {DIMENSION_TOOL_LABELS[m]}
                            </button>
                        ))}
                    </div>
                    <TextHeightField value={settings.dimTextHeight} onChange={(v) => set({ dimTextHeight: v })} />
                    <label className={ctlLabel}>
                        書込レイヤ
                        <LayerSelect value={state.drawing.currentLayer} layers={state.drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
                    </label>
                </>
            );
            break;
        case 'hatch':
            fields = (
                <>
                    <label className={ctlLabel}>
                        模様
                        <select value={settings.hatchPattern} onChange={(e) => set({ hatchPattern: e.target.value as HatchPattern })} className={ctlInput}>
                            {(Object.keys(HATCH_LABELS) as HatchPattern[]).map((k) => (
                                <option key={k} value={k}>
                                    {HATCH_LABELS[k]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={ctlLabel}>
                        書込レイヤ
                        <LayerSelect value={state.drawing.currentLayer} layers={state.drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
                    </label>
                </>
            );
            break;
        case 'copy':
        case 'move':
        case 'rotate':
        case 'mirror':
            fields = (
                <>
                    <span className="text-sm text-slate-600">選んでいる図形: {state.selection.length} 個</span>
                    {state.phase === 'select' ? (
                        <button
                            type="button"
                            onClick={() => dispatch({ type: 'finish' })}
                            disabled={state.selection.length === 0}
                            className="rounded bg-teal-600 px-2 py-0.5 text-sm text-white hover:bg-teal-700 disabled:bg-slate-300"
                        >
                            選んだら次へ（Enter）
                        </button>
                    ) : command === 'rotate' ? (
                        <NumField label="回転角" value={settings.angle} onChange={(v) => set({ angle: v })} onEnter={numeric} unit="°" width="w-14" placeholder="点で指示" />
                    ) : command === 'mirror' ? null : (
                        lengthAngle
                    )}
                </>
            );
            break;
        case 'select':
        case 'attr':
            fields = <AttributeFields state={state} dispatch={dispatch} />;
            break;
        case 'erase':
            fields = <span className="text-sm text-slate-600">クリックした図形を消します。ドラッグで囲むとまとめて消します</span>;
            break;
        case 'measureDistance':
        case 'measureArea':
            fields = <span className="text-sm text-slate-600">結果は下の帯に出ます（図面には残りません）</span>;
            break;
    }

    return (
        <div className="flex min-h-[40px] flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-300 bg-slate-50 px-3 py-1.5">
            <span className="min-w-[5rem] text-sm font-semibold text-slate-900">{COMMAND_LABELS[command]}</span>
            {fields}
        </div>
    );
}

/** 範囲・属性: 選んだ図形の属性（レイヤ・線種・太さ・文字の大きさ）を変える */
function AttributeFields({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
    const selected = useMemo(() => {
        const set = new Set(state.selection);
        return state.drawing.entities.filter((e) => set.has(e.id));
    }, [state.selection, state.drawing.entities]);
    const first: DrawingEntity | undefined = selected[0];
    const [attr, setAttr] = useState<Required<AttributePatch>>({ layer: 0, lineType: 'solid', width: 'normal', heightPaperMm: 3 });
    const selKey = state.selection.join(',');
    useEffect(() => {
        if (!first) return;
        setAttr({
            layer: first.layer,
            lineType: first.style.lineType,
            width: first.style.width,
            heightPaperMm: first.kind === 'text' || first.kind === 'dimension' || first.kind === 'leader' ? first.heightPaperMm : 3,
        });
        // 選び直したときだけ欄を入れ直す
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selKey]);

    if (selected.length === 0) {
        return <span className="text-sm text-slate-600">図形をクリック、またはドラッグで囲んで選んでください（Shift で追加・Delete で消去）</span>;
    }
    const hasText = selected.some((e) => e.kind === 'text' || e.kind === 'dimension' || e.kind === 'leader');
    const editable = selected.length === 1 && hasText;
    return (
        <>
            <span className="text-sm text-slate-600">選んでいる図形: {selected.length} 個</span>
            <label className={ctlLabel}>
                レイヤ
                <LayerSelect value={attr.layer} layers={state.drawing.layers} onChange={(id) => setAttr((a) => ({ ...a, layer: id }))} />
            </label>
            <label className={ctlLabel}>
                線種
                <select value={attr.lineType} onChange={(e) => setAttr((a) => ({ ...a, lineType: e.target.value as LineType }))} className={ctlInput}>
                    {(Object.keys(LINE_TYPE_LABELS) as LineType[]).map((k) => (
                        <option key={k} value={k}>
                            {LINE_TYPE_LABELS[k]}
                        </option>
                    ))}
                </select>
            </label>
            <label className={ctlLabel}>
                太さ
                <select value={attr.width} onChange={(e) => setAttr((a) => ({ ...a, width: e.target.value as LineWidth }))} className={ctlInput}>
                    {(Object.keys(LINE_WIDTH_LABELS) as LineWidth[]).map((k) => (
                        <option key={k} value={k}>
                            {LINE_WIDTH_LABELS[k]}
                        </option>
                    ))}
                </select>
            </label>
            {hasText && <TextHeightField value={attr.heightPaperMm} onChange={(v) => setAttr((a) => ({ ...a, heightPaperMm: v }))} />}
            <button
                type="button"
                onClick={() => dispatch({ type: 'applyAttributes', patch: hasText ? attr : { layer: attr.layer, lineType: attr.lineType, width: attr.width } })}
                className="rounded bg-teal-600 px-2 py-0.5 text-sm text-white hover:bg-teal-700"
            >
                この属性にする
            </button>
            {editable && (
                <button
                    type="button"
                    onClick={() => dispatch({ type: 'editSelectedText' })}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-700 hover:bg-slate-100"
                >
                    {first?.kind === 'dimension' ? '寸法の文字を直す' : '文字を直す'}
                </button>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// 左: 操作ボタン
// ---------------------------------------------------------------------------

function ToolPanel({ state, onCommand, dispatch }: { state: EditorState; onCommand: (c: CommandId) => void; dispatch: React.Dispatch<EditorAction> }) {
    const btn = (c: CommandId) => (
        <button
            key={c}
            type="button"
            onClick={() => onCommand(c)}
            className={`whitespace-nowrap rounded border px-0.5 py-1 text-[13px] transition-colors ${
                state.command === c ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-slate-800 hover:bg-teal-50'
            }`}
        >
            {COMMAND_LABELS[c]}
        </button>
    );
    const group = (title: string, list: readonly CommandId[]) => (
        <div>
            <div className="mb-1 text-xs text-slate-500">{title}</div>
            <div className="grid grid-cols-2 gap-1">{list.map(btn)}</div>
        </div>
    );
    return (
        <div className="flex w-[8.5rem] flex-shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-300 bg-slate-100 p-2">
            {group('描く', DRAW_COMMANDS)}
            {group('直す', EDIT_COMMANDS)}
            {group('測る', MEASURE_COMMANDS)}
            <div className="mt-auto grid grid-cols-2 gap-1">
                <button
                    type="button"
                    onClick={() => dispatch({ type: 'undo' })}
                    disabled={state.past.length === 0}
                    title="戻る（Ctrl+Z）"
                    className="flex items-center justify-center gap-0.5 rounded border border-slate-300 bg-white py-1 text-sm text-slate-800 hover:bg-slate-50 disabled:text-slate-300"
                >
                    <Undo2 className="h-3.5 w-3.5" />
                    戻る
                </button>
                <button
                    type="button"
                    onClick={() => dispatch({ type: 'redo' })}
                    disabled={state.future.length === 0}
                    title="進む（Ctrl+Y）"
                    className="flex items-center justify-center gap-0.5 rounded border border-slate-300 bg-white py-1 text-sm text-slate-800 hover:bg-slate-50 disabled:text-slate-300"
                >
                    <Redo2 className="h-3.5 w-3.5" />
                    進む
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 右: レイヤと設定
// ---------------------------------------------------------------------------

function SidePanel({
    state,
    dispatch,
    values,
    onFit,
}: {
    state: EditorState;
    dispatch: React.Dispatch<EditorAction>;
    values: RoadPermitValues;
    onFit: () => void;
}) {
    const { drawing, view } = state;
    const def = useMemo(() => titleBlockDefaults(values), [values]);
    const tbFields: { key: keyof RoadPermitDrawing['titleBlock']; label: string }[] = [
        { key: 'drawingName', label: '図面名' },
        { key: 'location', label: '場所' },
        { key: 'routeName', label: '路線名' },
        { key: 'period', label: '期間' },
        { key: 'author', label: '作成' },
    ];
    const check = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
            {label}
        </label>
    );

    return (
        <div className="hidden w-64 flex-shrink-0 overflow-y-auto border-l border-slate-300 bg-slate-100 p-2 md:block">
            <section className="overflow-hidden rounded border border-slate-300 bg-white">
                <h3 className={panelTitle}>レイヤ</h3>
                <ul className="divide-y divide-slate-100">
                    {drawing.layers.map((l) => {
                        const current = drawing.currentLayer === l.id;
                        return (
                            <li key={l.id} className={`flex items-center gap-1.5 px-2 py-1 ${current ? 'bg-teal-100' : ''}`}>
                                <input
                                    type="checkbox"
                                    checked={l.visible}
                                    title="表示"
                                    aria-label={`${l.name}を表示`}
                                    onChange={(e) => dispatch({ type: 'setLayer', id: l.id, patch: { visible: e.target.checked } })}
                                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                />
                                <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: DRAWING_LAYER_COLORS[l.id] }} />
                                <button
                                    type="button"
                                    onClick={() => dispatch({ type: 'setCurrentLayer', id: l.id })}
                                    title="書込レイヤにする"
                                    className={`min-w-0 flex-1 truncate text-left text-sm ${current ? 'font-semibold text-slate-900' : 'text-slate-700 hover:text-teal-700'}`}
                                >
                                    {l.id} {l.name}
                                    {current && <span className="ml-1 text-xs text-teal-700">（書込中）</span>}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => dispatch({ type: 'setLayer', id: l.id, patch: { locked: !l.locked } })}
                                    title={l.locked ? 'ロック中（押すと外す）' : 'ロックする（選べなくする）'}
                                    aria-label={l.locked ? `${l.name}のロックを外す` : `${l.name}をロックする`}
                                    className={`rounded p-0.5 ${l.locked ? 'text-amber-600' : 'text-slate-300 hover:text-slate-500'}`}
                                >
                                    {l.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => dispatch({ type: 'setLayer', id: l.id, patch: { printable: !l.printable } })}
                                    title={l.printable ? '印刷する（押すと印刷しない）' : '印刷しない（押すと印刷する）'}
                                    aria-label={l.printable ? `${l.name}を印刷しない` : `${l.name}を印刷する`}
                                    className={`rounded p-0.5 ${l.printable ? 'text-slate-600' : 'text-slate-300 line-through'}`}
                                >
                                    <Printer className="h-3.5 w-3.5" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section className="mt-2 overflow-hidden rounded border border-slate-300 bg-white">
                <h3 className={panelTitle}>用紙と縮尺</h3>
                <div className="space-y-2 p-2">
                    <div className="flex items-center gap-2">
                        <select
                            value={drawing.paper.size}
                            onChange={(e) => dispatch({ type: 'setPaper', size: e.target.value as PaperSize })}
                            className={ctlInput}
                            aria-label="用紙の大きさ"
                        >
                            <option value="A3">A3</option>
                            <option value="A4">A4</option>
                        </select>
                        <select
                            value={drawing.paper.orientation}
                            onChange={(e) => dispatch({ type: 'setPaper', orientation: e.target.value as PaperOrientation })}
                            className={ctlInput}
                            aria-label="用紙の向き"
                        >
                            <option value="landscape">横</option>
                            <option value="portrait">縦</option>
                        </select>
                        <select
                            value={drawing.scale}
                            onChange={(e) => dispatch({ type: 'setScale', scale: Number(e.target.value) as DrawingScale })}
                            className={ctlInput}
                            aria-label="縮尺"
                        >
                            {DRAWING_SCALES.map((s) => (
                                <option key={s} value={s}>
                                    1/{s}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button type="button" onClick={onFit} className="w-full rounded border border-slate-300 bg-white py-1 text-sm text-slate-800 hover:bg-teal-50">
                        図形を用紙に収める
                    </button>
                    <button
                        type="button"
                        onClick={() => dispatch({ type: 'setView', patch: { initialized: false } })}
                        className="w-full rounded border border-slate-300 bg-white py-1 text-sm text-slate-800 hover:bg-teal-50"
                    >
                        用紙全体を表示
                    </button>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {check(view.showGrid, (v) => dispatch({ type: 'setView', patch: { showGrid: v } }), '方眼')}
                        {check(view.showPaperFrame, (v) => dispatch({ type: 'setView', patch: { showPaperFrame: v } }), '用紙枠')}
                    </div>
                </div>
            </section>

            <section className="mt-2 overflow-hidden rounded border border-slate-300 bg-white">
                <h3 className={panelTitle}>表題欄</h3>
                <div className="space-y-1.5 p-2">
                    {tbFields.map((f) => (
                        <label key={f.key} className="block text-xs text-slate-600">
                            {f.label}
                            <input
                                type="text"
                                value={drawing.titleBlock[f.key]}
                                placeholder={def[f.key] || '（空欄）'}
                                onChange={(e) => dispatch({ type: 'setTitleBlock', patch: { [f.key]: e.target.value } })}
                                className={`${ctlInput} mt-0.5 block w-full`}
                            />
                        </label>
                    ))}
                    <p className="text-xs text-slate-500">空の欄は申請の入力から入ります（薄い字）</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                        {check(drawing.showTitleBlock, (v) => dispatch({ type: 'setDrawingFlags', patch: { showTitleBlock: v } }), '表題欄')}
                        {check(drawing.showNorthArrow, (v) => dispatch({ type: 'setDrawingFlags', patch: { showNorthArrow: v } }), '方位')}
                        {check(drawing.showScaleBar, (v) => dispatch({ type: 'setDrawingFlags', patch: { showScaleBar: v } }), '縮尺バー')}
                    </div>
                </div>
            </section>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 文字を入れる小さなポップアップ
// ---------------------------------------------------------------------------

function TextPrompt({ state, dispatch, onDone }: { state: EditorState; dispatch: React.Dispatch<EditorAction>; onDone: () => void }) {
    const pr = state.prompt!;
    const [text, setText] = useState(pr.initial);
    const pos = realToScreen(state.drawing, state.view, pr.anchor);
    const title = pr.kind === 'leader' ? '引出線の文字' : pr.kind === 'edit' ? '文字を直す' : '文字';
    const submit = useCallback(() => {
        dispatch({ type: 'promptSubmit', text });
        onDone();
    }, [dispatch, text, onDone]);
    const cancel = () => {
        dispatch({ type: 'promptCancel' });
        onDone();
    };
    return (
        <div
            className="absolute z-10 w-64 rounded-md border border-slate-300 bg-white p-2 shadow-lg"
            style={{ left: Math.max(4, pos.x + 8), top: Math.max(4, pos.y + 8) }}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <div className="mb-1 text-xs font-medium text-slate-600">{title}</div>
            <input
                autoFocus
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        submit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancel();
                    }
                }}
                placeholder={pr.kind === 'edit' && pr.initial === '' ? '空のままで自動の寸法値' : ''}
                className={`${ctlInput} w-full`}
            />
            <div className="mt-1.5 flex justify-end gap-1">
                <button type="button" onClick={cancel} className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
                    やめる
                </button>
                <button type="button" onClick={submit} className="rounded bg-teal-600 px-2 py-0.5 text-xs text-white hover:bg-teal-700">
                    決める
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 下: ステータスバー
// ---------------------------------------------------------------------------

function StatusBar({ state }: { state: EditorState }) {
    const { drawing, cursor, view } = state;
    const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
    return (
        <div className="flex min-h-[28px] flex-shrink-0 items-center gap-0 border-t border-slate-300 bg-slate-100 text-xs text-slate-700">
            <div className="min-w-0 flex-1 truncate px-2" title={state.message ?? guidance(state)}>
                {state.message ? <span className="font-semibold text-teal-800">{state.message}</span> : guidance(state)}
            </div>
            <div className="border-l border-slate-300 px-2">{paperLabel(drawing.paper.size, drawing.paper.orientation)}</div>
            <div className="border-l border-slate-300 px-2">{scaleLabel(drawing.scale)}</div>
            <div className="hidden w-44 border-l border-slate-300 px-2 tabular-nums sm:block">
                {cursor ? `X=${fmt(cursor.x)} Y=${fmt(cursor.y)}` : 'X= Y='}
            </div>
            <div className="border-l border-slate-300 px-2 tabular-nums">表示 {zoomPercent(view)}%</div>
        </div>
    );
}
