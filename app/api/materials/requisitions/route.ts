import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { materialRequisitionCreateSchema, validateRequest } from '@/lib/validations';

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
        const validation = validateRequest(materialRequisitionCreateSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const { projectMasterId, date, foremanId, foremanName, type, vehicleInfo, notes, items } = validation.data;

        // 数量 > 0 のアイテムのみ保存
        const validItems = items.filter((item) => item.quantity > 0);
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
                // C8（#1 解消）: 新規作成は常に draft 固定。body status は信頼しない
                // （schema でも z.literal('draft') で拒否しているが、二重防壁として
                //  ここでもハードコードし「loaded 伝票が直接作れない」不変条件を担保）。
                //  loaded 化は [id] PATCH / loading-list/confirm のヘルパ経由のみ。
                status: 'draft',
                vehicleInfo: vehicleInfo || null,
                notes: notes || null,
                createdBy: session?.user?.id || null,
                items: {
                    create: validItems.map((item) => ({
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
