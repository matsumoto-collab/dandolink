import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { calcTimeDiffMinutes } from '@/utils/dateUtils';

const ALLOWED_ROLES = ['admin', 'manager', 'foreman1', 'foreman2'];

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 出勤簿エクスポートと同じ丸め（小数2桁）
function minutesToHours(min: number): number {
    return Math.round((min / 60) * 100) / 100;
}

const workItemSelect = {
    assignmentId: true,
    startTime: true,
    endTime: true,
    breakMinutes: true,
    workerIds: true,
    assignment: {
        select: {
            sortOrder: true,
            projectMaster: { select: { title: true, name: true, honorific: true, customerName: true } },
        },
    },
};

const reportSelect = {
    id: true,
    foremanId: true,
    date: true,
    notes: true,
    workItems: { select: workItemSelect },
};

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!ALLOWED_ROLES.includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const url = new URL(req.url);
        const month = url.searchParams.get('month');
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');
        const foremanId = url.searchParams.get('foremanId');

        // 期間の解決: month 優先、無ければ startDate/endDate
        let dateFilter: { gte: Date; lte: Date };
        let filenameSuffix: string;
        if (month) {
            if (!MONTH_PATTERN.test(month)) {
                return validationErrorResponse('month=yyyy-mm または startDate/endDate=yyyy-mm-dd を指定してください');
            }
            const [y, m] = month.split('-').map(Number);
            // 月初〜月末（DailyReport.date は UTC0時の印として保存されている）
            dateFilter = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) };
            filenameSuffix = month;
        } else if (startDate && endDate) {
            if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
                return validationErrorResponse('month=yyyy-mm または startDate/endDate=yyyy-mm-dd を指定してください');
            }
            if (startDate > endDate) {
                return validationErrorResponse('開始日は終了日以前の日付を指定してください');
            }
            dateFilter = { gte: new Date(startDate), lte: new Date(endDate) };
            filenameSuffix = `${startDate}_${endDate}`;
        } else {
            return validationErrorResponse('month=yyyy-mm または startDate/endDate=yyyy-mm-dd を指定してください');
        }

        const where: Record<string, unknown> = { date: dateFilter };
        if (foremanId) where.foremanId = foremanId;

        const [reports, users] = await Promise.all([
            prisma.dailyReport.findMany({
                where,
                select: reportSelect,
                orderBy: [{ date: 'asc' }, { foremanId: 'asc' }],
            }),
            // 退職者の日報でも名前が出るよう isActive で絞らない
            prisma.user.findMany({ select: { id: true, displayName: true } }),
        ]);

        const userMap = new Map<string, string>((users ?? []).map((u: { id: string; displayName: string }) => [u.id, u.displayName]));
        const resolveUserName = (id: string) => userMap.get(id) ?? id;

        const header = ['日付', '職長', '案件名', '顧客名', '開始', '終了', '休憩(分)', '実作業(分)', '実作業(時)', '作業員', '人数', '備考'];
        const rows: string[][] = [];

        type ExportWorkItem = {
            startTime: string | null;
            endTime: string | null;
            breakMinutes: number | null;
            workerIds: string[] | null;
            assignment: {
                sortOrder: number | null;
                projectMaster: { title: string | null; name: string | null; honorific: string | null; customerName: string | null } | null;
            } | null;
        };
        type ExportReport = {
            foremanId: string;
            date: Date;
            notes: string | null;
            workItems: ExportWorkItem[];
        };

        for (const report of (reports ?? []) as ExportReport[]) {
            // DailyReport.date は UTC0時の印なので ISO の日付部分をそのまま使う
            const dateStr = new Date(report.date).toISOString().slice(0, 10);
            const foremanName = resolveUserName(report.foremanId);
            const notes = report.notes ?? '';

            const items = [...(report.workItems ?? [])].sort((a, b) => {
                const ao = a.assignment?.sortOrder ?? Number.MAX_SAFE_INTEGER;
                const bo = b.assignment?.sortOrder ?? Number.MAX_SAFE_INTEGER;
                return ao - bo;
            });

            // 作業項目が0件の日報も1行出す（案件系の列は空）
            if (items.length === 0) {
                rows.push([dateStr, foremanName, '', '', '', '', '', '', '', '', '', notes]);
                continue;
            }

            for (const item of items) {
                const pm = item.assignment?.projectMaster;
                const projectName = pm
                    ? (pm.name ? `${pm.name}${pm.honorific || ''}` : pm.title || '(案件名不明)')
                    : '(案件名不明)';
                const customerName = pm?.customerName ?? '';
                const breakMinutes = item.breakMinutes ?? 0;

                let netMinutes = '';
                let netHours = '';
                if (item.startTime && item.endTime) {
                    const gross = calcTimeDiffMinutes(item.startTime, item.endTime);
                    const net = Math.max(0, gross - breakMinutes);
                    netMinutes = String(net);
                    netHours = String(minutesToHours(net));
                }

                const workerIds = item.workerIds ?? [];
                const workerNames = workerIds.map(resolveUserName).join('、');

                rows.push([
                    dateStr,
                    foremanName,
                    projectName,
                    customerName,
                    item.startTime ?? '',
                    item.endTime ?? '',
                    String(breakMinutes),
                    netMinutes,
                    netHours,
                    workerNames,
                    String(workerIds.length),
                    notes,
                ]);
            }
        }

        const escape = (v: string) => {
            if (v.includes(',') || v.includes('"') || v.includes('\n')) {
                return `"${v.replace(/"/g, '""')}"`;
            }
            return v;
        };
        const csvBody = [header, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
        const bom = '﻿'; // Excel 用 BOM
        const csv = bom + csvBody;

        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="daily_reports_${filenameSuffix}.csv"`,
                'Cache-Control': 'no-store',
            },
        });
    } catch (err) {
        return serverErrorResponse('日報エクスポート', err);
    }
}
