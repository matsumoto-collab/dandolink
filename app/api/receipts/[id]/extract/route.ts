import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { isManagerOrAbove } from '@/utils/permissions';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { extractReceipt } from '@/lib/receiptExtract';
import { parseReceiptDate, RECEIPT_INCLUDE } from '@/lib/receipt';

// Claude 呼び出しに時間がかかるため最大実行時間を延長する。
export const maxDuration = 60;

interface RouteContext { params: Promise<{ id: string }>; }

// 保存済みの領収書ファイルを Claude で再読み取りし、抽出値を埋め直す（未確定の領収書向け）。
export async function POST(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const receipt = await prisma.receipt.findUnique({ where: { id } });
        if (!receipt) return notFoundResponse('領収書');
        if (receipt.status === 'confirmed') return errorResponse('仕分け済みの領収書は再読み取りできません', 400);

        const { data, error: dErr } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(receipt.storagePath);
        if (dErr || !data) return errorResponse('ファイルの取得に失敗しました', 500);
        const base64 = Buffer.from(await data.arrayBuffer()).toString('base64');

        const cats = await prisma.expenseCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, name: true },
        });

        const extracted = await extractReceipt(
            base64,
            receipt.mimeType,
            cats.map((c) => c.name),
        );

        let expenseCategoryId = receipt.expenseCategoryId;
        if (!expenseCategoryId && extracted.suggestedCategory) {
            const hint = extracted.suggestedCategory;
            expenseCategoryId = (cats.find((c) => c.name === hint) ?? cats.find((c) => hint.includes(c.name) || c.name.includes(hint)))?.id ?? null;
        }

        const updated = await prisma.receipt.update({
            where: { id },
            data: {
                extractedData: extracted as unknown as Prisma.InputJsonValue,
                storeName: extracted.storeName ?? receipt.storeName,
                issueDate: parseReceiptDate(extracted.issueDate) ?? receipt.issueDate,
                totalAmount: extracted.totalAmount ?? receipt.totalAmount,
                taxAmount: extracted.taxAmount ?? receipt.taxAmount,
                expenseCategoryId,
            },
            include: RECEIPT_INCLUDE,
        });

        return NextResponse.json(updated);
    } catch (error) {
        return serverErrorResponse('領収書の再読み取り', error);
    }
}
