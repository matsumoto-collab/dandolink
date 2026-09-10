'use client';

/**
 * 「人工あたり加工高」の判定設定（仕様1-5・2-1）。
 * 保存先は SystemSettings。金額を含むので admin / manager 以外にはタブごと出さない
 * （API 側でもこの4項目は該当ロール以外に返さない）。
 */
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface SettingsResponse {
    breakevenValueAddedPerManday?: number | null;
    outsourcingRatioThreshold?: string | number;
    billingShortRatio?: string | number;
    judgeWarningRatio?: string | number;
}

/** 0〜1 の比率を「%」の入力値へ */
function toPercentInput(value: string | number | null | undefined, fallback: number): string {
    const n = Number(value);
    return String(Math.round((Number.isFinite(n) ? n : fallback) * 100));
}

export default function ValueAddedSettingsPanel() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [breakeven, setBreakeven] = useState('');
    const [outsourcingThreshold, setOutsourcingThreshold] = useState('50');
    const [billingShort, setBillingShort] = useState('70');
    const [judgeWarning, setJudgeWarning] = useState('80');

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/settings');
                if (!res.ok) throw new Error('設定の取得に失敗しました');
                const data: SettingsResponse = await res.json();
                setBreakeven(data.breakevenValueAddedPerManday != null ? String(data.breakevenValueAddedPerManday) : '');
                setOutsourcingThreshold(toPercentInput(data.outsourcingRatioThreshold, 0.5));
                setBillingShort(toPercentInput(data.billingShortRatio, 0.7));
                setJudgeWarning(toPercentInput(data.judgeWarningRatio, 0.8));
            } catch (err) {
                logger.error('Failed to fetch value-added settings', err);
                toast.error('設定の取得に失敗しました');
            } finally {
                setIsLoading(false);
            }
        })();
    }, []);

    const handleSave = async () => {
        // しきい値は空欄可（＝未設定＝判定色を出さない）
        const breakevenValue = breakeven.trim() === '' ? null : parseInt(breakeven, 10);
        if (breakevenValue !== null && (isNaN(breakevenValue) || breakevenValue < 0)) {
            toast.error('損益分岐の人工単価は0以上の整数で入力してください');
            return;
        }
        const outsourcing = parseInt(outsourcingThreshold, 10);
        const billing = parseInt(billingShort, 10);
        const warning = parseInt(judgeWarning, 10);
        if ([outsourcing, billing, warning].some(v => isNaN(v) || v < 0 || v > 100)) {
            toast.error('各比率は0〜100の整数で入力してください');
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch('/api/master-data/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    breakevenValueAddedPerManday: breakevenValue,
                    outsourcingRatioThreshold: outsourcing / 100,
                    billingShortRatio: billing / 100,
                    judgeWarningRatio: warning / 100,
                }),
            });
            if (!res.ok) throw new Error('保存に失敗しました');
            toast.success('設定を保存しました');
        } catch (err) {
            logger.error('Failed to save value-added settings', err);
            toast.error('保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className="text-center py-8 text-slate-500">読み込み中...</div>;
    }

    return (
        <div className="max-w-2xl space-y-6">
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
