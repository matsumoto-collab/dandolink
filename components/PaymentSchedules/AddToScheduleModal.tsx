'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, CalendarPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import type { SupplierInvoice } from '@/types/supplierInvoice';
import type { PaymentSchedule } from '@/types/paymentSchedule';
import { hasAccountMismatch } from '@/lib/accountMatch';
import { suggestPaymentDateFromTerms } from '@/lib/paymentTerms';
import { yen, toInputDate } from '@/components/CreditCard/uploadPrep';
import { logger } from '@/lib/logger';

interface Props {
    invoice: SupplierInvoice;
    onClose: () => void;
    onAdded: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface SameDateList {
    listKey: string | null;
    count: number;
    total: number;
    types: Set<string>;
    minCreatedAt: string;
}

// 受け箱の請求書を支払予定リストへ追加するモーダル。
// 支払日は「請求書の期日 → 振込先マスターの支払サイト → 今日」の順で自動提案する。
// 追加先リストの選択は PaymentScheduleModal の sameDateLists と同じ考え方（対象日の既存リストを列挙）。
export default function AddToScheduleModal({ invoice, onClose, onAdded }: Props) {
    // 支払日の初期提案とその根拠
    const suggestion = useMemo((): { date: string; source: string } => {
        const due = toInputDate(invoice.dueDate);
        if (due) return { date: due, source: '請求書の支払期日から' };
        const fromTerms = suggestPaymentDateFromTerms(toInputDate(invoice.issueDate) || null, invoice.payee ?? null);
        if (fromTerms) return { date: fromTerms, source: `振込先マスター「${invoice.payee!.name}」の支払サイトから` };
        return { date: todayStr(), source: '期日が読み取れなかったため今日の日付' };
    }, [invoice]);

    const [paymentDate, setPaymentDate] = useState(suggestion.date);
    // 追加先リスト: 'new'=新しいリストを作成 / それ以外=sameDateLists のインデックス
    const [targetList, setTargetList] = useState<string>('new');
    const [sameDateLists, setSameDateLists] = useState<SameDateList[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const mismatch = hasAccountMismatch(invoice.payee, invoice);

    // 支払予定に書き込まれる口座情報のプレビュー（サーバーと同じ「マスター優先→請求書で補完」）
    const preview = useMemo(() => {
        const p = invoice.payee;
        return {
            bankName: p?.bankName ?? invoice.bankName,
            branchName: p?.branchName ?? invoice.branchName,
            accountType: p?.accountType ?? invoice.accountType,
            accountNumber: p?.accountNumber ?? invoice.accountNumber,
            accountHolder: p?.accountHolder ?? invoice.accountHolder,
            feeFlag: p?.feeBearer === 'us',
        };
    }, [invoice]);

    // 選択中の支払日と同じ日付の既存リストを取得（追加先の選択肢）
    useEffect(() => {
        let cancelled = false;
        setTargetList('new');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
            setSameDateLists([]);
            return;
        }
        (async () => {
            try {
                const res = await fetch(`/api/payment-schedules?from=${paymentDate}&to=${paymentDate}`, { cache: 'no-store' });
                if (!res.ok) throw new Error();
                const items: PaymentSchedule[] = await res.json();
                const groups = new Map<string, SameDateList>();
                for (const it of items) {
                    const gk = it.listKey ?? '';
                    let g = groups.get(gk);
                    if (!g) {
                        g = { listKey: it.listKey ?? null, count: 0, total: 0, types: new Set(), minCreatedAt: it.createdAt };
                        groups.set(gk, g);
                    }
                    g.count += 1;
                    g.total += Number(it.amount);
                    g.types.add(it.paymentType);
                    if (it.createdAt < g.minCreatedAt) g.minCreatedAt = it.createdAt;
                }
                if (!cancelled) {
                    setSameDateLists(Array.from(groups.values()).sort((a, b) => a.minCreatedAt.localeCompare(b.minCreatedAt)));
                }
            } catch (e) {
                logger.error('Failed to fetch same-date lists:', e);
                if (!cancelled) setSameDateLists([]);
            }
        })();
        return () => { cancelled = true; };
    }, [paymentDate]);

    const handleSubmit = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
            setError('支払日を指定してください');
            return;
        }
        try {
            setSubmitting(true);
            setError(null);
            const selected = targetList !== 'new' ? sameDateLists[Number(targetList)] : null;
            const res = await fetch(`/api/supplier-invoices/${invoice.id}/add-to-schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    paymentDate,
                    createNewList: !selected,
                    targetListKey: selected ? selected.listKey : undefined,
                }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error || '追加に失敗しました');
            }
            toast.success('支払予定に追加しました');
            onAdded();
        } catch (e) {
            setError(e instanceof Error ? e.message : '追加に失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    // 10日 / 末日 のクイックボタン（PaymentScheduleModal と同じ操作感）
    const baseDate = new Date(`${paymentDate}T00:00:00`);
    const baseY = baseDate.getFullYear();
    const baseM = baseDate.getMonth();
    const tenthStr = `${baseY}-${pad(baseM + 1)}-10`;
    const eomDate = new Date(baseY, baseM + 1, 0);
    const eomStr = `${eomDate.getFullYear()}-${pad(eomDate.getMonth() + 1)}-${pad(eomDate.getDate())}`;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">支払予定に追加</h2>
                    <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5 p-6">
                    {error && (
                        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
                    )}

                    {/* 追加内容の確認 */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-baseline justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-base font-semibold text-slate-900 truncate">{invoice.payeeName ?? '（請求元未設定）'}</div>
                                <div className="mt-0.5 text-xs text-slate-600">
                                    {preview.bankName} {preview.branchName}
                                    {preview.accountType && ` / ${preview.accountType}`}
                                    {preview.accountNumber && ` ${preview.accountNumber}`}
                                </div>
                                {preview.accountHolder && (
                                    <div className="text-xs text-slate-500">名義: {preview.accountHolder}</div>
                                )}
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-xl font-bold text-slate-900">{yen(invoice.totalAmount)}</div>
                                {preview.feeFlag && (
                                    <div className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">● 手数料当社負担</div>
                                )}
                            </div>
                        </div>

                        {/* マスター照合状態 */}
                        <div className="mt-3 border-t border-slate-200 pt-2.5 text-xs">
                            {invoice.payee ? (
                                mismatch ? (
                                    <div className="flex items-start gap-1.5 font-semibold text-red-700">
                                        <AlertTriangle className="w-4 h-4 shrink-0" />
                                        <span>
                                            マスター「{invoice.payee.name}」の口座と請求書の口座が一致しません。振込前に取引先へ確認してください（マスター登録の口座で作成されます）。
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-teal-700">✓ 振込先マスター「{invoice.payee.name}」と照合済み（マスターの口座情報で作成されます）</span>
                                )
                            ) : (
                                <span className="text-amber-700">
                                    振込先マスターに未登録です。追加と同時に上記の内容でマスターへ新規登録します（手数料は先方負担で登録。変更は振込先マスター画面から）。
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 支払日 */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                            支払日 <span className="text-red-500">*</span>
                        </label>
                        <div className="mb-2 grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={() => setPaymentDate(tenthStr)}
                                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                    paymentDate === tenthStr
                                        ? 'border-slate-800 bg-slate-800 text-white'
                                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                10日
                            </button>
                            <button
                                type="button"
                                onClick={() => setPaymentDate(eomStr)}
                                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                                    paymentDate === eomStr
                                        ? 'border-slate-800 bg-slate-800 text-white'
                                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                末日
                            </button>
                        </div>
                        <input
                            type="date"
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            className="w-full rounded border border-slate-300 px-3 py-2"
                        />
                        <p className="mt-1 text-xs text-slate-500">提案: {suggestion.source}</p>
                    </div>

                    {/* 追加先リスト（同じ日付に既存リストがある場合のみ） */}
                    {sameDateLists.length > 0 && (
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">追加先リスト</label>
                            <select
                                value={targetList}
                                onChange={(e) => setTargetList(e.target.value)}
                                className="w-full rounded border border-slate-300 px-3 py-2"
                            >
                                <option value="new">新しいリストを作成</option>
                                {sameDateLists.map((g, i) => {
                                    const types = [
                                        g.types.has('transfer') ? '振込' : null,
                                        g.types.has('payment_slip') ? '払込' : null,
                                        g.types.has('direct_debit') ? '引落' : null,
                                    ]
                                        .filter(Boolean)
                                        .join('・');
                                    return (
                                        <option key={i} value={String(i)}>
                                            {`リスト${i + 1}（${types} ${g.count}件 ¥${g.total.toLocaleString()}）に追加`}
                                        </option>
                                    );
                                })}
                            </select>
                            <p className="mt-1 text-xs text-slate-500">
                                同じ日付に既存のリストがあります。新しいリストを作るか、既存リストに追加するかを選べます
                            </p>
                        </div>
                    )}

                    <div className="flex justify-end gap-2 border-t pt-4">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={handleSubmit}
                            isLoading={submitting}
                            leftIcon={<CalendarPlus className="w-4 h-4" />}
                        >
                            支払予定に追加
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
