import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { materialRequisitionUpdateSchema, validateRequest } from '@/lib/validations';
import { applyStockForRequisition, reverseStockForRequisition } from '@/lib/materials/stock';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        const requisition = await prisma.materialRequisition.findUnique({
            where: { id },
            include: {
                items: {
                    include: { materialItem: { include: { category: true } } },
                },
            },
        });

        if (!requisition) {
            return NextResponse.json({ error: '伝票が見つかりません' }, { status: 404 });
        }

        // プロジェクト名取得
        const project = await prisma.projectMaster.findUnique({
            where: { id: requisition.projectMasterId },
            select: { id: true, title: true, name: true },
        });

        return NextResponse.json({
            ...requisition,
            projectTitle: project?.name || project?.title || '不明',
        }, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票取得', error);
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error, session } = await requireAuth();
        if (error) return error;

        const { id } = await params;
        const body = await request.json();
        const validation = validateRequest(materialRequisitionUpdateSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }

        // Get current requisition to check status transition
        const current = await prisma.materialRequisition.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!current) {
            return NextResponse.json({ error: '伝票が見つかりません' }, { status: 404 });
        }

        // 認可: admin/manager は全件OK。それ以外は自分が作成 or 自分が職長の伝票のみ更新可
        const userId = session?.user?.id;
        const role = session?.user?.role;
        const isPrivileged = role === 'admin' || role === 'manager';
        if (!isPrivileged) {
            const isOwner = userId && (current.createdBy === userId || current.foremanId === userId);
            if (!isOwner) {
                return NextResponse.json(
                    { error: '他のユーザーの伝票を更新する権限がありません' },
                    { status: 403, headers: { 'Cache-Control': 'no-store' } }
                );
            }
        }

        // loaded への遷移は在庫減算（inventory transaction）を伴うため admin/manager のみ許可
        // foreman/worker が独断で在庫を減らせないようにする
        if (body.status === 'loaded' && current.status !== 'loaded' && !isPrivileged) {
            return NextResponse.json(
                { error: '積込完了への変更は管理者またはマネージャー権限が必要です' },
                { status: 403, headers: { 'Cache-Control': 'no-store' } }
            );
        }

        const data: Record<string, unknown> = {};
        if (body.status !== undefined) data.status = body.status;
        if (body.notes !== undefined) data.notes = body.notes;
        if (body.vehicleInfo !== undefined) data.vehicleInfo = body.vehicleInfo;

        // --- 在庫連動の遷移判定 ---
        // C1: 在庫増減 / InventoryTransaction 発行は lib/materials/stock.ts の
        //     applyStockForRequisition / reverseStockForRequisition のみを経由する
        //     （直接 prisma で stockQuantity を更新する経路はここに作らない）。
        const willBeLoaded = body.status === 'loaded';
        const wasLoaded = current.status === 'loaded';
        const enteringLoaded = willBeLoaded && !wasLoaded;
        const leavingLoaded = !willBeLoaded && body.status !== undefined && wasLoaded;
        // loaded のまま items を差し替える場合は、旧在庫を巻き戻してから再適用する
        const replacingItemsWhileLoaded =
            wasLoaded && willBeLoaded && Array.isArray(body.items);
        const isReturn = current.type === '返却';
        const stockOpts = { isReturn, createdBy: session?.user?.id || null };

        // 伝票更新と在庫副作用を「単一トランザクション」で実行（整合担保）
        await prisma.$transaction(async (tx) => {
            // 1) items 全置換の前に、loaded 中なら旧在庫をロールバック
            if (replacingItemsWhileLoaded) {
                await reverseStockForRequisition(tx, id, stockOpts);
            }

            // 2) 伝票本体（status / notes / vehicleInfo / items）を更新
            if (body.items && Array.isArray(body.items)) {
                const validItems = body.items.filter(
                    (item: { quantity: number }) => item.quantity > 0,
                );
                await tx.materialRequisitionItem.deleteMany({ where: { requisitionId: id } });
                await tx.materialRequisition.update({
                    where: { id },
                    data: {
                        ...data,
                        items: {
                            create: validItems.map((item: { materialItemId: string; quantity: number; vehicleLabel?: string; notes?: string }) => ({
                                materialItemId: item.materialItemId,
                                quantity: item.quantity,
                                vehicleLabel: item.vehicleLabel || null,
                                notes: item.notes || null,
                            })),
                        },
                    },
                });
            } else {
                await tx.materialRequisition.update({ where: { id }, data });
            }

            // 3) 在庫反映
            if (enteringLoaded || replacingItemsWhileLoaded) {
                // 積込完了に遷移 / loaded 中の items 差し替え → 在庫を適用（冪等）
                await applyStockForRequisition(tx, id, stockOpts);
            } else if (leavingLoaded) {
                // loaded から戻す → 在庫をロールバック（逆仕訳・冪等）
                await reverseStockForRequisition(tx, id, stockOpts);
            }
        });

        const updated = await prisma.materialRequisition.findUnique({
            where: { id },
            include: { items: { include: { materialItem: true } } },
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('材料出庫伝票更新', error);
    }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;
        await prisma.materialRequisition.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票削除', error);
    }
}
