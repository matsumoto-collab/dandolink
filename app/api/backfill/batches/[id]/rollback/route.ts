import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, serverErrorResponse } from '@/lib/api/utils';
import { previewRollback, rollbackBatch } from '@/lib/backfill/engine';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** 取り消したときに消える件数（管理者のみ・書き込まない） */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { error } = await requireAdmin();
        if (error) return error;
        const { id } = await params;
        return NextResponse.json(await previewRollback(prisma, id), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('取り消しの確認', error);
    }
}

/** バッチ単位の取り消し（管理者のみ） */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;
        const { id } = await params;
        const deleted = await rollbackBatch(prisma, id, session!.user.id ?? null);
        return NextResponse.json({ success: true, deleted });
    } catch (error) {
        return serverErrorResponse('過去データの取り消し', error);
    }
}
