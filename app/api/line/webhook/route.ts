import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyLineSignature, replyLineMessage } from '@/lib/line';
import { applyContactLineUserId } from '@/lib/lineLink';

/**
 * LINE Messaging API の Webhook 受信口。
 * - middleware の認証除外に含めること（NextAuth トークンを持たないため）。
 * - セキュリティは x-line-signature 署名検証で担保する。
 * - follow: 案内返信 / message(text): 連携コード照合→lineUserId確定 / unfollow: 連携解除。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 連携コードらしい文字列のみコードとして扱う（雑談メッセージへの誤反応を防ぐ）。
const CODE_RE = /^[A-Z0-9]{4,12}$/;

interface LineEvent {
    type?: string;
    replyToken?: string;
    source?: { userId?: string };
    message?: { type?: string; text?: string };
}

export async function POST(req: NextRequest) {
    const raw = await req.text();
    const signature = req.headers.get('x-line-signature');
    if (!verifyLineSignature(raw, signature)) {
        return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }

    let body: { events?: LineEvent[] };
    try {
        body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ ok: true }); // 検証イベント等で本文が空でも200
    }

    const events = Array.isArray(body?.events) ? body.events : [];
    for (const ev of events) {
        try {
            await handleEvent(ev);
        } catch (e) {
            // 1イベントの失敗で全体を落とさない（LINEの再送を避けるため200を返す）
            logger.error('[LINE webhook] event handling failed', e);
        }
    }
    return NextResponse.json({ ok: true });
}

async function handleEvent(ev: LineEvent): Promise<void> {
    const userId = ev?.source?.userId;
    const replyToken = ev?.replyToken;

    if (ev?.type === 'follow') {
        if (replyToken) {
            await replyLineMessage(replyToken, [
                {
                    type: 'text',
                    text: '友だち追加ありがとうございます。\n担当者からお伝えした「連携コード」をこのトークに送信してください。',
                },
            ]);
        }
        return;
    }

    if (ev?.type === 'unfollow') {
        if (userId) {
            const tok = await prisma.lineLinkToken.findFirst({
                where: { lineUserId: userId, status: 'linked' },
            });
            if (tok) {
                await applyContactLineUserId(tok.customerId, tok.contactId, null);
                await prisma.lineLinkToken.updateMany({
                    where: { lineUserId: userId, status: 'linked' },
                    data: { status: 'expired' },
                });
            }
        }
        return;
    }

    if (ev?.type === 'message' && ev?.message?.type === 'text') {
        const code = String(ev.message.text ?? '').trim().toUpperCase().replace(/\s+/g, '');
        if (!CODE_RE.test(code)) return; // コードらしくないメッセージは無視
        if (!userId) return;

        const now = new Date();
        const token = await prisma.lineLinkToken.findFirst({
            where: { code, status: 'pending', expiresAt: { gt: now } },
        });

        if (!token) {
            if (replyToken) {
                await replyLineMessage(replyToken, [
                    {
                        type: 'text',
                        text: 'コードが確認できませんでした。有効期限切れの可能性があります。\nお手数ですが担当者へご確認ください。',
                    },
                ]);
            }
            return;
        }

        const found = await applyContactLineUserId(token.customerId, token.contactId, userId);
        await prisma.lineLinkToken.update({
            where: { id: token.id },
            data: { status: 'linked', lineUserId: userId, linkedAt: now },
        });

        if (replyToken) {
            await replyLineMessage(replyToken, [
                {
                    type: 'text',
                    text: found
                        ? '連携が完了しました。\n今後、工事の完了をこちらでお知らせします。'
                        : '連携処理を受け付けましたが、担当者情報が見つかりませんでした。担当者へご確認ください。',
                },
            ]);
        }
        return;
    }
}
