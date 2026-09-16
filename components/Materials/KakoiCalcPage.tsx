'use client';

import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import Button from '@/components/ui/Button';

/**
 * 仮囲い計算（カコイ拾い）
 *
 * 別に作った仮囲いの数量計算ソフト（別アプリ・別デプロイ）を、材料管理メニューの中から
 * 画面を移らずに使えるように iframe で表示するだけのページ。
 * DandoLink 側のデータとは一切やり取りしない（計算はあちら側で完結）。
 *
 * 注意: 表示するには next.config.js の CSP `frame-src` にもこの URL が必要。
 */
const KAKOI_CALC_URL = 'https://kakoi-hiroi.vercel.app/';

export default function KakoiCalcPage() {
    const [isLoaded, setIsLoaded] = useState(false);

    return (
        // 外枠の余白は MainContent 側が付けるので、ここでは付けない（他の材料ページと同じ）
        <div className="w-full h-full flex flex-col gap-3 sm:gap-4 min-h-0">
            {/* スマホは計算ソフト本体の高さを優先するため、説明文は出さずに1行に収める */}
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">仮囲い計算</h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">
                        仮囲いの数量を拾い出します（カコイ拾い）。この画面の中でそのまま操作できます。
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                    leftIcon={<ExternalLink className="w-4 h-4" />}
                    onClick={() => window.open(KAKOI_CALC_URL, '_blank', 'noopener,noreferrer')}
                >
                    別タブで開く
                </Button>
            </div>

            <div className="relative flex-1 min-h-0 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                {!isLoaded && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500" />
                        <p className="text-sm text-slate-500">仮囲い計算を読み込んでいます…</p>
                    </div>
                )}
                <iframe
                    src={KAKOI_CALC_URL}
                    title="仮囲い計算（カコイ拾い）"
                    onLoad={() => setIsLoaded(true)}
                    // 内容の高さで iframe が伸びないよう絶対配置で親いっぱいに固定する（スマホで縦に伸びるのを防ぐ）
                    className="absolute inset-0 w-full h-full border-0"
                    // 計算ソフト側でコピーや全画面表示を使うため許可しておく
                    allow="clipboard-write; fullscreen"
                />
            </div>
        </div>
    );
}
