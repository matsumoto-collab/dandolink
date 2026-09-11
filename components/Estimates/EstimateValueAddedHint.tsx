'use client';

/**
 * 見積書作成時の「人工あたり加工高」の目安（仕様3-5）。
 *
 * 予定で試算する: 売上＝見積額(税抜)、原価＝案件マスタの人件費以外の予定原価、
 * 人工＝予定組立人工＋予定解体人工。しきい値に届かない場合は、
 * 「見積額をいくら以上にするか」「人工を何人工以内に収めるか」を逆算して出す。
 *
 * 金額を含むので admin / manager のときだけ描画する（しきい値もこの2ロールにしか返らない）。
 */
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { logger } from '@/lib/logger';
import type { ProjectMaster } from '@/types/calendar';
import {
    DEFAULT_VALUE_ADDED_SETTINGS,
    previewEstimateValueAdded,
    type ValueAddedSettings,
} from '@/lib/valueAdded';
import { ValueAddedJudgementBadge } from '@/components/ui/ValueAddedBadge';

interface Props {
    /** 見積額（税抜小計） */
    subtotal: number;
    projectMaster?: ProjectMaster;
}

function yen(value: number): string {
    return value.toLocaleString('ja-JP');
}

export default function EstimateValueAddedHint({ subtotal, projectMaster }: Props) {
    const { data: session } = useSession();
    const role = session?.user?.role;
    const canSee = role === 'admin' || role === 'manager';
    const [settings, setSettings] = useState<ValueAddedSettings | null>(null);

    useEffect(() => {
        if (!canSee) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/master-data/settings');
                if (!res.ok) return;
                const data = await res.json() as {
                    laborDailyRate?: string | number;
                    breakevenValueAddedPerManday?: number | null;
                    outsourcingRatioThreshold?: string | number;
                    billingShortRatio?: string | number;
                    judgeWarningRatio?: string | number;
                };
                if (cancelled) return;
                setSettings({
                    breakevenPerManday: data.breakevenValueAddedPerManday ?? null,
                    outsourcingRatioThreshold: Number(data.outsourcingRatioThreshold ?? DEFAULT_VALUE_ADDED_SETTINGS.outsourcingRatioThreshold),
                    billingShortRatio: Number(data.billingShortRatio ?? DEFAULT_VALUE_ADDED_SETTINGS.billingShortRatio),
                    judgeWarningRatio: Number(data.judgeWarningRatio ?? DEFAULT_VALUE_ADDED_SETTINGS.judgeWarningRatio),
                    laborDailyRate: Number(data.laborDailyRate ?? DEFAULT_VALUE_ADDED_SETTINGS.laborDailyRate),
                });
            } catch (e) {
                logger.error('判定設定の取得に失敗:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [canSee]);

    if (!canSee || !projectMaster) return null;

    // 人件費以外の予定原価（材料費＋その他経費＋協力業者費の設定額）
    const subcontractorPlanned = (projectMaster.subcontractorCosts ?? []).reduce(
        (sum, c) => sum + Number(c.amount || 0) + Number(c.transportCost || 0),
        0,
    );
    const nonLaborCost =
        Number(projectMaster.materialCost || 0) +
        Number(projectMaster.otherExpenses || 0) +
        subcontractorPlanned;
    const plannedManDays =
        Number(projectMaster.estimatedAssemblyWorkers || 0) +
        Number(projectMaster.estimatedDemolitionWorkers || 0);

    if (plannedManDays <= 0) {
        return (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                案件マスタの<span className="font-medium text-slate-600">予定組立人工・予定解体人工</span>を入れると、
                この見積での「一人当たりの稼ぎ」の目安が出ます。
            </div>
        );
    }

    const preview = previewEstimateValueAdded(
        { sales: subtotal, nonLaborCost, plannedManDays },
        settings ?? DEFAULT_VALUE_ADDED_SETTINGS,
    );

    return (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-baseline flex-wrap gap-2">
                <span className="text-xs text-slate-500">この見積だと 一人当たりの稼ぎは</span>
                <span className="text-xl font-bold tabular-nums text-slate-800">
                    {preview.perManday !== null ? yen(preview.perManday) : '—'}
                </span>
                <span className="text-xs text-slate-500">円</span>
                <ValueAddedJudgementBadge judgement={preview.judgement} size="sm" />
            </div>

            <p className="mt-1.5 text-xs text-slate-500">
                稼ぎ {yen(preview.valueAdded)}円（見積 {yen(subtotal)} − 人件費以外の予定原価 {yen(nonLaborCost)}）
                ÷ 予定人工 {plannedManDays} 人工
                {settings?.breakevenPerManday != null && preview.achievementRate !== null
                    ? ` ／ 最低ライン ${yen(settings.breakevenPerManday)}円 の ${preview.achievementRate}%`
                    : ''}
            </p>

            {preview.requiredSales !== null && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    最低ラインを満たすには、見積額を <span className="font-semibold tabular-nums">{yen(preview.requiredSales)}円</span> 以上にするか、
                    予定人工を <span className="font-semibold tabular-nums">{preview.allowedManDays}</span> 人工以内に収める必要があります。
                </p>
            )}

            {settings?.breakevenPerManday == null && (
                <p className="mt-2 text-xs text-slate-400">
                    最低ラインが未設定のため判定は出ません（設定＞一人当たりの稼ぎ で入力できます）。
                </p>
            )}
        </div>
    );
}
