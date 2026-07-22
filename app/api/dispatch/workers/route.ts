import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner', 'partner_member'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        // 協力会社ロールはホバー詳細・案件詳細のID→名前解決にのみ使うため、
        // 手配用の内部情報（並び順・所属など）は返さない
        const isPartnerRole = role === 'partner' || role === 'partner_member';

        const workers = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER', 'support', 'SUPPORT', 'partner', 'PARTNER', 'partner_member', 'PARTNER_MEMBER'] } },
            select: isPartnerRole ? { id: true, displayName: true } : {
                id: true,
                displayName: true,
                role: true,
                dispatchSortOrder: true,
                hideByDefaultInDispatch: true,
                companyId: true,
                company: { select: { id: true, displayName: true } },
            },
            orderBy: [
                { dispatchSortOrder: { sort: 'asc', nulls: 'last' } },
                { displayName: 'asc' },
            ],
        });

        return NextResponse.json(workers, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('ワーカー一覧取得', error);
    }
}
