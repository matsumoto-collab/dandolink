/**
 * 協力業者出来高「公開ボタン化」の移行バックフィル（2026-06-10）。
 *
 * 背景: これまで「全行完了 = 即・協力業者へ公開」だったが、公開ボタンによる明示公開へ変更した。
 * このままデプロイすると、現在すでに協力業者へ見えている月（全行完了済みの月）が
 * 公開フラグ未設定のため一斉に非表示になる。本スクリプトはそれらの月を published に
 * 揃えて現状の見え方を維持する。
 *
 * 判定: 会社×月ごとに「有効行（deletedAt なし）が 1 件以上あり、全行 status='completed'」
 * なら公開対象。未保存の自動行までは判定しない（仮に過剰に published を立てても、
 * 閲覧側は「全行完了 && 公開」の AND なので協力業者に未完了の月が見えることはない）。
 *
 * 公開日時 (completedAt) は行の完了日時の最大値を引き継ぐ。公開者 (completedBy) は null（システム移行）。
 * 既に PartnerWorkVolumeMonth にレコードがある (会社, 年, 月) はスキップする（手動操作を上書きしない）。
 *
 * 実行（プロジェクトルートで）:
 *   ドライラン: npx tsx scripts/backfill-publish-partner-work-volume-months.ts
 *   反映      : npx tsx scripts/backfill-publish-partner-work-volume-months.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface MonthAgg {
    partnerCompanyId: string;
    year: number;
    month: number;
    total: number;
    completed: number;
    latestCompletedAt: Date | null;
}

async function main() {
    console.log(`mode: ${APPLY ? 'APPLY（書き込みあり）' : 'DRY-RUN（書き込みなし）'}`);

    const rows = await prisma.partnerWorkVolume.findMany({
        where: { deletedAt: null },
        select: { partnerCompanyId: true, date: true, status: true, completedAt: true },
    });
    console.log(`有効行: ${rows.length} 件`);

    // date は @db.Date（UTC 00:00 固定）なので UTC で年月を取る
    const byMonth = new Map<string, MonthAgg>();
    for (const r of rows) {
        const year = r.date.getUTCFullYear();
        const month = r.date.getUTCMonth() + 1;
        const key = `${r.partnerCompanyId}::${year}-${month}`;
        let agg = byMonth.get(key);
        if (!agg) {
            agg = { partnerCompanyId: r.partnerCompanyId, year, month, total: 0, completed: 0, latestCompletedAt: null };
            byMonth.set(key, agg);
        }
        agg.total += 1;
        if (r.status === 'completed') agg.completed += 1;
        if (r.completedAt && (!agg.latestCompletedAt || r.completedAt > agg.latestCompletedAt)) {
            agg.latestCompletedAt = r.completedAt;
        }
    }

    const companies = await prisma.user.findMany({
        where: { id: { in: Array.from(new Set(rows.map((r) => r.partnerCompanyId))) } },
        select: { id: true, displayName: true },
    });
    const companyName = new Map(companies.map((c) => [c.id, c.displayName]));

    const existing = await prisma.partnerWorkVolumeMonth.findMany({
        select: { partnerCompanyId: true, year: true, month: true, status: true },
    });
    const existingKeys = new Set(existing.map((e) => `${e.partnerCompanyId}::${e.year}-${e.month}`));

    let publishCount = 0;
    let skipIncomplete = 0;
    let skipExisting = 0;
    for (const [key, agg] of Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        const name = companyName.get(agg.partnerCompanyId) ?? agg.partnerCompanyId;
        const label = `${agg.year}/${String(agg.month).padStart(2, '0')} ${name}`;
        if (agg.completed !== agg.total) {
            skipIncomplete += 1;
            console.log(`  skip(未完了 ${agg.completed}/${agg.total}): ${label}`);
            continue;
        }
        if (existingKeys.has(key)) {
            skipExisting += 1;
            console.log(`  skip(レコード既存): ${label}`);
            continue;
        }
        publishCount += 1;
        console.log(`  publish: ${label} (${agg.total}行, 完了 ${agg.latestCompletedAt?.toISOString() ?? '-'})`);
        if (APPLY) {
            await prisma.partnerWorkVolumeMonth.create({
                data: {
                    partnerCompanyId: agg.partnerCompanyId,
                    year: agg.year,
                    month: agg.month,
                    status: 'published',
                    completedAt: agg.latestCompletedAt ?? new Date(),
                    completedBy: null,
                },
            });
        }
    }

    console.log('---');
    console.log(`publish 対象: ${publishCount} 月分 / 未完了スキップ: ${skipIncomplete} / 既存スキップ: ${skipExisting}`);
    if (!APPLY) console.log('書き込みは行っていません。反映するには --apply を付けて実行してください。');
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
