'use client';

/**
 * 「記録を足す」の小さなフォーム（docs/指示書_評価ポイント.md の 7-3 の 6）。
 *
 *  - 対象者: GET /summary の eligiblePeople から選ぶ
 *  - 日付: 初期値は今日・max は今日（先の日付には付けられない）
 *  - 項目: GET /items のうち使用中のもの全部（職長向け・管理者向けのどちらも）
 *  - メモ（任意・200字まで）
 *  - 自分を選んだときは「自分の分は確認待ちになります」
 */
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { EVALUATION_POINT_NOTE_MAX, todayJstDateKey } from '@/lib/evaluationPoints';
import EvaluationPointModal from './EvaluationPointModal';
import type { EligiblePerson, ItemOption } from './evaluationPointsClient';

export interface AddRecordInput {
    userId: string;
    date: string;
    itemId: string;
    note: string;
}

interface Props {
    isOpen: boolean;
    people: EligiblePerson[];
    items: ItemOption[];
    /** 項目を読めなかったとき true（「項目がありません」と分けて出す） */
    itemsFailed: boolean;
    currentUserId: string;
    busy: boolean;
    onClose: () => void;
    /** 保存。成功したら true（フォームを閉じる） */
    onSubmit: (input: AddRecordInput) => Promise<boolean>;
}

const fieldClass =
    'w-full min-w-0 h-10 px-3 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500';

export default function EvaluationPointAddModal({ isOpen, people, items, itemsFailed, currentUserId, busy, onClose, onSubmit }: Props) {
    const [userId, setUserId] = useState('');
    const [date, setDate] = useState(() => todayJstDateKey());
    const [itemId, setItemId] = useState('');
    const [note, setNote] = useState('');

    // 開くたびに、まっさらにする（日付は今日）
    useEffect(() => {
        if (!isOpen) return;
        setUserId('');
        setDate(todayJstDateKey());
        setItemId('');
        setNote('');
    }, [isOpen]);

    const today = todayJstDateKey();
    const activeItems = items.filter((i) => i.isActive);

    const handleSubmit = async () => {
        if (!userId) {
            toast.error('対象者を選んでください');
            return;
        }
        if (!date) {
            toast.error('日付を入れてください');
            return;
        }
        if (date > todayJstDateKey()) {
            toast.error('先の日付には付けられません');
            return;
        }
        if (!itemId) {
            toast.error('項目を選んでください');
            return;
        }
        if (note.trim().length > EVALUATION_POINT_NOTE_MAX) {
            toast.error(`メモは${EVALUATION_POINT_NOTE_MAX}字までです`);
            return;
        }
        const ok = await onSubmit({ userId, date, itemId, note: note.trim() });
        if (ok) onClose();
    };

    return (
        <EvaluationPointModal isOpen={isOpen} onClose={onClose} title="記録を足す" widthClass="lg:max-w-lg">
            <div className="space-y-4">
                <label className="block text-sm">
                    <span className="text-slate-700">対象者</span>
                    <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${fieldClass} mt-1`} disabled={busy}>
                        <option value="">選んでください</option>
                        {people.map((p) => (
                            <option key={p.userId} value={p.userId}>
                                {p.displayName}
                            </option>
                        ))}
                    </select>
                </label>
                {userId !== '' && userId === currentUserId && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        自分の分は確認待ちになります
                    </p>
                )}

                <label className="block text-sm">
                    <span className="text-slate-700">日付</span>
                    <input
                        type="date"
                        value={date}
                        max={today}
                        onChange={(e) => setDate(e.target.value)}
                        className={`${fieldClass} mt-1`}
                        disabled={busy}
                    />
                </label>

                <label className="block text-sm">
                    <span className="text-slate-700">項目</span>
                    <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${fieldClass} mt-1`} disabled={busy}>
                        <option value="">選んでください</option>
                        {activeItems.map((i) => (
                            <option key={i.id} value={i.id}>
                                {i.name}
                            </option>
                        ))}
                    </select>
                    {activeItems.length === 0 && (
                        <span className="block mt-1 text-xs text-slate-500">
                            {itemsFailed ? '項目を読めませんでした。画面を読み直してください。' : '使用中の項目がありません（設定の「評価ポイント」で作れます）'}
                        </span>
                    )}
                </label>

                <label className="block text-sm">
                    <span className="text-slate-700">メモ（任意・{EVALUATION_POINT_NOTE_MAX}字まで）</span>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={EVALUATION_POINT_NOTE_MAX}
                        rows={2}
                        className="w-full min-w-0 mt-1 px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                        disabled={busy}
                    />
                </label>

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={onClose} disabled={busy}>
                        キャンセル
                    </Button>
                    <Button variant="primary" onClick={handleSubmit} isLoading={busy}>
                        保存
                    </Button>
                </div>
            </div>
        </EvaluationPointModal>
    );
}
