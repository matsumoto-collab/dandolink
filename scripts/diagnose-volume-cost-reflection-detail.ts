/**
 * 協力業者出来高→外注費反映の影響調査（詳細版・読み取り専用）
 * 指定タイトル（部分一致）の案件について、partner配置と保存済み出来高行の対応を出力し、
 * 新ロジックでどの行がどう計上されるかを確認する。
 *
 * 使い方: npx tsx scripts/diagnose-volume-cost-reflection-detail.ts <タイトル部分一致>
 */
export {}; // モジュール化（他スクリプトとのトップレベル変数衝突を防ぐ）

const baseUrl = process.env.DATABASE_URL ?? '';
if (baseUrl) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${baseUrl}${sep}connection_limit=1`;
}
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

async function main() {
    const { prisma } = await import('../lib/prisma');
    const keyword = process.argv[2];
    if (!keyword) {
        console.error('Usage: npx tsx scripts/diagnose-volume-cost-reflection-detail.ts <タイトル部分一致>');
        process.exit(1);
    }
    try {
        const pms = await prisma.projectMaster.findMany({
            where: { title: { contains: keyword } },
            select: {
                id: true, title: true,
                subcontractorCosts: { select: { constructionTypeId: true, amount: true, transportCost: true } },
                assignments: {
                    select: {
                        id: true, date: true, assignedEmployeeId: true, isDispatchConfirmed: true,
                        constructionType: true, subcontractorCostOverride: true,
                    },
                    orderBy: { date: 'asc' },
                },
            },
        });
        const types = await prisma.constructionType.findMany({ select: { id: true, name: true } });
        const typeName = new Map(types.map((t) => [t.id, t.name]));
        const users = await prisma.user.findMany({ select: { id: true, displayName: true, role: true } });
        const userName = new Map(users.map((u) => [u.id, `${u.displayName}(${u.role})`]));

        for (const pm of pms) {
            console.log(`\n===== ${pm.title} (${pm.id}) =====`);
            console.log('協力業者費(予定):');
            for (const c of pm.subcontractorCosts) {
                console.log(`  ${typeName.get(c.constructionTypeId) ?? c.constructionTypeId}: 作業費¥${Number(c.amount).toLocaleString()} 運搬費¥${Number(c.transportCost ?? 0).toLocaleString()}`);
            }
            const aIds = pm.assignments.map((a) => a.id);
            const vols = await prisma.partnerWorkVolume.findMany({
                where: { sourceAssignmentId: { in: aIds } },
                select: {
                    sourceAssignmentId: true, rowType: true, amount: true, amountOverridden: true,
                    deletedAt: true, status: true, date: true, partnerCompanyId: true, isManual: true,
                },
            });
            const volByA = new Map<string, typeof vols>();
            for (const v of vols) {
                const arr = volByA.get(v.sourceAssignmentId as string) ?? [];
                arr.push(v);
                volByA.set(v.sourceAssignmentId as string, arr);
            }
            console.log('配置（日付順）:');
            for (const a of pm.assignments) {
                const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(a.date);
                const rows = volByA.get(a.id) ?? [];
                const foreman = userName.get(a.assignedEmployeeId) ?? a.assignedEmployeeId;
                const isPartner = (users.find((u) => u.id === a.assignedEmployeeId)?.role ?? '').toLowerCase() === 'partner';
                if (!isPartner && rows.length === 0) continue; // 自社班で出来高もない配置は省略
                console.log(`  ${dateStr} ${typeName.get(a.constructionType ?? '') ?? a.constructionType ?? '種別なし'} 職長=${foreman} 確定=${a.isDispatchConfirmed} override=${a.subcontractorCostOverride ?? '-'}`);
                for (const v of rows) {
                    const vDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(v.date);
                    console.log(`      └ 出来高[${v.rowType}] ¥${v.amount.toLocaleString()} overridden=${v.amountOverridden} status=${v.status} deleted=${v.deletedAt ? 'yes' : 'no'} 行日付=${vDate}`);
                }
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
