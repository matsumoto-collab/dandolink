// 作図機能の Zustand ストア（インメモリ）。永続化は別タスクで DB 連携。
import { create } from 'zustand';
import type { DrawingData, Direction, Point, MarkerColor } from './types';
import { directionVector } from '@/utils/drawingMath';

const HISTORY_LIMIT = 50;

const DEFAULT_HEIGHT_MM = 8200;
const DEFAULT_CORRECTION_M = 0;

const INITIAL_DATA: DrawingData = {
    version: '1.0',
    sections: [],
    markers: [],
    texts: [],
};

interface DrawingState {
    data: DrawingData;
    currentSectionId: string | null;
    currentPointIndex: number | null;
    history: DrawingData[];
    height: number;     // mm
    correction: number; // m
}

interface DrawingActions {
    setStartPoint: (x: number, y: number) => void;
    startNewSection: (x: number, y: number) => void;
    setCurrentSection: (sectionId: string, pointIndex?: number) => void;
    addWall: (direction: Direction, lengthMm: number) => void;
    removeLastWall: () => void;
    closePolygon: () => void;
    setCurrentPointIndex: (idx: number | null) => void;
    reset: () => void;
    setHeight: (mm: number) => void;
    setCorrection: (m: number) => void;
    loadSampleData: (data: DrawingData) => void;
    // 保存済みの図面データを読み込む（編集ページ用）
    loadDrawing: (data: DrawingData, opts?: { height?: number; correction?: number }) => void;
    addMarker: (points: Point[], color: MarkerColor) => void;
    updateMarker: (id: string, color: MarkerColor) => void;
    deleteMarker: (id: string) => void;
    extendMarker: (markerId: string, fromStart: boolean, endPoint: Point) => void;
    addText: (x: number, y: number, text: string) => void;
    updateText: (id: string, text: string) => void;
    moveText: (id: string, x: number, y: number) => void;
    deleteText: (id: string) => void;
    addOpening: (sectionId: string, wallIndex: number, position: number, width: number) => void;
    updateOpening: (sectionId: string, openingIndex: number, position: number, width: number) => void;
    deleteOpening: (sectionId: string, openingIndex: number) => void;
}

type Store = DrawingState & DrawingActions;

function pushHistory(state: DrawingState): DrawingData[] {
    const next = [...state.history, state.data];
    if (next.length > HISTORY_LIMIT) next.shift();
    return next;
}

function ensureSection(data: DrawingData, sectionId: string | null) {
    if (!sectionId) return null;
    return data.sections.find(s => s.id === sectionId) ?? null;
}

export const useDrawingStore = create<Store>((set, get) => ({
    data: INITIAL_DATA,
    currentSectionId: null,
    currentPointIndex: null,
    history: [],
    height: DEFAULT_HEIGHT_MM,
    correction: DEFAULT_CORRECTION_M,

    setStartPoint: (x, y) => {
        // 互換 API: 内部的に startNewSection と同じ
        get().startNewSection(x, y);
    },

    startNewSection: (x, y) => {
        set(state => {
            const history = pushHistory(state);
            const sectionCount = state.data.sections.length;
            const NAMES = ['本棟', 'テラス1', 'テラス2', '物置1', '物置2', '増築1', '増築2'];
            const name = NAMES[sectionCount] ?? `セクション${sectionCount + 1}`;
            const newId = `section-${Date.now()}-${sectionCount}`;
            const newSection = {
                id: newId,
                name,
                height: state.height,
                polygon: { points: [{ x, y }], closed: false },
                openings: [],
            };
            return {
                data: { ...state.data, sections: [...state.data.sections, newSection] },
                currentSectionId: newId,
                currentPointIndex: 0,
                history,
            };
        });
    },

    setCurrentSection: (sectionId, pointIndex) => set(state => {
        const section = state.data.sections.find(s => s.id === sectionId);
        if (!section) return state;
        const idx = pointIndex ?? section.polygon.points.length - 1;
        return { ...state, currentSectionId: sectionId, currentPointIndex: idx };
    }),

    addWall: (direction, lengthMm) => {
        const state = get();
        const section = ensureSection(state.data, state.currentSectionId);
        if (!section || state.currentPointIndex === null) return;
        const last = section.polygon.points[state.currentPointIndex];
        if (!last) return;
        const v = directionVector(direction);
        const next: Point = { x: last.x + v.dx * lengthMm, y: last.y + v.dy * lengthMm };
        set(s => {
            const history = pushHistory(s);
            const sections = s.data.sections.map(sec => {
                if (sec.id !== state.currentSectionId) return sec;
                return {
                    ...sec,
                    polygon: {
                        ...sec.polygon,
                        points: [...sec.polygon.points, next],
                    },
                };
            });
            return {
                data: { ...s.data, sections },
                history,
                currentPointIndex: section.polygon.points.length,
            };
        });
    },

    removeLastWall: () => {
        const state = get();
        if (state.history.length === 0) return;
        const prev = state.history[state.history.length - 1];
        const newHistory = state.history.slice(0, -1);
        const section = ensureSection(prev, state.currentSectionId);
        const idx = section ? section.polygon.points.length - 1 : null;
        set({
            data: prev,
            history: newHistory,
            currentPointIndex: idx,
        });
    },

    closePolygon: () => {
        set(s => {
            const section = ensureSection(s.data, s.currentSectionId);
            if (!section || section.polygon.points.length < 3) return s;
            const history = pushHistory(s);
            const sections = s.data.sections.map(sec =>
                sec.id === s.currentSectionId
                    ? { ...sec, polygon: { ...sec.polygon, closed: true } }
                    : sec,
            );
            return { ...s, data: { ...s.data, sections }, history };
        });
    },

    setCurrentPointIndex: (idx) => set({ currentPointIndex: idx }),

    reset: () => set({
        data: INITIAL_DATA,
        currentSectionId: null,
        currentPointIndex: null,
        history: [],
    }),

    setHeight: (mm) => set({ height: mm }),
    setCorrection: (m) => set({ correction: m }),

    loadSampleData: (data) => {
        const current = get().data;
        if (current.sections.length > 0) return;
        const firstSection = data.sections[0];
        const normalized: DrawingData = { ...data, markers: data.markers ?? [], texts: data.texts ?? [] };
        set({
            data: normalized,
            currentSectionId: firstSection ? firstSection.id : null,
            currentPointIndex: firstSection ? Math.max(0, firstSection.polygon.points.length - 1) : null,
            history: [],
            height: firstSection ? firstSection.height : DEFAULT_HEIGHT_MM,
        });
    },

    addMarker: (points, color) => {
        set((state) => {
            const history = pushHistory(state);
            const markersCount = state.data.markers.length;
            const newMarker = {
                id: `marker-${Date.now()}-${markersCount}`,
                points,
                color,
            };
            return {
                data: { ...state.data, markers: [...state.data.markers, newMarker] },
                history,
            };
        });
    },

    updateMarker: (id, color) => {
        set((state) => {
            if (!state.data.markers.some((m) => m.id === id)) return state;
            const history = pushHistory(state);
            const markers = state.data.markers.map((m) =>
                m.id === id ? { ...m, color } : m,
            );
            return { data: { ...state.data, markers }, history };
        });
    },

    deleteMarker: (id) => {
        set((state) => {
            if (!state.data.markers.some((m) => m.id === id)) return state;
            const history = pushHistory(state);
            const markers = state.data.markers.filter((m) => m.id !== id);
            return { data: { ...state.data, markers }, history };
        });
    },

    addText: (x, y, text) => {
        set((state) => {
            const history = pushHistory(state);
            const textsCount = state.data.texts.length;
            const newText = {
                id: `text-${Date.now()}-${textsCount}`,
                x,
                y,
                text,
            };
            return {
                data: { ...state.data, texts: [...state.data.texts, newText] },
                history,
            };
        });
    },

    updateText: (id, text) => {
        set((state) => {
            if (!state.data.texts.some((t) => t.id === id)) return state;
            const history = pushHistory(state);
            const texts = state.data.texts.map((t) => (t.id === id ? { ...t, text } : t));
            return { data: { ...state.data, texts }, history };
        });
    },

    moveText: (id, x, y) => {
        set((state) => {
            if (!state.data.texts.some((t) => t.id === id)) return state;
            const history = pushHistory(state);
            const texts = state.data.texts.map((t) => (t.id === id ? { ...t, x, y } : t));
            return { data: { ...state.data, texts }, history };
        });
    },

    deleteText: (id) => {
        set((state) => {
            if (!state.data.texts.some((t) => t.id === id)) return state;
            const history = pushHistory(state);
            const texts = state.data.texts.filter((t) => t.id !== id);
            return { data: { ...state.data, texts }, history };
        });
    },

    extendMarker: (markerId, fromStart, endPoint) => {
        set((state) => {
            if (!state.data.markers.some((m) => m.id === markerId)) return state;
            const history = pushHistory(state);
            const markers = state.data.markers.map((m) => {
                if (m.id !== markerId) return m;
                const points = fromStart ? [endPoint, ...m.points] : [...m.points, endPoint];
                return { ...m, points };
            });
            return { data: { ...state.data, markers }, history };
        });
    },

    addOpening: (sectionId, wallIndex, position, width) => {
        set((state) => {
            if (!state.data.sections.some((s) => s.id === sectionId)) return state;
            const history = pushHistory(state);
            const sections = state.data.sections.map((sec) =>
                sec.id === sectionId
                    ? { ...sec, openings: [...sec.openings, { wallIndex, position, width }] }
                    : sec,
            );
            return { data: { ...state.data, sections }, history };
        });
    },

    updateOpening: (sectionId, openingIndex, position, width) => {
        set((state) => {
            const target = state.data.sections.find((s) => s.id === sectionId);
            if (!target || !target.openings[openingIndex]) return state;
            const history = pushHistory(state);
            const sections = state.data.sections.map((sec) => {
                if (sec.id !== sectionId) return sec;
                const openings = sec.openings.map((o, i) =>
                    i === openingIndex ? { ...o, position, width } : o,
                );
                return { ...sec, openings };
            });
            return { data: { ...state.data, sections }, history };
        });
    },

    deleteOpening: (sectionId, openingIndex) => {
        set((state) => {
            const target = state.data.sections.find((s) => s.id === sectionId);
            if (!target || !target.openings[openingIndex]) return state;
            const history = pushHistory(state);
            const sections = state.data.sections.map((sec) => {
                if (sec.id !== sectionId) return sec;
                return { ...sec, openings: sec.openings.filter((_, i) => i !== openingIndex) };
            });
            return { data: { ...state.data, sections }, history };
        });
    },

    loadDrawing: (data, opts) => {
        const firstSection = data.sections[0];
        const normalized: DrawingData = { ...data, markers: data.markers ?? [], texts: data.texts ?? [] };
        set({
            data: normalized,
            currentSectionId: firstSection ? firstSection.id : null,
            currentPointIndex: firstSection ? Math.max(0, firstSection.polygon.points.length - 1) : null,
            history: [],
            height: (opts && opts.height) || (firstSection && firstSection.height) || DEFAULT_HEIGHT_MM,
            correction: (opts && opts.correction) || DEFAULT_CORRECTION_M,
        });
    },
}));
