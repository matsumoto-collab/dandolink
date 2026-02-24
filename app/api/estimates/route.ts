import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { formatEstimate } from '@/lib/formatters';

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
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
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const { projectMasterId, estimateNumber, title, items, subtotal, tax, total, validUntil, status, notes } = body;

        if (!estimateNumber || !title) {
            return validationErrorResponse('見積番号とタイトルは必須です');
        }

        const newEstimate = await prisma.estimate.create({
            data: {
                projectMasterId: projectMasterId || null, estimateNumber, title,
                items: JSON.stringify(items || []), subtotal: subtotal || 0, tax: tax || 0, total: total || 0,
                validUntil: validUntil ? new Date(validUntil) : new Date(), status: status || 'draft', notes: notes || null,
            },
        });

        return NextResponse.json(formatEstimate(newEstimate));
    } catch (error) {
        return serverErrorResponse('見積の作成', error);
    }
}
