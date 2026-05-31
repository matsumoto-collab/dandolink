'use client';

import React, { useMemo, useState } from 'react';
import {
    Plus,
    Edit,
    Trash2,
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    ArrowLeft,
    Check,
    FileDown,
    Loader2,
    Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import PaymentScheduleModal from '@/components/PaymentSchedules/PaymentScheduleModal';
import CopyFromPreviousModal from '@/components/PaymentSchedules/CopyFromPreviousModal';
import { usePaymentSchedules } from '@/hooks/usePaymentSchedules';
import type { PaymentSchedule, PaymentScheduleInput } from '@/types/paymentSchedule';
import { logger } from '@/lib/logger';

// 日付キー（YYYY-MM-DD）を生成
const formatDateKey = (d: string | Date): string => {
    const date = typeof d === 'string' ? new Date(d) : d;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const formatDateLabel = (d: string | Date) => {
    const date = typeof d === 'string' ? new Date(d) : d;
    if (isNaN(date.getTime())) return '-';
    return `${date.getMonth() + 1}/${date.getDate()}`;
};

// 月末判定
const isEndOfMonth = (d: Date): boolean => {
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    return next.getMonth() !== d.getMonth();
};

// 「4月10日」「4月末」のようなラベルを生成
const formatDateFull = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return isEndOfMonth(date) ? `${m}月末` : `${m}月${d}日`;
};

const yen = (n: number | string) => {
    const v = typeof n === 'string' ? Number(n) : n;
    if (isNaN(v)) return '¥0';
    return `¥${v.toLocaleString()}`;
};

const ITEMS_PER_PAGE = 20;

export default function PaymentSchedulesPage() {
    const today = new Date();
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    const { items, isLoading, isInitialized, refresh, addItem, updateItem, deleteItem, togglePaid } =
        usePaymentSchedules({ year, month });

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editing, setEditing] = useState<PaymentSchedule | null>(null);
    const [pdfExporting, setPdfExporting] = useState(false);
    const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);

    // 月切替（詳細画面なら閉じる）
    const goPrev = () => {
        setSelectedDate(null);
        setCurrentPage(1);
        if (month === 1) {
            setYear(year - 1);
            setMonth(12);
        } else {
            setMonth(month - 1);
        }
    };
    const goNext = () => {
        setSelectedDate(null);
        setCurrentPage(1);
        if (month === 12) {
            setYear(year + 1);
            setMonth(1);
        } else {
            setMonth(month + 1);
        }
    };
    const goToday = () => {
        setSelectedDate(null);
        setCurrentPage(1);
        const t = new Date();
        setYear(t.getFullYear());
        setMonth(t.getMonth() + 1);
    };

    // 日付ごとにグルーピング
    const dateGroups = useMemo(() => {
        const map = new Map<string, PaymentSchedule[]>();
        for (const item of items) {
            const key = formatDateKey(item.paymentDate);
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(item);
        }
        return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [items]);

    // ページネーション計算
    const totalPages = Math.max(1, Math.ceil(dateGroups.length / ITEMS_PER_PAGE));
    const paginatedDateGroups = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return dateGroups.slice(start, start + ITEMS_PER_PAGE);
    }, [dateGroups, currentPage]);

    // 詳細画面で表示するアイテム
    const selectedItems = useMemo(() => {
        if (!selectedDate) return [];
        return items
            .filter((i) => formatDateKey(i.paymentDate) === selectedDate)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    }, [items, selectedDate]);

    // 月全体サマリー
    const monthlyTotals = useMemo(() => {
        const total = items.reduce((s, x) => s + Number(x.amount), 0);
        const paid = items.filter((x) => x.isPaid).reduce((s, x) => s + Number(x.amount), 0);
        return { total, paid, unpaid: total - paid, count: items.length };
    }, [items]);

    // ハンドラ
    const handleAdd = async (data: PaymentScheduleInput) => {
        try {
            await addItem(data);
            toast.success('支払予定を追加しました');
        } catch (e) {
            logger.error('Failed to add', e);
            toast.error(e instanceof Error ? e.message : '追加に失敗しました');
            throw e;
        }
    };

    const handleUpdate = async (data: PaymentScheduleInput) => {
        if (!editing) return;
        try {
            await updateItem(editing.id, data);
            toast.success('更新しました');
        } catch (e) {
            logger.error('Failed to update', e);
            toast.error(e instanceof Error ? e.message : '更新に失敗しました');
            throw e;
        }
    };

    const handleDelete = async (item: PaymentSchedule) => {
        if (!confirm(`「${item.payeeName}」の支払予定を削除しますか？`)) return;
        try {
            await deleteItem(item.id);
            toast.success('削除しました');
        } catch (e) {
            logger.error('Failed to delete', e);
            toast.error(e instanceof Error ? e.message : '削除に失敗しました');
        }
    };

    const handleTogglePaid = async (item: PaymentSchedule) => {
        try {
            await togglePaid(item.id, !item.isPaid);
        } catch (e) {
            logger.error('Failed to toggle paid', e);
            toast.error(e instanceof Error ? e.message : '更新に失敗しました');
        }
    };

    // 支払予定リストPDFを出力
    const handleExportPDF = async () => {
        if (!selectedDate || selectedItems.length === 0) {
            toast.error('PDFに出力する支払予定がありません');
            return;
        }
        try {
            setPdfExporting(true);
            const { exportPaymentSchedulePDF } = await import('@/utils/paymentSchedulePdf');
            await exportPaymentSchedulePDF(selectedItems, selectedDate);
            toast.success('PDFをダウンロードしました');
        } catch (e) {
            logger.error('Failed to export PDF', e);
            toast.error(e instanceof Error ? e.message : 'PDF出力に失敗しました');
        } finally {
            setPdfExporting(false);
        }
    };

    // ============= 詳細リスト表示 =============
    if (selectedDate) {
        const list = selectedItems;
        const total = list.reduce((s, x) => s + Number(x.amount), 0);
        const paid = list.filter((x) => x.isPaid).reduce((s, x) => s + Number(x.amount), 0);
        const paidCount = list.filter((x) => x.isPaid).length;
        const progressPct = list.length > 0 ? Math.round((paidCount / list.length) * 100) : 0;
        const dateLabel = formatDateFull(selectedDate);
        const allPaid = list.length > 0 && paidCount === list.length;

        return (
            <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
                {/* 戻るボタン */}
                <div className="mb-3 flex-shrink-0">
                    <button
                        onClick={() => setSelectedDate(null)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                        <ArrowLeft className="w-4 h-4" /> 支払日リストに戻る
                    </button>
                </div>

                {/* ヘッダー */}
                <div className="mb-6 flex-shrink-0">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-2xl font-bold text-slate-800">
                            {year}年{dateLabel} 支払リスト
                        </h1>
                        {allPaid && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white">
                                すべて支払済
                            </span>
                        )}
                    </div>
                    <p className="text-sm text-slate-500 mt-1">
                        {list.length}件 / 合計 {yen(total)} ／ 支払済 {paidCount}件 ({yen(paid)})
                    </p>
                </div>

                {/* 進捗バー */}
                <div className="mb-6 flex-shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">
                            進捗: {paidCount} / {list.length} 件
                        </span>
                        <span className={`font-semibold ${allPaid ? 'text-emerald-700' : 'text-slate-700'}`}>
                            {progressPct}%
                        </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <div
                            className={`h-full transition-all ${allPaid ? 'bg-emerald-500' : 'bg-slate-700'}`}
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                </div>

                {/* アクション */}
                <div className="mb-4 flex-shrink-0 flex justify-end gap-2">
                    <Button
                        variant="secondary"
                        leftIcon={
                            pdfExporting ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <FileDown className="w-5 h-5" />
                            )
                        }
                        onClick={handleExportPDF}
                        disabled={pdfExporting || list.length === 0}
                    >
                        {pdfExporting ? 'PDF生成中...' : 'PDF出力（印刷用）'}
                    </Button>
                    <Button
                        variant="primary"
                        leftIcon={<Plus className="w-5 h-5" />}
                        onClick={() => {
                            setEditing(null);
                            setIsModalOpen(true);
                        }}
                    >
                        この日に追加
                    </Button>
                </div>

                {/* 支払いリスト */}
                <div className="flex-1 overflow-auto space-y-2 pr-1">
                    {/* スケルトンは初回ロード時のみ。再取得中(isLoading)に差し替えると
                        リスト高が縮んでスクロールが先頭に戻るため、ここでは isLoading を見ない。 */}
                    {!isInitialized ? (
                        [...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="animate-pulse rounded-xl border border-slate-200 bg-white p-4"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="h-12 w-12 rounded-full bg-slate-200" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 w-1/3 rounded bg-slate-200" />
                                        <div className="h-3 w-2/3 rounded bg-slate-200" />
                                    </div>
                                    <div className="h-6 w-24 rounded bg-slate-200" />
                                </div>
                            </div>
                        ))
                    ) : list.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
                            この日の支払予定はありません
                        </div>
                    ) : (
                        list.map((item, idx) => (
                            <div
                                key={item.id}
                                className={`rounded-xl border p-4 shadow-sm transition-all ${
                                    item.isPaid
                                        ? 'border-emerald-200 bg-emerald-50/40'
                                        : 'border-slate-200 bg-white hover:shadow-md'
                                }`}
                            >
                                <div className="flex items-start gap-3">
                                    {/* 大きな完了チェックボタン */}
                                    <button
                                        onClick={() => handleTogglePaid(item)}
                                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                                            item.isPaid
                                                ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                                                : 'border-slate-300 bg-white text-slate-400 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-500'
                                        }`}
                                        title={item.isPaid ? 'クリックで未払いに戻す' : 'クリックで支払い完了にする'}
                                    >
                                        {item.isPaid ? (
                                            <Check className="w-6 h-6" strokeWidth={3} />
                                        ) : (
                                            <span className="text-base font-semibold">{idx + 1}</span>
                                        )}
                                    </button>

                                    {/* 内容 */}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div
                                                    className={`text-base font-semibold ${
                                                        item.isPaid ? 'text-slate-400 line-through' : 'text-slate-900'
                                                    }`}
                                                >
                                                    {item.payeeName}
                                                </div>
                                                <div className="mt-0.5 text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                                                    {item.paymentType === 'payment_slip' ? (
                                                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                                                            払込用紙
                                                        </span>
                                                    ) : (
                                                        <span>
                                                            {item.bankName} {item.branchName}
                                                            {item.accountType && ` / ${item.accountType}`}
                                                            {item.accountNumber && ` ${item.accountNumber}`}
                                                        </span>
                                                    )}
                                                </div>
                                                {item.accountHolder && (
                                                    <div className="mt-0.5 text-xs text-slate-500">
                                                        名義: {item.accountHolder}
                                                    </div>
                                                )}
                                                {item.dueDate && (
                                                    <div className="mt-1 text-xs text-amber-700">
                                                        振込期日: {formatDateLabel(item.dueDate)}
                                                    </div>
                                                )}
                                                {item.notes && (
                                                    <div className="mt-1 text-xs text-slate-500">{item.notes}</div>
                                                )}
                                            </div>

                                            {/* 金額 */}
                                            <div className="text-right shrink-0">
                                                <div
                                                    className={`text-xl font-bold ${
                                                        item.isPaid ? 'text-slate-400' : 'text-slate-900'
                                                    }`}
                                                >
                                                    {yen(item.amount)}
                                                </div>
                                                {item.feeFlag && (
                                                    <div className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                                        ● 手数料当社負担
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 編集・削除ボタン */}
                                        <div className="mt-3 flex justify-end gap-1">
                                            <button
                                                onClick={() => {
                                                    setEditing(item);
                                                    setIsModalOpen(true);
                                                }}
                                                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 transition-colors"
                                            >
                                                <Edit className="w-3.5 h-3.5" /> 編集
                                            </button>
                                            <button
                                                onClick={() => handleDelete(item)}
                                                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 transition-colors"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" /> 削除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <PaymentScheduleModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setEditing(null);
                    }}
                    onSubmit={editing ? handleUpdate : handleAdd}
                    initial={editing}
                    defaultPaymentDate={selectedDate}
                />
            </div>
        );
    }

    // ============= 支払日カード一覧（メイン画面） =============
    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6 flex-shrink-0">
                <h1 className="text-2xl font-bold text-slate-800">支払予定</h1>
                <p className="text-sm text-slate-500 mt-1">
                    支払日ごとにリストを管理し、担当者間で進捗を共有できます
                </p>
            </div>

            {/* ツールバー（月切替 + 新規ボタン） */}
            <div className="mb-6 flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={goPrev}
                        className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50"
                        title="前月"
                    >
                        <ChevronLeft className="w-5 h-5 text-slate-600" />
                    </button>
                    <div className="min-w-[140px] text-center text-lg font-semibold text-slate-800">
                        {year}年{month}月
                    </div>
                    <button
                        onClick={goNext}
                        className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50"
                        title="翌月"
                    >
                        <ChevronRight className="w-5 h-5 text-slate-600" />
                    </button>
                    <button
                        onClick={goToday}
                        className="ml-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                        今月
                    </button>
                </div>

                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => setIsCopyModalOpen(true)}
                        leftIcon={<Copy className="w-5 h-5" />}
                    >
                        前月からコピー
                    </Button>
                    <Button
                        variant="primary"
                        onClick={() => {
                            setEditing(null);
                            setIsModalOpen(true);
                        }}
                        leftIcon={<Plus className="w-5 h-5" />}
                    >
                        新規追加
                    </Button>
                </div>
            </div>

            {/* 月全体サマリー */}
            <div className="mb-6 flex-shrink-0 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-xs text-slate-500">件数</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{monthlyTotals.count}件</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-xs text-slate-500">合計</div>
                    <div className="text-xl font-bold text-slate-800 mt-1">{yen(monthlyTotals.total)}</div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                    <div className="text-xs text-amber-700">未払</div>
                    <div className="text-xl font-bold text-amber-900 mt-1">{yen(monthlyTotals.unpaid)}</div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <div className="text-xs text-emerald-700">支払済</div>
                    <div className="text-xl font-bold text-emerald-900 mt-1">{yen(monthlyTotals.paid)}</div>
                </div>
            </div>

            {/* モバイル: カードビュー */}
            <div className="md:hidden flex-1 overflow-auto">
                {!isInitialized || isLoading ? (
                    <div className="grid grid-cols-1 gap-4">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse">
                                <div className="h-5 bg-slate-200 rounded w-32 mb-3"></div>
                                <div className="h-4 bg-slate-200 rounded w-48 mb-2"></div>
                                <div className="h-6 bg-slate-200 rounded w-24 mb-2"></div>
                                <div className="h-2 bg-slate-200 rounded-full w-full"></div>
                            </div>
                        ))}
                    </div>
                ) : dateGroups.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-lg">
                        <CalendarDays className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                        <p className="text-slate-500">{year}年{month}月の支払予定はまだありません</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {paginatedDateGroups.map(([dateKey, list]) => {
                            const total = list.reduce((s, x) => s + Number(x.amount), 0);
                            const paidCount = list.filter((x) => x.isPaid).length;
                            const allPaid = paidCount === list.length;
                            const progressPct = list.length > 0 ? Math.round((paidCount / list.length) * 100) : 0;
                            const label = formatDateFull(dateKey);
                            const types = Array.from(new Set(list.map((x) => x.paymentType)));
                            const hasTransfer = types.includes('transfer');
                            const hasSlip = types.includes('payment_slip');

                            return (
                                <button
                                    key={dateKey}
                                    onClick={() => setSelectedDate(dateKey)}
                                    className={`bg-white border rounded-xl p-4 text-left transition-all hover:shadow-md ${
                                        allPaid ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200'
                                    }`}
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg font-bold text-slate-800">{label}</span>
                                            {hasTransfer && (
                                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">振込</span>
                                            )}
                                            {hasSlip && (
                                                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">払込</span>
                                            )}
                                        </div>
                                        {allPaid && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                                                <Check className="w-3 h-3" strokeWidth={3} />完了
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-baseline justify-between text-sm mb-2">
                                        <span className="text-slate-600">{list.length}件</span>
                                        <span className="text-base font-bold text-slate-900">{yen(total)}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-xs mb-1">
                                        <span className="text-slate-500">進捗</span>
                                        <span className={`font-semibold ${allPaid ? 'text-emerald-700' : 'text-slate-700'}`}>
                                            {paidCount}/{list.length}
                                        </span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                        <div
                                            className={`h-full transition-all ${allPaid ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* デスクトップ: テーブルビュー */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
                <div className="flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-100 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    支払日
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    種別
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    件数
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    合計金額
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                    進捗
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
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-12"></div></td>
                                        <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-28"></div></td>
                                        <td className="px-6 py-4"><div className="h-2 bg-slate-200 rounded-full w-32"></div></td>
                                        <td className="px-6 py-4"><div className="h-6 bg-slate-200 rounded-full w-20"></div></td>
                                        <td className="px-6 py-4 text-right"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>
                                    </tr>
                                ))
                            ) : dateGroups.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                                        {year}年{month}月の支払予定はまだありません
                                    </td>
                                </tr>
                            ) : (
                                paginatedDateGroups.map(([dateKey, list]) => {
                                    const total = list.reduce((s, x) => s + Number(x.amount), 0);
                                    const paidCount = list.filter((x) => x.isPaid).length;
                                    const unpaidCount = list.length - paidCount;
                                    const allPaid = paidCount === list.length;
                                    const progressPct = list.length > 0 ? Math.round((paidCount / list.length) * 100) : 0;
                                    const label = formatDateFull(dateKey);
                                    const types = Array.from(new Set(list.map((x) => x.paymentType)));
                                    const hasTransfer = types.includes('transfer');
                                    const hasSlip = types.includes('payment_slip');

                                    return (
                                        <tr
                                            key={dateKey}
                                            className="hover:bg-slate-50 transition-all duration-200 cursor-pointer"
                                            onClick={() => setSelectedDate(dateKey)}
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-[14px] font-semibold text-slate-900">{label}</span>
                                                <span className="text-[11px] text-slate-500 ml-1">{year}年</span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex gap-1">
                                                    {hasTransfer && (
                                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                                            振込
                                                        </span>
                                                    )}
                                                    {hasSlip && (
                                                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                                                            払込
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                                {list.length}件
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-[12px] font-semibold text-slate-900">
                                                {yen(total)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2 min-w-[160px]">
                                                    <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-100">
                                                        <div
                                                            className={`h-full transition-all ${allPaid ? 'bg-emerald-500' : 'bg-slate-700'}`}
                                                            style={{ width: `${progressPct}%` }}
                                                        />
                                                    </div>
                                                    <span className={`text-[11px] font-medium whitespace-nowrap ${allPaid ? 'text-emerald-700' : 'text-slate-600'}`}>
                                                        {paidCount}/{list.length}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                {allPaid ? (
                                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                                        完了
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                                        未払 {unpaidCount}件
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => setSelectedDate(dateKey)}
                                                    className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                                                >
                                                    リストを開く
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ページネーション */}
                {totalPages > 1 && (
                    <div className="flex-shrink-0 flex justify-center items-center gap-2 py-3 border-t border-slate-200">
                        <button
                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            前へ
                        </button>
                        <span className="text-sm font-medium text-slate-600 px-4">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            次へ
                        </button>
                    </div>
                )}
            </div>

            {/* 統計情報 */}
            <div className="mt-4 flex-shrink-0 text-sm text-slate-600">
                全 {dateGroups.length} 件の支払日
            </div>

            <PaymentScheduleModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditing(null);
                }}
                onSubmit={editing ? handleUpdate : handleAdd}
                initial={editing}
                defaultPaymentDate={`${year}-${String(month).padStart(2, '0')}-01`}
            />

            <CopyFromPreviousModal
                isOpen={isCopyModalOpen}
                onClose={() => setIsCopyModalOpen(false)}
                toYear={year}
                toMonth={month}
                onSuccess={() => {
                    refresh();
                }}
            />
        </div>
    );
}
