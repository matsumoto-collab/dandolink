'use client';

/**
 * 「評価ポイント」の画面の見せ方（docs/指示書_評価ポイント.md の 7-4）。メニュー（Sidebar）と画面（EvaluationPointsPage）が使う。
 *
 *  - admin・manager           → 通信せずに 'manager'
 *  - worker・foreman1・foreman2 → GET /api/evaluation-points/access を1回だけ読んで、その mode
 *                                （読めるまで・失敗したときは 'none'）
 *  - それ以外のロール          → 通信せずに 'none'
 *
 * ロールの判定は lib/evaluationPoints.ts の関数で行う（小文字にそろえて比べる）。
 * loading は「職長・作業員で、まだ読めていない」あいだだけ true（画面が「読み込み中」と「権限なし」を見分けるため）。
 */
import { useEffect, useState } from 'react';
import { isEvaluationPointManager, isEvaluationPointMemberRole } from '@/lib/evaluationPoints';
import { logger } from '@/lib/logger';

export type EvaluationPointAccessMode = 'manager' | 'member' | 'none';

export const EVALUATION_POINT_ACCESS_URL = '/api/evaluation-points/access';

function isAccessMode(value: unknown): value is EvaluationPointAccessMode {
    return value === 'manager' || value === 'member' || value === 'none';
}

export function useEvaluationPointAccess(role: string | null | undefined): { mode: EvaluationPointAccessMode; loading: boolean } {
    const isManager = isEvaluationPointManager(role);
    const needsFetch = !isManager && isEvaluationPointMemberRole(role);

    const [fetched, setFetched] = useState<{ mode: EvaluationPointAccessMode; done: boolean }>({ mode: 'none', done: false });

    useEffect(() => {
        if (!needsFetch) return;
        let cancelled = false;
        setFetched({ mode: 'none', done: false });
        (async () => {
            let mode: EvaluationPointAccessMode = 'none';
            try {
                const res = await fetch(EVALUATION_POINT_ACCESS_URL, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { mode?: unknown };
                if (isAccessMode(body.mode)) mode = body.mode;
            } catch (e) {
                // 失敗したときは見せない（メニューに出ないだけで、ほかの画面は使える）
                logger.error('評価ポイントの表示の設定の取得に失敗:', e);
            }
            if (!cancelled) setFetched({ mode, done: true });
        })();
        return () => {
            cancelled = true;
        };
    }, [needsFetch]);

    if (isManager) return { mode: 'manager', loading: false };
    if (!needsFetch) return { mode: 'none', loading: false };
    return { mode: fetched.done ? fetched.mode : 'none', loading: !fetched.done };
}
