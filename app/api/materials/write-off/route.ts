import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { materialWriteOffSchema, validateRequest } from '@/lib/validations';
import { lentOutQuantityMap } from '@/lib/materials/lentOut';

/**
 * POST /api/materials/write-off
 *
 * 未回収（紛失・破損）償却。type='紛失' の MaterialRequisition を status='loaded'
 * で作成し、対象品目を貸出中から除外する（computeLentOut は紛失を減算扱い）。
 *
 * 在庫(stockQuantity)は変更しない。理由: 当該数量は出庫(loaded)時点で
 * 既に倉庫在庫から減算済みであり、紛失で倉庫へ戻らないだけ＝二重減算しない。
 * （償却で減るのは「総数 = 倉庫在庫 + 貸出中」のうち貸出中の側）。
 *
 * 認可: admin / manager のみ（損失計上は特権操作）。
 * 数量はサーバ側で貸出中を上限にクランプする。
 */
export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(materialWriteOffSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { projectMasterId, date, note, items } = validation.data;

        const userId = session?.user?.id ?? null;
        const foremanName = session?.user?.name || session?.user?.username || '';

        const created = await prisma.$transaction(async (tx) => {
            // 当該案件の貸出中を再計算し、償却数を上限クランプ（同一品目は合算）
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

            const clamped = new Map<string, number>();
            for (const it of items) {
                const cap = lentMap.get(it.materialItemId) ?? 0;
                const already = clamped.get(it.materialItemId) ?? 0;
                const room = Math.max(0, cap - already);
                const qty = Math.min(it.quantity, room);
                if (qty > 0) clamped.set(it.materialItemId, already + qty);
            }

            const writeOffItems = Array.from(clamped.entries()).map(([materialItemId, quantity]) => ({
                materialItemId,
                quantity,
            }));
            if (writeOffItems.length === 0) return null;

            // type='紛失' の伝票を loaded で作成（在庫は触らない）
            return tx.materialRequisition.create({
                data: {
                    projectMasterId,
                    date: date ? new Date(date) : new Date(),
                    foremanId: userId ?? '',
                    foremanName,
                    type: '紛失',
                    status: 'loaded',
                    notes: note || null,
                    createdBy: userId,
                    items: { create: writeOffItems },
                },
                include: { items: { include: { materialItem: true } } },
            });
        });

        if (!created) {
            return errorResponse('償却対象の貸出中材料がありません', 400);
        }

        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return serverErrorResponse('材料紛失償却', error);
    }
}
