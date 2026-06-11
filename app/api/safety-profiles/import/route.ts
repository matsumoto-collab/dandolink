import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';
import { safetyImportSchema } from '@/lib/validations/safety';

/**
 * Excelインポート（FR-5）。
 * ファイルは受けない — クライアントが SheetJS でパース・列マッピングした
 * 構造化JSONのみを受ける（攻撃面の縮小。FR-5-2）。
 * §7.4 の禁止項目はスキーマにフィールド自体が無く、.strict() で未知キーも 400。
 *
 * 行ごとの action:
 * - create-worker: Worker（職方）を新規作成してプロフィールを紐付け
 * - update:        既存の Worker / User のプロフィールを upsert
 */
export async function POST(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const parsed = safetyImportSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const { rows } = parsed.data;

        // update 行の対象存在を事前検証（トランザクション内で途中失敗させない）
        const targetWorkerIds = rows
            .filter((r) => r.action === 'update' && r.targetSource === 'worker')
            .map((r) => r.targetId!);
        const targetUserIds = rows
            .filter((r) => r.action === 'update' && r.targetSource === 'user')
            .map((r) => r.targetId!);

        const [existingWorkers, existingUsers] = await Promise.all([
            targetWorkerIds.length
                ? prisma.worker.findMany({ where: { id: { in: targetWorkerIds } }, select: { id: true } })
                : Promise.resolve([]),
            targetUserIds.length
                ? prisma.user.findMany({ where: { id: { in: targetUserIds } }, select: { id: true } })
                : Promise.resolve([]),
        ]);
        const workerIdSet = new Set(existingWorkers.map((w) => w.id));
        const userIdSet = new Set(existingUsers.map((u) => u.id));

        const missing = rows.filter(
            (r) =>
                r.action === 'update' &&
                (r.targetSource === 'worker' ? !workerIdSet.has(r.targetId!) : !userIdSet.has(r.targetId!))
        );
        if (missing.length > 0) {
            return validationErrorResponse(
                `取込対象が見つかりません: ${missing.map((r) => r.name).join(', ')}`
            );
        }

        let created = 0;
        let updated = 0;

        await prisma.$transaction(
            async (tx) => {
                for (const row of rows) {
                    if (row.action === 'create-worker') {
                        const worker = await tx.worker.create({ data: { name: row.name } });
                        await tx.workerSafetyProfile.create({
                            data: { ...row.profile, workerId: worker.id },
                        });
                        created++;
                    } else {
                        const where =
                            row.targetSource === 'worker'
                                ? { workerId: row.targetId! }
                                : { userId: row.targetId! };
                        await tx.workerSafetyProfile.upsert({
                            where,
                            create: { ...row.profile, ...where },
                            update: row.profile,
                        });
                        updated++;
                    }
                }
            },
            { timeout: 60000 }
        );

        return NextResponse.json(
            { created, updated },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('安全プロフィール取込', error);
    }
}
