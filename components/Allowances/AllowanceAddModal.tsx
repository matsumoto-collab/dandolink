'use client';

/**
 * 「記録を足す」の小さなフォーム（docs/指示書_大規模手当.md の 7-3 の 8）。
 *
 *  - 対象者: GET /summary の eligiblePeople から選ぶ（一人親方にはしるし）
 *  - 日付: 初期値は、見ている月が今月なら今日・そうでなければその月の末日。max は今日
 *  - 手当: 使用中のもの（GET /summary の items のうち isActive）
 *  - 区分: 「職長」「職長以外」（初期値は「職長以外」）。管理者・マネージャーが手で足すときだけ、区分を選ぶ
 *  - メモ（任意・200字まで）
 *  - 自分を選んだときは「自分の分は確認待ちになります」
 * 金額は、サーバーがその日付の金額を入れる（画面では決めない）。
 */
import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { ALLOWANCE_NOTE_MAX, todayJstDateKey, type AllowancePayRole } from '@/lib/allowances';
import AllowanceModal from './AllowanceModal';
import { PAY_ROLE_LABEL, defaultAddDate, formatMonthLabel, type EligiblePerson } from './allowancesClient';

export interface AddAllowanceInput {
    userId: string;
    date: string;
    itemId: string;
    payRole: AllowancePayRole;
    note: string;
}

interface Props {
    isOpen: boolean;
    /** 見ている月 'YYYY-MM'（日付の初期値に使う） */
    month: string;
    people: EligiblePerson[];
    /** 使用中の手当 */
    items: { id: string; name: string }[];
    currentUserId: string;
    busy: boolean;
    onClose: () => void;
    /** 保存。成功したら true（フォームを閉じる） */
    onSubmit: (input: AddAllowanceInput) => Promise<boolean>;
}

const fieldClass =
    'w-full min-w-0 h-10 px-3 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500';

const PAY_ROLES: AllowancePayRole[] = ['foreman', 'member'];

export default function AllowanceAddModal({ isOpen, month, people, items, currentUserId, busy, onClose, onSubmit }: Props) {
    const [userId, setUserId] = useState('');
    const [date, setDate] = useState(() => defaultAddDate(month, todayJstDateKey()));
    const [itemId, setItemId] = useState('');
    const [payRole, setPayRole] = useState<AllowancePayRole>('member');
    const [note, setNote] = useState('');

    // 開くたびに、まっさらにする（手当が1つだけなら、それを選んでおく）
    const singleItemId = items.length === 1 ? items[0].id : '';
    useEffect(() => {
        if (!isOpen) return;
        setUserId('');
        setDate(defaultAddDate(month, todayJstDateKey()));
        setItemId(singleItemId);
        setPayRole('member');
        setNote('');
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたとき・月が変わったときだけ初期値に戻す
    }, [isOpen, month]);

    const today = todayJstDateKey();

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
            toast.error('手当を選んでください');
            return;
        }
        if (note.trim().length > ALLOWANCE_NOTE_MAX) {
            toast.error(`メモは${ALLOWANCE_NOTE_MAX}字までの文字で入れてください`);
            return;
        }
        const ok = await onSubmit({ userId, date, itemId, payRole, note: note.trim() });
        if (ok) onClose();
    };

    return (
        <AllowanceModal isOpen={isOpen} onClose={onClose} title="記録を足す" subtitle={`${formatMonthLabel(month)}を表示中`} widthClass="lg:max-w-lg">
            <div className="space-y-4">
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    手配に入っていない人・日にも付けられます（『手配と見比べる』には『付けすぎ』と出ます）。金額は、その日付の金額が自動で入ります。
                </p>

                <label className="block text-sm">
                    <span className="text-slate-700">対象者</span>
                    <select value={userId} onChange={(e) => setUserId(e.target.value)} className={`${fieldClass} mt-1`} disabled={busy}>
                        <option value="">選んでください</option>
                        {people.map((p) => (
                            <option key={p.userId} value={p.userId}>
                                {p.isJoyo ? `${p.displayName}（一人親方）` : p.displayName}
                            </option>
                        ))}
                    </select>
                </label>
                {userId !== '' && userId === currentUserId && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">自分の分は確認待ちになります</p>
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
                    <span className="text-slate-700">手当</span>
                    <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${fieldClass} mt-1`} disabled={busy}>
                        <option value="">選んでください</option>
                        {items.map((i) => (
                            <option key={i.id} value={i.id}>
                                {i.name}
                            </option>
                        ))}
                    </select>
                    {items.length === 0 && (
                        <span className="block mt-1 text-xs text-slate-500">使用中の手当がありません（設定の「手当」で「使う」にすると、付けられます）</span>
                    )}
                </label>

                <fieldset className="text-sm">
                    <legend className="text-slate-700">区分</legend>
                    <div className="mt-1 flex gap-2">
                        {PAY_ROLES.map((r) => (
                            <label
                                key={r}
                                className={`flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border cursor-pointer text-sm ${
                                    payRole === r ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="allowance-pay-role"
                                    value={r}
                                    checked={payRole === r}
                                    onChange={() => setPayRole(r)}
                                    disabled={busy}
                                    className="sr-only"
                                />
                                {PAY_ROLE_LABEL[r]}
                            </label>
                        ))}
                    </div>
                </fieldset>

                <label className="block text-sm">
                    <span className="text-slate-700">メモ（任意・{ALLOWANCE_NOTE_MAX}字まで）</span>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={ALLOWANCE_NOTE_MAX}
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
        </AllowanceModal>
    );
}
