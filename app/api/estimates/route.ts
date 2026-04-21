import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { formatEstimate } from '@/lib/formatters';
import { createEstimateSchema, validateRequest } from '@/lib/validations';
import { createEstimateVersion } from '@/lib/versions/snapshot';

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        if (page && limit) {
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
                return validationErrorResponse('無効なページネーションパラメータです');
            }
            const [estimates, total] = await Promise.all([
                prisma.estimate.findMany({ skip: (pageNum - 1) * limitNum, take: limitNum, orderBy: { createdAt: 'desc' } }),
                prisma.estimate.count(),
            ]);
            return NextResponse.json({
                data: estimates.map(formatEstimate),
                pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        const estimates = await prisma.estimate.findMany({ orderBy: { createdAt: 'desc' } });
        return NextResponse.json(estimates.map(formatEstimate), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('見積一覧の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(createEstimateSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);
        const { projectMasterId, estimateNumber, title, items, subtotal, tax, total, validUntil, status, notes, customerId, location, costTotal, constructionPeriod } = validation.data;

        // 見積番号: 指定がなければサーバー側で自動採番
        let finalEstimateNumber = estimateNumber;
        if (!finalEstimateNumber) {
            const year = new Date().getFullYear();
            const prefix = `E${year}`;
            const latest = await prisma.estimate.findFirst({
                where: { estimateNumber: { startsWith: prefix } },
                orderBy: { estimateNumber: 'desc' },
                select: { estimateNumber: true },
            });
            let nextSeq = 1;
            if (latest) {
                const seq = parseInt(latest.estimateNumber.replace(prefix, ''), 10);
                if (!isNaN(seq)) nextSeq = seq + 1;
            }
            // 旧形式(YYYY-NNNN)からの移行チェック
            if (nextSeq === 1) {
                const oldPrefix = `${year}-`;
                const oldLatest = await prisma.estimate.findFirst({
                    where: { estimateNumber: { startsWith: oldPrefix } },
                    orderBy: { estimateNumber: 'desc' },
                    select: { estimateNumber: true },
                });
                if (oldLatest) {
                    const oldSeq = parseInt(oldLatest.estimateNumber.replace(oldPrefix, ''), 10);
                    if (!isNaN(oldSeq)) nextSeq = oldSeq + 1;
                }
            }
            finalEstimateNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        }

        const newEstimate = await prisma.$transaction(async (tx) => {
            const created = await tx.estimate.create({
                data: {
                    projectMasterId: projectMasterId || null, customerId: customerId || null, estimateNumber: finalEstimateNumber, title,
                    items: JSON.stringify(items || []), subtotal: subtotal || 0, tax: tax || 0, total: total || 0,
                    validUntil: validUntil ? new Date(validUntil) : new Date(), status: status || 'draft', notes: notes || null, location: location || null,
                    costTotal: costTotal ?? null,
                    constructionPeriod: constructionPeriod || null,
                    updatedBy: session!.user.id,
                },
            });
            await createEstimateVersion(tx, created.id, session!.user.id);
            return created;
        });

        return NextResponse.json(formatEstimate(newEstimate));
    } catch (error) {
        return serverErrorResponse('見積の作成', error);
    }
}
