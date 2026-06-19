'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowBigUpDash, MapPin, PackageOpen, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { LentOutItem } from '@/lib/materials/lentOut';
import type { ProjectMaster } from '@/types/calendar';

interface LentOutSectionProps {
    pm: ProjectMaster;
}

/**
 * 案件詳細「貸出中」タブ。
 * 現場へ出ている材料（出庫 − 返却 − 紛失, loaded 伝票のみ）を一覧表示し、
 * 返却画面への導線と、未回収（紛失・破損）処理の入口を提供する。
 */
export default function LentOutSection({ pm }: LentOutSectionProps) {
    const router = useRouter();
    const { data: session } = useSession();
    const isManager = session?.user?.role === 'admin' || session?.user?.role === 'manager';

    const [items, setItems] = useState<LentOutItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // 未回収（紛失・破損）償却ダイアログ
    const [writeOffItem, setWriteOffItem] = useState<LentOutItem | null>(null);
    const [writeOffQty, setWriteOffQty] = useState(0);
    const [isWritingOff, setIsWritingOff] = useState(false);

    const fetchLentOut = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`/api/project-masters/${pm.id}/lent-out`, { cache: 'no-store' });
            if (res.ok) {
                setItems(await res.json());
            } else {
                toast.error('貸出中材料の取得に失敗しました');
            }
        } catch {
            toast.error('貸出中材料の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [pm.id]);

    useEffect(() => {
        fetchLentOut();
    }, [fetchLentOut]);

    const goToReturn = () => {
        // 返却画面へディープリンク（案件プリセット）。activePage 切替でこのモーダルは自然に閉じる。
        router.push(`/?page=material-returns&projectId=${pm.id}`);
    };

    const openWriteOff = (it: LentOutItem) => {
        setWriteOffItem(it);
        setWriteOffQty(it.lentOut);
    };

    const doWriteOff = async () => {
        if (!writeOffItem) return;
        const qty = Math.max(0, Math.min(writeOffQty, writeOffItem.lentOut));
        if (qty <= 0) {
            toast.error('数量を入力してください');
            return;
        }
        setIsWritingOff(true);
        try {
            const res = await fetch('/api/materials/write-off', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectMasterId: pm.id,
                    items: [{ materialItemId: writeOffItem.materialItemId, quantity: qty }],
                }),
            });
            if (res.ok) {
                toast.success('紛失・破損として処理しました');
                setWriteOffItem(null);
                await fetchLentOut();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err.error || '処理に失敗しました');
            }
        } catch {
            toast.error('処理に失敗しました');
        } finally {
            setIsWritingOff(false);
        }
    };

    // カテゴリ別にグループ化（items は API 側で sortOrder 整列済み）
    const groups: { categoryName: string; items: LentOutItem[] }[] = [];
    for (const it of items) {
        const last = groups[groups.length - 1];
        if (last && last.categoryName === it.categoryName) last.items.push(it);
        else groups.push({ categoryName: it.categoryName, items: [it] });
    }

    if (isLoading) {
        return (
            <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500"></div>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            {/* ヘッダー */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                    <MapPin className="w-4 h-4 text-teal-600" />
                    <span>現在 <span className="text-base font-bold text-slate-900">{items.length}</span> 品目が貸出中</span>
                </div>
                {items.length > 0 && (
                    <button
                        onClick={goToReturn}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-xl hover:shadow-md transition-shadow"
                    >
                        <ArrowBigUpDash className="w-4 h-4" />
                        返却する
                    </button>
                )}
            </div>

            {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <PackageOpen className="w-10 h-10 mb-2" />
                    <p className="text-sm">貸出中の材料はありません</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {groups.map(group => (
                        <div key={group.categoryName} className="border border-slate-200 rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                <span>{group.categoryName}</span>
                                <span className="font-normal text-slate-400">{group.items.length}品目</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {group.items.map(it => (
                                    <div key={it.materialItemId} className="flex items-center justify-between gap-3 px-4 py-3">
                                        <span className="text-sm text-slate-800 min-w-0 flex-1">
                                            {it.name}
                                            {it.spec && <span className="text-xs text-slate-400 ml-1">({it.spec})</span>}
                                        </span>
                                        <span className="flex items-baseline gap-1">
                                            <span className="text-lg font-bold text-slate-900">{it.lentOut.toLocaleString()}</span>
                                            <span className="text-xs text-slate-400">{it.unit}</span>
                                        </span>
                                        {isManager && (
                                            <button
                                                onClick={() => openWriteOff(it)}
                                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
                                                title="紛失・破損として落とす"
                                            >
                                                <AlertTriangle className="w-3 h-3" />
                                                未回収
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!isManager && items.length > 0 && (
                <p className="mt-4 text-xs text-slate-400">
                    倉庫へ戻った材料は「返却する」から記録してください。
                </p>
            )}

            {/* 未回収（紛失・破損）償却ダイアログ */}
            {writeOffItem && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={() => !isWritingOff && setWriteOffItem(null)}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div className="relative bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            <h3 className="text-base font-semibold text-slate-800">紛失・破損として落とす</h3>
                        </div>
                        <p className="text-sm text-slate-600 mb-1">
                            {writeOffItem.name}
                            {writeOffItem.spec && <span className="text-xs text-slate-400 ml-1">({writeOffItem.spec})</span>}
                        </p>
                        <p className="text-xs text-slate-400 mb-4">貸出中: {writeOffItem.lentOut} {writeOffItem.unit}</p>
                        <label className="block text-xs font-medium text-slate-500 mb-1.5">落とす数量</label>
                        <input
                            type="number"
                            value={writeOffQty}
                            onChange={(e) => setWriteOffQty(Math.max(0, Math.min(parseInt(e.target.value) || 0, writeOffItem.lentOut)))}
                            className="w-full h-10 border border-slate-200 rounded-xl px-3 text-sm focus:ring-2 focus:ring-amber-500 shadow-sm mb-2"
                        />
                        <p className="text-[11px] text-slate-400 mb-4">
                            倉庫在庫は出庫時に減算済みのため変動しません（貸出中からのみ除外されます）。
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setWriteOffItem(null)}
                                disabled={isWritingOff}
                                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={doWriteOff}
                                disabled={isWritingOff || writeOffQty <= 0}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-xl hover:shadow-md disabled:opacity-50"
                            >
                                {isWritingOff ? '処理中...' : '落とす'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
