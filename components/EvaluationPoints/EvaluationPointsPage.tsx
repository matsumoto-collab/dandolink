'use client';

/**
 * 画面「評価ポイント」（docs/指示書_評価ポイント.md の 7-3・7-4）。
 *
 * 入口は MainContent が admin・manager・foreman1・foreman2・worker に絞っている。
 * ここで見せ方（mode。hooks/useEvaluationPointAccess）を見て出し分ける:
 *   'manager' → EvaluationPointsManagerView（全員の一覧）
 *   'member'  → EvaluationPointsMemberView（自分の点数と内訳だけ）
 *   'none'    → 「アクセス権限がありません」
 * API も同じ決まりで断る（GET /me は 'none' なら 403）ので、画面の出し分けは見た目のためだけ。
 */
import React from 'react';
import { useSession } from 'next-auth/react';
import { useEvaluationPointAccess } from '@/hooks/useEvaluationPointAccess';
import Loading from '@/components/ui/Loading';
import EvaluationPointsManagerView from './EvaluationPointsManagerView';
import EvaluationPointsMemberView from './EvaluationPointsMemberView';

export default function EvaluationPointsPage() {
    const { data: session } = useSession();
    const { mode, loading } = useEvaluationPointAccess(session?.user?.role);

    if (mode === 'manager') return <EvaluationPointsManagerView />;
    if (mode === 'member') return <EvaluationPointsMemberView />;
    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loading text="評価ポイントを読み込み中..." />
            </div>
        );
    }
    return (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500">アクセス権限がありません</p>
        </div>
    );
}
