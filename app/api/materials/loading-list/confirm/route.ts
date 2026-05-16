import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { loadingListConfirmSchema, validateRequest } from '@/lib/validations';
import { applyStockForRequisition, LEDGER_SOURCE } from '@/lib/materials/stock';
import { serializeRequisitionNotes, emptyRequisitionNotes } from '@/lib/materials/catalog';

// 積込リストから出庫確定 → 在庫減算 + 出庫伝票自動作成
export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(loadingListConfirmSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { date, vehicleId, items } = validation.data;

        // Group items by project for creating requisitions
        const byProject = new Map<string, { materialItemId: string; quantity: number }[]>();
        for (const item of items) {
            if (!byProject.has(item.projectMasterId)) {
                byProject.set(item.projectMasterId, []);
            }
            byProject.get(item.projectMasterId)!.push({
                materialItemId: item.materialItemId,
                quantity: item.quantity,
            });
        }

        const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } });

        // Phase 2 の notes-JSON 経路と一貫させる（プレーン文字列だと
        // parseRequisitionNotes が memo 扱いはするが、保存側も JSON で統一し
        // PDF / ライブプレビューの notes-JSON 経路から消えないようにする）。
        const autoNotes = serializeRequisitionNotes({
            ...emptyRequisitionNotes(),
            memo: '積込リストから自動作成',
        });

        await prisma.$transaction(async (tx) => {
            for (const [projectMasterId, projectItems] of byProject) {
                // Create requisition per project（loading-list 由来）
                const requisition = await tx.materialRequisition.create({
                    data: {
                        projectMasterId,
                        date: new Date(date),
                        foremanId: session?.user?.id || '',
                        foremanName: session?.user?.name || '',
                        type: '出庫',
                        status: 'loaded',
                        vehicleInfo: vehicle?.name || '',
                        notes: autoNotes,
                        createdBy: session?.user?.id || null,
                        items: {
                            create: projectItems.map(i => ({
                                materialItemId: i.materialItemId,
                                quantity: i.quantity,
                            })),
                        },
                    },
                });

                // C6 是正: 在庫減算 / InventoryTransaction は lib/materials/stock.ts の
                // 単一ヘルパ経由に統合（直接 stockQuantity 書き込みを廃止）。
                // 除外判定（ネット/リース）と台帳識別子（loading-list:forward）を
                // 共通適用する。source='loading-list' で台帳に印を付けるため、
                // 後続の [id] PATCH（requisition 台帳）からも同一 referenceId の
                // forward として認識され二重 apply されない。
                await applyStockForRequisition(tx, requisition.id, {
                    isReturn: false,
                    createdBy: session?.user?.id || null,
                    source: LEDGER_SOURCE.LOADING_LIST,
                });
            }
        });

        return NextResponse.json({ success: true, projectCount: byProject.size });
    } catch (error) {
        return serverErrorResponse('出庫確定', error);
    }
}
