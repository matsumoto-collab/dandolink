import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { materialReturnSchema, validateRequest } from '@/lib/validations';
import { applyStockForRequisition, LEDGER_SOURCE } from '@/lib/materials/stock';
import { lentOutQuantityMap } from '@/lib/materials/lentOut';

/**
 * POST /api/materials/returns
 *
 * 現場から戻った材料の「返却（入庫）」を記録する専用エンドポイント。
 *   - type='返却' の MaterialRequisition を status='loaded' で作成し、
 *     applyStockForRequisition(isReturn) で倉庫在庫を加算 + 台帳記録する。
 *   - 認可: requireAuth のみ（職長も可）。返却は在庫を増やす安全方向のため、
 *     出庫伝票の loaded ゲート（admin/manager のみ）とは別扱いにし、
 *     返却専用の本エンドポイントへ権限を閉じ込める。
 *   - 過返却（在庫の過剰加算）防止: サーバ側で当該案件の貸出中
 *     （出庫 − 返却 − 紛失）を再計算し、各 quantity をその上限にクランプする。
 */
export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(materialReturnSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { projectMasterId, date, note, items } = validation.data;

        const userId = session?.user?.id ?? null;
        const foremanName = session?.user?.name || session?.user?.username || '';

        const created = await prisma.$transaction(async (tx) => {
            // 1) 当該案件の貸出中（loaded 伝票の 出庫 − 返却 − 紛失）を再計算
            const loaded = await tx.materialRequisition.findMany({
                where: { projectMasterId, status: 'loaded' },
                select: {
                    type: true,
                    status: true,
                    items: {
                        select: {
                            materialItemId: true,
                            quantity: true,
                            materialItem: {
                                select: {
                                    name: true,
                                    spec: true,
                                    unit: true,
                                    sortOrder: true,
                                    category: { select: { name: true, sortOrder: true } },
                                },
                            },
                        },
                    },
                },
            });
            const lentMap = lentOutQuantityMap(loaded);

            // 2) 貸出中を上限に各返却数をクランプ（同一 materialItemId は合算）
            const clamped = new Map<string, number>();
            for (const it of items) {
                const cap = lentMap.get(it.materialItemId) ?? 0;
                const already = clamped.get(it.materialItemId) ?? 0;
                const room = Math.max(0, cap - already);
                const qty = Math.min(it.quantity, room);
                if (qty > 0) clamped.set(it.materialItemId, already + qty);
            }

            const returnItems = Array.from(clamped.entries()).map(([materialItemId, quantity]) => ({
                materialItemId,
                quantity,
            }));
            if (returnItems.length === 0) {
                // 貸出中が無い / すべて 0 にクランプ → 返却対象なし
                return null;
            }

            // 3) type='返却' の伝票を loaded で作成
            const requisition = await tx.materialRequisition.create({
                data: {
                    projectMasterId,
                    date: date ? new Date(date) : new Date(),
                    foremanId: userId ?? '',
                    foremanName,
                    type: '返却',
                    status: 'loaded',
                    notes: note || null,
                    createdBy: userId,
                    items: { create: returnItems },
                },
                include: { items: { include: { materialItem: true } } },
            });

            // 4) 在庫加算 + 台帳記録（isReturn=true）
            await applyStockForRequisition(tx, requisition.id, {
                isReturn: true,
                createdBy: userId,
                source: LEDGER_SOURCE.REQUISITION,
            });

            return requisition;
        });

        if (!created) {
            return errorResponse('返却対象の貸出中材料がありません', 400);
        }

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('材料返却', error);
    }
}
