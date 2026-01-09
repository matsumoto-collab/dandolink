'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteContext {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/project-masters/[id]
 * 案件マスター詳細取得
 */
export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { id } = await context.params;

        const projectMaster = await prisma.projectMaster.findUnique({
            where: { id },
            include: {
                assignments: {
                    orderBy: { date: 'desc' },
                },
            },
        });

        if (!projectMaster) {
            return NextResponse.json({ error: '案件マスターが見つかりません' }, { status: 404 });
        }

        return NextResponse.json({
            ...projectMaster,
            createdBy: projectMaster.createdBy ? JSON.parse(projectMaster.createdBy) : null,
            createdAt: projectMaster.createdAt.toISOString(),
            updatedAt: projectMaster.updatedAt.toISOString(),
            assignments: projectMaster.assignments.map(a => ({
                ...a,
                date: a.date.toISOString(),
                workers: a.workers ? JSON.parse(a.workers) : [],
                vehicles: a.vehicles ? JSON.parse(a.vehicles) : [],
                confirmedWorkerIds: a.confirmedWorkerIds ? JSON.parse(a.confirmedWorkerIds) : [],
                confirmedVehicleIds: a.confirmedVehicleIds ? JSON.parse(a.confirmedVehicleIds) : [],
                createdAt: a.createdAt.toISOString(),
                updatedAt: a.updatedAt.toISOString(),
            })),
        });
    } catch (error) {
        console.error('Get project master error:', error);
        return NextResponse.json(
            { error: '案件マスターの取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/project-masters/[id]
 * 案件マスター更新
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const { id } = await context.params;
        const body = await req.json();

        const updateData: Record<string, unknown> = {};
        // 基本情報
        if (body.title !== undefined) updateData.title = body.title;
        if (body.customerId !== undefined) updateData.customerId = body.customerId;
        if (body.customerName !== undefined) updateData.customerName = body.customerName;
        if (body.constructionType !== undefined) updateData.constructionType = body.constructionType;
        if (body.constructionContent !== undefined) updateData.constructionContent = body.constructionContent;
        if (body.status !== undefined) updateData.status = body.status;
        // 住所情報
        if (body.location !== undefined) updateData.location = body.location;
        if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
        if (body.prefecture !== undefined) updateData.prefecture = body.prefecture;
        if (body.city !== undefined) updateData.city = body.city;
        if (body.plusCode !== undefined) updateData.plusCode = body.plusCode;
        // 工事情報
        if (body.area !== undefined) updateData.area = body.area;
        if (body.areaRemarks !== undefined) updateData.areaRemarks = body.areaRemarks;
        if (body.assemblyDate !== undefined) updateData.assemblyDate = body.assemblyDate ? new Date(body.assemblyDate) : null;
        if (body.demolitionDate !== undefined) updateData.demolitionDate = body.demolitionDate ? new Date(body.demolitionDate) : null;
        if (body.estimatedAssemblyWorkers !== undefined) updateData.estimatedAssemblyWorkers = body.estimatedAssemblyWorkers;
        if (body.estimatedDemolitionWorkers !== undefined) updateData.estimatedDemolitionWorkers = body.estimatedDemolitionWorkers;
        if (body.contractAmount !== undefined) updateData.contractAmount = body.contractAmount;
        // 足場仕様
        if (body.scaffoldingSpec !== undefined) updateData.scaffoldingSpec = body.scaffoldingSpec;
        // その他
        if (body.description !== undefined) updateData.description = body.description;
        if (body.remarks !== undefined) updateData.remarks = body.remarks;
        if (body.createdBy !== undefined) updateData.createdBy = JSON.stringify(body.createdBy);

        const projectMaster = await prisma.projectMaster.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json({
            ...projectMaster,
            createdBy: projectMaster.createdBy ? JSON.parse(projectMaster.createdBy) : null,
            createdAt: projectMaster.createdAt.toISOString(),
            updatedAt: projectMaster.updatedAt.toISOString(),
            assemblyDate: projectMaster.assemblyDate?.toISOString() || null,
            demolitionDate: projectMaster.demolitionDate?.toISOString() || null,
        });
    } catch (error) {
        console.error('Update project master error:', error);
        return NextResponse.json(
            { error: '案件マスターの更新に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/project-masters/[id]
 * 案件マスター削除（関連する配置も削除）
 */
export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;
        if (role !== 'admin' && role !== 'manager') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const { id } = await context.params;

        // Cascade deleteにより関連するProjectAssignmentも削除される
        await prisma.projectMaster.delete({
            where: { id },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete project master error:', error);
        return NextResponse.json(
            { error: '案件マスターの削除に失敗しました' },
            { status: 500 }
        );
    }
}
