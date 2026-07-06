/**
 * 協力業者出来高→外注費反映（2026-07 改修）の移行バックフィル
 *
 * これまで「出来高で決めた金額を利益サマリーの外注費・手入力分へ転記する」運用だったため、
 * 出来高の自動反映を有効化すると転記済み手入力分と二重計上になる。
 * このスクリプトは、出来高の保存行（確定金額を持つ生きた行）と
 * 「日付＋金額（＋会社名があれば会社名も）」が一致する手入力明細（manualCostItems.subcontractor）だけを削除する。
 *
 * 使い方:
 *   npx tsx scripts/backfill-remove-volume-duplicated-manual-costs.ts           ← dry-run（書き込みなし）
 *   npx tsx scripts/backfill-remove-volume-duplicated-manual-costs.ts --apply   ← 実際に削除
 *
 * 安全策:
 * - 原価エンジンと同じ残骸ガード（行の会社≠配置の現職長 / 職長が協力業者でない行は反映されない）を適用し、
 *   原価に反映されない行にマッチする手入力は削除しない。
 * - 削除済み（deletedAt）出来高行にマッチする手入力も削除しない（出来高0円＋手入力の組み合わせを維持）。
 * - 1つの出来高行につき手入力明細1件だけをマッチさせる（同日同額の明細が複数ある場合は行数分だけ）。
 * - 旧スカラー（subcontractorExpense のみ・明細なし）の案件は判別不能のためスキップして警告表示。
 */

// ローカル .env は本番DB(セッションモード・接続15上限)直指しのため、単発スクリプトは接続1本に制限する
const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const APPLY = process.argv.includes('--apply');

interface ManualItem { label: string; amount: number }

function jstDateKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// 摘要から「M/D」を抽出して 'MM-DD' 形式へ（例: 「5/26　組立　龍成工業」→ '05-26'）
function labelDateKey(label: string): string | null {
    const m = label.match(/(\d{1,2})\/(\d{1,2})/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function main() {
    const { prisma } = await import('../lib/prisma');
    try {
        // 確定金額を持つ生きた出来高行（配置由来）
        const volRows = await prisma.partnerWorkVolume.findMany({
            where: {
                projectMasterId: { not: null },
                sourceAssignmentId: { not: null },
                rowType: { in: ['work', 'transport'] },
                deletedAt: null,
                OR: [{ amountOverridden: true }, { amount: { not: 0 } }],
            },
            select: {
                id: true, projectMasterId: true, sourceAssignmentId: true, rowType: true,
                amount: true, date: true, partnerCompanyId: true,
            },
        });
        const pids = [...new Set(volRows.map((r) => r.projectMasterId as string))];
        if (pids.length === 0) {
            console.log('対象なし');
            return;
        }

        const [pms, users] = await Promise.all([
            prisma.projectMaster.findMany({
                where: { id: { in: pids } },
                select: {
                    id: true, title: true, manualCostItems: true, subcontractorExpense: true,
                    assignments: { select: { id: true, assignedEmployeeId: true } },
                },
            }),
            prisma.user.findMany({ select: { id: true, displayName: true, role: true } }),
        ]);
        const partnerIds = new Set(users.filter((u) => (u.role ?? '').toLowerCase() === 'partner').map((u) => u.id));

        let totalRemoved = 0;
        let totalRemovedAmount = 0;
        let applied = 0;
        const skippedLegacy: string[] = [];

        for (const pm of pms) {
            const foremanByAssignment = new Map(pm.assignments.map((a) => [a.id, a.assignedEmployeeId]));
            // 原価エンジンが実際に反映する行（残骸ガード後）だけをマッチ対象にする
            const liveRows = volRows.filter((r) => {
                if (r.projectMasterId !== pm.id) return false;
                const foreman = foremanByAssignment.get(r.sourceAssignmentId as string);
                return !!foreman && partnerIds.has(foreman) && foreman === r.partnerCompanyId;
            });
            if (liveRows.length === 0) continue;

            const manualObj: Record<string, unknown> =
                (pm.manualCostItems && typeof pm.manualCostItems === 'object' && !Array.isArray(pm.manualCostItems))
                    ? { ...(pm.manualCostItems as Record<string, unknown>) } : {};
            const rawItems = manualObj['subcontractor'];
            if (!Array.isArray(rawItems)) {
                if (Number(pm.subcontractorExpense || 0) > 0) {
                    skippedLegacy.push(`${pm.title}: 旧手入力(明細なし) ¥${Number(pm.subcontractorExpense).toLocaleString()} — 手動確認が必要`);
                }
                continue;
            }
            const items: ManualItem[] = rawItems.map((it) => ({
                label: String((it as { label?: unknown })?.label ?? ''),
                amount: Number((it as { amount?: unknown })?.amount) || 0,
            }));

            // マッチング: 行ごとに「金額一致＋摘要の日付一致＋（摘要に会社名表記があれば）会社名一致」の明細を1件消費
            const removedIdx = new Set<number>();
            for (const row of liveRows) {
                const rowDateMd = jstDateKey(row.date).slice(5); // 'MM-DD'
                for (let i = 0; i < items.length; i++) {
                    if (removedIdx.has(i)) continue;
                    const it = items[i];
                    if (it.amount !== row.amount) continue;
                    if (labelDateKey(it.label) !== rowDateMd) continue;
                    // 摘要に何らかの協力会社名が含まれる場合は、この行の会社名と一致するときだけマッチ
                    const namedOther = users.some((u) =>
                        partnerIds.has(u.id) && u.displayName && it.label.includes(u.displayName) && u.id !== row.partnerCompanyId);
                    if (namedOther) continue;
                    removedIdx.add(i);
                    break;
                }
            }
            if (removedIdx.size === 0) continue;

            const removed = items.filter((_, i) => removedIdx.has(i));
            const kept = items.filter((_, i) => !removedIdx.has(i));
            const removedSum = removed.reduce((s, it) => s + it.amount, 0);
            totalRemoved += removed.length;
            totalRemovedAmount += removedSum;

            console.log(`\n${pm.title}`);
            for (const it of removed) console.log(`  削除: ${it.label || '(摘要なし)'} ¥${it.amount.toLocaleString()}`);
            for (const it of kept) if (it.label || it.amount) console.log(`  残す: ${it.label || '(摘要なし)'} ¥${it.amount.toLocaleString()}`);

            if (APPLY) {
                manualObj['subcontractor'] = kept;
                await prisma.projectMaster.update({
                    where: { id: pm.id },
                    data: { manualCostItems: manualObj as object },
                });
                applied++;
            }
        }

        console.log(`\n==== ${APPLY ? '適用結果' : 'dry-run（書き込みなし・--apply で適用）'} ====`);
        console.log(`削除対象の手入力明細: ${totalRemoved}件 / 合計 ¥${totalRemovedAmount.toLocaleString()}${APPLY ? ` / 更新した案件 ${applied}件` : ''}`);
        if (skippedLegacy.length > 0) {
            console.log('\n[警告] 旧形式の手入力（明細なし）のためスキップした案件:');
            for (const s of skippedLegacy) console.log(`  ${s}`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
