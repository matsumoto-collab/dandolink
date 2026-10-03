import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { joyoContractorCreateSchema, type JoyoContractorCreatePayload } from '@/lib/validations/joyoStatement';
import {
    JoyoRejectError,
    isUniqueConstraintError,
    loadContractorDtos,
    payeeBankLabel,
    payeeHasAccount,
} from '@/lib/joyoStatementServer';
import type { JoyoContractorsResponse } from '@/types/joyoStatement';
import { okResponse, requireJoyoAdmin } from '../_shared';

export const dynamic = 'force-dynamic';

/** 対象者に選べるロール（小文字。本番には大文字が混じるので小文字にそろえてから比べる） */
const SELECTABLE_ROLES = new Set(['admin', 'manager', 'foreman1', 'foreman2', 'worker']);

/**
 * GET /api/joyo-statements/contractors
 * 設定画面用。対象者の全件（利用停止も含む）＋選択肢（ユーザー・振込先）を返す（admin 限定）。
 * 振込先は口座番号・名義そのものを返さない（有無と「銀行名 支店名」だけ）。
 */
export async function GET() {
    try {
        const { error } = await requireJoyoAdmin();
        if (error) return error;

        const [contractors, users, payees] = await Promise.all([
            prisma.joyoContractor.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
            prisma.user.findMany({
                where: { isActive: true },
                select: { id: true, displayName: true, role: true, dispatchSortOrder: true },
            }),
            prisma.payee.findMany({
                where: { isActive: true },
                orderBy: { name: 'asc' },
                select: { id: true, name: true, bankName: true, branchName: true, accountNumber: true },
            }),
        ]);

        const registered = new Set(contractors.map((c) => c.userId));
        const userOptions = users
            .filter((u) => SELECTABLE_ROLES.has((u.role ?? '').toLowerCase()) && !registered.has(u.id))
            // dispatchSortOrder → displayName の順（並び順が未設定の人は後ろ）
            .sort((a, b) => {
                const ao = a.dispatchSortOrder ?? Number.MAX_SAFE_INTEGER;
                const bo = b.dispatchSortOrder ?? Number.MAX_SAFE_INTEGER;
                if (ao !== bo) return ao - bo;
                return a.displayName.localeCompare(b.displayName, 'ja');
            })
            .map((u) => ({ id: u.id, displayName: u.displayName }));

        const body: JoyoContractorsResponse = {
            contractors: await loadContractorDtos(contractors),
            userOptions,
            payeeOptions: payees.map((p) => ({
                id: p.id,
                name: p.name,
                bankLabel: payeeBankLabel(p),
                hasAccount: payeeHasAccount(p),
            })),
        };
        return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('支払明細書の対象者の取得', error);
    }
}

/** 先に調べて断る条件を見たうえで、code＝今の最大 + 1 で対象者を作る */
async function createContractor(input: JoyoContractorCreatePayload, userId: string | null): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
    if (!user) throw new JoyoRejectError('選んだユーザーが見つかりません');

    // 一意制約に頼らず、先に調べて断る（指示書 6-2）
    const dup = await prisma.joyoContractor.findUnique({ where: { userId: input.userId }, select: { id: true } });
    if (dup) throw new JoyoRejectError('このユーザーは登録済みです');

    if (input.payeeId) {
        const payee = await prisma.payee.findUnique({ where: { id: input.payeeId }, select: { id: true } });
        if (!payee) throw new JoyoRejectError('選んだ振込先が見つかりません');
    }

    const last = await prisma.joyoContractor.findFirst({ orderBy: { code: 'desc' }, select: { code: true } });
    const code = (last?.code ?? 0) + 1;

    const created = await prisma.joyoContractor.create({
        data: {
            userId: input.userId,
            code,
            // 並び順を変える画面は作らないので、登録順（code と同じ値）
            sortOrder: code,
            recipientName: input.recipientName,
            honorific: input.honorific,
            postalCode: input.postalCode ?? null,
            address: input.address ?? null,
            registrationNumber: input.registrationNumber ?? null,
            unitPrice: input.unitPrice,
            payeeId: input.payeeId ?? null,
            notes: input.notes ?? null,
            updatedBy: userId,
        },
        select: { id: true },
    });
    return created.id;
}

/**
 * POST /api/joyo-statements/contractors
 * 対象者を足す（admin 限定）。同時に2人ぶん登録して code がぶつかったとき（一意制約のエラー）は、
 * 処理全体を最初から1回だけやり直す。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(joyoContractorCreateSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);

        const userId = session?.user?.id ?? null;
        let id: string;
        try {
            id = await createContractor(parsed.data, userId);
        } catch (e) {
            if (!isUniqueConstraintError(e)) throw e;
            id = await createContractor(parsed.data, userId);
        }
        return okResponse(id);
    } catch (error) {
        if (error instanceof JoyoRejectError) return errorResponse(error.message, 400);
        return serverErrorResponse('支払明細書の対象者の登録', error);
    }
}
