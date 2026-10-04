'use client';

/**
 * 確認待ちの一覧（docs/指示書_評価ポイント.md の 7-3 の 3）。中身は親が GET /records?status=pending（全期間）で読んだもの。
 *
 *  - 日付／氏名／項目／点数／申請した日時／ボタン
 *  - 上に「まとめて認める」（canConfirm の記録だけを送る）
 *  - canConfirm の行 →「認める」／canRemove の行 →「取り消す」
 *  - 管理者・マネージャーは、自分の分の確認待ちも自分で認められる（kei 決定 2026-10-05）。
 *    だから、この一覧の行は、自分の分もふくめて「認める」が出る（出すかどうかは、サーバーが返す canConfirm で決める）
 */
import React from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import EvaluationPointModal from './EvaluationPointModal';
import { formatJstDateTime, formatShortDate, type PointRecord } from './evaluationPointsClient';

interface Props {
    isOpen: boolean;
    records: PointRecord[];
    busy: boolean;
    onClose: () => void;
    onConfirm: (ids: string[]) => Promise<boolean>;
    onRemove: (record: PointRecord) => Promise<boolean>;
}

export default function EvaluationPointPendingModal({ isOpen, records, busy, onClose, onConfirm, onRemove }: Props) {
    const confirmableIds = records.filter((r) => r.canConfirm).map((r) => r.id);

    const handleRemove = async (r: PointRecord) => {
        if (!window.confirm(`${r.userName}さんの ${formatShortDate(r.date)}の「${r.itemName}」を取り消しますか？`)) return;
        await onRemove(r);
    };

    return (
        <EvaluationPointModal isOpen={isOpen} onClose={onClose} title={`確認待ち ${records.length}件`}>
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
                                    <th className="px-3 py-2 whitespace-nowrap">項目</th>
                                    <th className="px-3 py-2 whitespace-nowrap text-right">点数</th>
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
                                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{r.points}点</td>
                                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatJstDateTime(r.createdAt)}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                                                {r.canConfirm && (
                                                    <Button size="sm" variant="primary" onClick={() => onConfirm([r.id])} disabled={busy}>
                                                        認める
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
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </EvaluationPointModal>
    );
}
