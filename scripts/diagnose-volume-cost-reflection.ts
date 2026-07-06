/**
 * 協力業者出来高→外注費反映（2026-07 改修）の影響調査スクリプト（読み取り専用）
 *
 * 出来高画面で保存された行（金額編集・削除・完了保存）を外注費へ反映する改修により、
 * 「外注費（=利益サマリーの原価）が現状から変わる案件」を新旧ロジックの比較で一覧する。
 *
 * 使い方:
 *   npx tsx scripts/diagnose-volume-cost-reflection.ts
 *
 * 旧ロジック値は partnerWorkVolume.findMany を一時的に空返しへ差し替えて算出する
 * （改修前のエンジンは出来高を参照しないため等価）。DBへの書き込みは一切行わない。
 */

export {}; // モジュール化（他スクリプトとのトップレベル変数衝突を防ぐ）

// ローカル .env は本番DB(セッションモード・接続15上限)直指しのため、単発スクリプトは接続1本に制限する
const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
// prisma のクエリログ(development時)を抑止
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

async function main() {
    const { prisma } = await import('../lib/prisma');
    const { computeProjectCosts } = await import('../lib/projectCost');

    try {
        // 影響しうる出来高行 = 配置由来(work/transport)で「削除済み or 金額の明示編集 or 金額あり」の保存行
        const rows = await prisma.partnerWorkVolume.findMany({
            where: {
                projectMasterId: { not: null },
                sourceAssignmentId: { not: null },
                rowType: { in: ['work', 'transport'] },
                OR: [
                    { deletedAt: { not: null } },
                    { amountOverridden: true },
                    { amount: { not: 0 } },
                ],
            },
            select: { projectMasterId: true, deletedAt: true, amountOverridden: true },
        });
        const pids = [...new Set(rows.map((r) => r.projectMasterId as string))];
        console.log(
            `影響しうる保存済み出来高行: ${rows.length}行 / ${pids.length}案件` +
            `（うち削除行 ${rows.filter((r) => r.deletedAt).length}・金額の明示編集 ${rows.filter((r) => r.amountOverridden).length}）`
        );
        if (pids.length === 0) {
            console.log('対象なし: 本改修で金額の変わる案件はありません。');
            return;
        }

        // 新ロジック（出来高反映あり）
        const newMap = await computeProjectCosts(pids);

        // 旧ロジック相当（出来高行を見せない）
        const volDelegate = prisma.partnerWorkVolume as unknown as { findMany: (...args: unknown[]) => Promise<unknown[]> };
        const origFindMany = volDelegate.findMany.bind(prisma.partnerWorkVolume);
        volDelegate.findMany = async () => [];
        const oldMap = await computeProjectCosts(pids);
        volDelegate.findMany = origFindMany;

        const pms = await prisma.projectMaster.findMany({
            where: { id: { in: pids } },
            select: { id: true, title: true, subcontractorExpense: true, manualCostItems: true, subcontractorCosts: { select: { constructionTypeId: true } } },
        });
        const pmById = new Map(pms.map((p) => [p.id, p]));
        // 外注費の手入力分（manualCostItems.subcontractor があればその合計、なければ旧スカラー subcontractorExpense）
        const manualSubOf = (p: (typeof pms)[number] | undefined): { sum: number; labels: string[] } => {
            if (!p) return { sum: 0, labels: [] };
            const obj = (p.manualCostItems && typeof p.manualCostItems === 'object' && !Array.isArray(p.manualCostItems))
                ? (p.manualCostItems as Record<string, unknown>) : {};
            const raw = obj['subcontractor'];
            if (Array.isArray(raw)) {
                const items = raw.map((it) => ({ label: String((it as { label?: unknown })?.label ?? ''), amount: Number((it as { amount?: unknown })?.amount) || 0 }));
                return { sum: items.reduce((s, it) => s + it.amount, 0), labels: items.filter((it) => it.label || it.amount).map((it) => `${it.label || '(摘要なし)'}:¥${it.amount.toLocaleString()}`) };
            }
            const legacy = Number(p.subcontractorExpense || 0);
            return { sum: legacy, labels: legacy > 0 ? [`(旧手入力):¥${legacy.toLocaleString()}`] : [] };
        };

        let changed = 0;
        let totalDiff = 0;
        let doubleCount = 0;
        const lines: string[] = [];
        for (const pid of pids) {
            const oldCost = oldMap.get(pid)?.breakdown.subcontractorCost ?? 0;
            const newCost = newMap.get(pid)?.breakdown.subcontractorCost ?? 0;
            if (oldCost === newCost) continue;
            changed++;
            const diff = newCost - oldCost;
            totalDiff += diff;
            const pm = pmById.get(pid);
            const manual = manualSubOf(pm);
            const hasRates = (pm?.subcontractorCosts.length ?? 0) > 0;
            // 増加分が手入力分と一致 = 手入力が出来高の代替だった疑い（手入力を消せば従来と同じ数字に戻る）
            const isDoubleSuspect = manual.sum > 0 && diff === manual.sum;
            if (isDoubleSuspect) doubleCount++;
            lines.push(
                `  ${pm?.title ?? pid}: ¥${oldCost.toLocaleString()} → ¥${newCost.toLocaleString()}` +
                ` (${diff >= 0 ? '+' : ''}¥${diff.toLocaleString()})` +
                ` | 手入力分=¥${manual.sum.toLocaleString()} 予定単価=${hasRates ? 'あり' : 'なし'}` +
                (isDoubleSuspect ? ' ★手入力と二重の疑い' : '') +
                (manual.labels.length > 0 ? `\n      手入力明細: ${manual.labels.join(' / ')}` : '')
            );
        }
        lines.sort();

        console.log(`\n外注費が変わる案件: ${changed}件（差額合計 ${totalDiff >= 0 ? '+' : ''}¥${totalDiff.toLocaleString()}）`);
        console.log(`うち「増加分＝手入力分」で二重の疑い: ${doubleCount}件`);
        for (const l of lines) console.log(l);
        console.log('\n※ 出来高の保存額が予定額と同額の案件（完了保存のみ等）は金額が変わらないため表示していません。');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
