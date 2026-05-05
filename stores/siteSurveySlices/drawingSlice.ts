// 作図機能の Zustand ストア（インメモリ）。永続化は別タスクで DB 連携。
import { create } from 'zustand';
import type { DrawingData, Direction, Point } from './types';
import { directionVector } from '@/utils/drawingMath';

const HISTORY_LIMIT = 50;

const DEFAULT_HEIGHT_MM = 8200;
const DEFAULT_CORRECTION_M = 0;

const INITIAL_DATA: DrawingData = {
    version: '1.0',
    sections: [],
    pins: [],
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
    addWall: (direction: Direction, lengthMm: number) => void;
    removeLastWall: () => void;
    closePolygon: () => void;
    setCurrentPointIndex: (idx: number | null) => void;
    reset: () => void;
    setHeight: (mm: number) => void;
    setCorrection: (m: number) => void;
    loadSampleData: (data: DrawingData) => void;
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
        set(state => {
            const history = pushHistory(state);
            const sectionId = 'section-1';
            const data: DrawingData = {
                ...state.data,
                sections: [
                    {
                        id: sectionId,
                        name: '本棟',
                        height: state.height,
                        polygon: { points: [{ x, y }], closed: false },
                        openings: [],
                    },
                ],
            };
            return { data, history, currentSectionId: sectionId, currentPointIndex: 0 };
        });
    },

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
        // StrictMode 対策: 既にセクションがロードされている場合はスキップ
        const current = get().data;
        if (current.sections.length > 0) return;
        const firstSection = data.sections[0];
        set({
            data,
            currentSectionId: firstSection?.id ?? null,
            currentPointIndex: firstSection
                ? Math.max(0, firstSection.polygon.points.length - 1)
                : null,
            history: [],
            height: firstSection?.height ?? DEFAULT_HEIGHT_MM,
        });
    },
}));
