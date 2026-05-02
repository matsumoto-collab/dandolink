import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';

interface RouteContext { params: Promise<{ id: string }>; }

const FIELDS = ['laborCostOverride', 'vehicleCostOverride', 'subcontractorCostOverride'] as const;
type Field = typeof FIELDS[number];

export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const role = session!.user.role;
        if (role !== 'admin' && role !== 'manager') {
            return errorResponse('権限がありません', 403);
        }

        const { id } = await context.params;
        const body = await request.json().catch(() => ({}));

        const data: Partial<Record<Field, number | null>> = {};
        for (const f of FIELDS) {
            if (!(f in body)) continue;
            const v = body[f];
            if (v === null || v === undefined || v === '') {
                data[f] = null;
            } else {
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0) {
                    return errorResponse(`${f} は0以上の数値で指定してください`, 400);
                }
                data[f] = Math.round(n);
            }
        }
        if (Object.keys(data).length === 0) {
            return errorResponse('更新対象が指定されていません', 400);
        }

        const exists = await prisma.projectAssignment.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return notFoundResponse('アサインメント');

        const updated = await prisma.projectAssignment.update({
            where: { id },
            data,
            select: {
                id: true,
                laborCostOverride: true,
                vehicleCostOverride: true,
                subcontractorCostOverride: true,
            },
        });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('原価上書き更新', error);
    }
}
