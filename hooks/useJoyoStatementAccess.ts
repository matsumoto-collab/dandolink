'use client';

/**
 * 「支払明細書」の画面の見せ方。メニュー（Sidebar）と本人の画面の入口（JoyoMyStatementsPage）が使う。
 *
 *  - admin                              → 通信せずに 'admin'（管理者の画面）
 *  - manager・foreman1・foreman2・worker → GET /api/joyo-statements/access を1回だけ読んで、その mode
 *                                          （読めるまで・失敗したときは 'none'）
 *  - それ以外のロール                    → 通信せずに 'none'
 *
 * ロールは小文字にそろえて比べる（本番の User.role には大文字が混ざる）。
 * loading は「読む必要があって、まだ読めていない」あいだだけ true（画面が「読み込み中」と「権限なし」を見分けるため）。
 * 作りは hooks/useAllowanceAccess.ts と同じ（手当の部品は使わない）。
 * API（GET /me）も同じ決まりで断るので、ここでの出し分けは見た目のためだけ。
 */
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import type { JoyoStatementAccessMode } from '@/types/joyoStatement';

export type { JoyoStatementAccessMode };

export const JOYO_STATEMENT_ACCESS_URL = '/api/joyo-statements/access';

/** 対象者に選べるロールのうち admin 以外（この人たちは「自分が対象者か」をサーバーに聞く） */
const MEMBER_ROLES: readonly string[] = ['manager', 'foreman1', 'foreman2', 'worker'];

const normalizeRole = (role: string | null | undefined) => (role ?? '').toString().toLowerCase();

function isAccessMode(value: unknown): value is JoyoStatementAccessMode {
    return value === 'admin' || value === 'member' || value === 'none';
}

export function useJoyoStatementAccess(role: string | null | undefined): { mode: JoyoStatementAccessMode; loading: boolean } {
    const normalized = normalizeRole(role);
    const isAdmin = normalized === 'admin';
    const needsFetch = !isAdmin && MEMBER_ROLES.includes(normalized);

    const [fetched, setFetched] = useState<{ mode: JoyoStatementAccessMode; done: boolean }>({ mode: 'none', done: false });

    useEffect(() => {
        if (!needsFetch) return;
        let cancelled = false;
        setFetched({ mode: 'none', done: false });
        (async () => {
            let mode: JoyoStatementAccessMode = 'none';
            try {
                const res = await fetch(JOYO_STATEMENT_ACCESS_URL, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = (await res.json()) as { mode?: unknown };
                if (isAccessMode(body.mode)) mode = body.mode;
            } catch (e) {
                // 失敗したときは見せない（メニューに出ないだけで、ほかの画面は使える）
                logger.error('支払明細書の表示の設定の取得に失敗:', e);
            }
            if (!cancelled) setFetched({ mode, done: true });
        })();
        return () => {
            cancelled = true;
        };
    }, [needsFetch]);

    if (isAdmin) return { mode: 'admin', loading: false };
    if (!needsFetch) return { mode: 'none', loading: false };
    return { mode: fetched.done ? fetched.mode : 'none', loading: !fetched.done };
}
