import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Get all estimates
 * GET /api/estimates
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        // Get pagination parameters
        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        // If pagination params are provided, return paginated data
        if (page && limit) {
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;

            const [estimates, total] = await Promise.all([
                prisma.estimate.findMany({
                    skip,
                    take: limitNum,
                    orderBy: { createdAt: 'desc' },
                }),
                prisma.estimate.count(),
            ]);

            const parsedEstimates = estimates.map((estimate: any) => ({
                ...estimate,
                items: estimate.items ? JSON.parse(estimate.items) : [],
                validUntil: new Date(estimate.validUntil),
            }));

            return NextResponse.json({
                data: parsedEstimates,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        }

        // Otherwise, return all data
        const estimates = await prisma.estimate.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });

        // Parse JSON fields
        const parsedEstimates = estimates.map((estimate: any) => ({
            ...estimate,
            items: estimate.items ? JSON.parse(estimate.items) : [],
            validUntil: new Date(estimate.validUntil),
        }));

        return NextResponse.json(parsedEstimates);
    } catch (error) {
        console.error('Get estimates error:', error);
        return NextResponse.json(
            { error: '見積一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Create a new estimate
 * POST /api/estimates
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const body = await req.json();
        const {
            projectMasterId,
            estimateNumber,
            title,
            items,
            subtotal,
            tax,
            total,
            validUntil,
            status,
            notes,
        } = body;

        // Validation
        if (!estimateNumber || !title) {
            return NextResponse.json(
                { error: '見積番号とタイトルは必須です' },
                { status: 400 }
            );
        }

        // Create estimate
        const newEstimate = await prisma.estimate.create({
            data: {
                projectMasterId: projectMasterId || null,
                estimateNumber,
                title,
                items: items ? JSON.stringify(items) : '[]',
                subtotal: subtotal || 0,
                tax: tax || 0,
                total: total || 0,
                validUntil: validUntil ? new Date(validUntil) : new Date(),
                status: status || 'draft',
                notes: notes || null,
            },
        });

        // Parse JSON fields for response
        const response = {
            ...newEstimate,
            items: newEstimate.items ? JSON.parse(newEstimate.items) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Create estimate error:', error);
        return NextResponse.json(
            { error: '見積の作成に失敗しました' },
            { status: 500 }
        );
    }
}
