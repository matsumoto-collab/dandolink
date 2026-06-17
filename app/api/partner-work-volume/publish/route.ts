import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
    parseJsonField,
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
            //
            // ただし「常用(joyo)化した配置の残骸 work/transport 行」は GET の monthStatus が
            // 有効行から除外している（その配置は今は別職長班の常用配置で、出来高は joyo 行で表すため）。
            // ガードがこの残骸行を完了判定に含めると、UI が「全行完了」でも公開できなくなるので、
            // GET と同じ有効行集合（残骸 joyo 行を除外）で判定する。
            const start = new Date(Date.UTC(year, month - 1, 1));
            const end = new Date(Date.UTC(year, month, 1));
            // 配置(DateTime)は実時刻入り・表示は JST 日付なので、常用判定は JST 日境界で配置を絞る。
            const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
            const jstStart = new Date(start.getTime() - JST_OFFSET_MS);
            const jstEnd = new Date(end.getTime() - JST_OFFSET_MS);

            // 会社メンバー（所属メンバー + 会社本体 id）
            const members = await prisma.user.findMany({
                where: { companyId: body.companyId },
                select: { id: true },
            });
            const memberIds = new Set<string>(members.map((m) => m.id));
            memberIds.add(body.companyId);

            // 当月の配置から「常用(joyo)化した配置」を特定する。
            // = 自社が職長(assignedEmployeeId)ではないが、自社メンバーが confirmedWorkerIds に含まれる配置。
            const monthAssignments = await prisma.projectAssignment.findMany({
                where: { date: { gte: jstStart, lt: jstEnd } },
                select: { id: true, assignedEmployeeId: true, confirmedWorkerIds: true },
            });
            const joyoAssignmentIdSet = new Set<string>();
            for (const a of monthAssignments) {
                if (a.assignedEmployeeId === body.companyId) continue;
                const confirmed = parseJsonField<string[]>(a.confirmedWorkerIds, []);
                if (confirmed.some((id) => memberIds.has(id))) {
                    joyoAssignmentIdSet.add(a.id);
                }
            }

            const rows = await prisma.partnerWorkVolume.findMany({
                where: {
                    partnerCompanyId: body.companyId,
                    date: { gte: start, lt: end },
                    deletedAt: null,
                },
                select: { status: true, rowType: true, sourceAssignmentId: true },
            });
            // GET monthStatus と同じ有効行集合（残骸 joyo 行を除外）で全行完了を判定する。
            const effectiveRows = rows.filter(
                (r) =>
                    !(
                        r.rowType !== 'joyo' &&
                        r.sourceAssignmentId &&
                        joyoAssignmentIdSet.has(r.sourceAssignmentId)
                    ),
            );
            if (effectiveRows.length === 0 || effectiveRows.some((r) => r.status !== 'completed')) {
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
