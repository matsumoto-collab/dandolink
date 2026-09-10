'use client';

import React, { useState } from 'react';
import type { MonthlySalesData } from '@/lib/profitDashboard';
import MonthlySalesPanel from './MonthlySalesPanel';
import LaborProductivityPanel from './LaborProductivityPanel';

// 月次パネルが主役のシンプルな構成（kei決定 2026-07-10）。
// 旧構成（フィルタパネル・KPIカード4枚・要注意案件・案件別/顧客別/工事種別/職長別テーブル）は
// 「ダッシュボードを月次中心に再編」コミットで削除した（復元は当該コミットの revert）。
interface Props {
    monthlySales: MonthlySalesData;
}

const TABS = [
    { key: 'monthly' as const, label: '月次売上' },
    { key: 'productivity' as const, label: '人工生産性' },
];

export default function ProfitDashboardClient({ monthlySales }: Props) {
    // 人工生産性は原価エンジンを全件で回すため、タブを開いたときに初めて取りに行く
    const [tab, setTab] = useState<'monthly' | 'productivity'>('monthly');

    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
            <div className="max-w-[1800px] mx-auto">
                {/* ヘッダー（モバイルは説明文非表示） */}
                <div className="mb-4 sm:mb-6">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">利益ダッシュボード</h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">
                        {tab === 'monthly'
                            ? '月次の売上・原価・粗利を、期間（当月/年間/期間指定）×担当者別/顧客別×絞り込みで多角的に確認できます'
                            : '加工高（売上 − 人件費以外の原価）を投入した人工で割り、どの現場・どの顧客が会社に残しているかを見ます'}
                    </p>
                </div>

                <div className="flex items-center gap-1 mb-4">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-4 py-2 text-sm rounded-xl border transition-colors ${
                                tab === t.key
                                    ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'monthly' ? <MonthlySalesPanel data={monthlySales} /> : <LaborProductivityPanel />}
            </div>
        </div>
    );
}
