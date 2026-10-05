'use client';

/**
 * 「ありがとうを送る」のモーダル（EvaluationThanksPanel から開く）。
 *
 * 相手は API（GET /thanks/me）の recipients から選ぶ。今日もう送った相手（sentTodayToIds）は選べない形にする。
 * 送るのは { toUserId, message } だけ（送る人・日付はサーバーが決める）。送る処理そのものは親（パネル）が持つ。
 */
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import EvaluationPointModal from './EvaluationPointModal';
import { THANKS_MESSAGE_MAX, messageCountLabel } from './evaluationThanksClient';

interface Props {
    isOpen: boolean;
    recipients: { userId: string; displayName: string }[];
    sentTodayToIds: string[];
    busy: boolean;
    onClose: () => void;
    /** 送る。成功したら true（親が閉じて読み直す） */
    onSubmit: (input: { toUserId: string; toUserName: string; message: string }) => Promise<boolean>;
}

const fieldClass =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-100';

export default function EvaluationThanksSendModal({ isOpen, recipients, sentTodayToIds, busy, onClose, onSubmit }: Props) {
    const [toUserId, setToUserId] = useState('');
    const [message, setMessage] = useState('');

    // 開くたびに空にする
    useEffect(() => {
        if (isOpen) {
            setToUserId('');
            setMessage('');
        }
    }, [isOpen]);

    // 読み直して、選んでいた相手が「今日は送りました」になった・相手の一覧から消えたときは、選び直してもらう
    useEffect(() => {
        if (!toUserId) return;
        if (sentTodayToIds.includes(toUserId) || !recipients.some((r) => r.userId === toUserId)) setToUserId('');
    }, [toUserId, recipients, sentTodayToIds]);

    const selected = recipients.find((r) => r.userId === toUserId) ?? null;
    const canSubmit = !!selected && !busy && message.length <= THANKS_MESSAGE_MAX;

    const handleSubmit = async () => {
        if (!selected || busy) return;
        await onSubmit({ toUserId: selected.userId, toUserName: selected.displayName, message });
    };

    return (
        <EvaluationPointModal isOpen={isOpen} onClose={onClose} title="ありがとうを送る" widthClass="lg:max-w-md">
            <div className="space-y-4">
                <label className="block text-sm">
                    <span className="text-slate-700">相手</span>
                    <select
                        value={toUserId}
                        onChange={(e) => setToUserId(e.target.value)}
                        disabled={busy}
                        className={`${fieldClass} mt-1 h-10`}
                    >
                        <option value="">選んでください</option>
                        {recipients.map((r) => {
                            const sentToday = sentTodayToIds.includes(r.userId);
                            return (
                                <option key={r.userId} value={r.userId} disabled={sentToday}>
                                    {sentToday ? `${r.displayName}（今日は送りました）` : r.displayName}
                                </option>
                            );
                        })}
                    </select>
                    {recipients.length === 0 && <span className="block mt-1 text-xs text-slate-500">送れる相手がいません</span>}
                </label>

                <label className="block text-sm">
                    <span className="text-slate-700">ひとこと（任意・{THANKS_MESSAGE_MAX}字まで）</span>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        maxLength={THANKS_MESSAGE_MAX}
                        rows={3}
                        disabled={busy}
                        className={`${fieldClass} mt-1`}
                    />
                    <span className="block mt-1 text-right text-xs text-slate-500 tabular-nums">{messageCountLabel(message)}</span>
                </label>

                <p className="text-xs text-slate-500">同じ人には1日1回、1日に3回まで送れます。送れるのは、今日の分だけです。</p>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose} disabled={busy}>
                        やめる
                    </Button>
                    <Button variant="primary" onClick={handleSubmit} isLoading={busy} disabled={!canSubmit}>
                        送る
                    </Button>
                </div>
            </div>
        </EvaluationPointModal>
    );
}
