import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';

const ADMIN_ROLES = ['admin', 'manager'];

interface PublishBody {
    companyId: string;
    year: number;
    month: number;
    /** true = 協力業者へ公開 / false = 公開解除 */
    published: boolean;
}

/**
 * POST /api/partner-work-volume/publish
 * 協力業者出来高の月単位の公開 / 公開解除（admin / manager のみ）。
 *
 * 公開状態は PartnerWorkVolumeMonth に保存する（status: 'published' = 公開 / 'draft' = 未公開、
 * completedAt / completedBy は公開日時 / 公開操作者に転用）。
 * 協力業者の閲覧条件は「全行完了 && 公開済み」の AND（判定は GET 側）。
 * 全行完了だけでは公開されず、このエンドポイントによる明示操作で初めて公開される（kei 決定 2026-06-10）。
 * 公開後に全行完了が崩れても公開フラグは保持し、再び全行完了になれば自動で再公開される。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!ADMIN_ROLES.includes(role)) {
            return errorResponse('管理者またはマネージャー権限が必要です', 403);
        }

        const body = (await req.json()) as PublishBody;
        const year = Number(body?.year);
        const month = Number(body?.month);
        if (
            !body?.companyId ||
            !Number.isInteger(year) ||
            !Number.isInteger(month) ||
            month < 1 ||
            month > 12
        ) {
            return validationErrorResponse('companyId / year / month が不正です');
        }

        const company = await prisma.user.findUnique({
            where: { id: body.companyId },
            select: { id: true, role: true },
        });
        if (!company || company.role.toLowerCase() !== 'partner') {
            return errorResponse('協力会社が見つかりません', 404);
        }

        const publish = body.published === true;

        if (publish) {
            // 公開前の軽量ガード: 保存済みの有効行が 1 件以上あり、全て完了していること。
            // 未保存の自動行までは見ない（取りこぼしても閲覧側は「全行完了 && 公開」の
            // AND 判定なので、未完了の月が協力業者に見えることはない）。
            const start = new Date(Date.UTC(year, month - 1, 1));
            const end = new Date(Date.UTC(year, month, 1));
            const rows = await prisma.partnerWorkVolume.findMany({
                where: {
                    partnerCompanyId: body.companyId,
                    date: { gte: start, lt: end },
                    deletedAt: null,
                },
                select: { status: true },
            });
            if (rows.length === 0 || rows.some((r) => r.status !== 'completed')) {
                return errorResponse('全行が完了になっていないため公開できません', 400);
            }
        }

        const userId = session!.user.id as string;
        const now = new Date();
        const statusData = {
            status: publish ? 'published' : 'draft',
            completedAt: publish ? now : null,
            completedBy: publish ? userId : null,
        };
        const saved = await prisma.partnerWorkVolumeMonth.upsert({
            where: {
                partnerCompanyId_year_month: {
                    partnerCompanyId: body.companyId,
                    year,
                    month,
                },
            },
            update: statusData,
            create: {
                partnerCompanyId: body.companyId,
                year,
                month,
                ...statusData,
            },
        });

        return NextResponse.json(
            {
                published: saved.status === 'published',
                publishedAt: saved.completedAt ? saved.completedAt.toISOString() : null,
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (err) {
        return serverErrorResponse('協力会社出来高公開', err);
    }
}
