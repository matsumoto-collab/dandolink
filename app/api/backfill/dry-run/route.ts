import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, serverErrorResponse } from '@/lib/api/utils';
import { preparePlan } from '@/lib/backfill/engine';
import { readBackfillUpload } from '@/lib/backfill/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * 過去データ取込のドライラン（管理者のみ）。4 ファイルを受け取り、件数・金額・期別・エラー行を返す。
 * DB には書き込まない。本実行はここで返した hash と同じファイルでしか通さない。
 */
export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;

        const upload = await readBackfillUpload(await request.formData());
        if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: 400 });

        const prepared = await preparePlan(prisma, upload.texts);
        return NextResponse.json(prepared.summary, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('過去データのドライラン', error);
    }
}
