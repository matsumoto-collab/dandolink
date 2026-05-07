'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Edit, Trash2, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import PayeeModal from '@/components/Payees/PayeeModal';
import { usePayees } from '@/hooks/usePayees';
import { Payee, PayeeInput } from '@/types/payee';
import { logger } from '@/lib/logger';

export default function PayeesPage() {
    const { payees, isLoading, isInitialized, ensureDataLoaded, addPayee, updatePayee, deletePayee } = usePayees();

    const [searchQuery, setSearchQuery] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<Payee | null>(null);

    useEffect(() => {
        ensureDataLoaded();
    }, [ensureDataLoaded]);

    // 検索文字列の正規化（全角→半角、大文字→小文字、空白除去）
    const normalize = (v: string | null | undefined) => {
        if (!v) return '';
        return v.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    };

    const filtered = useMemo(() => {
        const q = normalize(searchQuery);
        return payees.filter((p) => {
            if (!showInactive && !p.isActive) return false;
            if (!q) return true;
            const fields = [
                p.name,
                p.nameKana,
                p.alias,
                p.bankName,
                p.branchName,
                p.accountType,
                p.accountNumber,
                p.accountHolder,
                p.notes,
            ];
            return fields.some((f) => normalize(f).includes(q));
        });
    }, [payees, searchQuery, showInactive]);

    const handleAdd = async (data: PayeeInput) => {
        try {
            await addPayee(data);
            toast.success('振込先を追加しました');
        } catch (e) {
            logger.error('Failed to add payee', e);
            toast.error(e instanceof Error ? e.message : '追加に失敗しました');
            throw e;
        }
    };

    const handleUpdate = async (data: PayeeInput) => {
        if (!editing) return;
        try {
            await updatePayee(editing.id, data);
            toast.success('振込先を更新しました');
        } catch (e) {
            logger.error('Failed to update payee', e);
            toast.error(e instanceof Error ? e.message : '更新に失敗しました');
            throw e;
        }
    };

    const handleDelete = async (p: Payee) => {
        if (!confirm(`「${p.name}」を削除してもよろしいですか？`)) return;
        try {
            await deletePayee(p.id);
            toast.success('削除しました');
        } catch (e) {
            logger.error('Failed to delete payee', e);
            toast.error(e instanceof Error ? e.message : '削除に失敗しました');
        }
    };

    const handleEditClick = (p: Payee) => {
        setEditing(p);
        setIsModalOpen(true);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6 flex-shrink-0">
                <h1 className="text-2xl font-bold text-slate-800">振込先マスター</h1>
                <p className="text-sm text-slate-500 mt-1">{filtered.length}件の振込先データ</p>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
                    {/* 検索バー */}
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="名前・フリガナ・銀行名・口座番号などで検索..."
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                        />
                    </div>

                    {/* 無効表示トグル */}
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700 px-3 py-2 rounded-xl border border-slate-200 bg-white shadow-sm cursor-pointer">
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                            className="rounded border-slate-300 text-slate-700 focus:ring-slate-500"
                        />
                        無効も表示
                    </label>
                </div>

                <Button
                    variant="primary"
                    leftIcon={<Plus className="w-5 h-5" />}
                    onClick={() => {
                        setEditing(null);
                        setIsModalOpen(true);
                    }}
                >
                    新規追加
                </Button>
            </div>

            {/* モバイルカードビュー */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-3">
                {!isInitialized || isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-4 border-slate-500 border-t-transparent rounded-full"></div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                        <Building2 className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                        <p>{searchQuery ? '該当する振込先が見つかりません' : '振込先が登録されていません'}</p>
                        {!searchQuery && (
                            <Button
                                variant="ghost"
                                onClick={() => setIsModalOpen(true)}
                                className="mt-4"
                            >
                                最初の振込先を登録する
                            </Button>
                        )}
                    </div>
                ) : (
                    filtered.map((p) => (
                        <div
                            key={p.id}
                            className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                        >
                            <div className="p-3">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <h3 className="text-base font-bold text-slate-800">{p.name}</h3>
                                    {p.feeBearer === 'us' ? (
                                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
                                            ● 当社負担
                                        </span>
                                    ) : (
                                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                                            先方負担
                                        </span>
                                    )}
                                    {!p.isActive && (
                                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-200 text-slate-600">
                                            無効
                                        </span>
                                    )}
                                </div>
                                {p.nameKana && (
                                    <p className="text-xs text-slate-500 mb-1">{p.nameKana}</p>
                                )}
                                <div className="text-sm text-slate-600">
                                    {p.bankName ?? '-'} {p.branchName ?? ''}
                                    {p.accountType && ` / ${p.accountType}`}
                                    {p.accountNumber && ` ${p.accountNumber}`}
                                </div>
                                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                                    <button
                                        onClick={() => handleEditClick(p)}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                        編集
                                    </button>
                                    <button
                                        onClick={() => handleDelete(p)}
                                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                        title="削除"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    振込先名
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    手数料
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    銀行
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    支店
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    種別
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    口座番号
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    状態
                                </th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {!isInitialized || isLoading ? (
                                [...Array(5)].map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-32"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-20"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-24"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-24"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-12"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-28"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-16"></div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                                        {searchQuery ? '該当する振込先が見つかりません' : '振込先が登録されていません'}
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((p) => (
                                    <tr key={p.id} className="hover:bg-slate-50 transition-all duration-200">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-[12px] font-semibold text-slate-900">{p.name}</div>
                                            {p.nameKana && (
                                                <div className="text-[11px] text-slate-500 mt-0.5">{p.nameKana}</div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {p.feeBearer === 'us' ? (
                                                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-800">
                                                    ● 当社負担
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-slate-100 text-slate-600">
                                                    先方負担
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {p.bankName ?? '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {p.branchName ?? '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {p.accountType ?? '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                            {p.accountNumber ?? '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {p.isActive ? (
                                                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-emerald-100 text-emerald-700">
                                                    有効
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-slate-100 text-slate-500">
                                                    無効
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium">
                                            <button
                                                onClick={() => handleEditClick(p)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 mr-2 transition-colors"
                                            >
                                                編集
                                            </button>
                                            <button
                                                onClick={() => handleDelete(p)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                                            >
                                                削除
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <PayeeModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditing(null);
                }}
                onSubmit={editing ? handleUpdate : handleAdd}
                initial={editing}
            />
        </div>
    );
}
