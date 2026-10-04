'use client';

/**
 * 画面「手当」（docs/指示書_大規模手当.md の 7-3・7-4）。
 *
 * 入口は MainContent が admin・manager・foreman1・foreman2・worker に絞っている。
 * ここで見せ方（mode。hooks/useAllowanceAccess）を見て出し分ける:
 *   'manager' → AllowancesManagerView（全員の集計・明細・締め）
 *   'member'  → AllowancesMemberView（自分の手当の日数と金額だけ）
 *   'none'    → 「アクセス権限がありません」
 * API も同じ決まりで断る（GET /me は 'none' なら 403）ので、画面の出し分けは見た目のためだけ。
 */
import React from 'react';
import { useSession } from 'next-auth/react';
import { useAllowanceAccess } from '@/hooks/useAllowanceAccess';
import Loading from '@/components/ui/Loading';
import AllowancesManagerView from './AllowancesManagerView';
import AllowancesMemberView from './AllowancesMemberView';

export default function AllowancesPage() {
    const { data: session } = useSession();
    const { mode, loading } = useAllowanceAccess(session?.user?.role);

    if (mode === 'manager') return <AllowancesManagerView />;
    if (mode === 'member') return <AllowancesMemberView />;
    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loading text="手当を読み込み中..." />
            </div>
        );
    }
    return (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500">アクセス権限がありません</p>
        </div>
    );
}
