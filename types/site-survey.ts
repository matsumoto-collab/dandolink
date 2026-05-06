// 現場調査（図面）の型定義
// 設計書: docs/SCAFFOLD_DRAWING_SPEC.md §5
// drawingData の中身は stores/siteSurveySlices/types.ts の DrawingData を流用
import type { DrawingData } from '@/stores/siteSurveySlices/types';

// 現場調査のレコード（DB の SiteSurvey と1:1で対応）
export interface SiteSurvey {
    id: string;
    projectMasterId?: string | null;
    title: string;
    customerName?: string | null;
    workType?: string | null;          // 屋根 / 壁 / 新築 / その他
    managerIds: string[];
    scheduledDate?: string | null;     // ISO 文字列
    notes?: string | null;
    handoffNotes?: string | null;
    arrivalTime?: string | null;
    vehicleSpec?: string | null;
    drawingData: DrawingData;
    scaffoldSpec?: unknown | null;     // Phase 2 以降
    surroundings?: unknown | null;     // Phase 3 以降
    perimeter?: number | null;         // m（キャッシュ）
    floorArea?: number | null;         // ㎡（キャッシュ）
    scaffoldArea?: number | null;      // ㎡（キャッシュ）
    createdBy?: string | null;
    createdAt: string;                 // ISO 文字列
    updatedAt: string;
    updatedBy?: string | null;
}

// 一覧表示用に最低限の項目だけ抜き出した型
export interface SiteSurveyListItem {
    id: string;
    projectMasterId: string | null;
    title: string;
    customerName: string | null;
    workType: string | null;
    perimeter: number | null;
    floorArea: number | null;
    scaffoldArea: number | null;
    createdAt: string;
    updatedAt: string;
}

// 作成・更新時の入力。id とタイムスタンプはサーバー側で付与
export type SiteSurveyInput = Omit<
    SiteSurvey,
    'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'createdBy'
>;

// 空の DrawingData（新規作成時の初期値）
export const EMPTY_DRAWING_DATA: DrawingData = {
    version: '1.0',
    sections: [],
    markers: [],
    texts: [],
};
