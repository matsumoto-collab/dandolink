import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { materialRequisitionUpdateSchema, validateRequest } from '@/lib/validations';
import { applyStockForRequisition, reverseStockForRequisition, LEDGER_SOURCE } from '@/lib/materials/stock';

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

        // --- 在庫連動の遷移判定（特権ゲートより前に確定する） ---
        // C1: 在庫増減 / InventoryTransaction 発行は lib/materials/stock.ts の
        //     applyStockForRequisition / reverseStockForRequisition のみを経由する
        //     （直接 prisma で stockQuantity を更新する経路はここに作らない）。
        const willBeLoaded = body.status === 'loaded';
        const wasLoaded = current.status === 'loaded';
        const enteringLoaded = willBeLoaded && !wasLoaded;
        const leavingLoaded = !willBeLoaded && body.status !== undefined && wasLoaded;
        // D2（C9/C16 の body.status 依存穴）:
        //   loaded 伝票への items 差替は「在庫を reverse→apply で巻き戻し
        //   再適用する＝在庫副作用あり」の編集である。これは body.status の
        //   有無に依らず成立する（status 省略の items のみ PATCH でも
        //   loaded 伝票の品目は実際に差し替わる）。旧定義 wasLoaded &&
        //   willBeLoaded && items は status を省略すると willBeLoaded=false
        //   となり判定が外れ、:193-211 の deleteMany+再作成だけが無条件に
        //   走って在庫無調整で品目が差し替わり、伝票/在庫が恒久 desync して
        //   いた（D2 ブロッカー）。
        //   そこで replacingItemsWhileLoaded を body.status 非依存
        //   （current.status==='loaded' && Array.isArray(body.items)）へ
        //   統一する。ただし loaded から status を遷移させて「離脱」する
        //   ケース（leavingLoaded：例 loaded→draft + items）は status 遷移
        //   側の reverse（step 3 の leavingLoaded）が在庫を巻き戻すため、
        //   ここで二重 reverse にしないよう leavingLoaded のときは除外し
        //   両者を相互排他に保つ（enteringLoaded は wasLoaded と両立しない）。
        //   notes のみ PATCH（items 無し）は Array.isArray(body.items) が
        //   false で除外され、誤って在庫副作用化しない。
        const replacingItemsWhileLoaded =
            wasLoaded && Array.isArray(body.items) && !leavingLoaded;
        // ステータス遷移を伴う在庫連動か（status を data から除外する判定に使用）
        const isStockTransition = enteringLoaded || leavingLoaded;
        // C16（C9 の特権穴）/ D2 統一:
        //   loaded のまま items を差し替える PATCH（= reverse→apply で在庫を
        //   巻き戻し再適用する＝在庫副作用あり）も「積込完了への変更」と同様、
        //   foreman/worker が独断で在庫を動かせないようにする意図（:78-79）の
        //   配下に入れる。従来 :80 の特権チェックは enteringLoaded
        //   （status の loaded 遷移）限定で、C9 新設の特権ゲートも
        //   body.status==='loaded' を必須としていたため、status 省略の
        //   items のみ PATCH がこのゲートをすり抜けて非特権でも loaded
        //   伝票の品目を在庫無調整で差し替えられた（D2 ブロッカー）。
        //   C16 ゲートは在庫副作用判定（replacingItemsWhileLoaded）と
        //   同一の body.status 非依存条件を参照し一貫させる。
        if (replacingItemsWhileLoaded && !isPrivileged) {
            return NextResponse.json(
                { error: '積込完了伝票の品目変更は管理者またはマネージャー権限が必要です' },
                { status: 403, headers: { 'Cache-Control': 'no-store' } }
            );
        }

        const data: Record<string, unknown> = {};
        if (body.status !== undefined) data.status = body.status;
        if (body.notes !== undefined) data.notes = body.notes;
        if (body.vehicleInfo !== undefined) data.vehicleInfo = body.vehicleInfo;
        // C9（#2 解消 / delta 内 C7 完成）:
        //   在庫副作用（reverse/apply）を伴う全ケースを原子ガード対象にする。
        //   従来 isStockTransition は replacingItemsWhileLoaded（loaded→loaded
        //   items 差替 = 現場最頻の編集）を含まず、:123 のガードが status 遷移
        //   配下のみだったため、並行 loaded→loaded items 差替が「ガード皆無」で
        //   reverse/apply を二重実行し二重逆仕訳＋二重減算していた。
        //   → items 差替も含めた isStockMutation を新設しガード必須化する。
        const isStockMutation =
            enteringLoaded || leavingLoaded || replacingItemsWhileLoaded;
        const isReturn = current.type === '返却';
        const stockOpts = {
            isReturn,
            createdBy: session?.user?.id || null,
            source: LEDGER_SOURCE.REQUISITION,
        };

        // C7/C9: 並行 PATCH の TOCTOU 二重減算を防ぐ。
        // 在庫副作用を伴う全ケース（status 遷移 + loaded→loaded items 差替）は
        // トランザクション内で条件付き updateMany を「最初」に実行し、
        // count===0（= 別リクエストが先に勝者として確定済み）なら
        // 在庫副作用を一切行わず abort。
        //   - status 遷移: where に旧 status を含め、勝者が status を遷移させる。
        //   - items 差替（status 不変 loaded）: 楽観トークン updatedAt を where に
        //     含めて勝者を 1 本に絞る（@updatedAt が自動更新されるため、敗者の
        //     updatedAt 一致条件が外れ count===0 で abort → reverse/apply 各 1 回）。
        // 加えて deriveLedgerState + C10 の DB 部分 unique が第二・第三防壁。
        let aborted = false;

        // 伝票更新と在庫副作用を「単一トランザクション」で実行（整合担保）
        await prisma.$transaction(async (tx) => {
            // 0) C7/C9: 在庫副作用を伴うケースは条件付き updateMany で
            //    原子的に勝者を 1 つに絞る（最初に実行）。
            if (isStockTransition) {
                // status 遷移: 旧 status 一致を条件に新 status へ遷移
                const guard = await tx.materialRequisition.updateMany({
                    where: { id, status: current.status },
                    data: { status: body.status as string },
                });
                if (guard.count === 0) {
                    // 別の並行リクエストが先に status を変更済み → 在庫副作用せず終了
                    aborted = true;
                    return;
                }
            } else if (replacingItemsWhileLoaded) {
                // C9: status は loaded のまま不変。楽観トークン updatedAt で
                //     並行 items 差替の勝者を 1 本に絞る。data に updatedAt を
                //     明示セットして @updatedAt 自動更新と相まってトークンを進める。
                const guard = await tx.materialRequisition.updateMany({
                    where: { id, status: 'loaded', updatedAt: current.updatedAt },
                    data: { updatedAt: new Date() },
                });
                if (guard.count === 0) {
                    // 並行 items 差替の敗者 → reverse/apply を一切行わず終了
                    aborted = true;
                    return;
                }
            }

            // 1) items 全置換の前に、loaded 中なら旧在庫をロールバック
            if (replacingItemsWhileLoaded) {
                await reverseStockForRequisition(tx, id, stockOpts);
            }

            // 2) 伝票本体を更新。
            //    status は 0) で原子的に確定済み（遷移）or 不変（items 差替）の
            //    ため在庫副作用ケースでは data から除外し、
            //    notes / vehicleInfo / items のみを反映する。
            const { status: _statusInData, ...restData } = data;
            const bodyData = isStockMutation ? restData : data;
            if (body.items && Array.isArray(body.items)) {
                const validItems = body.items.filter(
                    (item: { quantity: number }) => item.quantity > 0,
                );
                await tx.materialRequisitionItem.deleteMany({ where: { requisitionId: id } });
                await tx.materialRequisition.update({
                    where: { id },
                    data: {
                        ...bodyData,
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
            } else if (Object.keys(bodyData).length > 0) {
                await tx.materialRequisition.update({ where: { id }, data: bodyData });
            }

            // 3) 在庫反映（applyStock... は台帳冪等判定も内蔵 = 二重防壁）
            if (enteringLoaded || replacingItemsWhileLoaded) {
                // 積込完了に遷移 / loaded 中の items 差し替え → 在庫を適用（冪等）
                await applyStockForRequisition(tx, id, stockOpts);
            } else if (leavingLoaded) {
                // loaded から戻す → 在庫をロールバック（逆仕訳・冪等）
                await reverseStockForRequisition(tx, id, stockOpts);
            }
        });

        if (aborted) {
            // 並行遷移の敗者: 既に他リクエストが反映済み。現状を返す（冪等）。
            const latest = await prisma.materialRequisition.findUnique({
                where: { id },
                include: { items: { include: { materialItem: true } } },
            });
            return NextResponse.json(latest, { headers: { 'Cache-Control': 'no-store' } });
        }

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
        const { error, session } = await requireManagerOrAbove();
        if (error) return error;

        const { id } = await params;

        const current = await prisma.materialRequisition.findUnique({
            where: { id },
            select: { id: true, status: true, type: true },
        });
        if (!current) {
            return NextResponse.json({ error: '伝票が見つかりません' }, { status: 404 });
        }

        // C11（#3 解消）: loaded（在庫適用済み）伝票の削除は、削除と同じ
        //   トランザクション内で必ず reverseStockForRequisition を実行してから
        //   delete する。従来は delete のみで在庫が永久にズレ・台帳が孤児化していた。
        //   reverseStockForRequisition は台帳冪等（forward 無し/取消済みは noop）
        //   かつ requisition items ではなく forward 台帳から逆仕訳するため、
        //   cascade で items が消える前に呼んでも台帳ベースで整合する。
        //   逆仕訳 Tx（referenceType=...:reversal）は監査用に台帳へ残す
        //   （InventoryTransaction は referenceId カスケード対象外）。
        try {
            await prisma.$transaction(async (tx) => {
                await reverseStockForRequisition(tx, id, {
                    isReturn: current.type === '返却',
                    createdBy: session?.user?.id || null,
                    source: LEDGER_SOURCE.REQUISITION,
                });
                await tx.materialRequisition.delete({ where: { id } });
            });
        } catch (e) {
            // C17: 二重 DELETE の 2 本目を冪等化する。
            //   並行 DELETE では両者が findUnique を通過し得る。1 本目が
            //   delete を確定すると 2 本目の delete は Prisma P2025
            //   （Record to delete does not exist）を投げる。これは
            //   「既に削除された」= 望む終端状態なので 500 にせず成功扱いに
            //   する（在庫整合は現状維持。reverse は台帳冪等で 2 本目 noop）。
            if (
                typeof e === 'object' &&
                e !== null &&
                (e as { code?: unknown }).code === 'P2025'
            ) {
                return NextResponse.json({ success: true });
            }
            throw e;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票削除', error);
    }
}
