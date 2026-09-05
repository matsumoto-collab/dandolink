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
    { id: 'partner_member', label: '協力会社メンバー' },
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
        const roomId = searchParams.get('roomId');

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
                            // 住所（ProjectMasterに siteAddress は無く location が現場住所）
                            { location: { contains: q, mode: 'insensitive' } },
                        ]
                        : undefined,
                },
                select: {
                    id: true,
                    title: true,
                    name: true,
                    honorific: true,
                    customerName: true,
                    customerShortName: true,
                    siteShortName: true,
                },
                orderBy: { updatedAt: 'desc' },
                take: 30,
            });
            const items = projects.map((p) => {
                const projectPart =
                    (p.name ? p.name + (p.honorific || '') : '') ||
                    p.siteShortName ||
                    p.title;
                const label = p.customerShortName
                    ? `${p.customerShortName} ${projectPart}`.trim()
                    : projectPart;
                // 右側の薄い文字は元請名。ラベルの略称と同じ文字列なら重複するので出さない
                const sub =
                    p.customerName && p.customerName !== p.customerShortName
                        ? p.customerName
                        : '';
                return { id: p.id, label, sub };
            });
            return NextResponse.json(
                { items },
                { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' } }
            );
        }

        // type === 'user'
        // roomId 指定時はそのチャットルームの参加メンバーに限定
        let memberIdFilter: { in: string[] } | undefined;
        if (roomId) {
            const members = await prisma.chatMember.findMany({
                where: { roomId, leftAt: null },
                select: { userId: true },
            });
            memberIdFilter = { in: members.map((m) => m.userId) };
        }
        const users = await prisma.user.findMany({
            where: {
                isActive: true,
                ...(memberIdFilter ? { id: memberIdFilter } : {}),
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
        case 'partner_member': return '協力会社メンバー';
        default: return role;
    }
}
