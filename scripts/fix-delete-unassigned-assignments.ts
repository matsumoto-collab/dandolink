/**
 * assignedEmployeeId='unassigned'（職長未割当）の孤児配置を削除する。
 * 作業履歴で「不明」と表示され、カレンダーに描画されないため UI から消せない（kei報告 2026-06-11）。
 *
 * 安全策:
 * - 既定はドライラン。`--apply` を付けたときだけ削除を実行する
 * - 日報明細が紐づく配置・手配確定済みの配置は対象外（原価データ保護。該当したら警告してスキップ）
 * - 削除前に DeletedAssignmentLog へ既存の削除API（app/api/assignments/[id]/route.ts DELETE）と
 *   同形式のスナップショットを控える → 誤削除でも履歴パネルから復元可能
 *
 *   ドライラン: npx tsx scripts/fix-delete-unassigned-assignments.ts
 *   実行:       npx tsx scripts/fix-delete-unassigned-assignments.ts --apply
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

function jstKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function parseJsonArray(value: string | null): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function main() {
    console.log(`モード: ${APPLY ? '★ 実行（削除します）' : 'ドライラン（--apply で実行）'}\n`);

    const targets = await prisma.projectAssignment.findMany({
        where: { assignedEmployeeId: 'unassigned' },
        include: {
            projectMaster: { select: { title: true } },
            dailyReportWorkItems: { select: { id: true } },
        },
        orderBy: { date: 'asc' },
    });

    if (targets.length === 0) {
        console.log('対象なし（assignedEmployeeId=unassigned の配置はありません）');
        return;
    }

    // 控えの deletedById は実在の admin ユーザーを使う（履歴パネルでの名前解決のため）
    // 教訓: DBの role 生値は大文字混在があるため insensitive で比較する
    const adminUser = await prisma.user.findFirst({
        where: { role: { equals: 'admin', mode: 'insensitive' }, isActive: true },
        select: { id: true, displayName: true },
        orderBy: { createdAt: 'asc' },
    });
    if (!adminUser) throw new Error('admin ユーザーが見つかりません（deletedById に必要）');
    console.log(`控えの deletedById: ${adminUser.displayName}（${adminUser.id}）\n`);

    let deleted = 0;
    let skipped = 0;

    for (const a of targets) {
        const label = `${jstKey(a.date)} / ${a.projectMaster?.title ?? '(案件なし)'} / 人数=${a.memberCount} / 配置ID=${a.id}`;

        // 原価・日報データが紐づくものは安全のため手動判断に回す
        if (a.dailyReportWorkItems.length > 0 || a.isDispatchConfirmed) {
            console.log(`⚠️ スキップ（日報明細${a.dailyReportWorkItems.length}件 / 確定=${a.isDispatchConfirmed}）: ${label}`);
            skipped++;
            continue;
        }

        if (!APPLY) {
            console.log(`[ドライラン] 削除予定: ${label}`);
            deleted++;
            continue;
        }

        // 既存 DELETE API と同形式のスナップショットを控えてから削除
        const snapshot = {
            assignedEmployeeId: a.assignedEmployeeId,
            date: a.date.toISOString(),
            memberCount: a.memberCount,
            workers: parseJsonArray(a.workers),
            vehicles: parseJsonArray(a.vehicles),
            meetingTime: a.meetingTime,
            sortOrder: a.sortOrder,
            remarks: a.remarks,
            dispatchRemark: a.dispatchRemark,
            constructionType: a.constructionType,
            estimatedHours: a.estimatedHours,
            isDispatchConfirmed: a.isDispatchConfirmed,
            confirmedWorkerIds: parseJsonArray(a.confirmedWorkerIds),
            confirmedVehicleIds: parseJsonArray(a.confirmedVehicleIds),
        };

        await prisma.$transaction([
            prisma.deletedAssignmentLog.create({
                data: {
                    assignmentId: a.id,
                    projectMasterId: a.projectMasterId,
                    snapshot: JSON.stringify(snapshot),
                    deletedById: adminUser.id,
                },
            }),
            prisma.projectAssignment.delete({ where: { id: a.id } }),
        ]);
        console.log(`✅ 削除（控え保存済み）: ${label}`);
        deleted++;
    }

    console.log(`\n結果: ${APPLY ? '削除' : '削除予定'} ${deleted}件 / スキップ ${skipped}件`);
    if (!APPLY && deleted > 0) {
        console.log('実行するには --apply を付けて再実行してください。');
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
