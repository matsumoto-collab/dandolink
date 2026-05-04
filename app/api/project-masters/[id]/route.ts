import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, stringifyJsonField, errorResponse, notFoundResponse, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';
import { canDispatch, isManagerOrAbove } from '@/utils/permissions';
import { formatProjectMaster, stripProjectMasterFinancials } from '@/lib/formatters';

// 配置の副作用としての同期更新では、ProjectMaster.updatedAt を進めない。
// ユーザーが案件詳細を明示的に編集していないのに「最終更新日」が
// 変わると混乱を招くため、syncOnly フラグで raw SQL 更新に切り替える。
// ※この設計は意図的なので、通常の update に戻さないでください。
//
// カラム識別子は SQL インジェクション防止のためホワイトリストで
// ハードコード。値は ${} で渡し Prisma 側でパラメータ化させる。
// 対応カラムは PATCH の updateData が書き込みうるカラム集合と一致させる。
const SYNC_COLUMN_FRAGMENTS: Record<string, (v: unknown) => Prisma.Sql> = {
    name: (v) => Prisma.sql`"name" = ${v}`,
    honorific: (v) => Prisma.sql`"honorific" = ${v}`,
    constructionSuffixId: (v) => Prisma.sql`"constructionSuffixId" = ${v}`,
    siteShortName: (v) => Prisma.sql`"siteShortName" = ${v}`,
    title: (v) => Prisma.sql`"title" = ${v}`,
    customerId: (v) => Prisma.sql`"customerId" = ${v}`,
    customerName: (v) => Prisma.sql`"customerName" = ${v}`,
    customerShortName: (v) => Prisma.sql`"customerShortName" = ${v}`,
    constructionType: (v) => Prisma.sql`"constructionType" = ${v}`,
    constructionContent: (v) => Prisma.sql`"constructionContent" = ${v}`,
    status: (v) => Prisma.sql`"status" = ${v}`,
    location: (v) => Prisma.sql`"location" = ${v}`,
    postalCode: (v) => Prisma.sql`"postalCode" = ${v}`,
    prefecture: (v) => Prisma.sql`"prefecture" = ${v}`,
    city: (v) => Prisma.sql`"city" = ${v}`,
    plusCode: (v) => Prisma.sql`"plusCode" = ${v}`,
    latitude: (v) => Prisma.sql`"latitude" = ${v}`,
    longitude: (v) => Prisma.sql`"longitude" = ${v}`,
    area: (v) => Prisma.sql`"area" = ${v}`,
    areaRemarks: (v) => Prisma.sql`"areaRemarks" = ${v}`,
    estimatedAssemblyWorkers: (v) => Prisma.sql`"estimatedAssemblyWorkers" = ${v}`,
    estimatedDemolitionWorkers: (v) => Prisma.sql`"estimatedDemolitionWorkers" = ${v}`,
    contractAmount: (v) => Prisma.sql`"contractAmount" = ${v}`,
    materialCost: (v) => Prisma.sql`"materialCost" = ${v}`,
    otherExpenses: (v) => Prisma.sql`"otherExpenses" = ${v}`,
    scaffoldingSpec: (v) => Prisma.sql`"scaffoldingSpec" = ${v === null ? null : JSON.stringify(v)}::jsonb`,
    description: (v) => Prisma.sql`"description" = ${v}`,
    remarks: (v) => Prisma.sql`"remarks" = ${v}`,
    createdBy: (v) => Prisma.sql`"createdBy" = ${v}`,
};

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
        const { session, error } = await requireAuth();
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
        const role = session!.user.role;
        const canSeeFinancials = role === 'admin' || role === 'manager';
        const formatted = formatProjectMaster(projectMaster);
        const payload = canSeeFinancials ? formatted : stripProjectMasterFinancials(formatted);
        return NextResponse.json({ ...payload, ...flags });
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
        const syncOnly = new URL(req.url).searchParams.get('syncOnly') === 'true';

        const VALID_STATUSES = ['active', 'completed', 'cancelled'];

        const existing = await prisma.projectMaster.findUnique({ where: { id } });
        if (!existing) return notFoundResponse('案件マスター');

        const updateData: Record<string, unknown> = {};
        if (body.name !== undefined) updateData.name = body.name || null;
        if (body.honorific !== undefined) updateData.honorific = body.honorific ?? null;
        if (body.constructionSuffixId !== undefined) updateData.constructionSuffixId = body.constructionSuffixId || null;
        if (body.siteShortName !== undefined) updateData.siteShortName = body.siteShortName || null;

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

        // customerId または customerName が変わる場合は、Customer テーブルから
        // shortName を引き直して customerShortName も更新する。
        // （customerShortName が明示的に送られた場合はそちらを優先）
        if (body.customerShortName !== undefined) {
            updateData.customerShortName = body.customerShortName || null;
        } else {
            const nextCustomerId =
                body.customerId !== undefined ? body.customerId : existing.customerId;
            const nextCustomerName =
                body.customerName !== undefined ? body.customerName : existing.customerName;
            const customerIdChanged =
                body.customerId !== undefined && body.customerId !== existing.customerId;
            const customerNameChanged =
                body.customerName !== undefined && body.customerName !== existing.customerName;

            if (customerIdChanged || customerNameChanged) {
                let resolvedShortName: string | null = null;
                if (nextCustomerId) {
                    const customer = await prisma.customer.findUnique({
                        where: { id: nextCustomerId },
                        select: { shortName: true },
                    });
                    resolvedShortName = customer?.shortName || null;
                } else if (nextCustomerName) {
                    const customer = await prisma.customer.findFirst({
                        where: { name: nextCustomerName },
                        select: { shortName: true },
                    });
                    resolvedShortName = customer?.shortName || null;
                }
                updateData.customerShortName = resolvedShortName;
            }
        }
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

        // syncOnly=true の時は updatedBy も更新しない（呼び出し元が
        // 明示指定しても無視）。通常時のみ updatedBy を進める。
        if (hasFieldChanges && !syncOnly) {
            changedData.updatedBy = session!.user.id;
        }
        if (syncOnly) {
            delete changedData.updatedBy;
        }

        const projectMaster = await prisma.$transaction(async (tx) => {
            if (hasFieldChanges) {
                if (syncOnly) {
                    // 配置の副作用としての同期更新では、ProjectMaster.updatedAt を進めない。
                    // Prisma の update は @updatedAt で自動更新されてしまうため raw SQL を使用。
                    // SET 句に updatedAt / updatedBy を含めない。
                    // ※この実装は意図的なので、通常の update に戻さないでください。
                    const setFragments: Prisma.Sql[] = [];
                    for (const [key, value] of Object.entries(changedData)) {
                        const fragmentBuilder = SYNC_COLUMN_FRAGMENTS[key];
                        if (fragmentBuilder) setFragments.push(fragmentBuilder(value));
                    }
                    if (setFragments.length > 0) {
                        await tx.$executeRaw(
                            Prisma.sql`UPDATE "ProjectMaster" SET ${Prisma.join(setFragments, ', ')} WHERE "id" = ${id}`
                        );
                    }
                } else {
                    await tx.projectMaster.update({ where: { id }, data: changedData });
                }
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
                // （ただし syncOnly=true の時は updatedAt 抑止のため進めない）
                if (!hasFieldChanges && !syncOnly) {
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
