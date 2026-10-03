'use client';

/**
 * 画面「評価ポイント」（docs/指示書_評価ポイント.md の 7-3・7-4）。
 *
 * Phase 3 では管理者・マネージャーの画面だけ（入口は MainContent が admin・manager に絞っている）。
 * Phase 4 で、ここに mode（'manager' / 'member' / 'none'）での出し分けを足す:
 *   'manager' → EvaluationPointsManagerView ／ 'member' → 本人の画面 ／ 'none' → 「アクセス権限がありません」
 */
import React from 'react';
import { useSession } from 'next-auth/react';
import { isEvaluationPointManager } from '@/lib/evaluationPoints';
import EvaluationPointsManagerView from './EvaluationPointsManagerView';

export default function EvaluationPointsPage() {
    const { data: session } = useSession();
    if (!isEvaluationPointManager(session?.user?.role)) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">アクセス権限がありません</p>
            </div>
        );
    }
    return <EvaluationPointsManagerView />;
}
