'use client';

import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useDebounce } from '@/hooks/useDebounce';
import { DailyReport } from '@/types/dailyReport';
import { formatDateKey } from '@/utils/employeeUtils';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Search, Trash2, Clock, Calendar, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
import { logger } from '@/lib/logger';

// モーダルを遅延読み込み
const DailyReportModal = dynamic(
    () => import('@/components/DailyReport/DailyReportModal'),
    { loading: () => <Loading overlay /> }
);

// 期間フィルタの初期値（過去30日）
const getInitialRange = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: formatDateKey(start), end: formatDateKey(end) };
};

export default function DailyReportPage() {
    const { dailyReports, fetchDailyReports, deleteDailyReport, isLoading } = useDailyReports({ autoFetch: false });
    const { allForemen, getForemanName } = useCalendarDisplay();

    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [foremanFilter, setForemanFilter] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;
    const initialRange = useMemo(getInitialRange, []);
    const [rangeStart, setRangeStart] = useState<string>(initialRange.start);
    const [rangeEnd, setRangeEnd] = useState<string>(initialRange.end);

    // 期間に応じて日報を取得
    useEffect(() => {
        if (!rangeStart || !rangeEnd) return;
        fetchDailyReports({ startDate: rangeStart, endDate: rangeEnd });
    }, [rangeStart, rangeEnd, fetchDailyReports]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);

    // ソート
    type SortKey = 'date' | 'foreman' | 'workTime';
    type SortDir = 'asc' | 'desc';
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'date' ? 'desc' : 'asc');
        }
    };

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return <ChevronsUpDown className="w-3 h-3 text-slate-300" />;
        return sortDir === 'asc'
            ? <ChevronUp className="w-3 h-3 text-slate-600" />
            : <ChevronDown className="w-3 h-3 text-slate-600" />;
    };

    // 分を時間:分形式に変換
    const formatMinutes = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
    };

    // 案件ごとの実作業時間を取得
    const getWorkItemSummaries = (report: DailyReport): { title: string; minutes: number }[] => {
        return report.workItems.map(item => {
            const pm = item.assignment?.projectMaster;
            const title = pm?.name
                ? `${pm.name}${pm.honorific || ''}`
                : pm?.title || '(案件名不明)';
            let minutes = 0;
            if (item.startTime && item.endTime) {
                const [sh, sm] = item.startTime.split(':').map(Number);
                const [eh, em] = item.endTime.split(':').map(Number);
                const gross = (eh * 60 + em) - (sh * 60 + sm);
                minutes = Math.max(0, gross - (item.breakMinutes ?? 0));
            }
            return { title, minutes };
        });
    };

    // フィルタリング（useMemoでメモ化）
    const filteredReports = useMemo(() => {
        return dailyReports
            .filter(report => {
                if (foremanFilter !== 'all' && report.foremanId !== foremanFilter) {
                    return false;
                }
                if (debouncedSearchTerm) {
                    const foremanName = getForemanName(report.foremanId).toLowerCase();
                    const notes = (report.notes || '').toLowerCase();
                    const search = debouncedSearchTerm.toLowerCase();
                    return foremanName.includes(search) || notes.includes(search);
                }
                return true;
            })
            .sort((a, b) => {
                let cmp = 0;
                switch (sortKey) {
                    case 'date': {
                        const dA = a.date instanceof Date ? a.date : new Date(a.date);
                        const dB = b.date instanceof Date ? b.date : new Date(b.date);
                        cmp = dA.getTime() - dB.getTime();
                        break;
                    }
                    case 'foreman':
                        cmp = getForemanName(a.foremanId).localeCompare(getForemanName(b.foremanId));
                        break;
                    case 'workTime': {
                        const totalA = a.workItems.reduce((s, i) => {
                            if (!i.startTime || !i.endTime) return s;
                            const [sh, sm] = i.startTime.split(':').map(Number);
                            const [eh, em] = i.endTime.split(':').map(Number);
                            return s + Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - (i.breakMinutes ?? 0));
                        }, 0);
                        const totalB = b.workItems.reduce((s, i) => {
                            if (!i.startTime || !i.endTime) return s;
                            const [sh, sm] = i.startTime.split(':').map(Number);
                            const [eh, em] = i.endTime.split(':').map(Number);
                            return s + Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - (i.breakMinutes ?? 0));
                        }, 0);
                        cmp = totalA - totalB;
                        break;
                    }
                }
                return sortDir === 'asc' ? cmp : -cmp;
            });
    }, [dailyReports, foremanFilter, debouncedSearchTerm, getForemanName, sortKey, sortDir]);

    // フィルター変更時にページをリセット
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, foremanFilter, rangeStart, rangeEnd]);

    const totalPages = Math.ceil(filteredReports.length / ITEMS_PER_PAGE);
    const paginatedReports = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredReports.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredReports, currentPage]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('この日報を削除してもよろしいですか?')) {
            try {
                await deleteDailyReport(id);
            } catch (error) {
                logger.error('Failed to delete daily report:', error);
                toast.error('日報の削除に失敗しました');
            }
        }
    };

    const handleAddNew = () => {
        setSelectedReport(null);
        setIsModalOpen(true);
    };

    const handleViewReport = (report: DailyReport) => {
        setSelectedReport(report);
        setIsModalOpen(true);
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
        setSelectedReport(null);
    };

    const handleSaved = () => {
        fetchDailyReports({ startDate: rangeStart, endDate: rangeEnd });
    };

    const resetRange = () => {
        const r = getInitialRange();
        setRangeStart(r.start);
        setRangeEnd(r.end);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6 flex-shrink-0">
                <h1 className="text-2xl font-bold text-slate-800">
                    報告一覧
                </h1>
                <p className="text-sm text-slate-500 mt-1">登録されている報告を管理できます</p>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex-shrink-0 flex flex-col gap-3 sm:gap-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="職長名、備考で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                        />
                    </div>
                    <Button
                        variant="primary"
                        onClick={handleAddNew}
                        leftIcon={<Plus className="w-5 h-5" />}
                    >
                        <span className="hidden sm:inline">新規報告追加</span>
                        <span className="sm:hidden">新規追加</span>
                    </Button>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <select
                        value={foremanFilter}
                        onChange={(e) => setForemanFilter(e.target.value)}
                        className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="all">全ての職長</option>
                        {allForemen.map(foreman => (
                            <option key={foreman.id} value={foreman.id}>
                                {foreman.displayName}
                            </option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-slate-600 whitespace-nowrap">期間</span>
                        <input
                            type="date"
                            value={rangeStart}
                            max={rangeEnd || undefined}
                            onChange={(e) => setRangeStart(e.target.value)}
                            className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        <span className="text-slate-400">〜</span>
                        <input
                            type="date"
                            value={rangeEnd}
                            min={rangeStart || undefined}
                            onChange={(e) => setRangeEnd(e.target.value)}
                            className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        <button
                            onClick={resetRange}
                            className="px-3 py-2.5 text-sm text-slate-600 hover:text-slate-800 transition-colors whitespace-nowrap"
                        >
                            直近30日
                        </button>
                    </div>
                </div>
            </div>

            {/* リスト（ヘッダーsticky + 縦スクロール） */}
            <div className="flex-1 min-h-0 overflow-y-auto md:border md:border-slate-200 md:rounded-xl md:bg-white">
            {/* デスクトップ: テーブルヘッダー（sticky） */}
            <div className="hidden md:block bg-slate-100 border-b border-slate-200 select-none sticky top-0 z-10 md:rounded-t-xl">
                <div className="grid grid-cols-[120px_100px_1fr_50px] gap-2 px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider">
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('date')}>
                        <Calendar className="w-3.5 h-3.5" />
                        日付
                        <SortIcon column="date" />
                    </div>
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('foreman')}>
                        職長
                        <SortIcon column="foreman" />
                    </div>
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('workTime')}>
                        <Clock className="w-3.5 h-3.5" />
                        作業時間
                        <SortIcon column="workTime" />
                    </div>
                    <div></div>
                </div>
            </div>

            {/* リスト本体 */}
            <div>
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loading text="読み込み中..." />
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                        <p className="text-slate-500">
                            {searchTerm || foremanFilter !== 'all'
                                ? '検索結果が見つかりませんでした'
                                : '指定期間に日報が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3 md:space-y-0 md:divide-y md:divide-slate-100">
                        {paginatedReports.map((report) => {
                            const workItemSummaries = getWorkItemSummaries(report);

                            return (
                                <div
                                    key={report.id}
                                    className="bg-white rounded-xl md:rounded-none border border-slate-200 md:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
                                    onClick={() => handleViewReport(report)}
                                >
                                    {/* モバイル表示 */}
                                    <div className="md:hidden p-4">
                                        <div className="flex items-start justify-between mb-2">
                                            <div>
                                                <div className="text-base font-semibold text-slate-900">
                                                    {formatDate(report.date, 'full')}
                                                </div>
                                                <div className="text-sm text-slate-600 mt-0.5">
                                                    {getForemanName(report.foremanId)}
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => handleDelete(e, report.id)}
                                                className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        {/* 案件ごとの作業時間 */}
                                        <div className="space-y-1 mb-2">
                                            {workItemSummaries.map((item, i) => (
                                                <div key={i} className="text-sm text-slate-700">
                                                    <span className="text-slate-500">{i + 1}件目</span>{' '}
                                                    <span className="font-medium">{item.title}</span>{' '}
                                                    <span className="text-slate-600">{formatMinutes(item.minutes)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <LastUpdatedLabel updatedAt={report.updatedAt} updatedBy={report.updatedBy} />
                                    </div>

                                    {/* デスクトップ表示 */}
                                    <div className="hidden md:grid grid-cols-[120px_100px_1fr_50px] gap-2 px-4 py-3 items-center">
                                        <div className="text-[12px] font-semibold text-slate-900">
                                            {formatDate(report.date, 'full')}
                                        </div>
                                        <div className="text-[12px] text-slate-700">
                                            {getForemanName(report.foremanId)}
                                        </div>
                                        <div className="text-[12px] text-slate-700 min-w-0">
                                            {workItemSummaries.map((item, i) => (
                                                <span key={i} className={i > 0 ? 'ml-3' : ''}>
                                                    <span className="text-slate-400">{i + 1}件目</span>{' '}
                                                    <span className="truncate">{item.title}</span>{' '}
                                                    <span className="font-medium text-slate-800">{formatMinutes(item.minutes)}</span>
                                                </span>
                                            ))}
                                            {workItemSummaries.length === 0 && <span className="text-slate-400">-</span>}
                                        </div>
                                        <div className="flex justify-end">
                                            <button
                                                onClick={(e) => handleDelete(e, report.id)}
                                                className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                            >
                                                削除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
                <div className="flex-shrink-0 flex justify-center items-center gap-2 py-3">
                    <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                    >
                        前へ
                    </button>
                    <span className="text-sm font-medium text-slate-600 px-4">
                        {currentPage} / {totalPages}
                    </span>
                    <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                    >
                        次へ
                    </button>
                </div>
            )}

            {/* 統計情報 */}
            <div className="mt-2 flex-shrink-0 text-sm text-slate-600">
                全 {filteredReports.length} 件の報告
                {(searchTerm || foremanFilter !== 'all') && ` (${dailyReports.length}件中)`}
            </div>

            {/* 日報入力モーダル */}
            <DailyReportModal
                isOpen={isModalOpen}
                onClose={handleModalClose}
                initialDate={selectedReport?.date instanceof Date ? selectedReport.date : selectedReport ? new Date(selectedReport.date) : undefined}
                foremanId={selectedReport?.foremanId}
                selectedReport={selectedReport}
                onSaved={handleSaved}
                onDelete={(id) => {
                    deleteDailyReport(id).catch(() => toast.error('日報の削除に失敗しました'));
                }}
            />
        </div>
    );
}
