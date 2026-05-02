import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

const ROLE_OPTIONS = [
    { id: 'admin', label: '管理者' },
    { id: 'manager', label: 'マネージャー' },
    { id: 'foreman1', label: '職長1' },
    { id: 'foreman2', label: '職長2' },
    { id: 'worker', label: '職方' },
    { id: 'partner', label: '協力業者' },
];

/**
 * GET /api/chat/mentions/suggest?type=user|project|role&q=
 * メンション入力時のサジェスト候補
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const type = searchParams.get('type') ?? 'user';
        const q = (searchParams.get('q') ?? '').trim();

        if (type === 'role') {
            const items = q
                ? ROLE_OPTIONS.filter((r) => r.label.includes(q) || r.id.includes(q.toLowerCase()))
                : ROLE_OPTIONS;
            return NextResponse.json(
                { items },
                { headers: { 'Cache-Control': 'private, max-age=60' } }
            );
        }

        if (type === 'project') {
            const projects = await prisma.projectMaster.findMany({
                where: {
                    status: 'active',
                    OR: q
                        ? [
                            { title: { contains: q, mode: 'insensitive' } },
                            { name: { contains: q, mode: 'insensitive' } },
                            { customerName: { contains: q, mode: 'insensitive' } },
                            { customerShortName: { contains: q, mode: 'insensitive' } },
                            { siteShortName: { contains: q, mode: 'insensitive' } },
                        ]
                        : undefined,
                },
                select: {
                    id: true,
                    title: true,
                    name: true,
                    customerShortName: true,
                    siteShortName: true,
                },
                orderBy: { updatedAt: 'desc' },
                take: 20,
            });
            const items = projects.map((p) => ({
                id: p.id,
                label: p.siteShortName || p.name || p.title,
                sub: p.customerShortName || '',
            }));
            return NextResponse.json(
                { items },
                { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } }
            );
        }

        // type === 'user'
        const users = await prisma.user.findMany({
            where: {
                isActive: true,
                ...(q
                    ? {
                        OR: [
                            { displayName: { contains: q, mode: 'insensitive' } },
                            { username: { contains: q, mode: 'insensitive' } },
                        ],
                    }
                    : {}),
            },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
            take: 20,
        });
        const items = users.map((u) => ({
            id: u.id,
            label: u.displayName,
            sub: roleLabel(u.role),
        }));
        return NextResponse.json(
            { items },
            { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } }
        );
    } catch (error) {
        return serverErrorResponse('メンション候補取得', error);
    }
}

function roleLabel(role: string): string {
    switch (role) {
        case 'admin': return '管理者';
        case 'manager': return 'マネージャー';
        case 'foreman1': return '職長1';
        case 'foreman2': return '職長2';
        case 'worker': return '職方';
        case 'partner': return '協力業者';
        default: return role;
    }
}
