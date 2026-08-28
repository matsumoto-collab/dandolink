import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyExternalApiKey, EXTERNAL_API_HEADERS } from '@/lib/api/externalApiAuth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/external/users
 *
 * 人事システム（yushin-hr）が社員と DandoLink ユーザーを紐づけるための一覧。
 * 勤怠を引くには DandoLink 側の userId が必要で、その対応表を人事システムに
 * 持たせる。氏名の突き合わせは人が画面で行う想定。
 *
 * 返すのは id・表示名・在籍フラグだけ。メールアドレスや権限ロールなど、
 * 紐づけに要らない情報は渡さない。
 */
export async function GET(req: NextRequest) {
    const authError = verifyExternalApiKey(req);
    if (authError) return authError;

    try {
        const includeInactive =
            new URL(req.url).searchParams.get('includeInactive') === 'true';

        const users = await prisma.user.findMany({
            where: includeInactive ? {} : { isActive: true },
            select: { id: true, displayName: true, isActive: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json({ users }, { headers: EXTERNAL_API_HEADERS });
    } catch (e) {
        logger.error('[external-api/users] 取得に失敗', e);
        return NextResponse.json(
            { error: 'ユーザー一覧の取得に失敗しました' },
            { status: 500, headers: EXTERNAL_API_HEADERS }
        );
    }
}
