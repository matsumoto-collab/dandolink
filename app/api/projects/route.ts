import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Get all projects
 * GET /api/projects
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

            const [projects, total] = await Promise.all([
                prisma.project.findMany({
                    skip,
                    take: limitNum,
                    orderBy: [
                        { startDate: 'asc' },
                        { sortOrder: 'asc' },
                    ],
                }),
                prisma.project.count(),
            ]);

            // Parse JSON fields
            const parsedProjects = projects.map((project: any) => ({
                ...project,
                workers: project.workers ? JSON.parse(project.workers) : [],
                vehicles: project.vehicles ? JSON.parse(project.vehicles) : [],
            }));

            return NextResponse.json({
                data: parsedProjects,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        }

        // Otherwise, return all data (for calendar view)
        const projects = await prisma.project.findMany({
            orderBy: [
                { startDate: 'asc' },
                { sortOrder: 'asc' },
            ],
        });

        // Parse JSON fields
        const parsedProjects = projects.map((project: any) => ({
            ...project,
            workers: project.workers ? JSON.parse(project.workers) : [],
            vehicles: project.vehicles ? JSON.parse(project.vehicles) : [],
        }));

        return NextResponse.json(parsedProjects);
    } catch (error) {
        console.error('Get projects error:', error);
        return NextResponse.json(
            { error: 'プロジェクトの取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Create a new project
 * POST /api/projects
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const body = await req.json();
        const {
            title,
            constructionType,
            startDate,
            endDate,
            assemblyStartDate,
            assemblyDuration,
            demolitionStartDate,
            demolitionDuration,
            assignedEmployeeId,
            customer,
            description,
            location,
            category,
            workers,
            vehicles,
            remarks,
            sortOrder,
        } = body;

        // Validation - only require essential fields
        if (!title || !startDate || !assignedEmployeeId) {
            return NextResponse.json(
                { error: '必須項目を入力してください（タイトル、開始日、担当者）' },
                { status: 400 }
            );
        }

        // Create project
        const newProject = await prisma.project.create({
            data: {
                title,
                constructionType: constructionType || 'other',
                startDate: new Date(startDate),
                endDate: endDate ? new Date(endDate) : null,
                assemblyStartDate: assemblyStartDate ? new Date(assemblyStartDate) : null,
                assemblyDuration: assemblyDuration || null,
                demolitionStartDate: demolitionStartDate ? new Date(demolitionStartDate) : null,
                demolitionDuration: demolitionDuration || null,
                assignedEmployeeId,
                customer: customer || null,
                description: description || null,
                location: location || null,
                category: category || null,
                workers: workers ? JSON.stringify(workers) : null,
                vehicles: vehicles ? JSON.stringify(vehicles) : null,
                remarks: remarks || null,
                sortOrder: sortOrder !== undefined ? sortOrder : 0,
            },
        });

        // Parse JSON fields for response
        const response = {
            ...newProject,
            workers: newProject.workers ? JSON.parse(newProject.workers) : [],
            vehicles: newProject.vehicles ? JSON.parse(newProject.vehicles) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Create project error:', error);
        return NextResponse.json(
            { error: 'プロジェクトの作成に失敗しました' },
            { status: 500 }
        );
    }
}
