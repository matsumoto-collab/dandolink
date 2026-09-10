/**
 * 「人工あたり加工高」の判定設定をDB（SystemSettings）から読み出す。サーバー専用。
 * 計算そのものは lib/valueAdded.ts（純粋関数・クライアントからも使える）に置いている。
 */
import { prisma } from '@/lib/prisma';
import { DEFAULT_VALUE_ADDED_SETTINGS, type ValueAddedSettings } from '@/lib/valueAdded';

export async function loadValueAddedSettings(): Promise<ValueAddedSettings> {
    const settings = await prisma.systemSettings.findFirst({
        where: { id: 'default' },
        select: {
            laborDailyRate: true,
            breakevenValueAddedPerManday: true,
            outsourcingRatioThreshold: true,
            billingShortRatio: true,
            judgeWarningRatio: true,
        },
    });
    if (!settings) return DEFAULT_VALUE_ADDED_SETTINGS;
    return {
        breakevenPerManday: settings.breakevenValueAddedPerManday ?? null,
        outsourcingRatioThreshold: Number(settings.outsourcingRatioThreshold ?? DEFAULT_VALUE_ADDED_SETTINGS.outsourcingRatioThreshold),
        billingShortRatio: Number(settings.billingShortRatio ?? DEFAULT_VALUE_ADDED_SETTINGS.billingShortRatio),
        judgeWarningRatio: Number(settings.judgeWarningRatio ?? DEFAULT_VALUE_ADDED_SETTINGS.judgeWarningRatio),
        laborDailyRate: Number(settings.laborDailyRate ?? DEFAULT_VALUE_ADDED_SETTINGS.laborDailyRate),
    };
}
