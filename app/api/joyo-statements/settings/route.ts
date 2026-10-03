import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { validateRequest } from '@/lib/validations/common';
import { joyoSettingsSchema } from '@/lib/validations/joyoStatement';
import { JOYO_SETTINGS_ID } from '@/lib/joyoStatementServer';
import { okResponse, requireJoyoAdmin } from '../_shared';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/joyo-statements/settings
 * 書類の名前・下の注意書きを保存する（id='default' の1行に upsert。admin 限定）。
 * 発行済みの明細は発行時の写し（issuedSnapshot）を使うので、ここを変えても影響しない。
 */
export async function PUT(req: NextRequest) {
    try {
        const { session, error } = await requireJoyoAdmin();
        if (error) return error;

        const body = await req.json().catch(() => null);
        const parsed = validateRequest(joyoSettingsSchema, body);
        if (!parsed.success) return validationErrorResponse(parsed.error, parsed.details);
        const { title, footerNote } = parsed.data;
        const updatedBy = session?.user?.id ?? null;

        const saved = await prisma.joyoStatementSettings.upsert({
            where: { id: JOYO_SETTINGS_ID },
            create: { id: JOYO_SETTINGS_ID, title, footerNote, updatedBy },
            update: { title, footerNote, updatedBy },
            select: { id: true },
        });
        return okResponse(saved.id);
    } catch (error) {
        return serverErrorResponse('支払明細書の設定の保存', error);
    }
}
