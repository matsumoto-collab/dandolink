import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const projectMasterId = searchParams.get('projectMasterId');
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        const status = searchParams.get('status');

        const where: Record<string, unknown> = {};
        if (projectMasterId) where.projectMasterId = projectMasterId;
        if (status) where.status = status;
        if (from || to) {
            where.date = {};
            if (from) (where.date as Record<string, unknown>).gte = new Date(from);
            if (to) (where.date as Record<string, unknown>).lte = new Date(to);
        }

        const requisitions = await prisma.materialRequisition.findMany({
            where,
            orderBy: { date: 'desc' },
            include: {
                items: {
                    include: { materialItem: true },
                },
            },
        });

        // ProjectMaster のタイトルを取得
        const projectIds = [...new Set(requisitions.map(r => r.projectMasterId))];
        const projects = await prisma.projectMaster.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, title: true, name: true },
        });
        const projectMap = new Map(projects.map(p => [p.id, p.name || p.title]));

        const result = requisitions.map(r => ({
            ...r,
            projectTitle: projectMap.get(r.projectMasterId) || '不明',
        }));

        return NextResponse.json(result, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票一覧取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error, session } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const { projectMasterId, date, foremanId, foremanName, type, status: reqStatus, vehicleInfo, notes, items } = body;

        if (!projectMasterId || !date || !foremanId) {
            return NextResponse.json({ error: '現場、日付、職長は必須です' }, { status: 400 });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: '材料を1つ以上入力してください' }, { status: 400 });
        }

        // 数量 > 0 のアイテムのみ保存
        const validItems = items.filter((item: { quantity: number }) => item.quantity > 0);
        if (validItems.length === 0) {
            return NextResponse.json({ error: '数量が入力された材料がありません' }, { status: 400 });
        }

        const requisition = await prisma.materialRequisition.create({
            data: {
                projectMasterId,
                date: new Date(date),
                foremanId,
                foremanName: foremanName || '',
                type: type || '出庫',
                status: reqStatus || 'draft',
                vehicleInfo: vehicleInfo || null,
                notes: notes || null,
                createdBy: session?.user?.id || null,
                items: {
                    create: validItems.map((item: { materialItemId: string; quantity: number; vehicleLabel?: string; notes?: string }) => ({
                        materialItemId: item.materialItemId,
                        quantity: item.quantity,
                        vehicleLabel: item.vehicleLabel || null,
                        notes: item.notes || null,
                    })),
                },
            },
            include: {
                items: {
                    include: { materialItem: true },
                },
            },
        });

        return NextResponse.json(requisition, { status: 201 });
    } catch (error) {
        return serverErrorResponse('材料出庫伝票作成', error);
    }
}
