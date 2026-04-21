import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { canDispatch, isManagerOrAbove } from '@/utils/permissions';
import { formatProjectMaster } from '@/lib/formatters';

interface RouteContext {
    params: Promise<{ id: string }>;
}

async function getDocFlags(pmId: string) {
    const [estimateCount, invoiceCount, invoicePmLinkCount] = await Promise.all([
        prisma.estimate.count({ where: { projectMasterId: pmId } }),
        prisma.invoice.count({ where: { projectMasterId: pmId } }),
        prisma.invoiceProjectMaster.count({ where: { projectMasterId: pmId } }),
    ]);
    return { hasEstimate: estimateCount > 0, hasInvoice: invoiceCount > 0 || invoicePmLinkCount > 0 };
}

export async function GET(_req: NextRequest, context: RouteContext) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { id } = await context.params;
        const projectMaster = await prisma.projectMaster.findUnique({
            where: { id },
            include: {
                assignments: { orderBy: { date: 'desc' } },
                subcontractorCosts: { orderBy: { sortOrder: 'asc' } },
            },
        });

        if (!projectMaster) return notFoundResponse('案件マスター');
        const flags = await getDocFlags(id);
        return NextResponse.json({ ...formatProjectMaster(projectMaster), ...flags });
    } catch (error) {
        return serverErrorResponse('案件マスターの取得', error);
    }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canDispatch(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const body = await req.json();

        const VALID_STATUSES = ['active', 'completed', 'cancelled'];

        const existing = await prisma.projectMaster.findUnique({ where: { id } });
        if (!existing) return notFoundResponse('案件マスター');

        const updateData: Record<string, unknown> = {};
        if (body.name !== undefined) updateData.name = body.name || null;
        if (body.honorific !== undefined) updateData.honorific = body.honorific ?? null;
        if (body.constructionSuffixId !== undefined) updateData.constructionSuffixId = body.constructionSuffixId || null;

        // nameがある場合、titleを自動合成
        if (body.name !== undefined) {
            let suffixName = '';
            const suffixId = body.constructionSuffixId !== undefined ? body.constructionSuffixId : existing.constructionSuffixId;
            if (suffixId) {
                const suffix = await prisma.constructionSuffix.findUnique({ where: { id: suffixId } });
                suffixName = suffix?.name || '';
            }
            const h = body.honorific !== undefined ? (body.honorific || '') : '';
            updateData.title = `${body.name}${h}${suffixName ? ' ' + suffixName : ''}`;
        } else if (body.title !== undefined) {
            updateData.title = body.title;
        }
        if (body.customerId !== undefined) updateData.customerId = body.customerId;
        if (body.customerName !== undefined) updateData.customerName = body.customerName;
        if (body.constructionType !== undefined) updateData.constructionType = body.constructionType;
        if (body.constructionContent !== undefined) updateData.constructionContent = body.constructionContent;
        if (body.status !== undefined) {
            if (!VALID_STATUSES.includes(body.status)) return validationErrorResponse(`statusは${VALID_STATUSES.join(', ')}のいずれかを指定してください`);
            updateData.status = body.status;
        }
        if (body.location !== undefined) updateData.location = body.location;
        if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
        if (body.prefecture !== undefined) updateData.prefecture = body.prefecture;
        if (body.city !== undefined) updateData.city = body.city;
        if (body.plusCode !== undefined) updateData.plusCode = body.plusCode;
        if (body.latitude !== undefined) updateData.latitude = body.latitude;
        if (body.longitude !== undefined) updateData.longitude = body.longitude;
        if (body.area !== undefined) updateData.area = body.area;
        if (body.areaRemarks !== undefined) updateData.areaRemarks = body.areaRemarks;
        if (body.estimatedAssemblyWorkers !== undefined) updateData.estimatedAssemblyWorkers = body.estimatedAssemblyWorkers;
        if (body.estimatedDemolitionWorkers !== undefined) updateData.estimatedDemolitionWorkers = body.estimatedDemolitionWorkers;
        if (body.contractAmount !== undefined) {
            if (typeof body.contractAmount === 'number' && body.contractAmount < 0) return validationErrorResponse('足場工事金額は0以上で指定してください');
            updateData.contractAmount = body.contractAmount;
        }
        const costFields = ['materialCost', 'otherExpenses'] as const;
        for (const field of costFields) {
            if (body[field] !== undefined) {
                const value = body[field];
                if (value !== null && (typeof value !== 'number' || value < 0)) {
                    return validationErrorResponse(`${field}は0以上の数値で指定してください`);
                }
                updateData[field] = value;
            }
        }

        // 協力業者費（工事種別ごとの設定額）: 渡された配列で完全置き換え
        let subcontractorCostsInput: { constructionTypeId: string; amount: number }[] | undefined;
        if (body.subcontractorCosts !== undefined) {
            if (!Array.isArray(body.subcontractorCosts)) {
                return validationErrorResponse('subcontractorCostsは配列で指定してください');
            }
            const parsed: { constructionTypeId: string; amount: number }[] = [];
            const seenTypes = new Set<string>();
            for (const row of body.subcontractorCosts) {
                if (!row || typeof row !== 'object') continue;
                const constructionTypeId = typeof row.constructionTypeId === 'string' ? row.constructionTypeId : '';
                const amount = Number(row.amount);
                if (!constructionTypeId) continue;
                if (!Number.isFinite(amount) || amount < 0) {
                    return validationErrorResponse('協力業者費の金額は0以上の数値で指定してください');
                }
                if (seenTypes.has(constructionTypeId)) {
                    return validationErrorResponse('同じ工事種別が重複しています');
                }
                seenTypes.add(constructionTypeId);
                parsed.push({ constructionTypeId, amount });
            }
            subcontractorCostsInput = parsed;
        }
        if (body.scaffoldingSpec !== undefined) updateData.scaffoldingSpec = body.scaffoldingSpec;
        if (body.description !== undefined) updateData.description = body.description;
        if (body.remarks !== undefined) updateData.remarks = body.remarks || null;
        if (body.createdBy !== undefined) updateData.createdBy = stringifyJsonField(body.createdBy);

        // 既存値と実際に差分があるフィールドだけを残す（updatedAt/updatedBy を無駄に進めないため）
        const changedData: Record<string, unknown> = {};
        for (const [key, newValue] of Object.entries(updateData)) {
            const currentValue = (existing as Record<string, unknown>)[key];
            if (!isPrismaFieldEqual(currentValue, newValue)) {
                changedData[key] = newValue;
            }
        }

        const hasSubcontractorUpdate = subcontractorCostsInput !== undefined;
        const hasFieldChanges = Object.keys(changedData).length > 0;

        if (!hasFieldChanges && !hasSubcontractorUpdate) {
            const current = await prisma.projectMaster.findUnique({
                where: { id },
                include: { subcontractorCosts: { orderBy: { sortOrder: 'asc' } } },
            });
            const flags = await getDocFlags(id);
            return NextResponse.json({ ...formatProjectMaster(current ?? existing), ...flags });
        }

        if (hasFieldChanges) {
            changedData.updatedBy = session!.user.id;
        }

        const projectMaster = await prisma.$transaction(async (tx) => {
            if (hasFieldChanges) {
                await tx.projectMaster.update({ where: { id }, data: changedData });
            }
            if (hasSubcontractorUpdate) {
                await tx.projectMasterSubcontractorCost.deleteMany({ where: { projectMasterId: id } });
                if (subcontractorCostsInput!.length > 0) {
                    await tx.projectMasterSubcontractorCost.createMany({
                        data: subcontractorCostsInput!.map((c, idx) => ({
                            projectMasterId: id,
                            constructionTypeId: c.constructionTypeId,
                            amount: c.amount,
                            sortOrder: idx,
                        })),
                    });
                }
                // 協力業者費だけ変更された場合も updatedBy / updatedAt を進める
                if (!hasFieldChanges) {
                    await tx.projectMaster.update({
                        where: { id },
                        data: { updatedBy: session!.user.id },
                    });
                }
            }
            return tx.projectMaster.findUnique({
                where: { id },
                include: { subcontractorCosts: { orderBy: { sortOrder: 'asc' } } },
            });
        });

        const flags = await getDocFlags(id);
        return NextResponse.json({ ...formatProjectMaster(projectMaster!), ...flags });
    } catch (error) {
        return serverErrorResponse('案件マスターの更新', error);
    }
}

function isPrismaFieldEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    if (typeof a === 'object' && typeof b === 'object') {
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }
    return false;
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!isManagerOrAbove(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        await prisma.projectMaster.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return serverErrorResponse('案件マスターの削除', error);
    }
}
