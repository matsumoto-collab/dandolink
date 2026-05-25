/**
 * 【車両引き継ぎ通知】既存の確定済み手配から「いまあるべき引き継ぎペア」を
 * VehicleHandoverNotice 表に投入するバックフィルスクリプト（一回限り）。
 *
 * 背景:
 *   2026-05-23 リリースの車両引き継ぎ通知（app/api/push/notify-vehicle-handover）は、
 *   呼び出しのたびに「いまあるべきペア集合」を全 confirmed assignment から再構築し、
 *   VehicleHandoverNotice の既存有効レコードとの差分で added/removed を判定する。
 *   リリース時にテーブルが空のため、最初の手配確定操作で過去30日分のペアが全部
 *   "added" と判定され、過去確定分まで通知が送られてしまった。
 *   このスクリプトで「すでに送ったことにする」種ペアを埋めて初期状態を整える。
 *
 * 何をするか:
 *   - すべての isDispatchConfirmed = true の手配を読み込む
 *   - lib/vehicleHandoverDiff の buildDesiredHandoverPairs と同じロジックで
 *     「いまあるべきペア集合」を構築
 *   - 既存の有効レコード（canceledAt = null）と突合し、欠けているペアだけを
 *     notifiedUserIds = '[]' で投入する（受信者ゼロ＝今後の追加通知は走らない）
 *   - 取り消しなどの操作は行わない
 *
 * 実行（本番に当てる前に必ずドライランで件数を確認すること）:
 *   ドライラン: DIRECT_URL="postgres://..." npx tsx scripts/backfill-vehicle-handover-notices.ts
 *   実適用     : DIRECT_URL="postgres://..." npx tsx scripts/backfill-vehicle-handover-notices.ts --apply
 *
 * 冪等性:
 *   既に同一 (vehicleId, fromAssignmentId, toAssignmentId) のレコード（canceledAt = null）が
 *   ある場合は INSERT しない。何度実行しても重複を作らない。
 */

import { PrismaClient } from '@prisma/client';
import { buildDesiredHandoverPairs, type TargetInfo } from '../lib/vehicleHandoverDiff';
import type { VehicleUsage } from '../lib/vehicleHandover';
import { parseJsonField } from '../lib/json-utils';

const prisma = new PrismaClient();

const SEARCH_RANGE_DAYS = 30;
const DRY_RUN = !process.argv.includes('--apply');

function dateKeyJst(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Tokyo',
    }).format(d);
}

function parseStringArray(value: string | null | undefined): string[] {
    const v = parseJsonField<unknown>(value, null);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

async function main() {
    console.log(`[backfill-vehicle-handover-notices] mode = ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);

    const confirmed = await prisma.projectAssignment.findMany({
        where: { isDispatchConfirmed: true },
        select: {
            id: true,
            assignedEmployeeId: true,
            date: true,
            confirmedVehicleIds: true,
            confirmedWorkerIds: true,
        },
    });
    console.log(`confirmed assignments: ${confirmed.length}`);

    const allUsages: VehicleUsage[] = [];
    const workersByAssignment = new Map<string, string[]>();
    const targets: TargetInfo[] = [];

    for (const a of confirmed) {
        workersByAssignment.set(a.id, parseStringArray(a.confirmedWorkerIds));
        const vehicleIds = parseStringArray(a.confirmedVehicleIds);
        if (vehicleIds.length === 0) continue;

        const dateKey = dateKeyJst(a.date);
        for (const v of vehicleIds) {
            allUsages.push({
                assignmentId: a.id,
                teamId: a.assignedEmployeeId,
                dateKey,
                vehicleId: v,
            });
        }
        targets.push({
            assignmentId: a.id,
            teamId: a.assignedEmployeeId,
            dateKey,
            vehicleIds,
        });
    }
    console.log(`vehicle usages: ${allUsages.length}, targets: ${targets.length}`);

    const desired = buildDesiredHandoverPairs(targets, allUsages, workersByAssignment, {
        searchRangeDays: SEARCH_RANGE_DAYS,
    });
    console.log(`desired pairs (current truth): ${desired.length}`);

    const existing = await prisma.vehicleHandoverNotice.findMany({
        where: { canceledAt: null },
        select: { vehicleId: true, fromAssignmentId: true, toAssignmentId: true },
    });
    const existingKey = (r: { vehicleId: string; fromAssignmentId: string; toAssignmentId: string }) =>
        `${r.vehicleId}|${r.fromAssignmentId}|${r.toAssignmentId}`;
    const existingSet = new Set(existing.map(existingKey));
    console.log(`existing active rows: ${existing.length}`);

    const toInsert = desired.filter(p => !existingSet.has(existingKey(p)));
    console.log(`rows to insert: ${toInsert.length}`);

    if (toInsert.length === 0) {
        console.log('no rows to insert. done.');
        return;
    }

    if (DRY_RUN) {
        const sample = toInsert.slice(0, 10);
        console.log(`--- DRY RUN: first ${sample.length} rows ---`);
        for (const p of sample) {
            console.log(
                `  vehicle=${p.vehicleId} from=${p.fromAssignmentId} to=${p.toAssignmentId}`,
            );
        }
        console.log('[DRY RUN] no rows inserted. Re-run with --apply to commit.');
        return;
    }

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
        const slice = toInsert.slice(i, i + BATCH);
        const result = await prisma.vehicleHandoverNotice.createMany({
            data: slice.map(p => ({
                vehicleId: p.vehicleId,
                fromAssignmentId: p.fromAssignmentId,
                toAssignmentId: p.toAssignmentId,
                notifiedUserIds: JSON.stringify([]),
            })),
        });
        inserted += result.count;
        console.log(`inserted ${inserted}/${toInsert.length}`);
    }
    console.log(`done. total inserted: ${inserted}`);
}

main()
    .catch(e => {
        console.error('[backfill-vehicle-handover-notices] failed:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
