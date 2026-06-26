import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

/**
 * GET /api/materials/return-projects
 *
 * 返却画面の現場セレクタ専用。アクティブ案件を「職長名・元請名・現場名」で検索できるよう、
 * 各案件に担当職長（ProjectAssignment.assignedEmployee）の表示名一覧を添えて返す。
 *
 * Response: Array<{
 *   id: string; title: string; name: string | null;
 *   customerName: string | null; customerShortName: string | null;
 *   foremanNames: string[];   // 担当職長（assignedEmployee）の displayName 一覧（重複除去）
 * }>
 *
 * 認可: worker / partner / partner_member はアサイン済み案件のみ（/api/project-masters と同方針）。
 */
export async function GET(_req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        const where: Record<string, unknown> = { status: 'active' };

        if (role === 'worker' || role === 'partner') {
            const rows = await prisma.projectAssignment.findMany({
                where: { assignedEmployeeId: session!.user.id },
                select: { projectMasterId: true },
                distinct: ['projectMasterId'],
            });
            where.id = { in: rows.map(r => r.projectMasterId) };
        } else if (role === 'partner_member') {
            const parentCompanyId = session!.user.companyId;
            if (!parentCompanyId) {
                where.id = { in: [] };
            } else {
                const rows = await prisma.projectAssignment.findMany({
                    where: { assignedEmployeeId: parentCompanyId },
                    select: { projectMasterId: true },
                    distinct: ['projectMasterId'],
                });
                where.id = { in: rows.map(r => r.projectMasterId) };
            }
        }

        const projects = await prisma.projectMaster.findMany({
            where,
            select: { id: true, title: true, name: true, customerName: true, customerShortName: true },
            orderBy: { updatedAt: 'desc' },
        });

        // 担当職長名（assignedEmployee の displayName）を案件ごとに収集。
        // ProjectAssignment は User へのリレーションを持たないため id→displayName を別引きする。
        const pmIds = projects.map(p => p.id);
        const foremanByPm = new Map<string, string[]>();
        if (pmIds.length > 0) {
            const asg = await prisma.projectAssignment.findMany({
                where: { projectMasterId: { in: pmIds } },
                select: { projectMasterId: true, assignedEmployeeId: true },
                distinct: ['projectMasterId', 'assignedEmployeeId'],
            });
            const empIds = Array.from(new Set(asg.map(a => a.assignedEmployeeId)));
            const users = empIds.length > 0
                ? await prisma.user.findMany({ where: { id: { in: empIds } }, select: { id: true, displayName: true } })
                : [];
            const nameById = new Map(users.map(u => [u.id, u.displayName]));
            for (const a of asg) {
                const nm = nameById.get(a.assignedEmployeeId);
                if (!nm) continue;
                const list = foremanByPm.get(a.projectMasterId) ?? [];
                if (!list.includes(nm)) list.push(nm);
                foremanByPm.set(a.projectMasterId, list);
            }
        }

        const result = projects.map(p => ({
            id: p.id,
            title: p.title,
            name: p.name,
            customerName: p.customerName,
            customerShortName: p.customerShortName,
            foremanNames: foremanByPm.get(p.id) ?? [],
        }));

        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('返却用案件一覧の取得', error);
    }
}
