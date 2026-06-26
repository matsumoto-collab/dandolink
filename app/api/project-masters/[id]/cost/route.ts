import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { Prisma } from '@prisma/client';

interface RouteContext { params: Promise<{ id: string }>; }

const FIELDS = ['materialCost', 'otherExpenses', 'loadingCost', 'subcontractorExpense', 'revenueOverride'] as const;

// 手入力明細を持つ6項目(人件費/車両費/材料費/積込費/その他/外注費)。各bucketは {摘要label, 金額amount>=0} の配列。空行は除去して保存。
const MANUAL_BUCKETS = ['labor', 'vehicle', 'material', 'loading', 'other', 'subcontractor'] as const;
function normalizeManualCostItems(raw: unknown): Record<string, { label: string; amount: number }[]> {
    const out: Record<string, { label: string; amount: number }[]> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    const obj = raw as Record<string, unknown>;
    for (const b of MANUAL_BUCKETS) {
        const arr = obj[b];
        if (!Array.isArray(arr)) continue;
        out[b] = arr
            .map((it) => {
                const o = (it ?? {}) as { label?: unknown; amount?: unknown };
                const amount = Math.max(0, Math.round(Number(o.amount) || 0));
                const label = typeof o.label === 'string' ? o.label.trim().slice(0, 100) : '';
                return { label, amount };
            })
            .filter(it => it.label !== '' || it.amount > 0);
    }
    return out;
}

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

        const data: Record<string, number | null | Prisma.InputJsonValue> = {};
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
        // 手入力明細(全6項目・摘要+金額の配列)を JSON 列へ保存。各bucketを正規化して空行を除去。
        if ('manualCostItems' in body) {
            data.manualCostItems = normalizeManualCostItems(body.manualCostItems);
        }
        if (Object.keys(data).length === 0) {
            return errorResponse('更新対象が指定されていません', 400);
        }

        const exists = await prisma.projectMaster.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return notFoundResponse('案件');

        const updated = await prisma.projectMaster.update({
            where: { id },
            data: data as Prisma.ProjectMasterUpdateInput,
            select: { id: true, materialCost: true, otherExpenses: true, loadingCost: true, subcontractorExpense: true, revenueOverride: true },
        });
        return NextResponse.json({
            id: updated.id,
            materialCost: updated.materialCost ? Number(updated.materialCost) : null,
            otherExpenses: updated.otherExpenses ? Number(updated.otherExpenses) : null,
            loadingCost: updated.loadingCost ? Number(updated.loadingCost) : null,
            subcontractorExpense: updated.subcontractorExpense ? Number(updated.subcontractorExpense) : null,
            revenueOverride: updated.revenueOverride,
        });
    } catch (error) {
        return serverErrorResponse('原価更新', error);
    }
}
