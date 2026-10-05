'use client';

/**
 * 管理者・マネージャーの「ありがとうの一覧」（集計に「ありがとう」の仮の項目があるときだけ、ボタンから開く）。
 * GET /api/evaluation-points/thanks に、管理者の画面で今見ている期間を付けて読む。
 * 日付／送った人／もらった人／ひとこと／点／「取り消す」（確認を挟む。管理者・マネージャーは、いつでも・だれの分でも取り消せる）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import EvaluationPointModal from './EvaluationPointModal';
import { errorMessageOf } from './evaluationPointsClient';
import { THANKS_API, type ThanksListRow } from './evaluationThanksClient';

interface Props {
    isOpen: boolean;
    startDate: string;
    endDate: string;
    /** 一覧を読み直したいときに変わる数（取り消し・知らせのあと） */
    reloadKey: number;
    busy: boolean;
    onClose: () => void;
    /** 取り消す。成功したら true（親が知らせを送り、集計と一覧を読み直す） */
    onRemove: (row: ThanksListRow) => Promise<boolean>;
}

export default function EvaluationThanksListModal({ isOpen, startDate, endDate, reloadKey, busy, onClose, onRemove }: Props) {
    const [rows, setRows] = useState<ThanksListRow[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const seqRef = useRef(0);

    const load = useCallback(async () => {
        if (!isOpen) return;
        const seq = ++seqRef.current;
        try {
            const params = new URLSearchParams({ startDate, endDate });
            const res = await fetch(`${THANKS_API}?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                const message = await errorMessageOf(res, '「ありがとう」の一覧の取得に失敗しました');
                if (seq === seqRef.current) setLoadError(message);
                return;
            }
            const body = (await res.json()) as { thanks: ThanksListRow[] };
            if (seq !== seqRef.current) return; // 古い読み込みの答えは捨てる
            setRows(body.thanks ?? []);
            setLoadError(null);
        } catch (e) {
            logger.error('「ありがとう」の一覧の取得に失敗:', e);
            if (seq === seqRef.current) setLoadError('「ありがとう」の一覧の取得に失敗しました');
        }
    }, [isOpen, startDate, endDate]);

    // 開き直した・期間が変わったら、前の内容は消してから読む
    useEffect(() => {
        setRows(null);
        setLoadError(null);
    }, [isOpen, startDate, endDate]);

    useEffect(() => {
        load();
    }, [load, reloadKey]);

    const handleRemove = async (r: ThanksListRow) => {
        if (!window.confirm(`${r.fromUserName}さんから ${r.toUserName}さんへの『ありがとう』を取り消しますか？`)) return;
        await onRemove(r);
    };

    return (
        <EvaluationPointModal isOpen={isOpen} onClose={onClose} title="ありがとうの一覧" subtitle={`${startDate} 〜 ${endDate}`}>
            <p className="text-xs text-slate-500 mb-3">同じ人どうしで送り合っていないか、ここで確かめられます。</p>
            {rows === null ? (
                <div className="text-sm text-slate-500 py-6 text-center">
                    <p>{loadError ?? '読み込み中…'}</p>
                    {loadError && (
                        <Button size="sm" variant="outline" className="mt-3" onClick={() => load()}>
                            読み直す
                        </Button>
                    )}
                </div>
            ) : rows.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">この期間の『ありがとう』はありません</p>
            ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm bg-white">
                        <thead>
                            <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                <th className="px-3 py-2 whitespace-nowrap">日付</th>
                                <th className="px-3 py-2 whitespace-nowrap">送った人</th>
                                <th className="px-3 py-2 whitespace-nowrap">もらった人</th>
                                <th className="px-3 py-2 whitespace-nowrap">ひとこと</th>
                                <th className="px-3 py-2 whitespace-nowrap text-right">点</th>
                                <th className="px-3 py-2 whitespace-nowrap"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map((r) => (
                                <tr key={r.id} className="hover:bg-teal-100 transition-colors">
                                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{r.date}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{r.fromUserName}</td>
                                    <td className="px-3 py-2 whitespace-nowrap">{r.toUserName}</td>
                                    <td className="px-3 py-2 min-w-[8rem] break-words text-slate-600">{r.message ?? ''}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">{r.points}点</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right">
                                        <Button size="sm" variant="dangerOutline" onClick={() => handleRemove(r)} disabled={busy}>
                                            取り消す
                                        </Button>
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
