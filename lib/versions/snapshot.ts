import type { Prisma } from '@prisma/client';

export async function createEstimateVersion(
    tx: Prisma.TransactionClient,
    estimateId: string,
    userId: string | null,
) {
    const current = await tx.estimate.findUniqueOrThrow({ where: { id: estimateId } });
    const maxVer = await tx.estimateVersion.aggregate({
        where: { estimateId },
        _max: { versionNumber: true },
    });
    const nextVer = (maxVer._max.versionNumber ?? 0) + 1;
    return tx.estimateVersion.create({
        data: {
            estimateId,
            versionNumber: nextVer,
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
            createdBy: userId,
        },
    });
}

export async function createInvoiceVersion(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    userId: string | null,
) {
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const links = await tx.invoiceProjectMaster.findMany({
        where: { invoiceId },
        orderBy: { sortOrder: 'asc' },
        select: { projectMasterId: true },
    });
    const projectMasterIdsJson = JSON.stringify(links.map(l => l.projectMasterId));
    const maxVer = await tx.invoiceVersion.aggregate({
        where: { invoiceId },
        _max: { versionNumber: true },
    });
    const nextVer = (maxVer._max.versionNumber ?? 0) + 1;
    return tx.invoiceVersion.create({
        data: {
            invoiceId,
            versionNumber: nextVer,
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
            createdBy: userId,
        },
    });
}
