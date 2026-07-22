/**
 * AI照会（スケジュールAI）の回答品質を、本番の実データ＋本番と同じモデルで検証する。
 * 読み取り専用・DBは一切変更しない。
 *
 * なぜ必要か:
 *   プロンプトは1か所いじると別の場所が壊れる（2026-07-20 の実例:
 *   「特定の班を列挙に出すな」という指示を足したら、AIが同名の案件担当者まで
 *   対象と誤解し、浮いている現場そのものを握り潰した。この除外運用自体は
 *   線引きが事故を招くとの kei 判断で同日撤廃し、現在は全班を回答対象にしている）。
 *   jest には入れない（API課金が発生し、出力も毎回同じ文字列にはならないため）。
 *   プロンプトや lib/availabilityAssistant.ts を触ったら手で1回走らせる。
 *
 * 検証の考え方:
 *   AIの文章そのものは毎回変わるので完全一致では見ない。
 *   「実データから機械的に作った、絶対に含まれるべき語／絶対に含まれてはいけない語」で判定する。
 *
 * 使い方:
 *   npx tsx --env-file=.env scripts/verify-ai-assistant.ts
 *   （ANTHROPIC_API_KEY と DATABASE_URL が必要。1回あたり数十円のAPI課金が発生する）
 */

export {}; // 他スクリプトの main と衝突しないようモジュール扱いにする（動的importのみのため必要）

interface Case {
    name: string;
    question: string;
    /** 回答に必ず含まれるべき文字列 */
    mustInclude: string[];
    /** 回答に含まれてはいけない文字列 */
    mustNotInclude: string[];
    /** 期待の根拠（失敗時に表示） */
    why: string;
}

function jstToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo',
    }).format(new Date());
}

/** 「2026-08-05」→「8月5日」（AIへの質問文用） */
function toJpDate(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${Number(m)}月${Number(d)}日`;
}

/**
 * 含有判定用の正規化。
 * DBの現場名は全角スペース入り（例「久原宏太　麻子様邸」）だが AI は半角で書くため、
 * 空白を全て落として比較しないと誤検知する（実際に初回実行で誤検知した）。
 */
function norm(s: string): string {
    return s.normalize('NFKC').replace(/\s+/g, '');
}

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL が未設定です（--env-file=.env を付けてください）');
    // スクリプトはセッションモードの接続上限を食い潰さないよう1本に絞る
    process.env.DATABASE_URL = url + (url.includes('?') ? '&' : '?') + 'connection_limit=1';

    const { askScheduleAssistant } = await import('../lib/availabilityAssistant');
    const { getFloating } = await import('../lib/crewAvailability');
    const { prisma } = await import('../lib/prisma');
    const { extractAssigneeIds } = await import('../lib/projectAssignees');
    const { toJstDateOnly } = await import('../lib/dateUtils');

    const cases: Case[] = [];

    // --- ケース生成: 実データから期待値を組み立てる ---

    // 1) 浮きが握り潰されないこと（2026-07-20 の事故の再発検知）
    const floating = await getFloating();
    if (floating.length > 0) {
        const sites = floating.map((f) => f.site);
        cases.push({
            name: '浮きの一覧が全件出る',
            question: '今浮いている現場はある？',
            mustInclude: sites,
            mustNotInclude: [],
            why: `DBの浮き ${floating.length}件: ${sites.join(' / ')}`,
        });

        // 担当者名が除外班名と同名の浮き（今井・三生・松本）が隠されないこと
        const risky = floating.filter((f) => f.owners.some((o) => ['今井', '三生', '松本'].includes(o)));
        for (const f of risky) {
            cases.push({
                name: `担当が${f.owners.join('・')}の浮きが隠されない`,
                question: `${toJpDate(f.date)}に浮いている現場はありますか？`,
                mustInclude: [f.site],
                mustNotInclude: [],
                why: `${f.date} の浮き「${f.site}」担当=${f.owners.join('・')}（班名と同名の担当者）`,
            });
        }
    } else {
        console.log('（注意）現在DBに浮きが0件のため、浮き関連の検証はスキップします');
    }

    // 2) 班を勝手に伏せないこと（2026-07-20 に班の除外運用を撤廃済み＝全班を出す）
    const today = jstToday();
    cases.push({
        name: '班を伏せず、除外めいた言い回しもしない',
        question: `${toJpDate(today)}に空いている班はある？`,
        mustInclude: [],
        mustNotInclude: ['除外', '対象外', '一部の班', '報告対象'],
        why: '班の除外運用は撤廃済み。「一部の班を除く」等の言い回しが出たら指示が残っている',
    });

    // 3) かつて除外対象だった班も普通に答えること
    cases.push({
        name: 'かつて除外していた班も名指しで答える',
        question: '修栄工業の今週の予定を教えて',
        mustInclude: ['修栄工業'],
        mustNotInclude: ['お答えできません', '対象外'],
        why: '全班を回答対象に戻したため、どの班も普通に答えられる必要がある',
    });

    // 4) 担当者が除外班名と同名の「通常の予定」が隠されないこと
    const soon = toJstDateOnly(new Date());
    const upcoming = await prisma.projectAssignment.findMany({
        where: { date: { gte: soon }, assignedEmployeeId: { not: 'unassigned' } },
        select: {
            date: true,
            projectMaster: { select: { name: true, title: true, createdBy: true } },
        },
        orderBy: { date: 'asc' },
        take: 200,
    });
    const riskyOwnerUsers = await prisma.user.findMany({
        where: { displayName: { in: ['今井', '三生', '松本'] } },
        select: { id: true, displayName: true },
    });
    const riskyIdToName = new Map(riskyOwnerUsers.map((u) => [u.id, u.displayName]));
    const sample = upcoming.find((a) =>
        extractAssigneeIds(a.projectMaster?.createdBy ?? undefined).some((id) => riskyIdToName.has(id))
    );
    if (sample) {
        const site = sample.projectMaster?.name || sample.projectMaster?.title || '';
        const dateKey = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC',
        }).format(sample.date);
        cases.push({
            name: '担当者が班名と同名の通常予定が隠されない',
            question: `${toJpDate(dateKey)}の予定を教えて`,
            mustInclude: [site],
            mustNotInclude: [],
            why: `${dateKey} の「${site}」は担当者が班名と同名（隠されると業務に影響）`,
        });
    }

    // 5) 近くの現場（現調でまとめて回るための照会）が、実データの最寄りと一致すること
    const { findNearbyJobs } = await import('../lib/nearbyJobs');
    const nearbySample = await prisma.projectAssignment.findMany({
        where: { date: { gte: soon }, projectMaster: { latitude: { not: null }, city: { not: null } } },
        select: { projectMaster: { select: { city: true } } },
        orderBy: { date: 'asc' },
        take: 50,
    });
    // 「松山市南吉田町」→「南吉田町」（社内で使う呼び方に近い形で聞く）
    const townName = nearbySample
        .map((a) => a.projectMaster?.city?.trim().replace(/^.+?[市町村区]/, ''))
        .find((t): t is string => !!t && t.length >= 2);
    if (townName) {
        const nearby = await findNearbyJobs({ place: townName });
        if (nearby.jobs.length > 0) {
            cases.push({
                name: '近くの現場が実データの最寄りと一致する',
                question: `今週で${townName}の近くに行く仕事はありますか？`,
                mustInclude: [nearby.jobs[0].site],
                mustNotInclude: [],
                why: `${townName} の最寄りは「${nearby.jobs[0].site}」約${nearby.jobs[0].distanceKm}km（半径${nearby.radiusKm}km内に${nearby.totalInRadius}件）`,
            });
        }
        if (nearby.unknownLocation.count > 0) {
            cases.push({
                name: '住所未登録の案件があることを隠さない',
                question: `${townName}の近くに行く仕事を教えて`,
                mustInclude: ['住所が未登録'],
                mustNotInclude: [],
                why: `距離を判定できない案件が ${nearby.unknownLocation.count}件ある（黙って落とすと「近くに無い」と誤解される・ルール12）`,
            });
        }
    }

    // 6) 分からない地名で距離をでっち上げないこと
    cases.push({
        name: '知らない地名で距離を捏造しない',
        question: 'ばななたうんの近くに行く仕事はありますか？',
        mustInclude: [],
        mustNotInclude: ['km'],
        why: '実在しない地名。resolved=null のときは場所を推測せず聞き返す（ルール13）',
    });

    // 7) 数字を勝手に作らないこと（Markdown禁止ルールの確認も兼ねる）
    cases.push({
        name: 'Markdown記法を使わない',
        question: '直近の余っている人数を教えて',
        mustInclude: [],
        mustNotInclude: ['**', '##'],
        why: '音声読み上げがあるためプレーンテキスト厳守（ルール9）',
    });

    // --- 実行 ---
    console.log(`\n検証ケース: ${cases.length}件（モデルは本番と同じ設定・実データ）\n`);
    let failed = 0;

    for (const c of cases) {
        const { answer } = await askScheduleAssistant(c.question, []);
        const normalized = norm(answer);
        const missing = c.mustInclude.filter((s) => !normalized.includes(norm(s)));
        const leaked = c.mustNotInclude.filter((s) => normalized.includes(norm(s)));
        const ok = missing.length === 0 && leaked.length === 0;
        if (!ok) failed += 1;

        console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${c.name}`);
        console.log(`   Q: ${c.question}`);
        if (!ok) {
            console.log(`   根拠: ${c.why}`);
            if (missing.length) console.log(`   含まれるべきだが無い: ${missing.join(' / ')}`);
            if (leaked.length) console.log(`   含まれてはいけないのに有る: ${leaked.join(' / ')}`);
            console.log(`   A: ${answer.replace(/\n/g, '\n      ')}`);
        }
        console.log('');
    }

    console.log(`結果: ${cases.length - failed} PASS / ${failed} FAIL`);
    await prisma.$disconnect();
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
