'use client';

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface SystemSettings {
    totalMembers: number;
    subcontractorRevenueRate: number;
    subcontractorAssemblyRate: number;
    subcontractorDemolitionRate: number;
}

export default function SystemSettingsPanel() {
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [revenueRate, setRevenueRate] = useState('60');
    const [assemblyRate, setAssemblyRate] = useState('60');
    const [demolitionRate, setDemolitionRate] = useState('40');

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/settings');
                if (!res.ok) throw new Error('設定の取得に失敗しました');
                const data: SystemSettings = await res.json();
                setRevenueRate(String(data.subcontractorRevenueRate ?? 60));
                setAssemblyRate(String(data.subcontractorAssemblyRate ?? 60));
                setDemolitionRate(String(data.subcontractorDemolitionRate ?? 40));
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
        setIsSaving(true);
        try {
            const res = await fetch('/api/master-data/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subcontractorRevenueRate: rev,
                    subcontractorAssemblyRate: asm,
                    subcontractorDemolitionRate: dem,
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

            <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg text-sm disabled:opacity-50"
            >
                {isSaving ? '保存中...' : '保存'}
            </button>
        </div>
    );
}
