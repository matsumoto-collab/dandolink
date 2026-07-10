'use client';

import React from 'react';
import type { MonthlySalesData } from '@/lib/profitDashboard';
import MonthlySalesPanel from './MonthlySalesPanel';

// 月次パネルが主役のシンプルな構成（kei決定 2026-07-10）。
// 旧構成（フィルタパネル・KPIカード4枚・要注意案件・案件別/顧客別/工事種別/職長別テーブル）は
// 「ダッシュボードを月次中心に再編」コミットで削除した（復元は当該コミットの revert）。
interface Props {
    monthlySales: MonthlySalesData;
}

export default function ProfitDashboardClient({ monthlySales }: Props) {
    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
            <div className="max-w-[1800px] mx-auto">
                {/* ヘッダー（モバイルは説明文非表示） */}
                <div className="mb-4 sm:mb-6">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">利益ダッシュボード</h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">
                        月次の売上・原価・粗利を、期間（当月/年間/期間指定）×担当者別/顧客別×絞り込みで多角的に確認できます
                    </p>
                </div>

                <MonthlySalesPanel data={monthlySales} />
            </div>
        </div>
    );
}
