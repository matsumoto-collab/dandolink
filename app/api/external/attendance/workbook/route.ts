import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyExternalApiKey, EXTERNAL_API_HEADERS } from '@/lib/api/externalApiAuth';
import { buildAttendanceMonthlyPdfData, type AttendancePdfRecord } from '@/utils/attendanceMonthlyData';
import {
    buildAttendanceWorkbook,
    type AttendanceExcelSheetInput,
} from '@/utils/attendanceMonthlyExcelBuilder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/external/attendance/workbook?userIds=<csv>&year=2026&month=6
 *
 * 人事システム（yushin-hr）が技能実習の提出書類一式をまとめるための出勤簿。
 * 紙の出勤簿と同じ見た目の xlsx を返す（1人=1シート、userIds の順）。
 *
 * 画面から出している出勤簿Excelと**まったく同じ集計・同じテンプレート**を使う。
 * 集計は utils/attendanceMonthlyData.ts（react-pdf 非依存）、組み立ては
 * utils/attendanceMonthlyExcelBuilder.ts で、どちらもブラウザ側と共有している。
 * 二重実装にしないことで、提出物と画面の数字がズレる余地をなくしている。
 *
 * 認証は x-api-key（EXTERNAL_API_KEY）。未設定の環境では 503 で閉じる。
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 紙の出勤簿から作ったテンプレート（scripts/build-attendance-excel-template.ts の生成物） */
const TEMPLATE_PATH = path.join(
    process.cwd(),
    'public',
    'templates',
    'attendance-monthly-template.xlsx'
);

const MAX_USER_IDS = 100;

/** テンプレートはプロセス内で使い回す（サーバーレスの温かいインスタンスで再読込しない） */
let templateCache: Buffer | null = null;

function loadTemplate(): Buffer {
    if (!templateCache) templateCache = fs.readFileSync(TEMPLATE_PATH);
    return templateCache;
}

export async function GET(req: NextRequest) {
    const authError = verifyExternalApiKey(req);
    if (authError) return authError;

    try {
        const url = new URL(req.url);
        const year = Number(url.searchParams.get('year'));
        const month = Number(url.searchParams.get('month'));
        const userIds = (url.searchParams.get('userIds') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

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

        // AttendanceRecord.date は @db.Date。書き込み側と同じく UTC 0時で範囲を切る
        const from = new Date(Date.UTC(year, month - 1, 1));
        const to = new Date(Date.UTC(year, month, 0));

        const [users, records] = await Promise.all([
            prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, displayName: true },
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

        const nameById = new Map(users.map((u) => [u.id, u.displayName]));
        const missing = userIds.filter((id) => !nameById.has(id));
        if (missing.length > 0) {
            // 紐づけ間違いに気づけるよう、どのIDが無いのかを返す
            return NextResponse.json(
                { error: `DandoLink に存在しないユーザーが含まれています: ${missing.join(', ')}` },
                { status: 404, headers: EXTERNAL_API_HEADERS }
            );
        }

        const pdfRecords: AttendancePdfRecord[] = records.map((r) => ({
            userId: r.userId,
            date: r.date.toISOString().slice(0, 10),
            status: r.status,
            earlyStartMinutes: r.earlyStartMinutes,
            morningLoadingMinutes: r.morningLoadingMinutes,
            overtimeMinutes: r.overtimeMinutes,
            eveningLoadingMinutes: r.eveningLoadingMinutes,
            earlyEndTime: r.earlyEndTime,
            note: r.note,
        }));

        // 指定された userIds の順に 1人=1シート で並べる
        const sheets: AttendanceExcelSheetInput[] = userIds.map((id) => ({
            userName: nameById.get(id)!,
            data: buildAttendanceMonthlyPdfData(year, month, id, pdfRecords),
        }));

        const buffer = await buildAttendanceWorkbook(loadTemplate(), year, month, sheets);

        const fileName = `出勤簿_${year}年${month}月_${sheets.length}名.xlsx`;
        return new NextResponse(buffer, {
            headers: {
                ...EXTERNAL_API_HEADERS,
                'Content-Type': XLSX_MIME,
                // 日本語ファイル名は RFC 5987 形式で渡す
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
            },
        });
    } catch (e) {
        logger.error('[external-api/attendance/workbook] 生成に失敗', e);
        return NextResponse.json(
            { error: '出勤簿の生成に失敗しました' },
            { status: 500, headers: EXTERNAL_API_HEADERS }
        );
    }
}
