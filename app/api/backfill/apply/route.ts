import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, serverErrorResponse } from '@/lib/api/utils';
import { applyPlan, preparePlan } from '@/lib/backfill/engine';
import { readBackfillUpload } from '@/lib/backfill/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 1 万行超の upsert を 1 トランザクションで流す。時間切れのときは scripts/import-backfill-csv.ts で取り込める
export const maxDuration = 300;

/**
 * 過去データ取込の本実行（管理者のみ）。
 * ドライランで返した hash を一緒に送ってもらい、同じファイルでなければ弾く（ドライランを必ず挟むため）。
 * 計画はここで作り直す（ドライラン後に DB が変わっていても、今の状態に対して正しく書くため）。
 */
export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAdmin();
        if (error) return error;

        const form = await request.formData();
        const expectedHash = form.get('hash');
        const upload = await readBackfillUpload(form);
        if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: 400 });

        const prepared = await preparePlan(prisma, upload.texts);
        if (typeof expectedHash !== 'string' || expectedHash !== prepared.summary.hash) {
            return NextResponse.json(
                { error: 'ドライランをしたファイルと中身が違います。もう一度ドライランをしてください' },
                { status: 400 },
            );
        }
        if (!prepared.summary.canApply) {
            return NextResponse.json({ error: 'エラーのある行があるため取り込めません' }, { status: 400 });
        }

        const result = await applyPlan(prisma, prepared, {
            userId: session!.user.id ?? null,
            userName: session!.user.name ?? '',
            fileNames: upload.fileNames,
        });
        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('過去データの取り込み', error);
    }
}
