import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations';

/**
 * GET /api/materials/my-assignments
 *
 * Query params:
 *   foremanId: string       - 対象職長ID（cuid / uuid 等の汎用ID）
 *   date:      YYYY-MM-DD   - 基準日（JST）
 *   rangeDays: number       - 前後の日数（既定: 3、0〜14）
 *
 * 認証: NextAuthセッション必須
 * 認可: foremanId がセッションユーザー本人の場合は誰でもOK
 *       それ以外のIDを指定できるのは admin / manager のみ
 *
 * Response: Array<{ id: string; title: string; name: string | null }>
 */

const myAssignmentsQuerySchema = z.object({
    foremanId: z
        .string()
        .min(8, 'foremanId は必須です')
        .max(64, 'foremanId が長すぎます')
        .regex(/^[a-zA-Z0-9_-]+$/, 'foremanId の形式が不正です'),
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date は YYYY-MM-DD 形式で指定してください'),
    rangeDays: z.coerce.number().int().min(0).max(14).default(3),
});

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        const userId = session!.user.id;

        const { searchParams } = new URL(req.url);
        const validation = validateRequest(myAssignmentsQuerySchema, {
            foremanId: searchParams.get('foremanId') ?? undefined,
            date: searchParams.get('date') ?? undefined,
            rangeDays: searchParams.get('rangeDays') ?? undefined,
        });
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { foremanId, date: dateParam, rangeDays } = validation.data;

        // 認可: 他人のIDは admin/manager のみ
        if (foremanId !== userId && role !== 'admin' && role !== 'manager') {
            return errorResponse('権限がありません', 403);
        }

        // JST日境界で範囲を計算（JST 0時 = UTC 前日 15時）
        // 基準日 ± rangeDays 日（JST 00:00 〜 翌日00:00 = UTC前日15時〜当日15時）
        const baseStartJst = new Date(`${dateParam}T00:00:00+09:00`);
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const gte = new Date(baseStartJst.getTime() - rangeDays * ONE_DAY_MS);
        const lte = new Date(baseStartJst.getTime() + (rangeDays + 1) * ONE_DAY_MS - 1);

        // active な案件のみ（完了/キャンセル等は除外）
        const assignments = await prisma.projectAssignment.findMany({
            where: {
                assignedEmployeeId: foremanId,
                date: { gte, lte },
                projectMaster: { is: { status: 'active' } },
            },
            select: {
                projectMasterId: true,
                projectMaster: {
                    select: { id: true, title: true, name: true },
                },
            },
            distinct: ['projectMasterId'],
        });

        // 念のため重複除去（distinct で済んでいるはずだが防御的に）
        const seen = new Set<string>();
        const result = assignments
            .map(a => a.projectMaster)
            .filter((pm): pm is { id: string; title: string; name: string | null } => {
                if (!pm) return false;
                if (seen.has(pm.id)) return false;
                seen.add(pm.id);
                return true;
            })
            .map(pm => ({ id: pm.id, title: pm.title, name: pm.name }));

        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('マイ案件取得', error);
    }
}
