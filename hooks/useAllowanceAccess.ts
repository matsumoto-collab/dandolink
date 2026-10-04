'use client';

/**
 * 「手当」の画面の見せ方（docs/指示書_大規模手当.md の 6-7・7-4）。メニュー（Sidebar）と画面（AllowancesPage）が使う。
 *
 *  - admin・manager           → 通信せずに 'manager'
 *  - worker・foreman1・foreman2 → GET /api/allowances/access を1回だけ読んで、その mode
 *                                （読めるまで・失敗したときは 'none'）
 *  - それ以外のロール          → 通信せずに 'none'
 *
 * ロールの判定は lib/allowances.ts の関数で行う（小文字にそろえて比べる）。
 * loading は「職長・作業員で、まだ読めていない」あいだだけ true（画面が「読み込み中」と「権限なし」を見分けるため）。
 * 作りは hooks/useEvaluationPointAccess.ts と同じ（評価ポイントの部品は使わない）。
 */
import { useEffect, useState } from 'react';
import { isAllowanceManager, isAllowanceMemberRole } from '@/lib/allowances';
import { logger } from '@/lib/logger';

export type AllowanceAccessMode = 'manager' | 'member' | 'none';

export const ALLOWANCE_ACCESS_URL = '/api/allowances/access';

function isAccessMode(value: unknown): value is AllowanceAccessMode {
    return value === 'manager' || value === 'member' || value === 'none';
}

export function useAllowanceAccess(role: string | null | undefined): { mode: AllowanceAccessMode; loading: boolean } {
    const isManager = isAllowanceManager(role);
    const needsFetch = !isManager && isAllowanceMemberRole(role);

    const [fetched, setFetched] = useState<{ mode: AllowanceAccessMode; done: boolean }>({ mode: 'none', done: false });

    useEffect(() => {
        if (!needsFetch) return;
        let cancelled = false;
        setFetched({ mode: 'none', done: false });
        (async () => {
            let mode: AllowanceAccessMode = 'none';
            try {
                const res = await fetch(ALLOWANCE_ACCESS_URL, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { mode?: unknown };
                if (isAccessMode(body.mode)) mode = body.mode;
            } catch (e) {
                // 失敗したときは見せない（メニューに出ないだけで、ほかの画面は使える）
                logger.error('手当の表示の設定の取得に失敗:', e);
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
