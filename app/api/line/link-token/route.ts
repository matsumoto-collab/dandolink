import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    notFoundResponse,
    validationErrorResponse,
    serverErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import type { ContactPerson } from '@/types/customer';
import { generateLinkCode, applyContactLineUserId } from '@/lib/lineLink';

/**
 * 顧客担当者の LINE 連携コードの発行・状態取得・解除。
 * 顧客マスタの操作なので requireManagerOrAbove（admin/manager）で保護。
 */
export const runtime = 'nodejs';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

async function findContact(
    customerId: string,
    contactId: string
): Promise<ContactPerson | null> {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { contactPersons: true },
    });
    if (!customer) return null;
    const contacts = parseJsonField<ContactPerson[]>(customer.contactPersons, []);
    return contacts.find((c) => c.id === contactId) ?? null;
}

/** POST: 連携コードを発行する。 */
export async function POST(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => ({}));
        const customerId = typeof body?.customerId === 'string' ? body.customerId : '';
        const contactId = typeof body?.contactId === 'string' ? body.contactId : '';
        if (!customerId || !contactId) {
            return validationErrorResponse('customerId と contactId は必須です');
        }

        const contact = await findContact(customerId, contactId);
        if (!contact) return notFoundResponse('担当者');

        // 既存の pending を失効（最新コードのみ有効に）
        await prisma.lineLinkToken.updateMany({
            where: { customerId, contactId, status: 'pending' },
            data: { status: 'expired' },
        });

        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
        let code = '';
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = generateLinkCode();
            try {
                await prisma.lineLinkToken.create({
                    data: { code: candidate, customerId, contactId, status: 'pending', expiresAt },
                });
                code = candidate;
                break;
            } catch (e) {
                if (attempt === 4) throw e; // 5回連続衝突は異常
            }
        }

        return NextResponse.json(
            {
                code,
                addFriendUrl: process.env.LINE_OA_ADD_FRIEND_URL || null,
                expiresAt: expiresAt.toISOString(),
            },
            { headers: NO_STORE }
        );
    } catch (error) {
        return serverErrorResponse('LINE連携コードの発行', error);
    }
}

/** GET: 連携状態を返す（モーダルのポーリング用）。 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const customerId = searchParams.get('customerId') || '';
        const contactId = searchParams.get('contactId') || '';
        if (!customerId || !contactId) {
            return validationErrorResponse('customerId と contactId は必須です');
        }

        const contact = await findContact(customerId, contactId);
        if (!contact) return notFoundResponse('担当者');

        return NextResponse.json(
            {
                linked: !!contact.lineUserId,
                lineUserId: contact.lineUserId || null,
                lineLinkedAt: contact.lineLinkedAt || null,
            },
            { headers: NO_STORE }
        );
    } catch (error) {
        return serverErrorResponse('LINE連携状態の取得', error);
    }
}

/** DELETE: 連携を解除する。 */
export async function DELETE(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json().catch(() => ({}));
        const customerId = typeof body?.customerId === 'string' ? body.customerId : '';
        const contactId = typeof body?.contactId === 'string' ? body.contactId : '';
        if (!customerId || !contactId) {
            return validationErrorResponse('customerId と contactId は必須です');
        }

        await applyContactLineUserId(customerId, contactId, null);
        await prisma.lineLinkToken.updateMany({
            where: { customerId, contactId, status: { in: ['pending', 'linked'] } },
            data: { status: 'expired' },
        });

        return NextResponse.json({ ok: true }, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('LINE連携の解除', error);
    }
}
