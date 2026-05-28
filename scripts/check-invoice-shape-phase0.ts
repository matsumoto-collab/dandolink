/**
 * Phase 0 設計確認用：Invoice.status 分布と items JSON 構造を本番 DB で確認。
 * 読み取り専用 SELECT のみ。
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. status 分布
  const statusCounts = await prisma.$queryRaw<
    Array<{ status: string; cnt: bigint }>
  >`
    SELECT status, COUNT(*)::bigint AS cnt
    FROM "Invoice"
    GROUP BY status
    ORDER BY cnt DESC;
  `;
  console.log('=== Invoice.status 分布 (本番) ===');
  for (const r of statusCounts) {
    console.log(`  ${r.status}: ${r.cnt}`);
  }

  // 2. projectMasterId が直接付いている Invoice のサンプル
  const sample1 = await prisma.invoice.findFirst({
    where: { projectMasterId: { not: null } },
    select: {
      id: true,
      projectMasterId: true,
      items: true,
      total: true,
      status: true,
      invoiceNumber: true,
    },
  });
  console.log('\n=== サンプル①: projectMasterId 直接付き Invoice ===');
  if (sample1) {
    console.log(`id: ${sample1.id}`);
    console.log(`invoiceNumber: ${sample1.invoiceNumber}`);
    console.log(`projectMasterId (top): ${sample1.projectMasterId}`);
    console.log(`status: ${sample1.status}`);
    console.log(`total: ${sample1.total.toString()}`);
    try {
      const items = JSON.parse(sample1.items);
      console.log(`items count: ${items.length}`);
      if (items[0]) {
        console.log('first item keys:', Object.keys(items[0]).join(', '));
        console.log('first item.projectMasterId:', items[0].projectMasterId);
        console.log('first item.amount:', items[0].amount);
        console.log('first item.description:', items[0].description);
      }
    } catch {
      console.log('items は JSON ではない、または空: ', sample1.items?.slice(0, 100));
    }
  } else {
    console.log('  (該当無し)');
  }

  // 3. InvoiceProjectMaster N:N を使う複数案件 Invoice のサンプル
  const sample2Rows = await prisma.$queryRaw<
    Array<{
      invoiceId: string;
      cnt: bigint;
    }>
  >`
    SELECT "invoiceId", COUNT(*)::bigint AS cnt
    FROM "InvoiceProjectMaster"
    GROUP BY "invoiceId"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 1;
  `;
  console.log('\n=== サンプル②: 複数案件 Invoice (InvoiceProjectMaster 経由) ===');
  if (sample2Rows[0]) {
    const sample2 = await prisma.invoice.findUnique({
      where: { id: sample2Rows[0].invoiceId },
      select: {
        id: true,
        projectMasterId: true,
        items: true,
        total: true,
        status: true,
        invoiceNumber: true,
      },
    });
    if (sample2) {
      console.log(`id: ${sample2.id}`);
      console.log(`invoiceNumber: ${sample2.invoiceNumber}`);
      console.log(`projectMasterId (top): ${sample2.projectMasterId ?? '(null)'}`);
      console.log(`InvoiceProjectMaster 行数: ${sample2Rows[0].cnt}`);
      console.log(`status: ${sample2.status}`);
      console.log(`total: ${sample2.total.toString()}`);
      try {
        const items = JSON.parse(sample2.items);
        console.log(`items count: ${items.length}`);
        const hasPmId = items.filter((i: any) => i.projectMasterId).length;
        const noPmId = items.length - hasPmId;
        console.log(
          `  projectMasterId 付き: ${hasPmId}, 付き無し: ${noPmId}`
        );
        if (items[0]) {
          console.log('first item keys:', Object.keys(items[0]).join(', '));
          console.log('first item.projectMasterId:', items[0].projectMasterId);
          console.log('first item.amount:', items[0].amount);
        }
      } catch {
        console.log('items は JSON ではない、または空');
      }
    }
  } else {
    console.log('  (該当無し: InvoiceProjectMaster で複数案件のレコード無し)');
  }

  // 4. 全 Invoice での items 内 projectMasterId 充足率（集計）
  const allInvoices = await prisma.invoice.findMany({
    select: { id: true, projectMasterId: true, items: true, total: true },
  });
  let totalInvoices = allInvoices.length;
  let itemsWithPmId = 0;
  let itemsWithoutPmId = 0;
  let invoicesWithSomeItemsTagged = 0;
  let invoicesWithAllItemsTagged = 0;
  let invoicesWithNoItemsTagged = 0;
  let parseErrors = 0;

  for (const inv of allInvoices) {
    try {
      const items: any[] = JSON.parse(inv.items);
      if (!Array.isArray(items)) continue;
      const withPm = items.filter((i) => !!i.projectMasterId).length;
      const total = items.length;
      itemsWithPmId += withPm;
      itemsWithoutPmId += total - withPm;
      if (withPm === 0) invoicesWithNoItemsTagged++;
      else if (withPm === total) invoicesWithAllItemsTagged++;
      else invoicesWithSomeItemsTagged++;
    } catch {
      parseErrors++;
    }
  }
  console.log('\n=== 全 Invoice での items.projectMasterId 充足率 ===');
  console.log(`  全 Invoice 件数: ${totalInvoices}`);
  console.log(`  parse 失敗: ${parseErrors}`);
  console.log(`  全 item に projectMasterId 付き: ${invoicesWithAllItemsTagged}`);
  console.log(`  一部 item に projectMasterId 付き: ${invoicesWithSomeItemsTagged}`);
  console.log(`  どの item にも projectMasterId 無し: ${invoicesWithNoItemsTagged}`);
  console.log(`  item 単位の集計: 付き ${itemsWithPmId} / 無し ${itemsWithoutPmId}`);

  // 5. Invoice の top-level projectMasterId 充足率
  const topPm = allInvoices.filter((i) => i.projectMasterId).length;
  console.log('\n=== Invoice.projectMasterId (top-level) 充足率 ===');
  console.log(`  付き: ${topPm} / 無し: ${totalInvoices - topPm}`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
