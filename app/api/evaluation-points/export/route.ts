/**
 * 評価ポイント: CSV（docs/指示書_評価ポイント.md の 6-3。共通の決まりは 6-0）。
 *
 *   GET /api/evaluation-points/export?startDate=&endDate=&type=detail|summary   admin・manager（期間は必須）
 *
 * 作りは app/api/attendance/export/route.ts と同じ（BOM 付き UTF-8・改行 CRLF・Content-Disposition: attachment）。
 *  - type=detail  … 1行＝1記録（確認待ちも出す。状態の列で見分ける）
 *  - type=summary … 1行＝1人。GET /summary と同じ loadEvaluationPointSummary() を使う＝同じ人・同じ並び・同じ数字
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { dateToDateKey, isEvaluationPointManager, toEvaluationPointStatus } from '@/lib/evaluationPoints';
import { actorOf } from '@/lib/evaluationPointsServer';
import {
    RECORD_SELECT,
    UNKNOWN_USER_NAME,
    loadEvaluationPointSummary,
    loadUserNames,
    parsePeriodParams,
} from '@/lib/evaluationPointsReport';

// 毎回サーバーで実行する（最近足した route＝own-crew-volume・joyo-statements と同じ書き方）
export const dynamic = 'force-dynamic';

const STATUS_LABEL = { confirmed: '確定', pending: '確認待ち' } as const;
const SOURCE_LABEL: Record<string, string> = { attendance: '出勤簿入力', manual: '評価ポイントの画面' };

/** カンマ・引用符・改行を含む値は、引用符で囲む */
function escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function toCsv(rows: string[][]): string {
    return '﻿' + rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
}

/** 日時 → 日本時間の「YYYY-MM-DD HH:mm」 */
function formatJstDateTime(date: Date): string {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date);
}

function csvResponse(csv: string, filename: string): NextResponse {
    return new NextResponse(csv, {
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        if (!isEvaluationPointManager(actor.role)) return errorResponse('権限がありません', 403);

        const params = new URL(req.url).searchParams;
        const type = params.get('type');
        if (type !== 'detail' && type !== 'summary') return validationErrorResponse('入力が不正です');
        const parsed = parsePeriodParams(params);
        if (!parsed.ok) return validationErrorResponse(parsed.message);
        if (!parsed.period) return validationErrorResponse('入力が不正です');
        const period = parsed.period;
        const suffix = `${period.startDate}_${period.endDate}`;

        if (type === 'summary') {
            const summary = await loadEvaluationPointSummary(period);
            const header = ['氏名', ...summary.items.map((i) => i.name), '合計回数', '合計点', '確認待ち件数'];
            const rows = summary.people.map((p) => [
                p.displayName,
                ...summary.items.map((i) => String(p.byItem[i.id]?.count ?? 0)),
                String(p.totalCount),
                String(p.totalPoints),
                String(p.pendingCount),
            ]);
            return csvResponse(toCsv([header, ...rows]), `evaluation_points_summary_${suffix}.csv`);
        }

        // ---- 明細（日付の古い順 → 入れた日時の古い順）
        const records = await prisma.evaluationPointRecord.findMany({
            where: { date: period.range },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
            select: RECORD_SELECT,
        });
        const names = await loadUserNames(records.map((r) => r.userId));
        const header = ['日付', '氏名', '項目', '点数', '状態', '付けた人', '入力元', 'メモ', '入力日時'];
        const rows = records.map((r) => [
            dateToDateKey(r.date),
            names.get(r.userId) ?? UNKNOWN_USER_NAME,
            r.itemName, // 記録に写してある名前
            String(r.points),
            STATUS_LABEL[toEvaluationPointStatus(r.status)],
            r.createdByName,
            SOURCE_LABEL[r.source] ?? r.source,
            r.note ?? '',
            formatJstDateTime(r.createdAt),
        ]);
        return csvResponse(toCsv([header, ...rows]), `evaluation_points_detail_${suffix}.csv`);
    } catch (err) {
        return serverErrorResponse('評価ポイントの CSV 出力', err);
    }
}
