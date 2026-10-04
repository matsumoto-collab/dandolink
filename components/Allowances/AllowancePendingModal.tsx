'use client';

/**
 * 確認待ちの一覧（docs/指示書_大規模手当.md の 7-3 の 4）。中身は親が GET /records?status=pending（月を付けない＝全部の月）で読んだもの。
 *
 *  - 日付／氏名／手当／区分／金額／申請した日時／ボタン
 *  - 上に「まとめて認める」（canConfirm の記録だけを送る）
 *  - canConfirm の行 →「認める」「取り消す」
 *  - 自分の分の行（canConfirm が false）→「自分の分は、ほかの管理者・マネージャーが確認します」。canRemove なら「取り下げる」
 * 作りは評価ポイントの確認待ちの一覧と同じ。
 */
import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import AllowanceModal from './AllowanceModal';
import { PAY_ROLE_LABEL, formatJstDateTime, formatShortDate, yen, type AllowanceRecordRow } from './allowancesClient';

interface Props {
    isOpen: boolean;
    records: AllowanceRecordRow[];
    busy: boolean;
    onClose: () => void;
    onConfirm: (ids: string[]) => Promise<boolean>;
    onRemove: (recordId: string) => Promise<boolean>;
}

export default function AllowancePendingModal({ isOpen, records, busy, onClose, onConfirm, onRemove }: Props) {
    const confirmableIds = records.filter((r) => r.canConfirm).map((r) => r.id);

    const handleRemove = async (r: AllowanceRecordRow, own: boolean) => {
        const message = own
            ? `${formatShortDate(r.date)}の「${r.itemName}」の申請を取り下げますか？`
            : `${r.userName}さんの ${formatShortDate(r.date)}の「${r.itemName}」を取り消しますか？`;
        if (!window.confirm(message)) return;
        await onRemove(r.id);
    };

    return (
        <AllowanceModal isOpen={isOpen} onClose={onClose} title={`確認待ち ${records.length}件`} widthClass="lg:max-w-5xl">
            {records.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">確認待ちの記録はありません</p>
            ) : (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">認めると「確定」になり、合計に入ります。</p>
                        <Button
                            size="sm"
                            variant="primary"
                            leftIcon={<Check className="w-4 h-4" />}
                            onClick={() => onConfirm(confirmableIds)}
                            disabled={busy || confirmableIds.length === 0}
                        >
                            まとめて認める{confirmableIds.length > 0 ? `（${confirmableIds.length}件）` : ''}
                        </Button>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-sm bg-white">
                            <thead>
                                <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                    <th className="px-3 py-2 whitespace-nowrap">日付</th>
                                    <th className="px-3 py-2 whitespace-nowrap">氏名</th>
                                    <th className="px-3 py-2 whitespace-nowrap">手当</th>
                                    <th className="px-3 py-2 whitespace-nowrap">区分</th>
                                    <th className="px-3 py-2 whitespace-nowrap text-right">金額</th>
                                    <th className="px-3 py-2 whitespace-nowrap">申請した日時</th>
                                    <th className="px-3 py-2 whitespace-nowrap"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {records.map((r) => (
                                    <tr key={r.id} className="hover:bg-teal-100 transition-colors">
                                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.date}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{r.userName}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{r.itemName}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">{PAY_ROLE_LABEL[r.payRole]}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{yen(r.amount)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatJstDateTime(r.createdAt)}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                {r.canConfirm ? (
                                                    <>
                                                        <Button size="sm" variant="primary" onClick={() => onConfirm([r.id])} disabled={busy}>
                                                            認める
                                                        </Button>
                                                        {r.canRemove && (
                                                            <Button size="sm" variant="dangerOutline" onClick={() => handleRemove(r, false)} disabled={busy}>
                                                                取り消す
                                                            </Button>
                                                        )}
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="text-xs text-slate-500">
                                                            {r.closed ? 'この月は締めてあります' : '自分の分は、ほかの管理者・マネージャーが確認します'}
                                                        </span>
                                                        {r.canRemove && (
                                                            <Button size="sm" variant="outline" onClick={() => handleRemove(r, true)} disabled={busy}>
                                                                取り下げる
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </AllowanceModal>
    );
}
