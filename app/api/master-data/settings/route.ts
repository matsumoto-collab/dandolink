import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';
import { systemSettingsSchema, validateRequest } from '@/lib/validations';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        let settings = await prisma.systemSettings.findFirst({ where: { id: 'default' } });
        if (!settings) {
            settings = await prisma.systemSettings.create({ data: { id: 'default', totalMembers: 20 } });
        }

        // 「人工あたり加工高」の判定設定は金額・判定の内部値なので admin / manager だけに返す
        // （仕様5章: 権限のないユーザーにはフィールド自体を返さない）
        const role = session!.user.role;
        if (role !== 'admin' && role !== 'manager') {
            const {
                breakevenValueAddedPerManday: _breakeven,
                outsourcingRatioThreshold: _outsourcing,
                billingShortRatio: _billing,
                judgeWarningRatio: _warning,
                ...rest
            } = settings;
            return NextResponse.json(rest);
        }
        return NextResponse.json(settings);
    } catch (error) {
        return serverErrorResponse('システム設定取得', error);
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await request.json();
        const validation = validateRequest(systemSettingsSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error, validation.details);
        }
        const {
            totalMembers,
            subcontractorRevenueRate,
            subcontractorAssemblyRate,
            subcontractorDemolitionRate,
            breakevenValueAddedPerManday,
            outsourcingRatioThreshold,
            billingShortRatio,
            judgeWarningRatio,
        } = validation.data;

        const updateData: Record<string, unknown> = {};
        if (totalMembers !== undefined) updateData.totalMembers = totalMembers;
        if (subcontractorRevenueRate !== undefined) updateData.subcontractorRevenueRate = subcontractorRevenueRate;
        if (subcontractorAssemblyRate !== undefined) updateData.subcontractorAssemblyRate = subcontractorAssemblyRate;
        if (subcontractorDemolitionRate !== undefined) updateData.subcontractorDemolitionRate = subcontractorDemolitionRate;
        // 人工あたり加工高の判定設定（null を渡すと「未設定＝判定しない」に戻せる）
        if (breakevenValueAddedPerManday !== undefined) updateData.breakevenValueAddedPerManday = breakevenValueAddedPerManday;
        if (outsourcingRatioThreshold !== undefined) updateData.outsourcingRatioThreshold = outsourcingRatioThreshold;
        if (billingShortRatio !== undefined) updateData.billingShortRatio = billingShortRatio;
        if (judgeWarningRatio !== undefined) updateData.judgeWarningRatio = judgeWarningRatio;

        const createData = {
            id: 'default',
            totalMembers: totalMembers ?? 20,
            ...(subcontractorRevenueRate !== undefined ? { subcontractorRevenueRate } : {}),
            ...(subcontractorAssemblyRate !== undefined ? { subcontractorAssemblyRate } : {}),
            ...(subcontractorDemolitionRate !== undefined ? { subcontractorDemolitionRate } : {}),
            ...(breakevenValueAddedPerManday !== undefined ? { breakevenValueAddedPerManday } : {}),
            ...(outsourcingRatioThreshold !== undefined ? { outsourcingRatioThreshold } : {}),
            ...(billingShortRatio !== undefined ? { billingShortRatio } : {}),
            ...(judgeWarningRatio !== undefined ? { judgeWarningRatio } : {}),
        };

        const settings = await prisma.systemSettings.upsert({
            where: { id: 'default' },
            update: updateData,
            create: createData,
        });
        return NextResponse.json(settings);
    } catch (error) {
        return serverErrorResponse('システム設定更新', error);
    }
}
