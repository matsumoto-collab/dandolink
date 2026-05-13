import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    errorResponse,
    notFoundResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import {
    isCalendarCategory,
    isCalendarVisibility,
    type CalendarEventInput,
} from '@/types/companyCalendar';

interface Params {
    params: { id: string };
}

/**
 * PATCH /api/company-calendar/:id
 * 作成者本人、または admin のみ更新可
 */
export async function PATCH(req: NextRequest, { params }: Params) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;
        const userId = session!.user.id as string;
        const role = session!.user.role;

        if (params.id.startsWith('auto:')) {
            return errorResponse('自動生成イベントは案件マスター側で編集してください', 403);
        }

        const existing = await prisma.calendarEvent.findUnique({ where: { id: params.id } });
        if (!existing) return notFoundResponse('カレンダーイベント');
        if (existing.createdBy !== userId && role !== 'admin') {
            return errorResponse('このイベントは作成者または管理者のみ編集できます', 403);
        }

        const body = (await req.json()) as Partial<CalendarEventInput>;

        const data: Record<string, unknown> = { updatedBy: userId };
        if (body.title !== undefined) {
            if (typeof body.title !== 'string' || !body.title.trim()) {
                return validationErrorResponse('title は必須です');
            }
            if (body.title.length > 200) {
                return validationErrorResponse('title は 200 文字以内で入力してください');
            }
            data.title = body.title.trim();
        }
        if (body.description !== undefined) {
            if (
                body.description != null &&
                typeof body.description === 'string' &&
                body.description.trim().length > 4000
            ) {
                return validationErrorResponse('description は4000文字以内で入力してください');
            }
            data.description = body.description?.toString().trim() || null;
        }
        if (body.category !== undefined) {
            if (!isCalendarCategory(body.category)) {
                return validationErrorResponse('category が不正です');
            }
            data.category = body.category;
        }
        if (body.startAt !== undefined) {
            const d = new Date(body.startAt);
            if (isNaN(d.getTime())) return validationErrorResponse('startAt が不正です');
            data.startAt = d;
        }
        if (body.endAt !== undefined) {
            const d = new Date(body.endAt);
            if (isNaN(d.getTime())) return validationErrorResponse('endAt が不正です');
            data.endAt = d;
        }
        if (body.allDay !== undefined) data.allDay = Boolean(body.allDay);
        if (body.location !== undefined) {
            if (
                body.location != null &&
                typeof body.location === 'string' &&
                body.location.trim().length > 200
            ) {
                return validationErrorResponse('location は200文字以内で入力してください');
            }
            data.location = body.location?.toString().trim() || null;
        }
        if (body.visibility !== undefined) {
            if (!isCalendarVisibility(body.visibility)) {
                return validationErrorResponse('visibility が不正です');
            }
            data.visibility = body.visibility;
        }
        if (body.color !== undefined) data.color = body.color?.toString().trim() || null;
        if (body.projectMasterId !== undefined) {
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
            data.projectMasterId = body.projectMasterId || null;
        }
        if (body.customerId !== undefined) data.customerId = body.customerId || null;

        // 開始 > 終了になっていないか最終チェック
        const finalStart =
            (data.startAt as Date | undefined) ?? existing.startAt;
        const finalEnd = (data.endAt as Date | undefined) ?? existing.endAt;
        if (finalEnd < finalStart) {
            return validationErrorResponse('endAt は startAt 以降を指定してください');
        }

        const updated = await prisma.calendarEvent.update({
            where: { id: params.id },
            data,
        });
        return NextResponse.json(updated, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('マイカレンダー更新', err);
    }
}

/**
 * DELETE /api/company-calendar/:id
 * 作成者本人、または admin のみ削除可
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;
        const userId = session!.user.id as string;
        const role = session!.user.role;

        if (params.id.startsWith('auto:')) {
            return errorResponse('自動生成イベントは案件マスター側で編集してください', 403);
        }

        const existing = await prisma.calendarEvent.findUnique({
            where: { id: params.id },
            select: { id: true, createdBy: true },
        });
        if (!existing) return notFoundResponse('カレンダーイベント');
        if (existing.createdBy !== userId && role !== 'admin') {
            return errorResponse('このイベントは作成者または管理者のみ削除できます', 403);
        }

        await prisma.calendarEvent.delete({ where: { id: params.id } });
        return NextResponse.json(
            { message: 'カレンダーイベントを削除しました' },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (err) {
        return serverErrorResponse('マイカレンダー削除', err);
    }
}
