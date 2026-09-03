/**
 * 受注明細書（信用保証協会様式）の API レスポンス型。画面とルートハンドラで共有する。
 *
 * `import type` はコンパイル時に消えるので、サーバー専用モジュール（prisma を持つ
 * lib/orderBacklog/server.ts・candidates.ts）から型だけ借りてもクライアントには何も入らない。
 */
import type { OrderBacklogCandidateWarning } from '@/lib/orderBacklog/candidates';
import type { OrderBacklogReportRecord } from '@/lib/orderBacklog/server';
import type { OrderBacklogLineInput } from '@/lib/orderBacklog/types';

export type { OrderBacklogCandidateWarning, OrderBacklogReportRecord };

/** 一覧（左ペイン）の1行。契約額合計は除外していない明細だけの合計。 */
export interface OrderBacklogReportSummary {
    id: string;
    /** 'YYYY-MM-DD' */
    asOfDate: string;
    title: string | null;
    lineCount: number;
    contractTotal: number;
    createdByName: string | null;
    /** ISO 文字列 */
    updatedAt: string;
}

/** GET/PUT /api/order-backlog/reports/[id] のレスポンス。 */
export interface OrderBacklogReportDetail {
    report: OrderBacklogReportRecord;
    lines: OrderBacklogLineInput[];
}

/** GET /api/order-backlog/candidates のレスポンス。 */
export interface OrderBacklogCandidatesResponse {
    lines: OrderBacklogLineInput[];
    warnings: OrderBacklogCandidateWarning[];
}
