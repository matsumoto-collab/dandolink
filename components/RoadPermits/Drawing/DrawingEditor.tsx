'use client';

/**
 * 道路申請の「図面」タブ（JWW 風の作図画面）。指示書 docs/指示書_道路申請_Phase2.md §2・画面イメージ docs/道路申請_作図画面イメージ.html。
 * - 上＝コントロールバー（いまの操作の設定）／左＝操作ボタン／中央＝用紙（DrawingCanvas）／右＝レイヤと設定／下＝ステータスバー
 * - 状態と操作は editorModel.ts の reducer。この画面は描いて、出来事を action にして渡すだけ
 * - 図形・レイヤ・設定が変わるたびに onChange（保存は編集画面の「保存」ボタン。自動保存はしない）
 * - 記号（Phase 2b）: 記号の一覧は親（RoadPermitEditor）が API から読んで props.symbols で渡す（null＝読み込み中）。
 *   右の「記号」（分類のタブ・下絵）で選んで置く。コーン列のコーンとバーの選択はブラウザに覚える（無くても動く）
 * - 占用範囲（Phase 2b）: 右の「占用範囲」に面積と式を出し、「申請書に入れる」で親（onApplyOccupancy）へ渡す
 *   （申請書の値は親が持っているので、確認と書き込みは親がする）
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
import type { RoadPermitSymbolCategory, RoadPermitSymbolDto, RoadPermitSymbolMap } from '@/types/roadPermitSymbol';
import { ROAD_PERMIT_SYMBOL_CATEGORIES, ROAD_PERMIT_SYMBOL_CATEGORY_LABELS } from '@/types/roadPermitSymbol';
import { sortRoadPermitSymbols, toSymbolMap } from '@/lib/roadPermit/symbols/normalize';
import SymbolThumbnail from './SymbolThumbnail';
import { DRAWING_LAYER_COLORS, emptyRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import { originToFit, paperLabel, scaleLabel } from '@/lib/roadPermit/drawing/paper';
import { entitiesBBox } from '@/lib/roadPermit/drawing/geometry';
import { occupancyApplyItems, occupancyMark, occupancyTotal, type OccupancyApplyItem } from '@/lib/roadPermit/drawing/occupancy';
import {
    COMMAND_LABELS,
    DIMENSION_TOOL_LABELS,
    DRAW_COMMANDS,
    EDIT_COMMANDS,
    MEASURE_COMMANDS,
    SYMBOL_COMMANDS,
    SYMBOL_PLACE_MODE_LABELS,
    activeConeBarSymbols,
    activeConeSymbols,
    editorReducer,
    parseNum,
    pickSymbolActions,
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
    type SymbolPlaceMode,
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
    /** 記号の一覧（使わないものも含めて全部・形つき）。null＝読み込み中 */
    symbols: RoadPermitSymbolDto[] | null;
    /** 右の「占用範囲」の「申請書に入れる」を押したとき（図面の中の占用範囲を並べた順に渡す）。無ければボタンを出さない */
    onApplyOccupancy?: (measures: OccupancyApplyItem[]) => void;
}

/** コーン列で前に選んだコーンとバー（ブラウザに覚える） */
const CONE_ROW_STORAGE_KEY = 'dandolink:roadPermit:coneRow';

function loadConeRowChoice(): { coneSymbolId: string | null; barSymbolId: string | null } {
    try {
        const raw = window.localStorage.getItem(CONE_ROW_STORAGE_KEY);
        if (!raw) return { coneSymbolId: null, barSymbolId: null };
        const o = JSON.parse(raw) as Record<string, unknown>;
        return {
            coneSymbolId: typeof o.coneSymbolId === 'string' ? o.coneSymbolId : null,
            barSymbolId: typeof o.barSymbolId === 'string' ? o.barSymbolId : null,
        };
    } catch {
        return { coneSymbolId: null, barSymbolId: null };
    }
}

function saveConeRowChoice(coneSymbolId: string | null, barSymbolId: string | null): void {
    try {
        window.localStorage.setItem(CONE_ROW_STORAGE_KEY, JSON.stringify({ coneSymbolId, barSymbolId }));
    } catch {
        // 保存できなくても動く（次に開いたとき選び直すだけ）
    }
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

export default function DrawingEditor({ value, onChange, values, symbols, onApplyOccupancy }: DrawingEditorProps) {
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

    // ---- 記号の表 ----
    const symbolMap = useMemo<RoadPermitSymbolMap>(() => toSymbolMap(symbols ?? []), [symbols]);
    useEffect(() => {
        dispatch({ type: 'setSymbols', symbols: symbolMap });
    }, [symbolMap]);
    // コーン列で前に選んだコーンとバーを戻す（読み込み終わったとき 1 回だけ。今の一覧に無い id は使わない）
    const restoredRef = useRef(false);
    useEffect(() => {
        if (symbols === null || restoredRef.current) return;
        restoredRef.current = true;
        const saved = loadConeRowChoice();
        const cone = saved.coneSymbolId && activeConeSymbols(symbolMap).some((x) => x.id === saved.coneSymbolId) ? saved.coneSymbolId : null;
        const bar = saved.barSymbolId && activeConeBarSymbols(symbolMap).some((x) => x.id === saved.barSymbolId) ? saved.barSymbolId : null;
        if (cone || bar) dispatch({ type: 'setSettings', patch: { coneSymbolId: cone, coneBarSymbolId: bar } });
    }, [symbols, symbolMap]);

    const pickSymbol = (sym: RoadPermitSymbolDto) => {
        for (const a of pickSymbolActions(sym)) dispatch(a);
        rootRef.current?.focus({ preventScroll: true });
    };

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
        const bb = entitiesBBox(drawing.entities, state.symbols);
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
                    <DrawingCanvas state={state} dispatch={dispatch} values={values} spaceDown={spaceDown} symbolsLoading={symbols === null} />
                    {state.prompt && <TextPrompt state={state} dispatch={dispatch} onDone={() => rootRef.current?.focus({ preventScroll: true })} />}
                </div>

                <SidePanel
                    state={state}
                    dispatch={dispatch}
                    values={values}
                    onFit={fitToPaper}
                    symbols={symbols}
                    onPickSymbol={pickSymbol}
                    onApplyOccupancy={onApplyOccupancy}
                />
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
        case 'symbol':
            fields = <SymbolFields state={state} dispatch={dispatch} />;
            break;
        case 'occupancy':
            fields = (
                <>
                    <label className={ctlLabel}>
                        路線名
                        <input
                            type="text"
                            value={settings.occupancyRoute}
                            placeholder="例: 市道 新屋敷線（空でもよい）"
                            maxLength={100}
                            onChange={(e) => set({ occupancyRoute: e.target.value })}
                            className={`${ctlInput} w-56`}
                        />
                    </label>
                    <label className={ctlLabel}>
                        書込レイヤ
                        <LayerSelect value={state.drawing.currentLayer} layers={state.drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
                    </label>
                    <span className="text-sm text-slate-600">閉じた連続線・矩形をクリック、または点を順にクリックして Enter で閉じる</span>
                </>
            );
            break;
        case 'coneRow':
            fields = <ConeRowFields state={state} dispatch={dispatch} />;
            break;
    }

    return (
        <div className="flex min-h-[40px] flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-300 bg-slate-50 px-3 py-1.5">
            <span className="min-w-[5rem] text-sm font-semibold text-slate-900">{COMMAND_LABELS[command]}</span>
            {fields}
        </div>
    );
}

/** 角度に足す（0〜360 未満にそろえる） */
function addAngle(angle: string, deg: number): string {
    const v = ((((parseNum(angle) ?? 0) + deg) % 360) + 360) % 360;
    return String(Math.round(v * 1000) / 1000);
}

const segBtn = (on: boolean) => `px-2 py-0.5 text-sm ${on ? 'bg-teal-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`;
const smallBtn = 'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-700 hover:bg-slate-100';

/** 記号: 記号名・角度（+15°・+90°）・反転・置き方（1 つずつ／線に沿って等間隔） */
function SymbolFields({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
    const { settings } = state;
    const set = (patch: Partial<EditorState['settings']>) => dispatch({ type: 'setSettings', patch });
    const sym = settings.symbolId ? state.symbols.get(settings.symbolId) : undefined;
    return (
        <>
            <span className="max-w-[12rem] truncate text-sm text-slate-800" title={sym?.name}>
                {sym ? sym.name : '（右の「記号」から選んでください）'}
            </span>
            <NumField label="角度" value={settings.angle} onChange={(v) => set({ angle: v })} unit="°" width="w-14" placeholder="0" />
            <button type="button" onClick={() => set({ angle: addAngle(settings.angle, 15) })} className={smallBtn} title="角度に 15° 足す">
                +15°
            </button>
            <button type="button" onClick={() => set({ angle: addAngle(settings.angle, 90) })} className={smallBtn} title="角度に 90° 足す">
                +90°
            </button>
            <label className={ctlLabel}>
                <input
                    type="checkbox"
                    checked={settings.symbolMirrored}
                    onChange={(e) => set({ symbolMirrored: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                反転
            </label>
            <div className="flex items-center gap-1">
                <span className="text-sm text-slate-700">置き方</span>
                <div className="flex overflow-hidden rounded border border-slate-300">
                    {(Object.keys(SYMBOL_PLACE_MODE_LABELS) as SymbolPlaceMode[]).map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => {
                                set({ symbolMode: m });
                                // 置き方を変えたら指示しかけの点を捨てる
                                dispatch({ type: 'command', command: 'symbol' });
                            }}
                            className={segBtn(settings.symbolMode === m)}
                        >
                            {SYMBOL_PLACE_MODE_LABELS[m]}
                        </button>
                    ))}
                </div>
            </div>
            {settings.symbolMode === 'array' && (
                <NumField label="間隔" value={settings.arraySpacing} onChange={(v) => set({ arraySpacing: v })} unit="mm" />
            )}
            <label className={ctlLabel}>
                書込レイヤ
                <LayerSelect value={state.drawing.currentLayer} layers={state.drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
            </label>
        </>
    );
}

/** コーン列: コーンとコーンバーの記号を選ぶ（選んだものはブラウザに覚える） */
function ConeRowFields({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
    const { settings } = state;
    const cones = useMemo(() => sortRoadPermitSymbols(activeConeSymbols(state.symbols)), [state.symbols]);
    const bars = useMemo(() => sortRoadPermitSymbols(activeConeBarSymbols(state.symbols)), [state.symbols]);
    const choose = (coneSymbolId: string | null, coneBarSymbolId: string | null) => {
        dispatch({ type: 'setSettings', patch: { coneSymbolId, coneBarSymbolId } });
        saveConeRowChoice(coneSymbolId, coneBarSymbolId);
    };
    const coneValue = settings.coneSymbolId && cones.some((c) => c.id === settings.coneSymbolId) ? settings.coneSymbolId : '';
    const barValue = settings.coneBarSymbolId && bars.some((b) => b.id === settings.coneBarSymbolId) ? settings.coneBarSymbolId : '';
    return (
        <>
            <label className={ctlLabel}>
                コーン
                <select value={coneValue} onChange={(e) => choose(e.target.value || null, settings.coneBarSymbolId)} className={ctlInput}>
                    <option value="">選んでください</option>
                    {cones.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
            </label>
            {bars.length === 0 ? (
                <span className="text-sm font-medium text-amber-700">コーンバーを登録してください</span>
            ) : (
                <label className={ctlLabel}>
                    コーンバー
                    <select value={barValue} onChange={(e) => choose(settings.coneSymbolId, e.target.value || null)} className={ctlInput}>
                        <option value="">選んでください</option>
                        {bars.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}（間隔 {(b.barPitchMm ?? 0).toLocaleString('ja-JP')}）
                            </option>
                        ))}
                    </select>
                </label>
            )}
            <label className={ctlLabel}>
                書込レイヤ
                <LayerSelect value={state.drawing.currentLayer} layers={state.drawing.layers} onChange={(id) => dispatch({ type: 'setCurrentLayer', id })} />
            </label>
            <span className="text-sm text-slate-600">点を順にクリックして、Enter か ダブルクリックで確定</span>
        </>
    );
}

/** 範囲・属性: 選んだ図形の属性（レイヤ・線種・太さ・文字の大きさ）を変える */
function AttributeFields({ state, dispatch }: { state: EditorState; dispatch: React.Dispatch<EditorAction> }) {
    const selected = useMemo(() => {
        const set = new Set(state.selection);
        return state.drawing.entities.filter((e) => set.has(e.id));
    }, [state.selection, state.drawing.entities]);
    const first: DrawingEntity | undefined = selected[0];
    const [attr, setAttr] = useState<Required<AttributePatch>>({ layer: 0, lineType: 'solid', width: 'normal', heightPaperMm: 3, routeName: '' });
    const selKey = state.selection.join(',');
    useEffect(() => {
        if (!first) return;
        setAttr({
            layer: first.layer,
            lineType: first.style.lineType,
            width: first.style.width,
            heightPaperMm: first.kind === 'text' || first.kind === 'dimension' || first.kind === 'leader' ? first.heightPaperMm : 3,
            routeName: first.kind === 'occupancy' ? first.routeName : '',
        });
        // 選び直したときだけ欄を入れ直す
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selKey]);

    if (selected.length === 0) {
        return <span className="text-sm text-slate-600">図形をクリック、またはドラッグで囲んで選んでください（Shift で追加・Delete で消去）</span>;
    }
    const hasText = selected.some((e) => e.kind === 'text' || e.kind === 'dimension' || e.kind === 'leader');
    const editable = selected.length === 1 && hasText;
    // 占用範囲だけを選んでいるときは路線名も直せる
    const onlyOccupancy = selected.every((e) => e.kind === 'occupancy');
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
            {onlyOccupancy && (
                <label className={ctlLabel}>
                    路線名
                    <input
                        type="text"
                        value={attr.routeName}
                        maxLength={100}
                        onChange={(e) => setAttr((a) => ({ ...a, routeName: e.target.value }))}
                        className={`${ctlInput} w-48`}
                    />
                </label>
            )}
            <button
                type="button"
                onClick={() => {
                    const common = { layer: attr.layer, lineType: attr.lineType, width: attr.width };
                    const patch: AttributePatch = {
                        ...common,
                        ...(hasText ? { heightPaperMm: attr.heightPaperMm } : {}),
                        ...(onlyOccupancy ? { routeName: attr.routeName } : {}),
                    };
                    dispatch({ type: 'applyAttributes', patch });
                }}
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
            {group('記号', SYMBOL_COMMANDS)}
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

/** 右パネルの「記号」: 分類のタブ → 下絵と名前のボタン（使うものだけ） */
function SymbolPalette({
    state,
    symbols,
    onPick,
}: {
    state: EditorState;
    symbols: RoadPermitSymbolDto[] | null;
    onPick: (s: RoadPermitSymbolDto) => void;
}) {
    const active = useMemo(() => sortRoadPermitSymbols((symbols ?? []).filter((s) => s.isActive)), [symbols]);
    const cats = useMemo(
        () => ROAD_PERMIT_SYMBOL_CATEGORIES.filter((c) => active.some((s) => s.category === c)),
        [active],
    );
    const [cat, setCat] = useState<RoadPermitSymbolCategory | null>(null);
    const current = cat && cats.includes(cat) ? cat : cats[0] ?? null;
    const list = active.filter((s) => s.category === current);
    const pickedId = state.command === 'symbol' ? state.settings.symbolId : null;

    return (
        <section className="overflow-hidden rounded border border-slate-300 bg-white">
            <h3 className={panelTitle}>記号</h3>
            {symbols === null ? (
                <p className="p-2 text-sm text-slate-500">記号を読み込み中…</p>
            ) : active.length === 0 ? (
                <p className="p-2 text-sm text-slate-600">記号がありません。一覧の『記号の登録』で JWW から取り込んでください</p>
            ) : (
                <>
                    <div className="flex flex-wrap gap-1 border-b border-slate-100 p-1.5">
                        {cats.map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setCat(c)}
                                className={`rounded px-1.5 py-0.5 text-xs ${current === c ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-teal-100'}`}
                            >
                                {ROAD_PERMIT_SYMBOL_CATEGORY_LABELS[c]}
                            </button>
                        ))}
                    </div>
                    <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto p-1.5">
                        {list.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => onPick(s)}
                                title={s.name}
                                className={`flex flex-col items-center gap-0.5 rounded border p-1 text-xs ${
                                    pickedId === s.id ? 'border-teal-600 bg-teal-100 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-teal-100'
                                }`}
                            >
                                <SymbolThumbnail geometry={s.geometry} size={40} title={s.name} />
                                <span className="w-full truncate text-center">{s.name}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

/** 右パネルの「占用範囲」: 図面の中の占用範囲（路線名・面積・式）と合計・「申請書に入れる」 */
function OccupancyPanel({
    state,
    dispatch,
    onApply,
}: {
    state: EditorState;
    dispatch: React.Dispatch<EditorAction>;
    onApply?: (measures: OccupancyApplyItem[]) => void;
}) {
    const list = useMemo(
        () => state.drawing.entities.filter((e): e is Extract<DrawingEntity, { kind: 'occupancy' }> => e.kind === 'occupancy'),
        [state.drawing.entities],
    );
    const items = useMemo(() => occupancyApplyItems(list), [list]);
    const total = occupancyTotal(items);
    const many = items.length >= 2;
    // 文字を動かしてある（自動の位置に戻せる）
    const moved = state.drawing.occupancyNoteAt !== null || list.some((e) => e.labelAt !== null);
    return (
        <section className="mt-2 overflow-hidden rounded border border-slate-300 bg-white">
            <h3 className={panelTitle}>占用範囲</h3>
            {items.length === 0 ? (
                <p className="p-2 text-xs text-slate-500">左の「占用範囲」で描くと、ここに面積と式が出ます</p>
            ) : (
                <div className="space-y-1.5 p-2">
                    <ul className="space-y-1">
                        {items.map((m, i) => (
                            <li key={list[i].id}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        dispatch({ type: 'command', command: 'select' });
                                        dispatch({ type: 'setSelection', ids: [list[i].id] });
                                    }}
                                    title="図面で選ぶ（Enter で路線名を直せます）"
                                    className={`w-full rounded border px-1.5 py-1 text-left text-xs hover:bg-teal-100 ${
                                        state.selection.includes(list[i].id) ? 'border-teal-600 bg-teal-50' : 'border-slate-200'
                                    }`}
                                >
                                    <span className="block font-medium text-slate-800">
                                        {many ? `${occupancyMark(i)}　` : ''}
                                        {m.routeName || `占用範囲 ${i + 1}`}
                                    </span>
                                    <span className="block tabular-nums text-slate-700">{m.expression}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <p className="text-right text-sm font-semibold tabular-nums text-slate-900">
                        {many ? '合計 ' : ''}
                        {total.areaText}㎡　約{total.approx}㎡
                    </p>
                    <p className="text-xs text-slate-500">図面の文字（式・①②）はドラッグで動かせます</p>
                    {moved && (
                        <button
                            type="button"
                            onClick={() => dispatch({ type: 'resetOccupancyLabels' })}
                            className="w-full rounded border border-slate-300 bg-white py-1 text-xs text-slate-700 hover:bg-slate-100"
                        >
                            文字の位置を自動に戻す
                        </button>
                    )}
                    {onApply && (
                        <button
                            type="button"
                            onClick={() => onApply(items)}
                            className="w-full rounded bg-teal-600 py-1 text-sm text-white hover:bg-teal-700"
                        >
                            申請書に入れる
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}

function SidePanel({
    state,
    dispatch,
    values,
    onFit,
    symbols,
    onPickSymbol,
    onApplyOccupancy,
}: {
    state: EditorState;
    dispatch: React.Dispatch<EditorAction>;
    values: RoadPermitValues;
    onFit: () => void;
    symbols: RoadPermitSymbolDto[] | null;
    onPickSymbol: (s: RoadPermitSymbolDto) => void;
    onApplyOccupancy?: (measures: OccupancyApplyItem[]) => void;
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
            <SymbolPalette state={state} symbols={symbols} onPick={onPickSymbol} />

            <OccupancyPanel state={state} dispatch={dispatch} onApply={onApplyOccupancy} />

            <section className="mt-2 overflow-hidden rounded border border-slate-300 bg-white">
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
                        {check(drawing.showLegend, (v) => dispatch({ type: 'setDrawingFlags', patch: { showLegend: v } }), '凡例')}
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
    const editingOccupancy = pr.kind === 'edit' && state.drawing.entities.some((e) => e.id === pr.entityId && e.kind === 'occupancy');
    const title = pr.kind === 'leader' ? '引出線の文字' : editingOccupancy ? '占用範囲の路線名' : pr.kind === 'edit' ? '文字を直す' : '文字';
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
                placeholder={editingOccupancy ? '例: 市道 新屋敷線（空なら付けない）' : pr.kind === 'edit' && pr.initial === '' ? '空のままで自動の寸法値' : ''}
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
