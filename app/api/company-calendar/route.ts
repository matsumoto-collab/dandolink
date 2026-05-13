import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import {
    CALENDAR_CATEGORY_LABELS,
    isCalendarCategory,
    isCalendarVisibility,
    type CalendarCategory,
    type CalendarEventDTO,
    type CalendarEventInput,
} from '@/types/companyCalendar';

/**
 * 社内カレンダー API
 *  - admin / manager のみアクセス可能（requireManagerOrAbove 経由）
 *  - GET: 期間内のイベントを返す
 *      + ProjectMaster の道路使用許可フィールドから自動生成したイベントもマージ
 *      + visibility === 'private' は本人作成分のみ
 *  - POST: 新規イベント作成
 */

interface AutoEvent extends CalendarEventDTO {
    isAuto: true;
}

/**
 * ProjectMaster の道路使用許可フィールドからカレンダーイベントを擬似生成する。
 * これらは DB の CalendarEvent には保存されず、表示用のみの仮想イベント。
 */
function buildAutoEventsFromProject(pm: {
    id: string;
    title: string;
    roadPermitCompletionDate: Date | null;
    roadPermitReceiveDate: Date | null;
    roadPermitExpiryDate: Date | null;
}): AutoEvent[] {
    const out: AutoEvent[] = [];
    const make = (
        suffix: string,
        category: CalendarCategory,
        date: Date,
    ): AutoEvent => ({
        id: `auto:${pm.id}:${suffix}`,
        title: `${pm.title}（${CALENDAR_CATEGORY_LABELS[category]}）`,
        description: null,
        category,
        startAt: date.toISOString(),
        endAt: date.toISOString(),
        allDay: true,
        location: null,
        visibility: 'shared',
        color: null,
        createdBy: 'system',
        createdByName: '自動生成（案件マスター）',
        projectMasterId: pm.id,
        projectTitle: pm.title,
        customerId: null,
        createdAt: date.toISOString(),
        updatedAt: date.toISOString(),
        isAuto: true,
    });
    if (pm.roadPermitCompletionDate) {
        out.push(make('complete', 'road_permit_complete', pm.roadPermitCompletionDate));
    }
    if (pm.roadPermitReceiveDate) {
        out.push(make('receive', 'road_permit_receive', pm.roadPermitReceiveDate));
    }
    if (pm.roadPermitExpiryDate) {
        out.push(make('expiry', 'road_permit_expiry', pm.roadPermitExpiryDate));
    }
    return out;
}

/**
 * GET /api/company-calendar?from=ISO&to=ISO
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const url = new URL(req.url);
        const fromStr = url.searchParams.get('from');
        const toStr = url.searchParams.get('to');
        if (!fromStr || !toStr) {
            return validationErrorResponse('from / to が必要です（ISO 文字列）');
        }
        const from = new Date(fromStr);
        const to = new Date(toStr);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
            return validationErrorResponse('from / to の日付形式が不正です');
        }
        if (from > to) {
            return validationErrorResponse('from は to より前の日付を指定してください');
        }

        const userId = session!.user.id as string;

        // 1. DB 保存済みイベント（期間内で重なるもの）
        //    プライベートイベントは本人のみ
        const events = await prisma.calendarEvent.findMany({
            where: {
                AND: [
                    { startAt: { lt: to } },
                    { endAt: { gte: from } },
                    {
                        OR: [
                            { visibility: 'shared' },
                            { visibility: 'private', createdBy: userId },
                        ],
                    },
                ],
            },
            orderBy: [{ startAt: 'asc' }],
            include: {
                projectMaster: { select: { id: true, title: true } },
            },
        });

        // 作成者名解決
        const creatorIds = Array.from(new Set(events.map((e) => e.createdBy)));
        const creators = creatorIds.length
            ? await prisma.user.findMany({
                  where: { id: { in: creatorIds } },
                  select: { id: true, displayName: true },
              })
            : [];
        const creatorMap = new Map(creators.map((u) => [u.id, u.displayName]));

        const dbEvents: CalendarEventDTO[] = events.map((e) => ({
            id: e.id,
            title: e.title,
            description: e.description,
            category: (isCalendarCategory(e.category) ? e.category : 'other') as CalendarCategory,
            startAt: e.startAt.toISOString(),
            endAt: e.endAt.toISOString(),
            allDay: e.allDay,
            location: e.location,
            visibility: isCalendarVisibility(e.visibility) ? e.visibility : 'shared',
            color: e.color,
            createdBy: e.createdBy,
            createdByName: creatorMap.get(e.createdBy) ?? null,
            projectMasterId: e.projectMasterId,
            projectTitle: e.projectMaster?.title ?? null,
            customerId: e.customerId,
            createdAt: e.createdAt.toISOString(),
            updatedAt: e.updatedAt.toISOString(),
            isAuto: false,
        }));

        // 2. ProjectMaster の道路使用許可フィールドから自動生成
        const projects = await prisma.projectMaster.findMany({
            where: {
                status: { in: ['active', 'completed'] },
                OR: [
                    {
                        roadPermitCompletionDate: { gte: from, lt: to },
                    },
                    {
                        roadPermitReceiveDate: { gte: from, lt: to },
                    },
                    {
                        roadPermitExpiryDate: { gte: from, lt: to },
                    },
                ],
            },
            select: {
                id: true,
                title: true,
                roadPermitCompletionDate: true,
                roadPermitReceiveDate: true,
                roadPermitExpiryDate: true,
            },
        });
        const autoEvents: AutoEvent[] = projects.flatMap(buildAutoEventsFromProject);

        // 3. マージ（同一 ProjectMaster + カテゴリで手動イベントがあれば自動側を除外）
        const manualKey = (e: CalendarEventDTO) =>
            e.projectMasterId ? `${e.projectMasterId}:${e.category}` : null;
        const manualKeys = new Set(dbEvents.map(manualKey).filter(Boolean) as string[]);
        const filteredAuto = autoEvents.filter((a) => !manualKeys.has(manualKey(a)!));

        const merged = [...dbEvents, ...filteredAuto].sort((a, b) =>
            a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0,
        );

        return NextResponse.json(
            { events: merged },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (err) {
        return serverErrorResponse('社内カレンダー取得', err);
    }
}

/**
 * POST /api/company-calendar
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;
        const userId = session!.user.id as string;

        const body = (await req.json()) as CalendarEventInput;
        if (!body || typeof body.title !== 'string' || !body.title.trim()) {
            return validationErrorResponse('title は必須です');
        }
        if (body.title.length > 200) {
            return validationErrorResponse('title は 200 文字以内で入力してください');
        }
        if (
            body.description != null &&
            typeof body.description === 'string' &&
            body.description.trim().length > 4000
        ) {
            return validationErrorResponse('description は4000文字以内で入力してください');
        }
        if (
            body.location != null &&
            typeof body.location === 'string' &&
            body.location.trim().length > 200
        ) {
            return validationErrorResponse('location は200文字以内で入力してください');
        }
        if (!isCalendarCategory(body.category)) {
            return validationErrorResponse('category が不正です');
        }
        const startAt = new Date(body.startAt);
        const endAt = new Date(body.endAt);
        if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
            return validationErrorResponse('startAt / endAt の日付形式が不正です');
        }
        if (endAt < startAt) {
            return validationErrorResponse('endAt は startAt 以降を指定してください');
        }
        const visibility =
            body.visibility && isCalendarVisibility(body.visibility) ? body.visibility : 'shared';

        // projectMasterId 検証
        if (body.projectMasterId) {
            const exists = await prisma.projectMaster.findFirst({
                where: {
                    id: body.projectMasterId,
                    status: { in: ['active', 'completed'] },
                },
                select: { id: true },
            });
            if (!exists) return errorResponse('関連案件が見つかりません', 404);
        }

        const created = await prisma.calendarEvent.create({
            data: {
                title: body.title.trim(),
                description: body.description?.toString().trim() || null,
                category: body.category,
                startAt,
                endAt,
                allDay: Boolean(body.allDay),
                location: body.location?.toString().trim() || null,
                visibility,
                color: body.color?.toString().trim() || null,
                createdBy: userId,
                projectMasterId: body.projectMasterId || null,
                customerId: body.customerId || null,
            },
        });

        return NextResponse.json(created, {
            status: 201,
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (err) {
        return serverErrorResponse('社内カレンダー作成', err);
    }
}
