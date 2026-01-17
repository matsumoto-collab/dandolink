import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/project-masters
 * 案件マスター一覧取得
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status');
        const search = searchParams.get('search');
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        const where: Record<string, unknown> = {};

        if (status) {
            where.status = status;
        }

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { customerName: { contains: search, mode: 'insensitive' } },
                { location: { contains: search, mode: 'insensitive' } },
            ];
        }

        // ページネーション付きレスポンス
        if (page && limit) {
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;

            const [projectMasters, total] = await Promise.all([
                prisma.projectMaster.findMany({
                    where,
                    include: {
                        assignments: {
                            orderBy: { date: 'desc' },
                            take: 5,
                        },
                    },
                    orderBy: { updatedAt: 'desc' },
                    skip,
                    take: limitNum,
                }),
                prisma.projectMaster.count({ where }),
            ]);

            const formatted = projectMasters.map(pm => ({
                ...pm,
                createdBy: pm.createdBy ? JSON.parse(pm.createdBy) : null,
                createdAt: pm.createdAt.toISOString(),
                updatedAt: pm.updatedAt.toISOString(),
                assignments: pm.assignments.map(a => ({
                    ...a,
                    date: a.date.toISOString(),
                    workers: a.workers ? JSON.parse(a.workers) : [],
                    vehicles: a.vehicles ? JSON.parse(a.vehicles) : [],
                    confirmedWorkerIds: a.confirmedWorkerIds ? JSON.parse(a.confirmedWorkerIds) : [],
                    confirmedVehicleIds: a.confirmedVehicleIds ? JSON.parse(a.confirmedVehicleIds) : [],
                    createdAt: a.createdAt.toISOString(),
                    updatedAt: a.updatedAt.toISOString(),
                })),
            }));

            return NextResponse.json({
                data: formatted,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        }

        // ページネーションなし（従来の全件取得）
        const projectMasters = await prisma.projectMaster.findMany({
            where,
            include: {
                assignments: {
                    orderBy: { date: 'desc' },
                    take: 5,
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        const formatted = projectMasters.map(pm => ({
            ...pm,
            createdBy: pm.createdBy ? JSON.parse(pm.createdBy) : null,
            createdAt: pm.createdAt.toISOString(),
            updatedAt: pm.updatedAt.toISOString(),
            assignments: pm.assignments.map(a => ({
                ...a,
                date: a.date.toISOString(),
                workers: a.workers ? JSON.parse(a.workers) : [],
                vehicles: a.vehicles ? JSON.parse(a.vehicles) : [],
                confirmedWorkerIds: a.confirmedWorkerIds ? JSON.parse(a.confirmedWorkerIds) : [],
                confirmedVehicleIds: a.confirmedVehicleIds ? JSON.parse(a.confirmedVehicleIds) : [],
                createdAt: a.createdAt.toISOString(),
                updatedAt: a.updatedAt.toISOString(),
            })),
        }));

        return NextResponse.json(formatted);
    } catch (error) {
        console.error('Get project masters error:', error);
        return NextResponse.json(
            { error: '案件マスター一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/project-masters
 * 案件マスター作成
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const role = session.user.role;
        if (role !== 'admin' && role !== 'manager' && role !== 'foreman1') {
            return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }

        const body = await req.json();

        const projectMaster = await prisma.projectMaster.create({
            data: {
                title: body.title,
                customerId: body.customerId || null,
                customerName: body.customerName || null,
                constructionType: body.constructionType || 'other',
                constructionContent: body.constructionContent || null,
                status: body.status || 'active',
                // 住所情報
                location: body.location || null,
                postalCode: body.postalCode || null,
                prefecture: body.prefecture || null,
                city: body.city || null,
                plusCode: body.plusCode || null,
                // 工事情報
                area: body.area || null,
                areaRemarks: body.areaRemarks || null,
                assemblyDate: body.assemblyDate ? new Date(body.assemblyDate) : null,
                demolitionDate: body.demolitionDate ? new Date(body.demolitionDate) : null,
                estimatedAssemblyWorkers: body.estimatedAssemblyWorkers || null,
                estimatedDemolitionWorkers: body.estimatedDemolitionWorkers || null,
                contractAmount: body.contractAmount || null,
                // 足場仕様
                scaffoldingSpec: body.scaffoldingSpec || null,
                description: body.description || null,
                remarks: body.remarks || null,
                createdBy: body.createdBy ? JSON.stringify(body.createdBy) : null,
            },
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
        console.error('Create project master error:', error);
        return NextResponse.json(
            { error: '案件マスターの作成に失敗しました' },
            { status: 500 }
        );
    }
}
