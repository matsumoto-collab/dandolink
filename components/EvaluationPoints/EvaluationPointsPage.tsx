'use client';

/**
 * 画面「評価ポイント」（docs/指示書_評価ポイント.md の 7-3・7-4）。
 *
 * 入口は MainContent が admin・manager・foreman1・foreman2・worker に絞っている。
 * ここで見せ方（mode。hooks/useEvaluationPointAccess）を見て出し分ける:
 *   'manager' → EvaluationPointsManagerView（全員の一覧）
 *   'member'  → EvaluationPointsMemberView（自分の点数と内訳だけ）
 *   'none'    → 「ありがとう」を使う設定なら（hooks/useEvaluationThanksAccess の enabled）「ありがとう」の欄だけ
 *               （点数は出ない。GET /thanks/me が showPoints: false で返す）。そうでなければ「アクセス権限がありません」
 * API も同じ決まりで断る（GET /me は 'none' なら 403）ので、画面の出し分けは見た目のためだけ。
 */
import React from 'react';
import { useSession } from 'next-auth/react';
import { useEvaluationPointAccess } from '@/hooks/useEvaluationPointAccess';
import { useEvaluationThanksAccess } from '@/hooks/useEvaluationThanksAccess';
import Loading from '@/components/ui/Loading';
import EvaluationPointsManagerView from './EvaluationPointsManagerView';
import EvaluationPointsMemberView from './EvaluationPointsMemberView';
import EvaluationThanksPanel from './EvaluationThanksPanel';

export default function EvaluationPointsPage() {
    const { data: session } = useSession();
    const { mode, loading } = useEvaluationPointAccess(session?.user?.role);
    const { enabled: thanksEnabled, loading: thanksLoading } = useEvaluationThanksAccess(session?.user?.role);

    if (mode === 'manager') return <EvaluationPointsManagerView />;
    if (mode === 'member') return <EvaluationPointsMemberView />;
    // 見せ方が読めるまでは「ありがとう」だけの画面も出さない（読めたら本人の画面になることがあるので）
    if (!loading && thanksEnabled) {
        return (
            <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="flex flex-col gap-3 max-w-2xl w-full mx-auto min-w-0 pb-2">
                    <h1 className="text-xl font-bold text-slate-900">評価ポイント</h1>
                    <EvaluationThanksPanel showStatus />
                </div>
            </div>
        );
    }
    if (loading || thanksLoading) {
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
