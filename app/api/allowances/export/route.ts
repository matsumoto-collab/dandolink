/**
 * 手当: CSV（docs/指示書_大規模手当.md の 6-4。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/export?month=YYYY-MM&type=detail|summary   admin・manager（月は必須）
 *
 * 作りは評価ポイントの CSV（app/api/evaluation-points/export/route.ts）と同じ
 * （BOM 付き UTF-8・改行 CRLF・Content-Disposition: attachment）。
 * 違う点: 人が入れた文字（氏名・手当の名前・付けた人・メモ）が = + - @ で始まるときは、頭に ' を付ける
 * （Excel が、その文字を「式」として読んでしまわないように）。
 *  - type=summary … 1行＝1人。GET /summary と同じ loadAllowanceSummary() を使う＝同じ人・同じ並び・同じ数字
 *  - type=detail  … 1行＝1記録（確認待ちも出す。状態の列で見分ける）。日付の古い順
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { dateToDateKey, isAllowanceManager, monthRangeOf, toAllowancePayRole, toAllowanceStatus } from '@/lib/allowances';
import { actorOf } from '@/lib/allowancesServer';
import { ALLOWANCE_RECORD_SELECT, UNKNOWN_USER_NAME, loadAllowanceSummary, loadUserNames } from '@/lib/allowancesReport';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

const STATUS_LABEL = { confirmed: '確定', pending: '確認待ち' } as const;
const PAY_ROLE_LABEL = { foreman: '職長', member: '職長以外' } as const;
const SOURCE_LABEL = new Map<string, string>([['attendance', '出勤簿入力'], ['manual', '手当の画面'], ['bulk', '手配と見比べる']]);
/** 社員（給与に付ける分）か、常用の一人親方（支払明細書に載せる分）か */
const kindLabel = (isJoyo: boolean): string => (isJoyo ? '一人親方' : '社員');

/** カンマ・引用符・改行を含む値は、引用符で囲む */
function escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/** 先頭に付ける BOM（Excel が UTF-8 と分かるように）。見えない文字なので、番号で書く */
const BOM = '\uFEFF';

function toCsv(rows: string[][]): string {
    return BOM + rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
}

/**
 * 人が入れた文字を CSV に出す前に通す。
 * = + - @（と、タブ・復帰）で始まる値は、Excel が式として読むことがあるので、頭に ' を付けて、ただの文字にする。
 */
function safeText(value: string): string {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const params = new URL(req.url).searchParams;
        const type = params.get('type');
        if (type !== 'detail' && type !== 'summary') return validationErrorResponse('入力が不正です');
        const month = params.get('month');
        if (month === null) return validationErrorResponse('入力が不正です');
        const range = monthRangeOf(month);
        if (!range) return validationErrorResponse('月が不正です');

        if (type === 'summary') {
            const summary = await loadAllowanceSummary(month);
            if (!summary) return validationErrorResponse('月が不正です');
            const header = ['氏名', '区分', '職長（日）', '職長（円）', '職長以外（日）', '職長以外（円）', '合計（日）', '合計（円）', '確認待ち（件）'];
            const rows = summary.people.map((p) => [
                safeText(p.displayName),
                kindLabel(p.isJoyo),
                String(p.foremanDays),
                String(p.foremanAmount),
                String(p.memberDays),
                String(p.memberAmount),
                String(p.totalDays),
                String(p.totalAmount),
                String(p.pendingCount),
            ]);
            return csvResponse(toCsv([header, ...rows]), `allowances_summary_${month}.csv`);
        }

        // ---- 明細（日付の古い順 → 入れた日時の古い順 → ID 順。まとめて付けた記録は入れた日時が同じなので、最後は ID で決める）
        const records = await prisma.allowanceRecord.findMany({
            where: { date: range.dateRange },
            orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            select: ALLOWANCE_RECORD_SELECT,
        });
        const userIds = Array.from(new Set(records.map((r) => r.userId)));
        const [names, joyoRows] = await Promise.all([
            loadUserNames(userIds),
            userIds.length === 0
                ? []
                : prisma.joyoContractor.findMany({ where: { userId: { in: userIds } }, select: { userId: true } }),
        ]);
        const joyoUserIds = new Set(joyoRows.map((j) => j.userId));

        const header = ['日付', '氏名', '区分', '手当', '職長・職長以外', '金額', '状態', '付けた人', '入力元', 'メモ', '入力日時'];
        const rows = records.map((r) => [
            dateToDateKey(r.date),
            safeText(names.get(r.userId) ?? UNKNOWN_USER_NAME),
            kindLabel(joyoUserIds.has(r.userId)),
            safeText(r.itemName), // 記録に写してある名前
            PAY_ROLE_LABEL[toAllowancePayRole(r.payRole)],
            String(r.amount), // 記録に入っている金額
            STATUS_LABEL[toAllowanceStatus(r.status)],
            safeText(r.createdByName),
            safeText(SOURCE_LABEL.get(r.source) ?? r.source),
            safeText(r.note ?? ''),
            formatJstDateTime(r.createdAt),
        ]);
        return csvResponse(toCsv([header, ...rows]), `allowances_detail_${month}.csv`);
    } catch (err) {
        return serverErrorResponse('手当の CSV 出力', err);
    }
}
