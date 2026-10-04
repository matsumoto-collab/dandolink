/**
 * 手当: 手当の種類の一覧（docs/指示書_大規模手当.md の 6-1。共通の決まりは 6-0）。
 *
 *   GET /api/allowances/items   全部の手当（sortOrder 順）。admin・manager
 *
 * 手当の行は、マイグレーションで作る（最初は「大規模手当」の1行）。画面からは増やさない・消さない（POST・DELETE は無い）。
 * 直せるのは、名前・説明・使う／使わない（PATCH /items/[id]）と、金額（POST /items/[id]/rates）。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { isAllowanceManager, todayJstDateKey } from '@/lib/allowances';
import { actorOf, loadAllowanceRatesByItemId } from '@/lib/allowancesServer';
import { NO_STORE } from '@/lib/allowancesReport';
import { toAllowanceItemResponse } from './_shared';

// 毎回サーバーで実行する（評価ポイントの route と同じ書き方）
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const actor = actorOf(session!);
        // 職長向けの手当の一覧は GET /day が返すので、ここは管理者・マネージャーだけ
        if (!isAllowanceManager(actor.role)) return errorResponse('権限がありません', 403);

        const rows = await prisma.allowanceItem.findMany({
            // sortOrder が同じ手当どうしは、作った順
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: {
                id: true, name: true, description: true, constructionContent: true, isActive: true, sortOrder: true,
                _count: { select: { records: true } },
            },
        });
        const ratesByItemId = await loadAllowanceRatesByItemId(rows.map((r) => r.id));
        const today = todayJstDateKey();

        // 応答は、手当の配列そのもの（評価ポイントの GET /items と同じ）
        return NextResponse.json(
            rows.map((r) => toAllowanceItemResponse(r, ratesByItemId.get(r.id) ?? [], r._count.records, today)),
            NO_STORE,
        );
    } catch (err) {
        return serverErrorResponse('手当の種類の取得', err);
    }
}
