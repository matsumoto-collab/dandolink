'use client';

/**
 * 画面「手当」（docs/指示書_大規模手当.md の 7-3）。
 *
 * Phase 4 では、管理者・マネージャーの画面（AllowancesManagerView）を出すだけ。
 * 入口のロールの絞り込み（admin・manager）は MainContent が行う（API も同じ決まりで 403）。
 * 本人の画面（見せ方 mode の出し分け）は Phase 5 で、ここに足す。
 */
import React from 'react';
import AllowancesManagerView from './AllowancesManagerView';

export default function AllowancesPage() {
    return <AllowancesManagerView />;
}
