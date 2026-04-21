/**
 * 既存の Estimate / Invoice に対して v1 のバージョンスナップショットを作成する一回限りのスクリプト。
 *
 * 実行:
 *   DIRECT_URL="postgres://..." npx tsx scripts/backfill-versions.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillEstimates() {
    const estimates = await prisma.estimate.findMany({ select: { id: true } });
    console.log(`Estimates: ${estimates.length} 件`);

    let created = 0;
    let skipped = 0;
    for (const { id } of estimates) {
        const existing = await prisma.estimateVersion.count({ where: { estimateId: id } });
        if (existing > 0) {
            skipped++;
            continue;
        }
        const current = await prisma.estimate.findUniqueOrThrow({ where: { id } });
        await prisma.estimateVersion.create({
            data: {
                estimateId: id,
                versionNumber: 1,
                estimateNumber: current.estimateNumber,
                title: current.title,
                items: current.items,
                subtotal: current.subtotal,
                tax: current.tax,
                total: current.total,
                validUntil: current.validUntil,
                status: current.status,
                notes: current.notes,
                location: current.location,
                costTotal: current.costTotal,
                constructionPeriod: current.constructionPeriod,
                projectMasterId: current.projectMasterId,
                customerId: current.customerId,
                createdAt: current.updatedAt,
                createdBy: current.updatedBy,
            },
        });
        created++;
    }
    console.log(`  ✓ v1 作成: ${created}, スキップ（既に履歴あり）: ${skipped}`);
}

async function backfillInvoices() {
    const invoices = await prisma.invoice.findMany({ select: { id: true } });
    console.log(`Invoices: ${invoices.length} 件`);

    let created = 0;
    let skipped = 0;
    for (const { id } of invoices) {
        const existing = await prisma.invoiceVersion.count({ where: { invoiceId: id } });
        if (existing > 0) {
            skipped++;
            continue;
        }
        const current = await prisma.invoice.findUniqueOrThrow({ where: { id } });
        const links = await prisma.invoiceProjectMaster.findMany({
            where: { invoiceId: id },
            orderBy: { sortOrder: 'asc' },
            select: { projectMasterId: true },
        });
        const projectMasterIdsJson = JSON.stringify(links.map(l => l.projectMasterId));

        await prisma.invoiceVersion.create({
            data: {
                invoiceId: id,
                versionNumber: 1,
                invoiceNumber: current.invoiceNumber,
                title: current.title,
                items: current.items,
                subtotal: current.subtotal,
                tax: current.tax,
                total: current.total,
                dueDate: current.dueDate,
                status: current.status,
                paidDate: current.paidDate,
                notes: current.notes,
                estimateId: current.estimateId,
                projectMasterId: current.projectMasterId,
                customerId: current.customerId,
                projectMasterIdsJson,
                createdAt: current.updatedAt,
                createdBy: current.updatedBy,
            },
        });
        created++;
    }
    console.log(`  ✓ v1 作成: ${created}, スキップ（既に履歴あり）: ${skipped}`);
}

async function main() {
    console.log('=== Version backfill 開始 ===');
    await backfillEstimates();
    await backfillInvoices();
    console.log('=== 完了 ===');
}

main()
    .catch(err => {
        console.error('Backfill 失敗:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
