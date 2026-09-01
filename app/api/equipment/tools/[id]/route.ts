import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse, deleteSuccessResponse } from '@/lib/api/utils';
import { canEditEquipment } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

const str = (v: unknown, max = 200): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, max);
};

const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const toAmount = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,，\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** 電動工具の基本情報を更新する（持出しの状態は /checkout が担当）。 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.tool.findUnique({ where: { id } });
        if (!current) return notFoundResponse('電動工具');

        const body = await request.json().catch(() => ({}));
        const data: Record<string, unknown> = {};

        if ('categoryId' in body) {
            const categoryId = str(body.categoryId, 100);
            if (!categoryId) return errorResponse('分類を選んでください', 400);
            const category = await prisma.toolCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
            if (!category) return errorResponse('分類が見つかりません', 400);
            data.categoryId = categoryId;
        }
        if ('name' in body) {
            const name = str(body.name, 100);
            if (!name) return errorResponse('名前（管理番号）を入力してください', 400);
            data.name = name;
        }
        if ('maker' in body) data.maker = str(body.maker, 100);
        if ('modelNumber' in body) data.modelNumber = str(body.modelNumber, 100);
        if ('serialNumber' in body) data.serialNumber = str(body.serialNumber, 100);
        if ('purchaseDate' in body) data.purchaseDate = toDate(body.purchaseDate);
        if ('purchasePrice' in body) data.purchasePrice = toAmount(body.purchasePrice);
        if ('note' in body) data.note = str(body.note, 1000);
        if ('isActive' in body) data.isActive = body.isActive !== false;

        const updated = await prisma.tool.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('電動工具の更新', error);
    }
}

/**
 * 電動工具を台帳から外す。
 * 持出しの履歴・整備の履歴を残すため物理削除はせず isActive=false にする
 * （画面では「使わなくなった工具も表示」で見える）。
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const current = await prisma.tool.findUnique({ where: { id }, select: { id: true } });
        if (!current) return notFoundResponse('電動工具');

        await prisma.tool.update({ where: { id }, data: { isActive: false } });
        return deleteSuccessResponse('電動工具');
    } catch (error) {
        return serverErrorResponse('電動工具の削除', error);
    }
}
