'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Copy, Check, RefreshCw, Loader2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    customerId: string;
    contactId: string;
    contactName: string;
    /** 連携完了時に確定した lineUserId を親へ通知（フォームの担当者に反映） */
    onLinked: (lineUserId: string) => void;
}

type Phase = 'issuing' | 'waiting' | 'linked' | 'error';

/**
 * 顧客担当者の LINE 連携モーダル。
 * 開くと連携コードを発行し、顧客が「友だち追加＋コード送信」するまで状態をポーリングする。
 */
export default function LineLinkModal({ isOpen, onClose, customerId, contactId, contactName, onLinked }: Props) {
    const [phase, setPhase] = useState<Phase>('issuing');
    const [code, setCode] = useState('');
    const [addFriendUrl, setAddFriendUrl] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [copiedField, setCopiedField] = useState<'code' | 'url' | null>(null);

    const onLinkedRef = useRef(onLinked);
    onLinkedRef.current = onLinked;

    const issue = useCallback(async () => {
        setPhase('issuing');
        setErrorMsg('');
        try {
            const res = await fetch('/api/line/link-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId, contactId }),
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j?.error || '発行に失敗しました');
            }
            const j = await res.json();
            setCode(j.code ?? '');
            setAddFriendUrl(j.addFriendUrl ?? null);
            setPhase('waiting');
        } catch (e) {
            logger.error('[LineLinkModal] issue failed', e);
            setErrorMsg(e instanceof Error ? e.message : '発行に失敗しました');
            setPhase('error');
        }
    }, [customerId, contactId]);

    const checkStatus = useCallback(async () => {
        try {
            const res = await fetch(
                `/api/line/link-token?customerId=${encodeURIComponent(customerId)}&contactId=${encodeURIComponent(contactId)}`,
                { cache: 'no-store' }
            );
            if (!res.ok) return;
            const j = await res.json();
            if (j.linked && j.lineUserId) {
                setPhase('linked');
                onLinkedRef.current(j.lineUserId);
            }
        } catch {
            // 次のポーリングで再試行
        }
    }, [customerId, contactId]);

    // 開いたらコード発行
    useEffect(() => {
        if (isOpen) issue();
    }, [isOpen, issue]);

    // 連携待ち中はポーリング
    useEffect(() => {
        if (!isOpen || phase !== 'waiting') return;
        const iv = setInterval(checkStatus, 4000);
        return () => clearInterval(iv);
    }, [isOpen, phase, checkStatus]);

    if (!isOpen) return null;

    const copy = async (text: string, field: 'code' | 'url') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(field);
            setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 1500);
        } catch {
            toast.error('コピーできませんでした');
        }
    };

    return (
        <div
            className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-black/50 lg:p-4"
            onClick={onClose}
        >
            <div
                className="bg-white w-full lg:max-w-md rounded-t-2xl lg:rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <h3 className="font-semibold text-slate-800">
                        LINE連携 — <span className="text-slate-600">{contactName} 様</span>
                    </h3>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg" aria-label="閉じる">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5">
                    {phase === 'issuing' && (
                        <div className="py-10 flex flex-col items-center gap-3 text-slate-500">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-sm">連携コードを発行しています…</span>
                        </div>
                    )}

                    {phase === 'error' && (
                        <div className="py-6 text-center space-y-4">
                            <p className="text-sm text-red-600">{errorMsg}</p>
                            <button
                                onClick={issue}
                                className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                            >
                                再試行
                            </button>
                        </div>
                    )}

                    {phase === 'waiting' && (
                        <div className="space-y-5">
                            <p className="text-sm text-slate-600">お客様に、下の2ステップをお伝えください。</p>

                            {/* ① 友だち追加 */}
                            <div>
                                <div className="text-xs font-bold text-slate-700 mb-2">① 公式LINEを友だち追加</div>
                                {addFriendUrl ? (
                                    <div className="flex flex-col gap-2">
                                        <a
                                            href={addFriendUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-[#06C755] text-white hover:opacity-90 transition-opacity"
                                        >
                                            <UserPlus className="w-4 h-4" />
                                            友だち追加リンクを開く
                                        </a>
                                        <button
                                            onClick={() => copy(addFriendUrl, 'url')}
                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                        >
                                            {copiedField === 'url' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                                            {copiedField === 'url' ? 'コピーしました' : 'リンクをコピー'}
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                        友だち追加URLが未設定です（環境変数 <code>LINE_OA_ADD_FRIEND_URL</code>）。設定後に表示されます。
                                    </p>
                                )}
                            </div>

                            {/* ② コード送信 */}
                            <div>
                                <div className="text-xs font-bold text-slate-700 mb-2">② トーク画面でこの連携コードを送信</div>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 text-center text-2xl font-bold tracking-[0.3em] text-slate-800 bg-slate-50 border border-slate-200 rounded-lg py-3">
                                        {code}
                                    </div>
                                    <button
                                        onClick={() => copy(code, 'code')}
                                        className="inline-flex items-center gap-1.5 px-3 py-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                    >
                                        {copiedField === 'code' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                                        {copiedField === 'code' ? '済' : 'コピー'}
                                    </button>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-400">有効期限は発行から24時間です。</p>
                            </div>

                            {/* ステータス */}
                            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                                <span className="flex items-center gap-2 text-sm text-slate-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    連携待ち…
                                </span>
                                <button
                                    onClick={checkStatus}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    状態を更新
                                </button>
                            </div>
                            <p className="text-[11px] text-slate-400">
                                お客様が友だち追加してコードを送ると、自動で「連携済み」に切り替わります。
                            </p>
                        </div>
                    )}

                    {phase === 'linked' && (
                        <div className="py-8 text-center space-y-4">
                            <div className="mx-auto w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                                <Check className="w-7 h-7 text-green-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-800">連携が完了しました</p>
                                <p className="text-sm text-slate-500 mt-1">{contactName} 様へ完了連絡を送れるようになりました。</p>
                            </div>
                            <button
                                onClick={onClose}
                                className="px-5 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                            >
                                閉じる
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
