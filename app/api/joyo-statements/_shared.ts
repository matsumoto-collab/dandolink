/**
 * 支払明細書 API の共通処理（権限チェック）。
 * route.ts ではないので Next.js のルートにはならない（同じ階層に置いて import するだけ）。
 */
import { NextResponse } from 'next/server';
import { errorResponse, requireAuth } from '@/lib/api/utils';

/**
 * 支払明細書は admin 専用（指示書 3-5）。
 *
 * 本番の User.role には大文字混在（'PARTNER' など）があるため、必ず小文字化して比較する。
 * `requireAdmin`（lib/api/utils）は大文字小文字をそのまま比較するのでここでは使わない。
 */
export async function requireJoyoAdmin() {
    const { session, error } = await requireAuth();
    if (error) return { session: null, error };

    const role = (session!.user.role ?? '').toString().toLowerCase();
    if (role !== 'admin') {
        return { session: null, error: errorResponse('管理者権限が必要です', 403) };
    }
    return { session, error: null };
}

/** 保存系（PUT / POST / PATCH / DELETE）の返り値は `{ ok: true, id }` だけ（画面は成功のたびに一覧を取り直す） */
export function okResponse(id: string) {
    return NextResponse.json({ ok: true, id }, { headers: { 'Cache-Control': 'no-store' } });
}
