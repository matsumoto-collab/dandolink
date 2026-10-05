'use client';

/**
 * 評価ポイント「ありがとう」を送れるか（メニュー Sidebar・画面 EvaluationPointsPage が使う）。
 *
 *  - worker・foreman1・foreman2 → GET /api/evaluation-points/thanks/access を1回だけ読んで、その enabled
 *                                （読めるまで・失敗したときは false）
 *  - それ以外のロール（admin・manager も）→ 通信せずに false
 *    （admin・manager は「評価ポイント」の画面がいつも出るので、メニューの出し分けには要らない）
 *
 * ロールの判定は lib/evaluationPoints.ts の関数で行う（小文字にそろえて比べる）。
 * loading は「職長・作業員で、まだ読めていない」あいだだけ true。
 */
import { useEffect, useState } from 'react';
import { isEvaluationPointMemberRole } from '@/lib/evaluationPoints';
import { logger } from '@/lib/logger';

export const EVALUATION_THANKS_ACCESS_URL = '/api/evaluation-points/thanks/access';

export function useEvaluationThanksAccess(role: string | null | undefined): { enabled: boolean; loading: boolean } {
    const needsFetch = isEvaluationPointMemberRole(role);

    const [fetched, setFetched] = useState<{ enabled: boolean; done: boolean }>({ enabled: false, done: false });

    useEffect(() => {
        if (!needsFetch) return;
        let cancelled = false;
        setFetched({ enabled: false, done: false });
        (async () => {
            let enabled = false;
            try {
                const res = await fetch(EVALUATION_THANKS_ACCESS_URL, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { enabled?: unknown };
                enabled = body.enabled === true;
            } catch (e) {
                // 失敗したときは出さない（メニューに出ないだけで、ほかの画面は使える）
                logger.error('「ありがとう」の表示の設定の取得に失敗:', e);
            }
            if (!cancelled) setFetched({ enabled, done: true });
        })();
        return () => {
            cancelled = true;
        };
    }, [needsFetch]);

    if (!needsFetch) return { enabled: false, loading: false };
    return { enabled: fetched.done ? fetched.enabled : false, loading: !fetched.done };
}
