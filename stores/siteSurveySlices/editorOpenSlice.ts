// 現場調査エディタの開閉状態を管理する小さな Zustand ストア
// URL を変えずにフルスクリーンエディタをオーバーレイ表示するために使う
import { create } from 'zustand';

export type EditorMode = 'new' | 'edit';

interface EditorOpenState {
    isOpen: boolean;
    mode: EditorMode;
    surveyId: string | null;       // 編集モード時に必要
    projectMasterId: string | null; // 新規作成時に紐付ける案件
    closeVersion: number;
}

interface EditorOpenActions {
    openNew: (projectMasterId?: string | null) => void;
    openEdit: (surveyId: string) => void;
    close: () => void;
}

type Store = EditorOpenState & EditorOpenActions;

const INITIAL: Omit<EditorOpenState, 'closeVersion'> = {
    isOpen: false,
    mode: 'new',
    surveyId: null,
    projectMasterId: null,
};

export const useSiteSurveyEditor = create<Store>((set) => ({
    ...INITIAL,
    closeVersion: 0,

    openNew: (projectMasterId) =>
        set({
            isOpen: true,
            mode: 'new',
            surveyId: null,
            projectMasterId: projectMasterId ?? null,
        }),

    openEdit: (surveyId) =>
        set({
            isOpen: true,
            mode: 'edit',
            surveyId,
            projectMasterId: null,
        }),

    close: () =>
        set((state) => ({
            ...INITIAL,
            closeVersion: state.closeVersion + 1,
        })),
}));
