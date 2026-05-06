// 現場調査（図面）の本体エディタ。新規作成・既存編集の両方で使う共通コンポーネント
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
    ArrowLeft,
    RotateCcw,
    Undo2,
    Save,
    Loader2,
    AlertCircle,
    CornerDownLeft,
    ZoomIn,
    ZoomOut,
    Maximize2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import {
    computeTotalStats,
    computeBoundingBox,
    fitToCanvas,
    getWalls,
    distancePointToSegment,
} from '@/utils/drawingMath';
import ArrowInputController, { type LengthSheetRequest } from '@/components/SiteSurvey/ArrowInputController';
import LengthInputSheet from '@/components/SiteSurvey/LengthInputSheet';
import OpeningInputSheet from '@/components/SiteSurvey/OpeningInputSheet';
import OpeningInputController from '@/components/SiteSurvey/OpeningInputController';
import MarkerInputController from '@/components/SiteSurvey/MarkerInputController';
import MarkerColorSheet from '@/components/SiteSurvey/MarkerColorSheet';
import { MARKER_COLORS } from '@/components/SiteSurvey/DrawingCanvas';
import TextInputController from '@/components/SiteSurvey/TextInputController';
import TextLayer from '@/components/SiteSurvey/TextLayer';
import TextInputSheet from '@/components/SiteSurvey/TextInputSheet';
import { useSiteSurveys } from '@/hooks/useSiteSurveys';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import type { SiteSurvey } from '@/types/site-survey';
import type { CanvasFit, MarkerColor, Point } from '@/stores/siteSurveySlices/types';

const DrawingCanvas = dynamic(() => import('@/components/SiteSurvey/DrawingCanvas'), {
    ssr: false,
    loading: () => (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            キャンバス読み込み中...
        </div>
    ),
});

const DEFAULT_BBOX = { minX: -6000, maxX: 6000, minY: -6000, maxY: 6000 };

interface SiteSurveyEditorProps {
    mode: 'new' | 'edit';
    initial?: SiteSurvey | null;
    initialProjectMasterId?: string;
    /** 渡された場合は戻るボタンで router.push せず、このコールバックを呼ぶ（オーバーレイ用） */
    onClose?: () => void;
    /** 新規作成成功後に呼ばれる。渡されない場合は router.replace で /site-surveys/[id] に遷移 */
    onSaveNewSuccess?: (id: string) => void;
}

export default function SiteSurveyEditor({
    mode,
    initial,
    initialProjectMasterId,
    onClose,
    onSaveNewSuccess,
}: SiteSurveyEditorProps) {
    const router = useRouter();
    const { create, update } = useSiteSurveys();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();

    // ストア
    const data = useDrawingStore((s) => s.data);
    const correction = useDrawingStore((s) => s.correction);
    const height = useDrawingStore((s) => s.height);
    const setHeight = useDrawingStore((s) => s.setHeight);
    const reset = useDrawingStore((s) => s.reset);
    const removeLastWall = useDrawingStore((s) => s.removeLastWall);
    const closePolygon = useDrawingStore((s) => s.closePolygon);
    const addWall = useDrawingStore((s) => s.addWall);
    const loadDrawing = useDrawingStore((s) => s.loadDrawing);
    const history = useDrawingStore((s) => s.history);
    const addMarker = useDrawingStore((s) => s.addMarker);
    const updateMarker = useDrawingStore((s) => s.updateMarker);
    const deleteMarker = useDrawingStore((s) => s.deleteMarker);
    const extendMarker = useDrawingStore((s) => s.extendMarker);
    const addText = useDrawingStore((s) => s.addText);
    const updateText = useDrawingStore((s) => s.updateText);
    const moveText = useDrawingStore((s) => s.moveText);
    const deleteText = useDrawingStore((s) => s.deleteText);
    const addOpening = useDrawingStore((s) => s.addOpening);
    const updateOpening = useDrawingStore((s) => s.updateOpening);
    const deleteOpening = useDrawingStore((s) => s.deleteOpening);

    // メタ情報フォーム
    const [title, setTitle] = useState(initial?.title ?? '');
    const [projectMasterId, setProjectMasterId] = useState<string>(
        initial?.projectMasterId ?? initialProjectMasterId ?? '',
    );
    const [customerName, setCustomerName] = useState(initial?.customerName ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [lastSavedDataJson, setLastSavedDataJson] = useState<string>('');

    // 初回マウントで保存済みデータをストアにロード
    const didLoadRef = useRef(false);
    useEffect(() => {
        if (didLoadRef.current) return;
        didLoadRef.current = true;
        if (initial?.drawingData) {
            loadDrawing(initial.drawingData, {
                height: initial.drawingData.sections[0]?.height,
            });
            setLastSavedDataJson(JSON.stringify(initial.drawingData));
        } else {
            // 新規作成: ストアをクリーンに
            reset();
            setLastSavedDataJson(JSON.stringify(useDrawingStore.getState().data));
        }
    }, [initial, loadDrawing, reset]);

    useEffect(() => {
        fetchProjectMasters();
    }, [fetchProjectMasters]);

    // タイトル自動入力（案件選択時）
    useEffect(() => {
        if (mode === 'new' && projectMasterId && !title) {
            const pm = projectMasters.find((p) => p.id === projectMasterId);
            if (pm?.title) setTitle(`${pm.title} 現場調査`);
            if (pm?.customerName && !customerName) setCustomerName(pm.customerName);
        }
    }, [mode, projectMasterId, projectMasters, title, customerName]);

    // キャンバスサイズ追従
    const containerRef = useRef<HTMLDivElement>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    useEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const update = () => {
            const w = Math.max(320, el.clientWidth);
            const h = Math.max(360, el.clientHeight);
            setCanvasSize({ width: w, height: h });
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const currentSectionId = useDrawingStore((s) => s.currentSectionId);
    const stats = data.sections.length > 0 ? computeTotalStats(data.sections, correction) : null;
    const allClosed = data.sections.length > 0 && data.sections.every((s) => s.polygon.closed);
    const hasAnyPoints = data.sections.some((s) => s.polygon.points.length > 0);
    const activeSection = data.sections.find((s) => s.id === currentSectionId);
    const canCloseActive =
        !!activeSection && !activeSection.polygon.closed && activeSection.polygon.points.length >= 3;

    type Bbox = { minX: number; maxX: number; minY: number; maxY: number };

    const [viewBbox, setViewBbox] = useState<Bbox>(() => {
        const initialPoints = initial?.drawingData?.sections?.[0]?.polygon?.points ?? [];
        if (initialPoints.length === 0) return DEFAULT_BBOX;
        const raw = computeBoundingBox(initialPoints);
        const padMm = 1000;
        return {
            minX: Math.min(DEFAULT_BBOX.minX, raw.minX - padMm),
            maxX: Math.max(DEFAULT_BBOX.maxX, raw.maxX + padMm),
            minY: Math.min(DEFAULT_BBOX.minY, raw.minY - padMm),
            maxY: Math.max(DEFAULT_BBOX.maxY, raw.maxY + padMm),
        };
    });

    const [isManualZoom, setIsManualZoom] = useState(false);

    // 点が増えて現在の視野からはみ出したら、視野を拡張する（縮めない）。手動ズーム中は抑止
    useEffect(() => {
        if (isManualZoom) return;
        const points = data.sections.flatMap((s) => s.polygon.points);
        if (points.length === 0) return;
        const raw = computeBoundingBox(points);
        const padMm = 1000;
        setViewBbox((prev) => {
            const next: Bbox = {
                minX: Math.min(prev.minX, raw.minX - padMm),
                maxX: Math.max(prev.maxX, raw.maxX + padMm),
                minY: Math.min(prev.minY, raw.minY - padMm),
                maxY: Math.max(prev.maxY, raw.maxY + padMm),
            };
            const same =
                prev.minX === next.minX &&
                prev.maxX === next.maxX &&
                prev.minY === next.minY &&
                prev.maxY === next.maxY;
            return same ? prev : next;
        });
    }, [data.sections, isManualZoom]);

    const handleZoomIn = useCallback(() => {
        setIsManualZoom(true);
        setViewBbox((prev) => {
            const cx = (prev.minX + prev.maxX) / 2;
            const cy = (prev.minY + prev.maxY) / 2;
            const minSize = 500;
            const finalW = Math.max((prev.maxX - prev.minX) * 0.67, minSize);
            const finalH = Math.max((prev.maxY - prev.minY) * 0.67, minSize);
            return {
                minX: cx - finalW / 2,
                maxX: cx + finalW / 2,
                minY: cy - finalH / 2,
                maxY: cy + finalH / 2,
            };
        });
    }, []);

    const handleZoomOut = useCallback(() => {
        setIsManualZoom(true);
        setViewBbox((prev) => {
            const cx = (prev.minX + prev.maxX) / 2;
            const cy = (prev.minY + prev.maxY) / 2;
            const maxSize = 200000;
            const finalW = Math.min((prev.maxX - prev.minX) * 1.5, maxSize);
            const finalH = Math.min((prev.maxY - prev.minY) * 1.5, maxSize);
            return {
                minX: cx - finalW / 2,
                maxX: cx + finalW / 2,
                minY: cy - finalH / 2,
                maxY: cy + finalH / 2,
            };
        });
    }, []);

    // マウスホイールでズーム（passive:false で preventDefault 有効化）
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.deltaY < 0) handleZoomIn();
            else if (e.deltaY > 0) handleZoomOut();
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [handleZoomIn, handleZoomOut]);

    const handleViewPan = useCallback((deltaMm: { x: number; y: number }) => {
        setIsManualZoom(true);
        setViewBbox((prev) => ({
            minX: prev.minX + deltaMm.x,
            maxX: prev.maxX + deltaMm.x,
            minY: prev.minY + deltaMm.y,
            maxY: prev.maxY + deltaMm.y,
        }));
    }, []);

    const handleFitView = () => {
        setIsManualZoom(false);
        const points = data.sections.flatMap((s) => s.polygon.points);
        if (points.length === 0) {
            setViewBbox(DEFAULT_BBOX);
            return;
        }
        const raw = computeBoundingBox(points);
        const padMm = 1000;
        setViewBbox({
            minX: raw.minX - padMm,
            maxX: raw.maxX + padMm,
            minY: raw.minY - padMm,
            maxY: raw.maxY + padMm,
        });
    };

    const fit: CanvasFit = useMemo(() => {
        return fitToCanvas(viewBbox, canvasSize.width, canvasSize.height, 60);
    }, [viewBbox, canvasSize]);

    const [ghost, setGhost] = useState<
        | { fromPx: { x: number; y: number }; toPx: { x: number; y: number } }
        | null
    >(null);

    const [pendingSheet, setPendingSheet] = useState<LengthSheetRequest | null>(null);

    const [inputMode, setInputMode] = useState<'wall' | 'marker' | 'opening' | 'text'>('wall');

    const [currentMarkerColor, setCurrentMarkerColor] = useState<MarkerColor>('blue');
    const [markerPreview, setMarkerPreview] = useState<{ points: Point[]; color: MarkerColor } | null>(null);
    const [colorSheetTargetId, setColorSheetTargetId] = useState<string | null>(null);

    const handleMarkerPreview = (points: Point[] | null) => {
        if (points === null) setMarkerPreview(null);
        else setMarkerPreview({ points, color: currentMarkerColor });
    };

    const handleCommitMarker = (points: Point[]) => {
        addMarker(points, currentMarkerColor);
        setMarkerPreview(null);
    };

    const handleTapMarker = (id: string) => {
        if (window.confirm('このマーカーを削除しますか？')) deleteMarker(id);
    };

    const handleLongPressMarker = (id: string) => {
        setColorSheetTargetId(id);
    };

    const handleColorSheetConfirm = (color: MarkerColor) => {
        if (colorSheetTargetId) updateMarker(colorSheetTargetId, color);
        setColorSheetTargetId(null);
    };

    const handleColorSheetCancel = () => {
        setColorSheetTargetId(null);
    };

    const handleExtendMarker = (markerId: string, fromStart: boolean, endMm: Point) => {
        extendMarker(markerId, fromStart, endMm);
        setMarkerPreview(null);
    };

    type PendingText =
        | { mode: 'new'; x: number; y: number }
        | { mode: 'edit'; id: string; initialText: string };
    const [pendingText, setPendingText] = useState<PendingText | null>(null);
    const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

    const handleRequestNewText = (xMm: number, yMm: number) => {
        setSelectedTextId(null);
        setPendingText({ mode: 'new', x: xMm, y: yMm });
    };

    const handleTapText = (id: string) => {
        const t = useDrawingStore.getState().data.texts.find((x) => x.id === id);
        if (!t) return;
        setSelectedTextId(id);
        setPendingText({ mode: 'edit', id, initialText: t.text });
    };

    const handleMoveText = (id: string, xMm: number, yMm: number) => {
        moveText(id, xMm, yMm);
    };

    const handleTextConfirm = (text: string) => {
        if (!pendingText) return;
        if (pendingText.mode === 'new') {
            addText(pendingText.x, pendingText.y, text);
        } else {
            updateText(pendingText.id, text);
        }
        setPendingText(null);
        setSelectedTextId(null);
    };

    const handleTextDelete = () => {
        if (!pendingText || pendingText.mode !== 'edit') return;
        deleteText(pendingText.id);
        setPendingText(null);
        setSelectedTextId(null);
    };

    const handleTextCancel = () => {
        setPendingText(null);
        setSelectedTextId(null);
    };

    type PendingOpening =
        | {
              mode: 'new';
              sectionId: string;
              wallIndex: number;
              distanceFromStart: number;
              width: number;
              wallLengthMm: number;
          }
        | {
              mode: 'edit';
              sectionId: string;
              openingIndex: number;
              wallIndex: number;
              distanceFromStart: number;
              width: number;
              wallLengthMm: number;
          };
    const [pendingOpening, setPendingOpening] = useState<PendingOpening | null>(null);
    const [selectedOpening, setSelectedOpening] = useState<
        { sectionId: string; openingIndex: number } | null
    >(null);

    const handleRequestNewOpening = useCallback(
        (sectionId: string, wallIndex: number, tapMm: { x: number; y: number }) => {
            const sec = useDrawingStore.getState().data.sections.find((s) => s.id === sectionId);
            if (!sec) return;
            const wall = getWalls(sec).find((w) => w.wallIndex === wallIndex);
            if (!wall) return;
            const wallLength = wall.length;
            const { t } = distancePointToSegment(tapMm, wall.a, wall.b);
            const defaultWidth = 1800;
            const desiredCenter = t * wallLength;
            const distanceFromStart = Math.max(
                0,
                Math.min(desiredCenter - defaultWidth / 2, Math.max(0, wallLength - defaultWidth)),
            );
            setSelectedOpening(null);
            setPendingOpening({
                mode: 'new',
                sectionId,
                wallIndex,
                distanceFromStart,
                width: defaultWidth,
                wallLengthMm: wallLength,
            });
        },
        [],
    );

    const handleRequestEditOpening = useCallback(
        (sectionId: string, openingIndex: number) => {
            const sec = useDrawingStore.getState().data.sections.find((s) => s.id === sectionId);
            if (!sec) return;
            const op = sec.openings[openingIndex];
            if (!op) return;
            const wall = getWalls(sec).find((w) => w.wallIndex === op.wallIndex);
            if (!wall) return;
            const wallLength = wall.length;
            const distanceFromStart = op.position * wallLength - op.width / 2;
            setSelectedOpening({ sectionId, openingIndex });
            setPendingOpening({
                mode: 'edit',
                sectionId,
                openingIndex,
                wallIndex: op.wallIndex,
                distanceFromStart: Math.max(0, distanceFromStart),
                width: op.width,
                wallLengthMm: wallLength,
            });
        },
        [],
    );

    const handleOpeningConfirm = (distanceFromStart: number, width: number) => {
        if (!pendingOpening) return;
        const wallLength = pendingOpening.wallLengthMm;
        const position = wallLength > 0 ? (distanceFromStart + width / 2) / wallLength : 0;
        if (pendingOpening.mode === 'new') {
            addOpening(pendingOpening.sectionId, pendingOpening.wallIndex, position, width);
        } else {
            updateOpening(pendingOpening.sectionId, pendingOpening.openingIndex, position, width);
        }
        setPendingOpening(null);
        setSelectedOpening(null);
    };

    const handleOpeningDelete = () => {
        if (!pendingOpening || pendingOpening.mode !== 'edit') return;
        deleteOpening(pendingOpening.sectionId, pendingOpening.openingIndex);
        setPendingOpening(null);
        setSelectedOpening(null);
    };

    const handleOpeningCancel = () => {
        setPendingOpening(null);
        setSelectedOpening(null);
    };

    const handleRequestLengthSheet = useCallback((req: LengthSheetRequest) => {
        setPendingSheet(req);
    }, []);

    const handleSheetConfirm = (lengthMm: number) => {
        if (!pendingSheet) return;
        if (pendingSheet.closing) {
            closePolygon();
        } else {
            addWall(pendingSheet.direction, lengthMm);
        }
        setPendingSheet(null);
        setGhost(null);
    };

    const handleSheetCancel = () => {
        setPendingSheet(null);
        setGhost(null);
    };

    const handleBack = () => {
        const isDirty = JSON.stringify(data) !== lastSavedDataJson;
        if (isDirty) {
            if (!confirm('編集内容が保存されていません。離れますか？')) return;
        }
        if (onClose) {
            onClose();
        } else {
            router.push('/site-surveys');
        }
    };

    const handleReset = () => {
        if (!confirm('描いた図形をすべて消しますか？')) return;
        reset();
        setGhost(null);
        setViewBbox(DEFAULT_BBOX);
        setIsManualZoom(false);
    };

    const handleSave = async () => {
        if (!title.trim()) {
            toast.error('タイトルを入力してください');
            return;
        }
        if (!hasAnyPoints) {
            toast.error('図面が空です。少なくとも1辺は描いてください');
            return;
        }
        setIsSaving(true);
        try {
            const input = {
                title: title.trim(),
                projectMasterId: projectMasterId || null,
                customerName: customerName || null,
                workType: null,
                managerIds: [],
                scheduledDate: null,
                notes: null,
                handoffNotes: null,
                arrivalTime: null,
                vehicleSpec: null,
                drawingData: data,
                scaffoldSpec: null,
                surroundings: null,
                perimeter: stats?.perimeter ?? null,
                floorArea: stats?.floorArea ?? null,
                scaffoldArea: stats?.scaffoldArea ?? null,
            };
            if (mode === 'new') {
                const created = await create(input);
                setLastSavedDataJson(JSON.stringify(data));
                toast.success('保存しました');
                if (onSaveNewSuccess) {
                    onSaveNewSuccess(created.id);
                } else {
                    router.replace(`/site-surveys/${created.id}`);
                }
            } else if (initial) {
                await update(initial.id, input);
                setLastSavedDataJson(JSON.stringify(data));
                toast.success('更新しました');
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    const hint = (() => {
        if (inputMode === 'text') {
            return 'タップしてテキスト追加 / 既存テキストをタップで編集 / ドラッグで移動';
        }
        if (inputMode === 'marker') {
            return 'マーカー: ドラッグで描画 / 端点をドラッグで継続描画 / タップで削除 / 長押しで色変更';
        }
        if (inputMode === 'opening') {
            return '壁をタップして開口を追加 / 既存の開口をタップで編集';
        }
        if (data.sections.length === 0) return 'タップして開始点を置く';
        if (activeSection?.polygon.closed) {
            return allClosed
                ? 'タップして次の図形を追加 / 既存の点をタップで枝分かれ / または保存'
                : 'タップして次の図形を追加 / 既存の点をタップで枝分かれ';
        }
        if (activeSection) return `編集中: ${activeSection.name}（矢印で壁を追加）`;
        return '';
    })();

    const canClose = canCloseActive;

    return (
        <div className="fixed inset-0 z-[80] bg-slate-50 flex flex-col pwa-modal-safe">
            {/* ヘッダー */}
            <header className="flex-none px-3 sm:px-4 py-2.5 bg-white border-b border-slate-200 flex items-center gap-2 shadow-sm">
                <button
                    onClick={handleBack}
                    className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
                    title="戻る"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="タイトル（例: 本棟 現場調査）"
                    className="flex-1 min-w-0 px-3 py-1.5 text-base font-medium border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none"
                />
                <select
                    value={projectMasterId}
                    onChange={(e) => setProjectMasterId(e.target.value)}
                    className="hidden md:block px-3 py-1.5 text-sm border border-slate-200 rounded-lg max-w-[260px]"
                >
                    <option value="">案件を選択（任意）</option>
                    {projectMasters.map((pm) => (
                        <option key={pm.id} value={pm.id}>
                            {pm.title}
                        </option>
                    ))}
                </select>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-sm font-medium shadow-sm disabled:opacity-50"
                >
                    {isSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Save className="w-4 h-4" />
                    )}
                    保存
                </button>
            </header>

            {/* 統計バー + ツールバー */}
            <div className="flex-none px-3 sm:px-4 py-2 bg-white border-b border-slate-200 flex items-center gap-2 overflow-x-auto">
                <div className="flex items-center gap-3 text-xs sm:text-sm whitespace-nowrap">
                    <Stat label="外周" value={stats ? `${stats.perimeter.toFixed(2)} m` : '—'} />
                    <Stat label="床面積" value={stats ? `${stats.floorArea.toFixed(2)} ㎡` : '—'} />
                    <Stat label="足場面積" value={stats ? `${stats.scaffoldArea.toFixed(2)} ㎡` : '—'} />
                </div>
                <div className="ml-auto flex items-center gap-1">
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium mr-2">
                        <button
                            type="button"
                            onClick={() => setInputMode('wall')}
                            className={`px-3 py-1.5 ${inputMode === 'wall' ? 'bg-teal-50 text-teal-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                        >壁</button>
                        <button
                            type="button"
                            onClick={() => setInputMode('marker')}
                            className={`px-3 py-1.5 border-l border-slate-200 ${inputMode === 'marker' ? 'bg-indigo-50 text-indigo-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                        >マーカー</button>
                        <button
                            type="button"
                            onClick={() => setInputMode('opening')}
                            className={`px-3 py-1.5 border-l border-slate-200 ${inputMode === 'opening' ? 'bg-red-50 text-red-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                        >開口</button>
                        <button
                            type="button"
                            onClick={() => setInputMode('text')}
                            className={`px-3 py-1.5 border-l border-slate-200 ${inputMode === 'text' ? 'bg-amber-50 text-amber-700' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                        >テキスト</button>
                    </div>
                    {inputMode === 'marker' && (
                        <div className="flex items-center gap-1 px-2">
                            {(['red', 'blue', 'green', 'yellow'] as MarkerColor[]).map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setCurrentMarkerColor(c)}
                                    className={`w-7 h-7 rounded-full border-2 transition ${
                                        currentMarkerColor === c
                                            ? 'border-slate-700 scale-110'
                                            : 'border-white hover:border-slate-300'
                                    }`}
                                    style={{ backgroundColor: MARKER_COLORS[c] }}
                                    aria-label={`色: ${c}`}
                                    title={c}
                                />
                            ))}
                        </div>
                    )}
                    <label className="text-xs text-slate-500 mr-1 hidden sm:inline">軒高</label>
                    <input
                        type="number"
                        value={height}
                        onChange={(e) => setHeight(Number(e.target.value) || 0)}
                        className="w-20 px-2 py-1 text-sm border border-slate-200 rounded-lg"
                        title="軒高 (mm)"
                    />
                    <span className="text-xs text-slate-400 mr-2">mm</span>
                    <button
                        onClick={removeLastWall}
                        disabled={history.length === 0}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
                        title="一手戻す"
                    >
                        <Undo2 className="w-4 h-4" />
                        戻る
                    </button>
                    {canClose && (
                        <button
                            onClick={closePolygon}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100"
                            title="多角形を閉じる"
                        >
                            <CornerDownLeft className="w-4 h-4" />
                            閉じる
                        </button>
                    )}
                    <button
                        onClick={handleReset}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50"
                    >
                        <RotateCcw className="w-4 h-4" />
                        リセット
                    </button>
                </div>
            </div>

            {/* 補助メッセージ */}
            <div className="flex-none px-3 sm:px-4 py-1 bg-teal-50 border-b border-teal-100 text-xs text-teal-700 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {hint}
            </div>

            {/* キャンバス本体（残りの全領域） */}
            <div ref={containerRef} className="flex-1 min-h-0 relative" style={{ touchAction: 'none' }}>
                <DrawingCanvas
                    width={canvasSize.width}
                    height={canvasSize.height}
                    fit={fit}
                    ghost={ghost}
                    selectedOpening={selectedOpening}
                    markers={data.markers}
                    previewMarker={markerPreview}
                    selectedMarkerId={colorSheetTargetId}
                />
                {inputMode === 'wall' && (
                    <ArrowInputController
                        width={canvasSize.width}
                        height={canvasSize.height}
                        fit={fit}
                        onGhostChange={setGhost}
                        onPan={handleViewPan}
                        onRequestLengthSheet={handleRequestLengthSheet}
                        sheetOpen={pendingSheet !== null}
                    />
                )}
                {inputMode === 'marker' && (
                    <MarkerInputController
                        width={canvasSize.width}
                        height={canvasSize.height}
                        fit={fit}
                        onPreviewMarker={handleMarkerPreview}
                        onCommitMarker={handleCommitMarker}
                        onTapMarker={handleTapMarker}
                        onLongPressMarker={handleLongPressMarker}
                        onExtendMarker={handleExtendMarker}
                        sheetOpen={colorSheetTargetId !== null}
                    />
                )}
                {inputMode === 'opening' && (
                    <OpeningInputController
                        width={canvasSize.width}
                        height={canvasSize.height}
                        fit={fit}
                        onPan={handleViewPan}
                        onRequestNewOpening={handleRequestNewOpening}
                        onRequestEditOpening={handleRequestEditOpening}
                        sheetOpen={pendingOpening !== null}
                    />
                )}
                {inputMode === 'text' && (
                    <TextInputController
                        width={canvasSize.width}
                        height={canvasSize.height}
                        fit={fit}
                        onRequestNewText={handleRequestNewText}
                        sheetOpen={pendingText !== null}
                    />
                )}

                <TextLayer
                    fit={fit}
                    texts={data.texts}
                    isInteractive={inputMode === 'text' && pendingText === null}
                    selectedTextId={selectedTextId}
                    onTapText={handleTapText}
                    onMoveText={handleMoveText}
                />

                {isManualZoom && (
                    <div className="absolute bottom-[180px] right-4 z-10 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium border border-amber-200">
                        手動ズーム
                    </div>
                )}

                {!pendingSheet && (
                <div
                    className="absolute bottom-4 right-4 flex flex-col gap-1 bg-white rounded-xl shadow-lg border-2 border-teal-500 p-1"
                    style={{ zIndex: 50, pointerEvents: 'auto' }}
                >
                    <button
                        type="button"
                        onClick={handleZoomIn}
                        className="w-12 h-12 inline-flex items-center justify-center rounded-lg text-teal-700 hover:bg-teal-50 active:scale-95 transition"
                        title="拡大"
                        aria-label="拡大"
                    >
                        <ZoomIn className="w-6 h-6" />
                    </button>
                    <button
                        type="button"
                        onClick={handleZoomOut}
                        className="w-12 h-12 inline-flex items-center justify-center rounded-lg text-teal-700 hover:bg-teal-50 active:scale-95 transition"
                        title="縮小"
                        aria-label="縮小"
                    >
                        <ZoomOut className="w-6 h-6" />
                    </button>
                    <button
                        type="button"
                        onClick={handleFitView}
                        className="w-12 h-12 inline-flex items-center justify-center rounded-lg text-teal-700 hover:bg-teal-50 active:scale-95 transition"
                        title="全体表示"
                        aria-label="全体表示"
                    >
                        <Maximize2 className="w-6 h-6" />
                    </button>
                </div>
                )}
            </div>

            <LengthInputSheet
                open={pendingSheet !== null}
                direction={pendingSheet?.direction ?? null}
                estimatedLengthMm={pendingSheet?.estimatedLengthMm ?? 0}
                closing={pendingSheet?.closing ?? false}
                onCancel={handleSheetCancel}
                onConfirm={handleSheetConfirm}
            />

            <MarkerColorSheet
                open={colorSheetTargetId !== null}
                currentColor={
                    colorSheetTargetId
                        ? data.markers.find((m) => m.id === colorSheetTargetId)?.color ?? 'blue'
                        : 'blue'
                }
                onCancel={handleColorSheetCancel}
                onConfirm={handleColorSheetConfirm}
            />

            <TextInputSheet
                open={pendingText !== null}
                mode={pendingText?.mode === 'edit' ? 'edit' : 'new'}
                initialText={pendingText?.mode === 'edit' ? pendingText.initialText : ''}
                onCancel={handleTextCancel}
                onConfirm={handleTextConfirm}
                onDelete={pendingText?.mode === 'edit' ? handleTextDelete : undefined}
            />

            <OpeningInputSheet
                open={pendingOpening !== null}
                mode={pendingOpening?.mode === 'edit' ? 'edit' : 'new'}
                wallLengthMm={pendingOpening?.wallLengthMm ?? 0}
                initialDistanceFromStart={pendingOpening?.distanceFromStart ?? 0}
                initialWidth={pendingOpening?.width ?? 1800}
                onCancel={handleOpeningCancel}
                onConfirm={handleOpeningConfirm}
                onDelete={pendingOpening?.mode === 'edit' ? handleOpeningDelete : undefined}
            />
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col leading-tight">
            <span className="text-[10px] text-slate-400">{label}</span>
            <span className="font-semibold text-teal-700 tabular-nums">{value}</span>
        </div>
    );
}
