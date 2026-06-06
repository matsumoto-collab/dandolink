'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, Check, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface ContactOpt {
    id: string;
    name: string;
    linked: boolean;
}
interface PhotoOpt {
    id: string;
    fileName: string;
    thumbnailUrl: string | null;
    createdAt: string;
    isDefault: boolean;
}
interface Ctx {
    kind: 'start' | 'complete';
    workLabel?: string;
    phaseLabel?: string; // 開始 / 完了
    project?: { id: string; title: string };
    customer?: { id: string; name: string } | null;
    contacts?: ContactOpt[];
    photos?: PhotoOpt[];
    defaultMessage?: string;
    sent?: { sentAt: string; imageCount: number } | null;
}

interface Props {
    assignmentId: string;
    kind: 'start' | 'complete';
    onClose: () => void;
}

function toggleSet(set: Set<string>, id: string): Set<string> {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
}

/**
 * 完了→顧客へワンタップ送信ダイアログ。
 * GET でコンテキスト（送信先・写真候補・文面・送信済み状況）を取得し、確認のうえ POST で送信。
 */
export default function CustomerNotifyDialog({ assignmentId, kind, onClose }: Props) {
    const [loading, setLoading] = useState(true);
    const [ctx, setCtx] = useState<Ctx | null>(null);
    const [error, setError] = useState('');
    const [selContacts, setSelContacts] = useState<Set<string>>(new Set());
    const [selPhotos, setSelPhotos] = useState<Set<string>>(new Set());
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState<{ sentCount: number; imageCount: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const res = await fetch(`/api/customer-notify/line?assignmentId=${encodeURIComponent(assignmentId)}&kind=${kind}`, { cache: 'no-store' });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j?.error || '読み込みに失敗しました');
                }
                const j: Ctx = await res.json();
                if (cancelled) return;
                setCtx(j);
                setMessage(j.defaultMessage || '');
                setSelContacts(new Set((j.contacts || []).filter((c) => c.linked).map((c) => c.id)));
                setSelPhotos(new Set((j.photos || []).filter((p) => p.isDefault).map((p) => p.id)));
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : '読み込みに失敗しました');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [assignmentId, kind]);

    const linkedContacts = (ctx?.contacts || []).filter((c) => c.linked);
    const unlinkedContacts = (ctx?.contacts || []).filter((c) => !c.linked);
    const hasLinked = linkedContacts.length > 0;
    const isResend = !!ctx?.sent;

    const send = useCallback(async () => {
        if (selContacts.size === 0) {
            toast.error('送信先を選択してください');
            return;
        }
        setSending(true);
        try {
            const res = await fetch('/api/customer-notify/line', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignmentId,
                    kind,
                    contactIds: [...selContacts],
                    imageFileIds: [...selPhotos],
                    messageOverride: message,
                    force: isResend,
                }),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j?.error || '送信に失敗しました');
            const failed = (j.results || []).filter((r: { status: string }) => r.status === 'failed');
            if (failed.length) toast.error(`${failed.length}件の送信に失敗しました`);
            setDone({ sentCount: j.sentCount ?? 0, imageCount: j.imageCount ?? 0 });
        } catch (e) {
            logger.error('[CustomerNotifyDialog] send failed', e);
            toast.error(e instanceof Error ? e.message : '送信に失敗しました');
        } finally {
            setSending(false);
        }
    }, [assignmentId, kind, selContacts, selPhotos, message, isResend]);

    return (
        <div className="fixed inset-0 z-[80] flex items-end lg:items-center justify-center bg-black/50 lg:p-4" onClick={onClose}>
            <div
                className="bg-white w-full lg:max-w-lg rounded-t-2xl lg:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
                    <div>
                        <h3 className="font-semibold text-slate-800">顧客へ{kind === 'start' ? '開始' : '完了'}連絡（LINE）</h3>
                        {ctx?.project && (
                            <p className="text-xs text-slate-500 mt-0.5">
                                {ctx.project.title}　{ctx.workLabel}{ctx.phaseLabel}
                                {ctx.customer ? `　/　${ctx.customer.name}` : ''}
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg" aria-label="閉じる">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {loading ? (
                        <div className="py-10 flex flex-col items-center gap-3 text-slate-500">
                            <Loader2 className="w-6 h-6 animate-spin" />
                            <span className="text-sm">読み込み中…</span>
                        </div>
                    ) : error ? (
                        <div className="py-8 text-center text-sm text-red-600">{error}</div>
                    ) : done ? (
                        <div className="py-8 text-center space-y-3">
                            <div className="mx-auto w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                                <Check className="w-7 h-7 text-green-600" />
                            </div>
                            <p className="font-semibold text-slate-800">送信しました</p>
                            <p className="text-sm text-slate-500">
                                {done.sentCount}名へ送信{done.imageCount > 0 ? `（写真${done.imageCount}枚）` : ''}
                            </p>
                        </div>
                    ) : !ctx ? (
                        <div className="py-8 text-center text-sm text-slate-500">この作業は顧客通知の対象ではありません。</div>
                    ) : !hasLinked ? (
                        <div className="py-6 space-y-3">
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-amber-700 text-sm">
                                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <div>
                                    この顧客はLINE未連携です。
                                    <div className="text-xs mt-1 text-amber-600">
                                        「顧客管理」で担当者のLINE連携を行うと送信できるようになります。連携が済むまでは従来通り手動でご連絡ください。
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {isResend && (
                                <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-600">
                                    この節目は <strong>{new Date(ctx.sent!.sentAt).toLocaleString('ja-JP')}</strong> に送信済みです。再送する場合のみ送信してください。
                                </div>
                            )}

                            {/* 送信先 */}
                            <div>
                                <div className="text-xs font-bold text-slate-700 mb-2">送信先（LINE連携済みの担当者）</div>
                                <div className="space-y-1.5">
                                    {linkedContacts.map((c) => (
                                        <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selContacts.has(c.id)}
                                                onChange={() => setSelContacts((s) => toggleSet(s, c.id))}
                                                className="w-4 h-4 accent-teal-600"
                                            />
                                            {c.name}
                                            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-green-50 text-green-700">連携済み</span>
                                        </label>
                                    ))}
                                </div>
                                {unlinkedContacts.length > 0 && (
                                    <p className="text-[11px] text-slate-400 mt-1.5">
                                        未連携: {unlinkedContacts.map((c) => c.name).join('、')}（送信不可）
                                    </p>
                                )}
                            </div>

                            {/* メッセージ */}
                            <div>
                                <div className="text-xs font-bold text-slate-700 mb-2">メッセージ（編集できます）</div>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    rows={5}
                                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                                />
                            </div>

                            {/* 添付写真 */}
                            {kind === 'complete' && (ctx.photos?.length ?? 0) > 0 && (
                                <div>
                                    <div className="text-xs font-bold text-slate-700 mb-2">
                                        添付写真　{selPhotos.size}枚を選択中
                                    </div>
                                    <div className="grid grid-cols-4 gap-2">
                                        {ctx.photos!.map((p) => {
                                            const selected = selPhotos.has(p.id);
                                            return (
                                                <button
                                                    type="button"
                                                    key={p.id}
                                                    onClick={() => setSelPhotos((s) => toggleSet(s, p.id))}
                                                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${selected ? 'border-teal-500' : 'border-slate-200'}`}
                                                >
                                                    {p.thumbnailUrl ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img src={p.thumbnailUrl} alt={p.fileName} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full bg-slate-100" />
                                                    )}
                                                    {selected && (
                                                        <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center">
                                                            <Check className="w-3.5 h-3.5" />
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-1.5">本日アップ分を自動選択。タップで増減できます（写真はJPEGに変換して送信されます）。</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* フッター */}
                {!loading && !error && !done && ctx && hasLinked && (
                    <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-slate-200 flex-shrink-0">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
                            送信せず閉じる
                        </button>
                        <button
                            onClick={send}
                            disabled={sending || selContacts.size === 0}
                            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
                        >
                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {isResend ? '再送する' : 'LINEで送信'}
                        </button>
                    </div>
                )}

                {(done || (!hasLinked && !loading && !error)) && (
                    <div className="flex items-center justify-end px-5 py-3 border-t border-slate-200 flex-shrink-0">
                        <button onClick={onClose} className="px-5 py-2 text-sm font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                            閉じる
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
