'use client';

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface SystemSettings {
    totalMembers: number;
    subcontractorRevenueRate: number;
    subcontractorAssemblyRate: number;
    subcontractorDemolitionRate: number;
    breakevenValueAddedPerManday: number | null;
    outsourcingRatioThreshold: string | number;
    billingShortRatio: string | number;
    judgeWarningRatio: string | number;
}

/** 0〜1 の比率を「%」の入力値へ */
function toPercentInput(value: string | number | null | undefined, fallback: number): string {
    const n = Number(value);
    return String(Math.round((Number.isFinite(n) ? n : fallback) * 100));
}

export default function SystemSettingsPanel() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [revenueRate, setRevenueRate] = useState('60');
    const [assemblyRate, setAssemblyRate] = useState('60');
    const [demolitionRate, setDemolitionRate] = useState('40');
    // 人工あたり加工高の判定設定
    const [breakeven, setBreakeven] = useState('');
    const [outsourcingThreshold, setOutsourcingThreshold] = useState('50');
    const [billingShort, setBillingShort] = useState('70');
    const [judgeWarning, setJudgeWarning] = useState('80');

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/settings');
                if (!res.ok) throw new Error('設定の取得に失敗しました');
                const data: SystemSettings = await res.json();
                setRevenueRate(String(data.subcontractorRevenueRate ?? 60));
                setAssemblyRate(String(data.subcontractorAssemblyRate ?? 60));
                setDemolitionRate(String(data.subcontractorDemolitionRate ?? 40));
                setBreakeven(data.breakevenValueAddedPerManday != null ? String(data.breakevenValueAddedPerManday) : '');
                setOutsourcingThreshold(toPercentInput(data.outsourcingRatioThreshold, 0.5));
                setBillingShort(toPercentInput(data.billingShortRatio, 0.7));
                setJudgeWarning(toPercentInput(data.judgeWarningRatio, 0.8));
            } catch (err) {
                logger.error('Failed to fetch system settings', err);
                toast.error('設定の取得に失敗しました');
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    const handleSave = async () => {
        const rev = parseInt(revenueRate, 10);
        const asm = parseInt(assemblyRate, 10);
        const dem = parseInt(demolitionRate, 10);
        if ([rev, asm, dem].some(v => isNaN(v) || v < 0 || v > 100)) {
            toast.error('各率は0〜100の整数で入力してください');
            return;
        }
        if (asm + dem !== 100) {
            toast.error('組立率と解体率の合計は100%にしてください');
            return;
        }

        // 人工あたり加工高の判定設定。しきい値は空欄可（＝未設定＝判定色を出さない）
        const breakevenValue = breakeven.trim() === '' ? null : parseInt(breakeven, 10);
        if (breakevenValue !== null && (isNaN(breakevenValue) || breakevenValue < 0)) {
            toast.error('損益分岐の人工単価は0以上の整数で入力してください');
            return;
        }
        const outsourcing = parseInt(outsourcingThreshold, 10);
        const billing = parseInt(billingShort, 10);
        const warning = parseInt(judgeWarning, 10);
        if ([outsourcing, billing, warning].some(v => isNaN(v) || v < 0 || v > 100)) {
            toast.error('判定の各比率は0〜100の整数で入力してください');
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/master-data/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subcontractorRevenueRate: rev,
                    subcontractorAssemblyRate: asm,
                    subcontractorDemolitionRate: dem,
                    breakevenValueAddedPerManday: breakevenValue,
                    outsourcingRatioThreshold: outsourcing / 100,
                    billingShortRatio: billing / 100,
                    judgeWarningRatio: warning / 100,
                }),
            });
            if (!res.ok) throw new Error('保存に失敗しました');
            toast.success('設定を保存しました');
        } catch (err) {
            logger.error('Failed to save system settings', err);
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className="text-center py-8 text-slate-500">読み込み中...</div>;
    }

    const assemblyAmount = Math.round(100000 * (parseInt(revenueRate, 10) || 0) / 100 * (parseInt(assemblyRate, 10) || 0) / 100);
    const demolitionAmount = Math.round(100000 * (parseInt(revenueRate, 10) || 0) / 100 * (parseInt(demolitionRate, 10) || 0) / 100);

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">協力業者費 自動計算設定</h3>
                <p className="text-sm text-slate-500">
                    案件詳細で「協力業者費を自動計算」ボタンを押したときの計算ルールです。売上（税別）に対する協力業者への支払割合、さらに組立・解体への按分比率を設定します。
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">協力業者率（売上比）</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={revenueRate}
                            onChange={e => setRevenueRate(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                        />
                        <span className="text-sm text-slate-600">%</span>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">組立按分率</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={assemblyRate}
                            onChange={e => setAssemblyRate(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                        />
                        <span className="text-sm text-slate-600">%</span>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">解体按分率</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={demolitionRate}
                            onChange={e => setDemolitionRate(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                        />
                        <span className="text-sm text-slate-600">%</span>
                    </div>
                </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 mb-2">計算プレビュー（売上¥100,000の場合）</div>
                <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                        <span className="text-slate-600">協力業者費 合計</span>
                        <span className="font-semibold text-slate-800 tabular-nums">
                            ¥{(assemblyAmount + demolitionAmount).toLocaleString()}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-600 pl-3">組立</span>
                        <span className="tabular-nums text-slate-700">¥{assemblyAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-600 pl-3">解体</span>
                        <span className="tabular-nums text-slate-700">¥{demolitionAmount.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            <div className="border-t border-slate-200 pt-6 space-y-4">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">人工あたり加工高の判定</h3>
                    <p className="text-sm text-slate-500">
                        案件詳細・案件一覧・利益ダッシュボードに出る「人工あたり加工高（加工高 ÷ 総人数）」の判定に使います。
                        加工高は<span className="font-medium text-slate-600">売上 − 人件費以外の原価</span>で、人件費は引きません（月給制のため固定費として扱う）。
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">損益分岐の人工単価</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                step={100}
                                value={breakeven}
                                onChange={e => setBreakeven(e.target.value)}
                                placeholder="未設定"
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                            />
                            <span className="text-sm text-slate-600 whitespace-nowrap">円 / 人工</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                            この値以上で緑、{judgeWarning || 80}%以上で黄、それ未満で赤。空欄にすると判定色を出しません。
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">「外注中心」と判定する労務外注比率</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={outsourcingThreshold}
                                onChange={e => setOutsourcingThreshold(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                            />
                            <span className="text-sm text-slate-600">%</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                            外注費 ÷（外注費 ＋ 自社人件費）。超えた案件は「外注中心」バッジを付け、判定色は労働生産性倍率で決めます。
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">請求不足を疑う 請求額 ÷ 見積額</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={billingShort}
                                onChange={e => setBillingShort(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                            />
                            <span className="text-sm text-slate-600">%</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                            これを下回る案件はグレー表示にし、ダッシュボードの平均から除外します。
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">「注意」（黄色）判定の下限</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={judgeWarning}
                                onChange={e => setJudgeWarning(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                            />
                            <span className="text-sm text-slate-600">%</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                            しきい値のこの割合を下回ると赤（要改善）になります。
                        </p>
                    </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500">
                    しきい値の目安は「（年間の人件費 ＋ 年間の固定費）÷ 年間の延べ人工」です。
                    実績は<span className="font-medium text-slate-600">利益ダッシュボードの「人工生産性」タブ</span>で確認できます。
                </div>
            </div>

            <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg text-sm disabled:opacity-50"
            >
                {isSaving ? '保存中...' : '保存'}
            </button>
        </div>
    );
}
