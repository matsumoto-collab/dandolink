'use client';

/**
 * 画面「支払明細書」— 管理者以外の入口（manager・foreman1・foreman2・worker）。
 *
 * 入口は MainContent が絞っている（admin は今までどおり JoyoStatementsPage＝管理者の画面）。
 * ここで見せ方（mode。hooks/useJoyoStatementAccess）を見て出し分ける:
 *   'member' → JoyoMyStatementsView（自分の発行済みの支払明細書だけ）
 *   読み込み中 → 読み込み中の表示
 *   それ以外 → 「アクセス権限がありません」
 * API も同じ決まりで断る（GET /api/joyo-statements/me は対象者でなければ 403）ので、画面の出し分けは見た目のためだけ。
 */
import React from 'react';
import { useSession } from 'next-auth/react';
import { useJoyoStatementAccess } from '@/hooks/useJoyoStatementAccess';
import Loading from '@/components/ui/Loading';
import JoyoMyStatementsView from './JoyoMyStatementsView';

export default function JoyoMyStatementsPage() {
    const { data: session } = useSession();
    const { mode, loading } = useJoyoStatementAccess(session?.user?.role);

    if (mode === 'member') return <JoyoMyStatementsView />;
    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loading text="支払明細書を読み込み中..." />
            </div>
        );
    }
    return (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <p className="text-slate-500">アクセス権限がありません</p>
        </div>
    );
}
