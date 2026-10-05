'use client';

/**
 * 人の行を押したときの、その人の明細（docs/指示書_大規模手当.md の 7-3 の 7）。
 * GET /records?month=<見ている月>&userId=<その人> で読む。
 * 日付／手当／区分／金額／状態／付けた人／入力元／メモ／「取り消す」（canRemove のときだけ・確認を挟む）。
 *
 * 金額を手で直す（kei 決定 2026-10-05・管理者だけ）:
 *  - 手で直した記録（amountEdited）は、金額の横に「直した」のしるし（title に、直した人と日時）
 *  - canEditAmount の行に「金額を直す」（押すと、その行の下に、金額・メモ・「保存」「やめる」）
 *  - canEditAmount で amountEdited の行に「単価に戻す」（確認を挟む）
 * だれが直せるかは、サーバーが返す canEditAmount で出し分ける（画面では決めない）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { ALLOWANCE_AMOUNT_MAX, ALLOWANCE_AMOUNT_MIN, ALLOWANCE_NOTE_MAX } from '@/lib/allowances';
import { Button } from '@/components/ui/Button';
import AllowanceModal from './AllowanceModal';
import {
    ALLOWANCES_API,
    PAY_ROLE_LABEL,
    STATUS_LABEL,
    amountEditedTitle,
    errorMessageOf,
    formatMonthLabel,
    formatShortDate,
    parseAmountInput,
    recordsQuery,
    sourceLabelOf,
    yen,
    type AllowanceRecordRow,
} from './allowancesClient';

interface Props {
    person: { userId: string; displayName: string } | null;
    month: string;
    /** 一覧を読み直したいときに変わる数（保存・取り消し・確認・知らせのあと） */
    reloadKey: number;
    busy: boolean;
    onClose: () => void;
    /** 取り消す。成功したら true（親が知らせを送り、一覧を読み直す） */
    onRemove: (recordId: string) => Promise<boolean>;
    /** 金額を手で直す（メモも一緒に送る）。成功したら true（親が知らせを送り、一覧を読み直す） */
    onEditAmount: (recordId: string, amount: number, note: string) => Promise<boolean>;
    /** 手で直した金額を、その日の単価に戻す（確認は、ここで挟む）。成功したら true */
    onResetAmount: (recordId: string) => Promise<boolean>;
}

/** 表の列の数（金額を直す欄を、行の下に1つのセルで広げるのに使う） */
const COLUMN_COUNT = 9;

const AMOUNT_RULE_MESSAGE = `金額は ${ALLOWANCE_AMOUNT_MIN}〜${ALLOWANCE_AMOUNT_MAX.toLocaleString('ja-JP')} の整数で入れてください`;

const fieldClass =
    'w-full min-w-0 px-3 py-2 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500';

export default function AllowancePersonModal({ person, month, reloadKey, busy, onClose, onRemove, onEditAmount, onResetAmount }: Props) {
    const [records, setRecords] = useState<AllowanceRecordRow[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const seqRef = useRef(0);

    // ---- 金額を直している行（1行だけ）
    const [editingId, setEditingId] = useState<string | null>(null);
    const [amountText, setAmountText] = useState('');
    const [noteText, setNoteText] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);

    const userId = person?.userId ?? null;

    const load = useCallback(async () => {
        if (!userId) return;
        const seq = ++seqRef.current;
        try {
            const res = await fetch(`${ALLOWANCES_API}/records?${recordsQuery({ month, userId })}`, { cache: 'no-store' });
            if (!res.ok) {
                const message = await errorMessageOf(res, '明細の取得に失敗しました');
                if (seq === seqRef.current) setLoadError(message);
                return;
            }
            const body = (await res.json()) as { records: AllowanceRecordRow[] };
            if (seq !== seqRef.current) return; // 古い読み込みの答えは捨てる
            setRecords(body.records ?? []);
            setLoadError(null);
        } catch (e) {
            logger.error('手当の明細の取得に失敗:', e);
            if (seq === seqRef.current) setLoadError('明細の取得に失敗しました');
        }
    }, [userId, month]);

    // 開いた人・月が変わったら、前の人の内容は消してから読む（直している途中の欄も閉じる）
    useEffect(() => {
        setRecords(null);
        setLoadError(null);
        setEditingId(null);
    }, [userId, month]);

    useEffect(() => {
        load();
    }, [load, reloadKey]);

    const handleRemove = async (r: AllowanceRecordRow) => {
        if (!window.confirm(`${formatShortDate(r.date)}の「${r.itemName}」（${PAY_ROLE_LABEL[r.payRole]} ${yen(r.amount)}）を取り消しますか？`)) return;
        await onRemove(r.id);
    };

    const startEdit = (r: AllowanceRecordRow) => {
        setEditingId(r.id);
        setAmountText(String(r.amount));
        setNoteText(r.note ?? '');
        setInputError(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setInputError(null);
    };

    const handleSaveAmount = async (r: AllowanceRecordRow) => {
        if (busy) return;
        // 0〜100,000 の整数以外は、送る前に止める（最後の判定はサーバー）
        const amount = parseAmountInput(amountText);
        if (amount === null) {
            setInputError(AMOUNT_RULE_MESSAGE);
            return;
        }
        if (noteText.trim().length > ALLOWANCE_NOTE_MAX) {
            setInputError(`メモは${ALLOWANCE_NOTE_MAX}字までで入れてください`);
            return;
        }
        setInputError(null);
        const ok = await onEditAmount(r.id, amount, noteText);
        if (ok) setEditingId(null);
    };

    const handleResetAmount = async (r: AllowanceRecordRow) => {
        if (busy) return;
        if (!window.confirm('この記録の金額を、その日の単価に戻します。よろしいですか？')) return;
        const ok = await onResetAmount(r.id);
        if (ok && editingId === r.id) setEditingId(null);
    };

    return (
        <AllowanceModal
            isOpen={!!person}
            onClose={onClose}
            title={person ? `${person.displayName}さんの明細` : ''}
            subtitle={formatMonthLabel(month)}
            widthClass="lg:max-w-5xl"
        >
            {records === null ? (
                <p className="text-sm text-slate-500 py-6 text-center">{loadError ?? '読み込み中…'}</p>
            ) : records.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">この月の記録はありません</p>
            ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm bg-white">
                        <thead>
                            <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                <th className="px-3 py-2 whitespace-nowrap">日付</th>
                                <th className="px-3 py-2 whitespace-nowrap">手当</th>
                                <th className="px-3 py-2 whitespace-nowrap">区分</th>
                                <th className="px-3 py-2 whitespace-nowrap text-right">金額</th>
                                <th className="px-3 py-2 whitespace-nowrap">状態</th>
                                <th className="px-3 py-2 whitespace-nowrap">付けた人</th>
                                <th className="px-3 py-2 whitespace-nowrap">入力元</th>
                                <th className="px-3 py-2 whitespace-nowrap">メモ</th>
                                <th className="px-3 py-2 whitespace-nowrap"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {records.map((r) => (
                                <React.Fragment key={r.id}>
                                    <tr className="hover:bg-teal-100 transition-colors">
                                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.date}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{r.itemName}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{PAY_ROLE_LABEL[r.payRole]}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
                                            {r.amountEdited && (
                                                <span
                                                    className="mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200 align-middle"
                                                    title={amountEditedTitle(r)}
                                                >
                                                    直した
                                                </span>
                                            )}
                                            {yen(r.amount)}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <span
                                                className={`px-2 py-0.5 rounded-md text-xs ${
                                                    r.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-teal-50 text-teal-700'
                                                }`}
                                            >
                                                {STATUS_LABEL[r.status]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap">{r.createdByName || '—'}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{sourceLabelOf(r.source)}</td>
                                        <td className="px-3 py-2 min-w-[8rem] break-words text-slate-600">{r.note ?? ''}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right">
                                            <div className="inline-flex items-center gap-1.5">
                                                {r.canEditAmount && editingId !== r.id && (
                                                    <Button size="sm" variant="outline" onClick={() => startEdit(r)} disabled={busy}>
                                                        金額を直す
                                                    </Button>
                                                )}
                                                {r.canEditAmount && r.amountEdited && (
                                                    <Button size="sm" variant="outline" onClick={() => handleResetAmount(r)} disabled={busy}>
                                                        単価に戻す
                                                    </Button>
                                                )}
                                                {r.canRemove && (
                                                    <Button size="sm" variant="dangerOutline" onClick={() => handleRemove(r)} disabled={busy}>
                                                        取り消す
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {r.canEditAmount && editingId === r.id && (
                                        <tr className="bg-slate-50">
                                            <td colSpan={COLUMN_COUNT} className="px-3 py-3">
                                                <div className="flex flex-col gap-2 max-w-xl">
                                                    <div className="flex flex-col sm:flex-row gap-2">
                                                        <label className="block text-sm sm:w-40 shrink-0">
                                                            <span className="text-slate-700">金額（円）</span>
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                value={amountText}
                                                                onChange={(e) => setAmountText(e.target.value)}
                                                                className={`${fieldClass} mt-1 text-right tabular-nums`}
                                                                disabled={busy}
                                                                aria-label="金額（円）"
                                                            />
                                                        </label>
                                                        <label className="block text-sm flex-1 min-w-0">
                                                            <span className="text-slate-700">メモ（任意・{ALLOWANCE_NOTE_MAX}字まで。直す理由など）</span>
                                                            <input
                                                                type="text"
                                                                value={noteText}
                                                                onChange={(e) => setNoteText(e.target.value)}
                                                                maxLength={ALLOWANCE_NOTE_MAX}
                                                                className={`${fieldClass} mt-1`}
                                                                disabled={busy}
                                                                aria-label="メモ"
                                                            />
                                                        </label>
                                                    </div>
                                                    {inputError && <p className="text-xs text-red-600">{inputError}</p>}
                                                    <p className="text-xs text-slate-500">直した金額は、あとで単価を変えても変わりません。</p>
                                                    <div className="flex gap-2">
                                                        <Button size="sm" variant="primary" onClick={() => handleSaveAmount(r)} isLoading={busy}>
                                                            保存
                                                        </Button>
                                                        <Button size="sm" variant="outline" onClick={cancelEdit} disabled={busy}>
                                                            やめる
                                                        </Button>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </AllowanceModal>
    );
}
