import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    requireManagerOrAccountant,
    validationErrorResponse,
    serverErrorResponse,
} from '@/lib/api/utils';
import type { InvoiceItem } from '@/types/invoice';

/** クライアントへ返す請求対象（staged）1行。 */
interface StagedLineResponse {
    projectMasterId: string;
    customerId: string;
    items: InvoiceItem[];
    total: number;
    label: string;
}

/** 非空文字列か。 */
function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}

/**
 * GET /api/billing-staged
 *
 * 請求待ちボードの「請求対象（請求する を押した案件）」を全件返す。
 * 案件1件につき1行（projectMasterId が一意）。請求書を発行した案件の行は残らない。
 * 閲覧は税理士(accountant)にも開放（billing-board GET と同じ認可レベル）。操作は POST/DELETE 側で制限。
 */
export async function GET() {
    try {
        const { error } = await requireManagerOrAccountant();
        if (error) return error;

        const lines = await prisma.billingStagedLine.findMany({
            select: { projectMasterId: true, customerId: true, items: true, total: true, label: true },
        });

        const result: StagedLineResponse[] = lines.map((l) => ({
            projectMasterId: l.projectMasterId,
            customerId: l.customerId,
            items: Array.isArray(l.items) ? (l.items as unknown as InvoiceItem[]) : [],
            total: Number(l.total) || 0,
            label: l.label,
        }));

        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求対象の取得', error);
    }
}

/**
 * POST /api/billing-staged
 *
 * 請求対象に追加する（案件単位の upsert）。同じ案件を再度「請求する」した場合は最新の内容で上書きする。
 * body: { projectMasterId, customerId, items: InvoiceItem[], total, label }
 * 権限：admin / manager のみ（税理士は閲覧のみ）。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = (await req.json().catch(() => ({}))) as {
            projectMasterId?: unknown;
            customerId?: unknown;
            items?: unknown;
            total?: unknown;
            label?: unknown;
        };

        if (!isNonEmptyString(body.projectMasterId)) {
            return validationErrorResponse('projectMasterId は必須です');
        }
        if (!isNonEmptyString(body.customerId)) {
            return validationErrorResponse('customerId は必須です');
        }
        if (!Array.isArray(body.items) || body.items.length === 0) {
            return validationErrorResponse('items は1件以上の配列で指定してください');
        }
        if (typeof body.total !== 'number' || !Number.isFinite(body.total)) {
            return validationErrorResponse('total は数値で指定してください');
        }
        if (typeof body.label !== 'string') {
            return validationErrorResponse('label は文字列で指定してください');
        }

        const items = body.items as unknown as Prisma.InputJsonValue;
        const data = {
            customerId: body.customerId,
            items,
            total: body.total,
            label: body.label,
            stagedBy: session!.user.id,
        };

        await prisma.billingStagedLine.upsert({
            where: { projectMasterId: body.projectMasterId },
            update: data,
            create: { projectMasterId: body.projectMasterId, ...data },
        });

        return NextResponse.json(
            { projectMasterId: body.projectMasterId },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('請求対象への追加', error);
    }
}

/**
 * DELETE /api/billing-staged
 *
 * 請求対象から外す（取消・請求書発行後の掃除）。
 * body: { projectMasterIds: string[] }
 * 権限：admin / manager のみ。
 */
export async function DELETE(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = (await req.json().catch(() => ({}))) as { projectMasterIds?: unknown };
        const ids = body.projectMasterIds;
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => isNonEmptyString(id))) {
            return validationErrorResponse('projectMasterIds は1件以上の文字列配列で指定してください');
        }

        const result = await prisma.billingStagedLine.deleteMany({
            where: { projectMasterId: { in: ids as string[] } },
        });

        return NextResponse.json(
            { deleted: result.count },
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('請求対象の取消', error);
    }
}
