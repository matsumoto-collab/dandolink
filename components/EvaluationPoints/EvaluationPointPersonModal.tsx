'use client';

/**
 * 人の行を押したときの、その人の明細（docs/指示書_評価ポイント.md の 7-3 の 5）。
 * GET /records?userId= に、表示中の期間を付けて読む。
 * 日付／項目（記録に写してある項目名）／点数／状態／付けた人／メモ／「取り消す」（canRemove のときだけ・確認を挟む）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import EvaluationPointModal from './EvaluationPointModal';
import {
    EVALUATION_POINTS_API,
    STATUS_LABEL,
    errorMessageOf,
    formatShortDate,
    type PointRecord,
} from './evaluationPointsClient';

interface Props {
    person: { userId: string; displayName: string } | null;
    startDate: string;
    endDate: string;
    /** 一覧を読み直したいときに変わる数（保存・取り消し・確認・知らせのあと） */
    reloadKey: number;
    busy: boolean;
    onClose: () => void;
    /** 取り消す。成功したら true（親が知らせを送り、一覧を読み直す） */
    onRemove: (record: PointRecord) => Promise<boolean>;
}

export default function EvaluationPointPersonModal({ person, startDate, endDate, reloadKey, busy, onClose, onRemove }: Props) {
    const [records, setRecords] = useState<PointRecord[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const seqRef = useRef(0);

    const userId = person?.userId ?? null;

    const load = useCallback(async () => {
        if (!userId) return;
        const seq = ++seqRef.current;
        try {
            const params = new URLSearchParams({ userId, startDate, endDate });
            const res = await fetch(`${EVALUATION_POINTS_API}/records?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                const message = await errorMessageOf(res, '明細の取得に失敗しました');
                if (seq === seqRef.current) setLoadError(message);
                return;
            }
            const body = (await res.json()) as { records: PointRecord[] };
            if (seq !== seqRef.current) return; // 古い読み込みの答えは捨てる
            setRecords(body.records ?? []);
            setLoadError(null);
        } catch (e) {
            logger.error('評価ポイントの明細の取得に失敗:', e);
            if (seq === seqRef.current) setLoadError('明細の取得に失敗しました');
        }
    }, [userId, startDate, endDate]);

    // 開いた人・期間が変わったら、前の人の内容は消してから読む
    useEffect(() => {
        setRecords(null);
        setLoadError(null);
    }, [userId, startDate, endDate]);

    useEffect(() => {
        load();
    }, [load, reloadKey]);

    const handleRemove = async (r: PointRecord) => {
        if (!window.confirm(`${formatShortDate(r.date)}の「${r.itemName}」（${r.points}点）を取り消しますか？`)) return;
        await onRemove(r);
    };

    return (
        <EvaluationPointModal
            isOpen={!!person}
            onClose={onClose}
            title={person ? `${person.displayName}さんの明細` : ''}
            subtitle={`${startDate} 〜 ${endDate}`}
        >
            {records === null ? (
                <p className="text-sm text-slate-500 py-6 text-center">{loadError ?? '読み込み中…'}</p>
            ) : records.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">この期間の記録はありません</p>
            ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm bg-white">
                        <thead>
                            <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                <th className="px-3 py-2 whitespace-nowrap">日付</th>
                                <th className="px-3 py-2 whitespace-nowrap">項目</th>
                                <th className="px-3 py-2 whitespace-nowrap text-right">点数</th>
                                <th className="px-3 py-2 whitespace-nowrap">状態</th>
                                <th className="px-3 py-2 whitespace-nowrap">付けた人</th>
                                <th className="px-3 py-2 whitespace-nowrap">メモ</th>
                                <th className="px-3 py-2 whitespace-nowrap"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {records.map((r) => (
                                <tr key={r.id} className="hover:bg-teal-100 transition-colors">
                                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.date}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{r.itemName}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{r.points}点</td>
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
                                    <td className="px-3 py-2 min-w-[8rem] break-words text-slate-600">{r.note ?? ''}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right">
                                        {r.canRemove && (
                                            <Button size="sm" variant="dangerOutline" onClick={() => handleRemove(r)} disabled={busy}>
                                                取り消す
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </EvaluationPointModal>
    );
}
