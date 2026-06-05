import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { parseJsonField, stringifyJsonField } from '@/lib/json-utils';
import type { ContactPerson } from '@/types/customer';

/**
 * LINE 連携のドメインヘルパー（サーバー専用）。
 * 連携コード生成と、Customer.contactPersons(JSON) 内の担当者への lineUserId 設定/解除。
 */

// 紛らわしい文字（I/O/0/1）を除いた英数字。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** 顧客に提示する一意な連携コードを生成する（重複可能性は呼び出し側の @unique で担保）。 */
export function generateLinkCode(): string {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    }
    return out;
}

/**
 * 顧客の contactPersons JSON 内の該当担当者へ lineUserId を設定（解除は null）。
 * 見つかって更新できたら true。webhook（連携確定/unfollow）と解除APIから使う。
 */
export async function applyContactLineUserId(
    customerId: string,
    contactId: string,
    lineUserId: string | null
): Promise<boolean> {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { contactPersons: true },
    });
    if (!customer) return false;

    const contacts = parseJsonField<ContactPerson[]>(customer.contactPersons, []);
    let found = false;
    const next = contacts.map((c) => {
        if (c.id !== contactId) return c;
        found = true;
        if (lineUserId) {
            return { ...c, lineUserId, lineLinkedAt: new Date().toISOString() };
        }
        // 解除: lineUserId / lineLinkedAt を除去
        const { lineUserId: _u, lineLinkedAt: _l, ...rest } = c;
        return rest;
    });
    if (!found) return false;

    await prisma.customer.update({
        where: { id: customerId },
        data: { contactPersons: stringifyJsonField(next) },
    });
    return true;
}
