/**
 * 請求書一覧で「担当者」がブランクになる請求書を本番DBで切り分ける診断。
 * 読み取り専用 SELECT のみ（書き込み一切なし）。
 *
 * 表示ロジック（app/(finance)/invoices/page.tsx）の再現:
 *   invoice -> 紐付け案件id（InvoiceProjectMaster + 代表 projectMasterId）
 *           -> ProjectMaster.createdBy(担当者User ID配列)
 *           -> User.displayName（/api/users は全ユーザー返却・isActive 非フィルタ）
 *
 * 実行:
 *   node --env-file=.env --env-file=.env.local --import tsx scripts/diagnose-invoice-assignee-blank.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// lib/projectAssignees.ts の extractAssigneeIds と同等（DBは createdBy を JSON文字列で保持）
function extractAssigneeIds(createdBy: unknown): string[] {
  if (!createdBy) return [];
  if (Array.isArray(createdBy)) return createdBy.filter(Boolean) as string[];
  if (typeof createdBy === 'string') {
    const t = createdBy.trim();
    if (!t) return [];
    if (t.startsWith('[')) {
      try {
        const p = JSON.parse(t);
        return Array.isArray(p) ? p.filter(Boolean) : [t];
      } catch {
        return [t];
      }
    }
    return [t];
  }
  return [];
}

async function main() {
  const invoices = await prisma.invoice.findMany({
    select: { id: true, invoiceNumber: true, title: true, projectMasterId: true, customerId: true, items: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const links = await prisma.invoiceProjectMaster.findMany({ select: { invoiceId: true, projectMasterId: true } });
  const linkMap = new Map<string, string[]>();
  for (const l of links) {
    const arr = linkMap.get(l.invoiceId) ?? [];
    arr.push(l.projectMasterId);
    linkMap.set(l.invoiceId, arr);
  }
  const pms = await prisma.projectMaster.findMany({ select: { id: true, createdBy: true, customerId: true, title: true, status: true } });
  const pmMap = new Map(pms.map((p) => [p.id, p]));
  const users = await prisma.user.findMany({ select: { id: true, displayName: true, isActive: true } });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 顧客ID -> その顧客に紐づく案件の担当者名（ユニーク）。締めまとめ系の集約解決の候補確認用
  const customerAssignees = new Map<string, Set<string>>();
  for (const pm of pms) {
    if (!pm.customerId) continue;
    const set = customerAssignees.get(pm.customerId) ?? new Set<string>();
    for (const aid of extractAssigneeIds(pm.createdBy)) {
      const u = userMap.get(aid);
      if (u?.displayName) set.add(u.displayName);
    }
    customerAssignees.set(pm.customerId, set);
  }
  // 明細行から projectMasterId を抽出
  const itemProjectIds = (itemsRaw: string | null): string[] => {
    if (!itemsRaw) return [];
    try {
      const arr = JSON.parse(itemsRaw);
      if (!Array.isArray(arr)) return [];
      return arr.map((i) => i?.projectMasterId).filter((v): v is string => !!v);
    } catch {
      return [];
    }
  };

  const cat = {
    resolved: [] as string[],
    noProject: [] as string[],
    projectNoCreatedBy: [] as string[],
    createdByUnresolved: [] as string[],
    projectMissing: [] as string[],
  };
  const detail: Record<string, string[]> = {
    noProject: [],
    projectNoCreatedBy: [],
    createdByUnresolved: [],
    projectMissing: [],
  };

  for (const inv of invoices) {
    const projIds = new Set<string>();
    for (const pid of linkMap.get(inv.id) ?? []) projIds.add(pid);
    if (inv.projectMasterId) projIds.add(inv.projectMasterId);

    // 明細行の projectMasterId タグ → そこから引ける担当者名
    const itemPids = itemProjectIds(inv.items);
    const itemAssigneeNames = new Set<string>();
    for (const pid of itemPids) {
      const pm = pmMap.get(pid);
      if (!pm) continue;
      for (const aid of extractAssigneeIds(pm.createdBy)) {
        const u = userMap.get(aid);
        if (u?.displayName) itemAssigneeNames.add(u.displayName);
      }
    }
    // 顧客集約で引ける担当者名
    const custNames = inv.customerId ? Array.from(customerAssignees.get(inv.customerId) ?? []) : [];

    const tag = `${inv.invoiceNumber}「${inv.title || '(無題)'}」 顧客=${inv.customerId ? 'あり' : 'なし'}`;
    const resolveHint = `明細タグ案件${itemPids.length}件→担当[${Array.from(itemAssigneeNames).join('、') || 'なし'}] / 顧客集約→担当[${custNames.join('、') || 'なし'}]`;

    if (projIds.size === 0) {
      cat.noProject.push(inv.id);
      detail.noProject.push(`  ${tag}\n      ${resolveHint}`);
      continue;
    }

    let anyProjectFound = false;
    let anyCreatedBy = false;
    const assigneeIds = new Set<string>();
    const projTitles: string[] = [];
    const missingProjIds: string[] = [];
    for (const pid of projIds) {
      const pm = pmMap.get(pid);
      if (!pm) {
        missingProjIds.push(pid);
        continue;
      }
      anyProjectFound = true;
      projTitles.push(`${pm.title}[${pm.status}]`);
      const ids = extractAssigneeIds(pm.createdBy);
      if (ids.length > 0) anyCreatedBy = true;
      ids.forEach((i) => assigneeIds.add(i));
    }

    if (!anyProjectFound) {
      cat.projectMissing.push(inv.id);
      detail.projectMissing.push(`  ${tag}  missingProjId=${missingProjIds.join(',')}`);
      continue;
    }

    const names: string[] = [];
    const unresolvedIds: string[] = [];
    for (const aid of assigneeIds) {
      const u = userMap.get(aid);
      if (u && u.displayName) names.push(u.displayName);
      else unresolvedIds.push(aid);
    }

    if (names.length > 0) {
      cat.resolved.push(inv.id);
      continue;
    }
    if (!anyCreatedBy) {
      cat.projectNoCreatedBy.push(inv.id);
      detail.projectNoCreatedBy.push(`  ${tag}  案件=${projTitles.join(' / ')}`);
      continue;
    }
    cat.createdByUnresolved.push(inv.id);
    detail.createdByUnresolved.push(`  ${tag}  案件=${projTitles.join(' / ')}  未解決ID=${unresolvedIds.join(',')}`);
  }

  console.log('================ 請求書 担当者ブランク 診断（本番・読み取りのみ）================');
  console.log(`総請求書数: ${invoices.length}`);
  console.log(`  解決OK（担当者名あり）            : ${cat.resolved.length}`);
  console.log(`  ブランク① 案件未紐付け            : ${cat.noProject.length}`);
  console.log(`  ブランク② 案件あり/createdBy空    : ${cat.projectNoCreatedBy.length}`);
  console.log(`  ブランク③ createdBy にIDあるが未解決: ${cat.createdByUnresolved.length}`);
  console.log(`  ブランク④ 紐付け案件がDBに無い    : ${cat.projectMissing.length}`);

  const dump = (label: string, key: keyof typeof detail) => {
    const lines = detail[key];
    if (lines.length === 0) return;
    console.log(`\n--- ${label}（${lines.length}件） ---`);
    for (const l of lines.slice(0, 100)) console.log(l);
    if (lines.length > 100) console.log(`  ...(他 ${lines.length - 100} 件)`);
  };
  dump('ブランク① 案件未紐付け', 'noProject');
  dump('ブランク② 案件あり/createdBy空', 'projectNoCreatedBy');
  dump('ブランク③ createdBy にIDあるが未解決', 'createdByUnresolved');
  dump('ブランク④ 紐付け案件がDBに無い', 'projectMissing');

  // ========= 新ロジック（明細タグ + 顧客集約フォールバック）適用後の検証 =========
  const resolveNew = (inv: (typeof invoices)[number]): string[] => {
    const projIds = new Set<string>();
    for (const pid of linkMap.get(inv.id) ?? []) projIds.add(pid);
    if (inv.projectMasterId) projIds.add(inv.projectMasterId);
    for (const pid of itemProjectIds(inv.items)) projIds.add(pid);
    const set = new Set<string>();
    for (const pid of projIds) {
      const pm = pmMap.get(pid);
      if (!pm) continue;
      for (const aid of extractAssigneeIds(pm.createdBy)) {
        const u = userMap.get(aid);
        if (u?.displayName) set.add(u.displayName);
      }
    }
    if (set.size === 0 && inv.customerId) {
      for (const n of customerAssignees.get(inv.customerId) ?? []) set.add(n);
    }
    return Array.from(set);
  };
  let stillBlank = 0;
  const newlyResolved: string[] = [];
  for (const inv of invoices) {
    const names = resolveNew(inv);
    if (names.length === 0) {
      stillBlank++;
      newlyResolved.push(`  [まだ空] ${inv.invoiceNumber}「${inv.title || '(無題)'}」 顧客=${inv.customerId ? 'あり' : 'なし'}`);
    }
  }
  console.log('\n================ 新ロジック適用後 ================');
  console.log(`担当者がまだ空の請求書: ${stillBlank} / ${invoices.length}`);
  if (newlyResolved.length > 0) newlyResolved.forEach((l) => console.log(l));
  console.log('\n--- 旧ブランク8件の新解決結果 ---');
  for (const num of ['I20260025', 'I20260013', 'I20260011', 'I20260009', 'I20260008', 'I20260010', 'I20260006', 'I20260012']) {
    const inv = invoices.find((i) => i.invoiceNumber === num);
    if (inv) console.log(`  ${num} → [${resolveNew(inv).join('、') || '空'}]`);
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
