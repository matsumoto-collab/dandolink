import crypto from 'crypto';
import { logger } from '@/lib/logger';

/**
 * LINE Messaging API クライアント（サーバー専用）。
 * - 署名検証（Webhook）
 * - reply / push 送信
 * 認証情報は env: LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN。
 */

const LINE_MESSAGING_BASE = 'https://api.line.me/v2/bot';

export type LineMessage =
    | { type: 'text'; text: string }
    | { type: 'image'; originalContentUrl: string; previewImageUrl: string };

/**
 * Webhook の x-line-signature を検証する。
 * HMAC-SHA256(channelSecret, rawBody) の base64 と一致するか（タイミング安全比較）。
 */
export function verifyLineSignature(rawBody: string, signature: string | null | undefined): boolean {
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!secret || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

function accessToken(): string | null {
    return process.env.LINE_CHANNEL_ACCESS_TOKEN || null;
}

/** 返信メッセージを送る（replyToken は受信から約1分間有効）。 */
export async function replyLineMessage(replyToken: string, messages: LineMessage[]): Promise<boolean> {
    const token = accessToken();
    if (!token) {
        logger.error('[LINE] reply skipped: LINE_CHANNEL_ACCESS_TOKEN 未設定');
        return false;
    }
    try {
        const res = await fetch(`${LINE_MESSAGING_BASE}/message/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ replyToken, messages }),
        });
        if (!res.ok) {
            logger.error('[LINE] reply failed', { status: res.status, body: await res.text().catch(() => '') });
            return false;
        }
        return true;
    } catch (e) {
        logger.error('[LINE] reply error', e);
        return false;
    }
}

/** プッシュメッセージを送る（to = 相手の lineUserId）。 */
export async function pushLineMessage(
    to: string,
    messages: LineMessage[]
): Promise<{ ok: boolean; status: number; error?: string }> {
    const token = accessToken();
    if (!token) return { ok: false, status: 0, error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' };
    try {
        const res = await fetch(`${LINE_MESSAGING_BASE}/message/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ to, messages }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            logger.error('[LINE] push failed', { status: res.status, body });
            return { ok: false, status: res.status, error: body };
        }
        return { ok: true, status: res.status };
    } catch (e) {
        logger.error('[LINE] push error', e);
        return { ok: false, status: 0, error: String(e) };
    }
}
