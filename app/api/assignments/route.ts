'use server';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/assignments
 * 配置一覧取得（日付範囲フィルター対応）
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const assignedEmployeeId = searchParams.get('assignedEmployeeId');
        const projectMasterId = searchParams.get('projectMasterId');

        const where: Record<string, unknown> = {};

        // 日付範囲フィルター
        if (startDate || endDate) {
            where.date = {};
            if (startDate) {
                (where.date as Record<string, Date>).gte = new Date(startDate);
            }
            if (endDate) {
                (where.date as Record<string, Date>).lte = new Date(endDate);
            }
        }

        if (assignedEmployeeId) {
            where.assignedEmployeeId = assignedEmployeeId;
        }

        if (projectMasterId) {
            where.projectMasterId = projectMasterId;
        }

        const assignments = await prisma.projectAssignment.findMany({
            where,
            include: {
                projectMaster: true,
            },
            orderBy: [
                { date: 'asc' },
                { sortOrder: 'asc' },
            ],
        });

        // Date型をISO文字列に変換、JSON文字列を配列に変換
        const formatted = assignments.map(a => ({
            ...a,
            date: a.date.toISOString(),
            workers: a.workers ? JSON.parse(a.workers) : [],
            vehicles: a.vehicles ? JSON.parse(a.vehicles) : [],
            confirmedWorkerIds: a.confirmedWorkerIds ? JSON.parse(a.confirmedWorkerIds) : [],
            confirmedVehicleIds: a.confirmedVehicleIds ? JSON.parse(a.confirmedVehicleIds) : [],
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
            projectMaster: a.projectMaster ? {
                ...a.projectMaster,
                createdBy: a.projectMaster.createdBy ? JSON.parse(a.projectMaster.createdBy) : null,
                createdAt: a.projectMaster.createdAt.toISOString(),
                updatedAt: a.projectMaster.updatedAt.toISOString(),
            } : null,
        }));

        return NextResponse.json(formatted);
    } catch (error) {
        console.error('Get assignments error:', error);
        return NextResponse.json(
            { error: '配置一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/assignments
 * 配置作成
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

        // 必須フィールドチェック
        if (!body.projectMasterId || !body.assignedEmployeeId || !body.date) {
            return NextResponse.json(
                { error: 'projectMasterId, assignedEmployeeId, date は必須です' },
                { status: 400 }
            );
        }

        // 同一案件・同一職長・同一日付の重複チェック
        const existing = await prisma.projectAssignment.findUnique({
            where: {
                projectMasterId_assignedEmployeeId_date: {
                    projectMasterId: body.projectMasterId,
                    assignedEmployeeId: body.assignedEmployeeId,
                    date: new Date(body.date),
                },
            },
        });

        if (existing) {
            return NextResponse.json(
                { error: '同一案件・同一職長・同一日付の配置は既に存在します' },
                { status: 409 }
            );
        }

        const assignment = await prisma.projectAssignment.create({
            data: {
                projectMasterId: body.projectMasterId,
                assignedEmployeeId: body.assignedEmployeeId,
                date: new Date(body.date),
                memberCount: body.memberCount || 0,
                workers: body.workers ? JSON.stringify(body.workers) : null,
                vehicles: body.vehicles ? JSON.stringify(body.vehicles) : null,
                meetingTime: body.meetingTime || null,
                sortOrder: body.sortOrder || 0,
                remarks: body.remarks || null,
                isDispatchConfirmed: body.isDispatchConfirmed || false,
                confirmedWorkerIds: body.confirmedWorkerIds ? JSON.stringify(body.confirmedWorkerIds) : null,
                confirmedVehicleIds: body.confirmedVehicleIds ? JSON.stringify(body.confirmedVehicleIds) : null,
            },
            include: {
                projectMaster: true,
            },
        });

        return NextResponse.json({
            ...assignment,
            date: assignment.date.toISOString(),
            workers: assignment.workers ? JSON.parse(assignment.workers) : [],
            vehicles: assignment.vehicles ? JSON.parse(assignment.vehicles) : [],
            confirmedWorkerIds: assignment.confirmedWorkerIds ? JSON.parse(assignment.confirmedWorkerIds) : [],
            confirmedVehicleIds: assignment.confirmedVehicleIds ? JSON.parse(assignment.confirmedVehicleIds) : [],
            createdAt: assignment.createdAt.toISOString(),
            updatedAt: assignment.updatedAt.toISOString(),
            projectMaster: assignment.projectMaster ? {
                ...assignment.projectMaster,
                createdBy: assignment.projectMaster.createdBy ? JSON.parse(assignment.projectMaster.createdBy) : null,
                createdAt: assignment.projectMaster.createdAt.toISOString(),
                updatedAt: assignment.projectMaster.updatedAt.toISOString(),
            } : null,
        });
    } catch (error) {
        console.error('Create assignment error:', error);
        return NextResponse.json(
            { error: '配置の作成に失敗しました' },
            { status: 500 }
        );
    }
}
