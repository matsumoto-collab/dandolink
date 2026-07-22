/**
 * 「◯◯の近くに行く仕事はある？」の近隣検索（lib/nearbyJobs.ts）を、本番の実データで検証する。
 * 読み取り専用・DBは一切変更しない。AIは呼ばないので課金は発生しない。
 *
 * 見たいこと:
 *   1. 実在の地名（過去案件の住所から自動抽出）で基準点が正しく解決できるか
 *   2. 距離つきの結果が妥当か（明らかに遠い現場が混ざっていないか）
 *   3. 住所（座標）未登録の案件が何件あり、どれくらい取りこぼすか
 *   4. 過去案件に無い地名で、地図サービス（Nominatim）へのフォールバックが効くか
 *
 * 使い方:
 *   npx tsx --env-file=.env scripts/verify-nearby-jobs.ts
 *   npx tsx --env-file=.env scripts/verify-nearby-jobs.ts 北条 30   （地名と半径kmの指定）
 */

export {}; // 他スクリプトの main と衝突しないようモジュール扱いにする（動的importのみのため必要）

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL が未設定です（--env-file=.env を付けてください）');
    // スクリプトはセッションモードの接続上限を食い潰さないよう1本に絞る
    process.env.DATABASE_URL = url + (url.includes('?') ? '&' : '?') + 'connection_limit=1';

    const { findNearbyJobs } = await import('../lib/nearbyJobs');
    const { prisma } = await import('../lib/prisma');

    const argPlace = process.argv[2];
    const argRadius = process.argv[3] ? Number(process.argv[3]) : undefined;

    // 検証する地名: 引数優先。無ければ「今後30日に予定がある案件」の市区町村から自動で選ぶ
    let places: string[];
    if (argPlace) {
        places = [argPlace];
    } else {
        const now = new Date();
        const asg = await prisma.projectAssignment.findMany({
            where: { date: { gte: now, lt: new Date(now.getTime() + 30 * 24 * 3600 * 1000) } },
            select: { projectMaster: { select: { city: true, latitude: true } } },
        });
        const cities = asg
            .map((a) => a.projectMaster?.city?.trim())
            .filter((c): c is string => !!c && c.length > 3);
        // 「松山市南吉田町」→「南吉田町」のように市名を落として町名で引く（社内の呼び方に近い）
        const townNames = Array.from(new Set(cities.map((c) => c.replace(/^.+?[市町村区]/, '')).filter((t) => t.length >= 2)));
        places = townNames.slice(0, 3);
        if (places.length === 0) places = ['松山'];
        console.log(`※ 検証地名は「今後30日に予定がある案件」の住所から自動抽出しました\n`);
    }

    for (const place of places) {
        const r = await findNearbyJobs({ place, radiusKm: argRadius });
        console.log(`━━━ 「${place}」の近く（半径${r.radiusKm}km・${r.startDate}〜${r.endDate}）`);
        if (!r.resolved) {
            console.log('  × 地名を特定できませんでした（AIは「分かりません」と答えます）\n');
            continue;
        }
        console.log(`  基準点: ${r.resolved.label} [${r.resolved.source === 'projects' ? `過去案件${r.resolved.matchedProjects}件から算出` : '地図サービス'}] (${r.resolved.latitude.toFixed(4)}, ${r.resolved.longitude.toFixed(4)})`);
        console.log(`  距離を判定できた現場: ${r.checkedCount}件 / うち半径内: ${r.totalInRadius}件（近い順に最大12件を表示）`);
        if (r.jobs.length === 0) {
            console.log('  該当なし');
        }
        for (const j of r.jobs) {
            const days = j.schedule
                .map((d) => `${d.date.slice(5)}${d.dateStatus === 'tentative' ? '(仮)' : ''} ${d.team ?? '浮き'}`)
                .join('、');
            const out = j.outsideRadius ? ' （半径外・最寄り）' : '';
            console.log(`  ・約${j.distanceKm}km ${j.address || '(住所未入力・座標のみ)'} ${j.site}${out}`);
            console.log(`      ${days}`);
        }
        if (r.unknownLocation.count > 0) {
            console.log(`  ⚠ 住所（座標）未登録で距離を判定できない案件: ${r.unknownLocation.count}件 例) ${r.unknownLocation.sites.join('、')}`);
        }
        console.log('');
    }

    // 過去案件に無い地名 → 地図サービスへのフォールバック確認
    if (!argPlace) {
        const r = await findNearbyJobs({ place: '道後温泉' });
        console.log('━━━ フォールバック確認「道後温泉」');
        console.log(r.resolved
            ? `  基準点: ${r.resolved.label} [${r.resolved.source === 'projects' ? '過去案件' : '地図サービス'}] / 半径内 ${r.totalInRadius}件`
            : '  × 特定できず（過去案件にも地図サービスにも無し）');
    }

    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
