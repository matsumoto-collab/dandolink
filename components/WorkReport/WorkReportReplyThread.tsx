'use client';

import React, { useState } from 'react';
import { Send, Trash2, Loader2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { sendBroadcast } from '@/lib/broadcastChannel';

export interface WorkReportReplyItem {
    id: string;
    reportType: 'start' | 'end';
    authorId: string;
    body: string;
    createdAt: Date | string;
}

interface Props {
    assignmentId: string;
    reportType: 'start' | 'end';
    replies: WorkReportReplyItem[];
    currentUserId: string;
    canPost: boolean;
    canDeleteAll: boolean;
    userNameMap: Map<string, string>;
    onChanged?: () => void;
}

const TEMPLATES = ['了解です', 'ありがとうございます'] as const;
const BODY_MAX = 100;

function formatTimestamp(d: Date | string): string {
    const date = d instanceof Date ? d : new Date(d);
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
}

export default function WorkReportReplyThread({
    assignmentId,
    reportType,
    replies,
    currentUserId,
    canPost,
    canDeleteAll,
    userNameMap,
    onChanged,
}: Props) {
    const [text, setText] = useState('');
    const [postingSource, setPostingSource] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const submit = async (body: string, source: string) => {
        const trimmed = body.trim();
        if (!trimmed) return;
        if (trimmed.length > BODY_MAX) {
            toast.error(`${BODY_MAX}文字以内で入力してください`);
            return;
        }
        setPostingSource(source);
        try {
            const res = await fetch(`/api/assignments/${assignmentId}/work-status/replies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportType, body: trimmed }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '返信の送信に失敗しました');
                return;
            }
            if (source === 'free') setText('');
            sendBroadcast('work_report_reply_updated', { assignmentId, reportType });
            onChanged?.();
        } catch (e) {
            logger.error('reply post failed', e);
            toast.error('返信の送信に失敗しました');
        } finally {
            setPostingSource(null);
        }
    };

    const remove = async (replyId: string) => {
        if (!confirm('この返信を削除しますか？')) return;
        setDeletingId(replyId);
        try {
            const res = await fetch(
                `/api/assignments/${assignmentId}/work-status/replies/${replyId}`,
                { method: 'DELETE' }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '返信の削除に失敗しました');
                return;
            }
            sendBroadcast('work_report_reply_updated', { assignmentId, reportType });
            onChanged?.();
        } catch (e) {
            logger.error('reply delete failed', e);
            toast.error('返信の削除に失敗しました');
        } finally {
            setDeletingId(null);
        }
    };

    if (!canPost && replies.length === 0) return null;

    return (
        <div className="mt-2 pl-5 space-y-2">
            {replies.length > 0 && (
                <ul className="space-y-1.5">
                    {replies.map((r) => {
                        const isAuthor = r.authorId === currentUserId;
                        const canDelete = isAuthor || canDeleteAll;
                        const authorName = userNameMap.get(r.authorId) || '（不明）';
                        return (
                            <li
                                key={r.id}
                                className="flex items-start gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg"
                            >
                                <User className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-xs font-medium text-slate-700">{authorName}</span>
                                        <span className="text-[10px] text-slate-400">{formatTimestamp(r.createdAt)}</span>
                                    </div>
                                    <div className="text-xs text-slate-700 whitespace-pre-wrap break-words">{r.body}</div>
                                </div>
                                {canDelete && (
                                    <button
                                        type="button"
                                        onClick={() => remove(r.id)}
                                        disabled={deletingId === r.id}
                                        className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors disabled:opacity-50"
                                        aria-label="返信を削除"
                                    >
                                        {deletingId === r.id ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {canPost && (
                <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                        {TEMPLATES.map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => submit(t, t)}
                                disabled={postingSource !== null}
                                className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-full hover:bg-slate-200 transition-colors disabled:opacity-50"
                            >
                                {postingSource === t ? (
                                    <span className="inline-flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" /> 送信中
                                    </span>
                                ) : (
                                    t
                                )}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1.5">
                        <input
                            type="text"
                            value={text}
                            onChange={(e) => setText(e.target.value.slice(0, BODY_MAX))}
                            maxLength={BODY_MAX}
                            placeholder="返信を入力（100文字まで）"
                            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                        <button
                            type="button"
                            onClick={() => submit(text, 'free')}
                            disabled={postingSource !== null || text.trim().length === 0}
                            className="px-2.5 py-1.5 text-xs bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                            {postingSource === 'free' ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                                <Send className="w-3 h-3" />
                            )}
                            送信
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
