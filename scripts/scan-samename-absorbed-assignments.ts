/**
 * 「新規案件登録のつもりが、同名の既存案件マスタへ吸収された配置」を洗い出す（読み取り専用）
 *
 * 背景:
 *   旧 addProject（stores/calendarSlices/assignmentSlice.ts）は、カレンダーの「新規作成」で
 *   projectMasterId 未指定のとき、title 完全一致の既存 ProjectMaster を探して再利用していた。
 *   このため、同名の別案件（特に「○○様邸」など住宅で多発）を新規登録したつもりでも、
 *   既存の同名案件マスタに配置（ProjectAssignment）がぶら下がるケースがありえた。
 *   本スキャンはその痕跡を探す（DBは一切変更しない）。
 *
 * 検出:
 *   [A] 案件マスタ作成から --days 日（既定14日）以上あとに作成された配置を含む案件マスタ。
 *       = 後から（多くは新規登録の操作で）既存マスタへ吸収された疑い。
 *       ※「既存案件から作成」や案件詳細から意図的に後日追加した正当なケースも混ざるため、
 *         経過日数・職長・種別・備考を判断材料に、最終判断は人が行う。
 *   [B] 同名タイトルの案件マスタが複数あるグループ（参考。名寄せが効かず別登録できた分）。
 *
 * 使い方（本番DBに対して読み取りのみ）:
 *   npx tsx scripts/scan-samename-absorbed-assignments.ts
 *   npx tsx scripts/scan-samename-absorbed-assignments.ts --days=7
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function jstKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function daysBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

async function main() {
    const daysArg = process.argv.find((s) => s.startsWith('--days='));
    const THRESHOLD_DAYS = daysArg ? Math.max(1, parseInt(daysArg.split('=')[1], 10) || 14) : 14;

    const masters = await prisma.projectMaster.findMany({
        select: {
            id: true, title: true, name: true, customerName: true, status: true, createdAt: true,
            assignments: {
                select: { id: true, date: true, assignedEmployeeId: true, createdAt: true, constructionType: true, remarks: true },
            },
        },
    });
    type Master = typeof masters[number];

    // 職長名の解決
    const fids = [...new Set(masters.flatMap((m) => m.assignments.map((a) => a.assignedEmployeeId)))];
    const users = await prisma.user.findMany({ where: { id: { in: fids } }, select: { id: true, displayName: true } });
    const fmap = new Map(users.map((u) => [u.id, u.displayName]));
    const fname = (id: string): string => fmap.get(id) ?? id.slice(0, 8);

    // [A] マスタ作成から閾値日以上あとに作成された配置を含むマスタ
    const suspects: { m: Master; maxGap: number }[] = [];
    for (const m of masters) {
        if (m.assignments.length === 0) continue;
        const maxGap = Math.max(...m.assignments.map((a) => daysBetween(m.createdAt, a.createdAt)));
        if (maxGap >= THRESHOLD_DAYS) suspects.push({ m, maxGap });
    }
    suspects.sort((x, y) => y.maxGap - x.maxGap);

    console.log(`\n##### [A] 案件マスタ作成から${THRESHOLD_DAYS}日以上あとに追加された配置を含む案件 = 同名既存への吸収の疑い: ${suspects.length}件 #####`);
    console.log('（「既存案件から作成」等で意図的に後日追加した正当なケースも含みます。★印=閾値超の配置。経過が大きいものほど要確認）\n');
    for (const { m } of suspects) {
        const disp = m.name || m.title || '(名称未設定)';
        console.log(`■ ${disp}  [pm=${m.id.slice(0, 8)} 顧客=${m.customerName ?? '—'} status=${m.status} マスタ作成=${jstKey(m.createdAt)} 配置${m.assignments.length}件]`);
        const sorted = m.assignments.slice().sort((p, q) => p.createdAt.getTime() - q.createdAt.getTime());
        for (const a of sorted) {
            const gap = daysBetween(m.createdAt, a.createdAt);
            const mark = gap >= THRESHOLD_DAYS ? ` ★+${gap}日後` : '';
            const note = a.remarks ? ` 備考「${a.remarks.replace(/\s+/g, ' ').slice(0, 24)}」` : '';
            console.log(`    ・作業日${jstKey(a.date)} 種別${a.constructionType ?? '—'} ${fname(a.assignedEmployeeId)}班 配置作成=${jstKey(a.createdAt)}${mark}${note}`);
        }
        console.log('');
    }

    // [B] 同名タイトルで複数マスタ
    const byTitle = new Map<string, Master[]>();
    for (const m of masters) {
        const key = (m.title || m.name || '').trim();
        if (!key) continue;
        const arr = byTitle.get(key);
        if (arr) arr.push(m); else byTitle.set(key, [m]);
    }
    const dupTitles = [...byTitle.entries()].filter(([, arr]) => arr.length >= 2).sort((a, b) => b[1].length - a[1].length);

    console.log(`\n##### [B] 同名タイトルの案件マスタが複数あるグループ（参考・正常に別登録できた分）: ${dupTitles.length}グループ #####`);
    for (const [title, arr] of dupTitles) {
        console.log(`  「${title}」 : ${arr.length}件`);
        for (const m of arr.slice().sort((p, q) => p.createdAt.getTime() - q.createdAt.getTime())) {
            console.log(`      - pm=${m.id.slice(0, 8)} 顧客=${m.customerName ?? '—'} 作成=${jstKey(m.createdAt)} 配置${m.assignments.length}件`);
        }
    }

    console.log(`\n=== サマリ === 対象マスタ=${masters.length}  [A]吸収疑い=${suspects.length}件  [B]同名複数=${dupTitles.length}グループ  (閾値=${THRESHOLD_DAYS}日)`);
    console.log('※[A]は候補です。各案件をカレンダー/案件詳細で開き、別物件の作業日が混ざっていないか確認してください。');
    console.log('※誤吸収が見つかったら、正しい新規案件を作成して当該配置の所属を付け替える対応が必要です（本スクリプトは変更しません）。');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
