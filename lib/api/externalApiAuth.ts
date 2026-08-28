import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * 外部システム（人事システム yushin-hr）からのサーバー間アクセスを認証する。
 *
 * ブラウザのセッションではなく共有シークレットで認証する。
 * `x-api-key` ヘッダーに `EXTERNAL_API_KEY` と同じ値を入れて呼ぶ。
 *
 * 注意:
 *   - EXTERNAL_API_KEY が未設定の環境では常に拒否する（既定で閉じる）。
 *     本番に環境変数を入れるまで外部からは一切読めない。
 *   - 比較は timingSafeEqual で行い、応答時間からキーを推測されないようにする。
 *   - このエンドポイントは社員の勤怠を返すため、CORS は開けない。
 *     ブラウザから直接呼ぶ用途はなく、サーバー間だけで使う。
 */
export function verifyExternalApiKey(req: NextRequest): NextResponse | null {
    const expected = process.env.EXTERNAL_API_KEY;

    if (!expected) {
        logger.error('[external-api] EXTERNAL_API_KEY が未設定のためアクセスを拒否しました');
        return NextResponse.json(
            { error: 'External API is not configured' },
            { status: 503, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    const provided = req.headers.get('x-api-key');
    if (!provided || !safeEqual(provided, expected)) {
        return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    return null;
}

/** 長さが違っても早期 return せずに比較する */
function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
        // 長さが違う場合も同じだけ時間を使ってから false を返す
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

/** 外部 API 共通のレスポンスヘッダー（キャッシュ禁止） */
export const EXTERNAL_API_HEADERS = { 'Cache-Control': 'no-store' } as const;
