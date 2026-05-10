import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, parseJsonField } from '@/lib/api/utils';

interface PartnerScheduleAssignment {
    id: string;
    date: string; // YYYY-MM-DD
    projectMasterId: string;
    projectTitle: string;
    projectName: string | null;
    customerShortName: string | null;
    location: string | null;
    prefecture: string | null;
    city: string | null;
    constructionTypeId: string | null;
    constructionContent: string | null;
    meetingTime: string | null;
    foremanId: string;
    foremanName: string;
    isOwnTeam: boolean;
    workers: { id: string; displayName: string }[];
    vehicles: { id: string; name: string }[];
    dispatchRemark: string | null;
    remarks: string | null;
    workStartedAt: string | null;
    workEndedAt: string | null;
}

/**
 * GET /api/partner-schedule
 * 協力会社 (partner) / 協力会社メンバー (partner_member) 専用の閲覧 API。
 * 前日 〜 5日後 (計7日間、手配確定済のみ) を、会社単位のスコープで返す。
 * 「自社班」と「自社メンバーが他班に手配」の両方を含む。
 */
export async function GET(_req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (role !== 'partner' && role !== 'partner_member') {
            return errorResponse('権限がありません', 403);
        }

        const scopeCompanyId =
            role === 'partner' ? session!.user.id : session!.user.companyId;
        if (!scopeCompanyId) {
            return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
        }

        // JST (Asia/Tokyo) ベースで「今日」「翌々日」を計算する
        // サーバが UTC でも JST でも同一の動作になるよう Intl.DateTimeFormat を使う
        const jstDateKey = (d: Date): string =>
            new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(d);

        const nowJstKey = jstDateKey(new Date());
        const today = new Date(`${nowJstKey}T00:00:00+09:00`);
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        // 前日 00:00 (JST) 以上、6日後 00:00 (JST) 未満 = -1〜+5日の計7日間
        const rangeStart = new Date(today.getTime() - 1 * ONE_DAY_MS);
        const rangeEnd = new Date(today.getTime() + 6 * ONE_DAY_MS);

        const members = await prisma.user.findMany({
            where: { companyId: scopeCompanyId, isActive: true },
            select: { id: true, displayName: true },
        });
        const memberIds = new Set(members.map((m) => m.id));
        memberIds.add(scopeCompanyId);

        const assignments = await prisma.projectAssignment.findMany({
            where: {
                date: { gte: rangeStart, lt: rangeEnd },
                isDispatchConfirmed: true,
            },
            select: {
                id: true,
                date: true,
                assignedEmployeeId: true,
                confirmedWorkerIds: true,
                meetingTime: true,
                dispatchRemark: true,
                remarks: true,
                constructionType: true,
                workStartedAt: true,
                workEndedAt: true,
                projectMaster: {
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        honorific: true,
                        customerShortName: true,
                        location: true,
                        prefecture: true,
                        city: true,
                        constructionContent: true,
                    },
                },
            },
            orderBy: [{ date: 'asc' }, { meetingTime: 'asc' }],
        });

        const foremanIds = new Set<string>();
        assignments.forEach((a) => foremanIds.add(a.assignedEmployeeId));
        const foremenList = await prisma.user.findMany({
            where: { id: { in: Array.from(foremanIds) } },
            select: { id: true, displayName: true },
        });
        const foremenMap = new Map(foremenList.map((f) => [f.id, f.displayName]));

        const workerIdSet = new Set<string>();
        assignments.forEach((a) => {
            const ids = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            ids.forEach((id) => workerIdSet.add(id));
        });
        const workersList = await prisma.user.findMany({
            where: { id: { in: Array.from(workerIdSet) } },
            select: { id: true, displayName: true },
        });
        const workerMap = new Map(workersList.map((w) => [w.id, w.displayName]));

        const filtered: PartnerScheduleAssignment[] = [];
        for (const a of assignments) {
            const confirmedIds = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            const isOwnTeam = a.assignedEmployeeId === scopeCompanyId;
            const memberInThisTeam = confirmedIds.some((id) => memberIds.has(id));
            if (!isOwnTeam && !memberInThisTeam) continue;

            filtered.push({
                id: a.id,
                date: jstDateKey(a.date),
                projectMasterId: a.projectMaster.id,
                projectTitle: a.projectMaster.title,
                projectName: a.projectMaster.name
                    ? a.projectMaster.name + (a.projectMaster.honorific || '')
                    : null,
                customerShortName: a.projectMaster.customerShortName,
                location: a.projectMaster.location,
                prefecture: a.projectMaster.prefecture,
                city: a.projectMaster.city,
                constructionTypeId: a.constructionType,
                constructionContent: a.projectMaster.constructionContent,
                meetingTime: a.meetingTime,
                foremanId: a.assignedEmployeeId,
                foremanName: foremenMap.get(a.assignedEmployeeId) ?? '不明',
                isOwnTeam,
                workers: confirmedIds.map((id) => ({
                    id,
                    displayName: workerMap.get(id) ?? '不明',
                })),
                vehicles: [],
                dispatchRemark: a.dispatchRemark,
                remarks: a.remarks,
                workStartedAt: a.workStartedAt ? a.workStartedAt.toISOString() : null,
                workEndedAt: a.workEndedAt ? a.workEndedAt.toISOString() : null,
            });
        }

        return NextResponse.json(filtered, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('協力会社向け予定取得', error);
    }
}
