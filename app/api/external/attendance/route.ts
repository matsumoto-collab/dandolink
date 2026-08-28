import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyExternalApiKey, EXTERNAL_API_HEADERS } from '@/lib/api/externalApiAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/external/attendance?userIds=<csv>&year=2026&month=6
 *
 * 人事システム（yushin-hr）へ月次の勤怠を渡すサーバー間 API。
 * 技能実習日誌の「休み」を出勤簿と完全に一致させるために使う。
 *
 * 認証は x-api-key（EXTERNAL_API_KEY）。未設定の環境では 503 で閉じる。
 *
 * 出勤簿マスタは DandoLink 側という既定方針のとおり、こちらは読み取り専用。
 * 受け取った側が勤怠を書き換えることはない。
 */

/** 出勤簿の区分ラベル。MonthlyAttendanceView の STATUS_OPTIONS と同じ */
const STATUS_LABELS: Record<string, string> = {
    present: '出勤',
    absent: '欠勤',
    paid_leave: '有給',
    holiday: '休日',
    night_shift: '夜勤',
    compensatory_holiday: '代休',
    holiday_work: '休日出勤',
};

/**
 * 実習・就労を行った日として数える区分。
 * MonthlyAttendanceView の workish 判定と揃えてある（開始/終了時刻が入る区分）。
 * 有給・代休・欠勤・休日は「働いていない日」なので false。
 */
const WORKED_STATUSES = new Set(['present', 'night_shift', 'holiday_work']);

const MAX_USER_IDS = 100;

export async function GET(req: NextRequest) {
    const authError = verifyExternalApiKey(req);
    if (authError) return authError;

    try {
        const url = new URL(req.url);
        const year = Number(url.searchParams.get('year'));
        const month = Number(url.searchParams.get('month'));
        const userIdsParam = url.searchParams.get('userIds') ?? '';

        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            return NextResponse.json(
                { error: 'year は2000〜2100の整数で指定してください' },
                { status: 400, headers: EXTERNAL_API_HEADERS }
            );
        }
        if (!Number.isInteger(month) || month < 1 || month > 12) {
            return NextResponse.json(
                { error: 'month は1〜12の整数で指定してください' },
                { status: 400, headers: EXTERNAL_API_HEADERS }
            );
        }

        const userIds = userIdsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        if (userIds.length === 0) {
            return NextResponse.json(
                { error: 'userIds をカンマ区切りで1つ以上指定してください' },
                { status: 400, headers: EXTERNAL_API_HEADERS }
            );
        }
        if (userIds.length > MAX_USER_IDS) {
            return NextResponse.json(
                { error: `userIds は最大${MAX_USER_IDS}件までです` },
                { status: 400, headers: EXTERNAL_API_HEADERS }
            );
        }

        // AttendanceRecord.date は @db.Date。POST 側と同じく UTC 0時で範囲を切る
        const from = new Date(Date.UTC(year, month - 1, 1));
        const to = new Date(Date.UTC(year, month, 0));

        const [users, records] = await Promise.all([
            prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, displayName: true, isActive: true },
            }),
            prisma.attendanceRecord.findMany({
                where: { userId: { in: userIds }, date: { gte: from, lte: to } },
                select: {
                    userId: true,
                    date: true,
                    status: true,
                    earlyStartMinutes: true,
                    morningLoadingMinutes: true,
                    overtimeMinutes: true,
                    eveningLoadingMinutes: true,
                    earlyEndTime: true,
                    note: true,
                },
                orderBy: [{ userId: 'asc' }, { date: 'asc' }],
            }),
        ]);

        const userById = new Map(users.map((u) => [u.id, u]));
        const daysByUser = new Map<string, unknown[]>();

        for (const record of records) {
            const list = daysByUser.get(record.userId) ?? [];
            list.push({
                date: record.date.toISOString().slice(0, 10),
                status: record.status,
                statusLabel: STATUS_LABELS[record.status] ?? record.status,
                worked: WORKED_STATUSES.has(record.status),
                earlyStartMinutes: record.earlyStartMinutes,
                morningLoadingMinutes: record.morningLoadingMinutes,
                overtimeMinutes: record.overtimeMinutes,
                eveningLoadingMinutes: record.eveningLoadingMinutes,
                earlyEndTime: record.earlyEndTime,
                note: record.note,
            });
            daysByUser.set(record.userId, list);
        }

        // 指定された userIds の順序を保って返す。存在しない ID も found:false で返し、
        // 呼び出し側が「マッピングが間違っている」ことに気づけるようにする
        const payload = userIds.map((id) => {
            const user = userById.get(id);
            return {
                userId: id,
                found: Boolean(user),
                displayName: user?.displayName ?? null,
                isActive: user?.isActive ?? null,
                days: daysByUser.get(id) ?? [],
            };
        });

        return NextResponse.json(
            { year, month, users: payload },
            { headers: EXTERNAL_API_HEADERS }
        );
    } catch (e) {
        logger.error('[external-api/attendance] 取得に失敗', e);
        return NextResponse.json(
            { error: '勤怠の取得に失敗しました' },
            { status: 500, headers: EXTERNAL_API_HEADERS }
        );
    }
}
