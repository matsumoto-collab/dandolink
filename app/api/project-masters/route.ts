'use server';

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

        const where: Record<string, unknown> = {};

        if (status) {
            where.status = status;
        }

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { customer: { contains: search, mode: 'insensitive' } },
                { location: { contains: search, mode: 'insensitive' } },
            ];
        }

        const projectMasters = await prisma.projectMaster.findMany({
            where,
            include: {
                assignments: {
                    orderBy: { date: 'desc' },
                    take: 5, // 最新5件の配置のみ
                },
            },
            orderBy: { updatedAt: 'desc' },
        });

        // Date型をISO文字列に変換
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
                customer: body.customer || null,
                constructionType: body.constructionType || 'other',
                status: body.status || 'active',
                location: body.location || null,
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
        });
    } catch (error) {
        console.error('Create project master error:', error);
        return NextResponse.json(
            { error: '案件マスターの作成に失敗しました' },
            { status: 500 }
        );
    }
}
