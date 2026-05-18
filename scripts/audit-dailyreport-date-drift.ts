/**
 * 【ドライラン・読み取り専用】DailyReport.date のJST日ズレ件数を集計する一回限りの調査スクリプト。
 *
 * 背景:
 *   work-status ルートの旧 toDateOnly() がサーバーローカルTZ(本番=UTC)依存だったため、
 *   配置(ProjectAssignment.date)が JST 0時=「…T15:00:00.000Z」で保存されているケースで
 *   DailyReport.date が本来のJST日より1日前に書かれていた（山建班・和馬班など自動生成経路）。
 *
 * このスクリプトは一切書き込みを行わない（findMany のみ）。件数の把握だけが目的。
 *
 * 実行（本番DBに対して読み取りのみ。実行前に念のためバックアップ推奨）:
 *   DIRECT_URL="postgres://..." npx tsx scripts/audit-dailyreport-date-drift.ts
 *
 * 判定:
 *   各 DailyReport について、紐づく WorkItem の assignment.date を JSTカレンダー日に
 *   正規化した集合を見る。
 *   - clean        : 保存日(JST) == assignment(JST) で一致（修復不要）
 *   - off-by-one   : 全 WorkItem の assignment(JST) が一致し、保存日 + 1日 = それ（既知バグ）
 *   - collision    : off-by-one のうち、正しい (foremanId, 正JST日) に別 DailyReport が既存
 *                    （Bスクリプトでは WorkItem マージ or 手動対応が必要）
 *   - ambiguous    : WorkItem 間で assignment 日が割れている / ズレ幅が1日でない（手動確認）
 *   - no-workitems : WorkItem が無く判定不能
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** lib/dateUtils.ts の toJstDateOnly と同一ロジック（スクリプト自己完結のためインライン） */
function toJstDateOnly(input: string | Date): Date {
    const d = input instanceof Date ? input : new Date(input);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return new Date(
        Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0, 0),
    );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
    const reports = await prisma.dailyReport.findMany({
        select: {
            id: true,
            foremanId: true,
            date: true,
            workItems: {
                select: { assignmentId: true, assignment: { select: { date: true } } },
            },
        },
        orderBy: { date: 'asc' },
    });

    // 既存 (foremanId, JST日) の集合（衝突検出用）
    const existingKeys = new Set(
        reports.map((r) => `${r.foremanId}|${ymd(toJstDateOnly(r.date))}`),
    );

    const stats = {
        total: reports.length,
        clean: 0,
        offByOne: 0,
        collision: 0,
        ambiguous: 0,
        noWorkItems: 0,
    };
    const offByOneSamples: string[] = [];
    const ambiguousSamples: string[] = [];

    for (const r of reports) {
        const storedJst = toJstDateOnly(r.date);
        if (r.workItems.length === 0) {
            stats.noWorkItems++;
            continue;
        }

        const asgDays = Array.from(
            new Set(r.workItems.map((w) => ymd(toJstDateOnly(w.assignment.date)))),
        ).sort();

        if (asgDays.length === 1) {
            const correct = asgDays[0];
            const stored = ymd(storedJst);
            if (correct === stored) {
                stats.clean++;
            } else {
                const diffDays = Math.round(
                    (new Date(correct).getTime() - storedJst.getTime()) / DAY_MS,
                );
                if (diffDays === 1) {
                    stats.offByOne++;
                    const collides = existingKeys.has(`${r.foremanId}|${correct}`);
                    if (collides) stats.collision++;
                    if (offByOneSamples.length < 20) {
                        offByOneSamples.push(
                            `report=${r.id} foreman=${r.foremanId} stored=${stored} -> correct=${correct}` +
                            (collides ? '  [COLLISION: 正日に既存レコードあり]' : ''),
                        );
                    }
                } else {
                    stats.ambiguous++;
                    if (ambiguousSamples.length < 20) {
                        ambiguousSamples.push(
                            `report=${r.id} foreman=${r.foremanId} stored=${stored} asg=${correct} diff=${diffDays}d`,
                        );
                    }
                }
            }
        } else {
            // WorkItem 間で assignment 日が割れている → 自動修復対象外
            stats.ambiguous++;
            if (ambiguousSamples.length < 20) {
                ambiguousSamples.push(
                    `report=${r.id} foreman=${r.foremanId} stored=${ymd(storedJst)} asgDays=[${asgDays.join(',')}]`,
                );
            }
        }
    }

    console.log('=== DailyReport date drift audit (DRY RUN / read-only) ===');
    console.table(stats);
    console.log(`\n-- off-by-one candidates (修復対象, 最大20件表示 / 全${stats.offByOne}件) --`);
    offByOneSamples.forEach((s) => console.log('  ' + s));
    console.log(`  ...うち衝突 ${stats.collision} 件は WorkItem マージ or 手動対応が必要`);
    console.log(`\n-- ambiguous (要手動確認, 最大20件表示 / 全${stats.ambiguous}件) --`);
    ambiguousSamples.forEach((s) => console.log('  ' + s));
    console.log('\n書き込みは行っていません（read-only）。');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
