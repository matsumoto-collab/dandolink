'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useDebounce } from '@/hooks/useDebounce';
import { DailyReport } from '@/types/dailyReport';
import { formatDateKey } from '@/utils/employeeUtils';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Search, Trash2, Clock, Calendar, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import toast from 'react-hot-toast';

// モーダルを遅延読み込み
const DailyReportModal = dynamic(
    () => import('@/components/DailyReport/DailyReportModal'),
    { loading: () => <Loading overlay /> }
);

export default function DailyReportPage() {
    const { dailyReports, fetchDailyReports, deleteDailyReport, isLoading } = useDailyReports({ autoFetch: true });
    const { allForemen, getForemanName } = useCalendarDisplay();

    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [foremanFilter, setForemanFilter] = useState<string>('all');
    const [dateFilter, setDateFilter] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);

    // ソート
    type SortKey = 'date' | 'foreman' | 'workTime' | 'loading' | 'earlyStart' | 'overtime';
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
            const title = item.assignment?.projectMaster?.title || '(案件名不明)';
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
                if (dateFilter) {
                    const reportDate = report.date instanceof Date
                        ? formatDateKey(report.date)
                        : formatDateKey(new Date(report.date));
                    if (reportDate !== dateFilter) {
                        return false;
                    }
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
                    case 'loading':
                        cmp = (a.morningLoadingMinutes + a.eveningLoadingMinutes) - (b.morningLoadingMinutes + b.eveningLoadingMinutes);
                        break;
                    case 'earlyStart':
                        cmp = a.earlyStartMinutes - b.earlyStartMinutes;
                        break;
                    case 'overtime':
                        cmp = a.overtimeMinutes - b.overtimeMinutes;
                        break;
                }
                return sortDir === 'asc' ? cmp : -cmp;
            });
    }, [dailyReports, foremanFilter, dateFilter, debouncedSearchTerm, getForemanName, sortKey, sortDir]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('この日報を削除してもよろしいですか?')) {
            try {
                await deleteDailyReport(id);
            } catch (error) {
                console.error('Failed to delete daily report:', error);
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
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        fetchDailyReports({
            startDate: formatDateKey(startDate),
            endDate: formatDateKey(endDate),
        });
    };

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-slate-50 to-white w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-2">
                    日報一覧
                </h1>
                <p className="text-slate-600">登録されている日報を管理できます</p>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex flex-col gap-3 sm:gap-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="職長名、備考で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                        />
                    </div>
                    <button
                        onClick={handleAddNew}
                        className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white font-semibold rounded-lg hover:from-slate-800 hover:to-slate-900 active:scale-95 transition-all duration-200 shadow-md hover:shadow-lg"
                    >
                        <Plus className="w-5 h-5" />
                        <span className="hidden sm:inline">新規日報追加</span>
                        <span className="sm:hidden">新規追加</span>
                    </button>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <select
                        value={foremanFilter}
                        onChange={(e) => setForemanFilter(e.target.value)}
                        className="px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="all">全ての職長</option>
                        {allForemen.map(foreman => (
                            <option key={foreman.id} value={foreman.id}>
                                {foreman.displayName}
                            </option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="flex-1 sm:flex-none px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        {dateFilter && (
                            <button
                                onClick={() => setDateFilter('')}
                                className="px-3 py-2.5 text-sm text-slate-600 hover:text-slate-800 transition-colors whitespace-nowrap"
                            >
                                クリア
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* デスクトップ: テーブルヘッダー */}
            <div className="hidden md:block bg-gradient-to-r from-slate-100 to-slate-50 rounded-t-xl border border-slate-200 border-b-0 select-none">
                <div className="grid grid-cols-[120px_100px_1fr_140px_80px_80px_50px] gap-2 px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider">
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
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('loading')}>
                        積込時間
                        <SortIcon column="loading" />
                    </div>
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('earlyStart')}>
                        早出
                        <SortIcon column="earlyStart" />
                    </div>
                    <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('overtime')}>
                        残業
                        <SortIcon column="overtime" />
                    </div>
                    <div></div>
                </div>
            </div>

            {/* リスト */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loading text="読み込み中..." />
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
                        <p className="text-slate-500">
                            {searchTerm || foremanFilter !== 'all' || dateFilter
                                ? '検索結果が見つかりませんでした'
                                : '日報が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="md:border md:border-slate-200 md:rounded-b-xl md:bg-white space-y-3 md:space-y-0 md:divide-y md:divide-slate-100">
                        {filteredReports.map((report) => {
                            const workItemSummaries = getWorkItemSummaries(report);

                            return (
                                <div
                                    key={report.id}
                                    className="bg-white rounded-lg md:rounded-none border border-slate-200 md:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
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
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                            <span>積込 朝{formatMinutes(report.morningLoadingMinutes)} / 夕{formatMinutes(report.eveningLoadingMinutes)}</span>
                                            {report.earlyStartMinutes > 0 && <span>早出 {formatMinutes(report.earlyStartMinutes)}</span>}
                                            {report.overtimeMinutes > 0 && <span>残業 {formatMinutes(report.overtimeMinutes)}</span>}
                                        </div>
                                    </div>

                                    {/* デスクトップ表示 */}
                                    <div className="hidden md:grid grid-cols-[120px_100px_1fr_140px_80px_80px_50px] gap-2 px-4 py-3 items-center">
                                        <div className="text-sm font-semibold text-slate-900">
                                            {formatDate(report.date, 'full')}
                                        </div>
                                        <div className="text-sm text-slate-700">
                                            {getForemanName(report.foremanId)}
                                        </div>
                                        <div className="text-sm text-slate-700 min-w-0">
                                            {workItemSummaries.map((item, i) => (
                                                <span key={i} className={i > 0 ? 'ml-3' : ''}>
                                                    <span className="text-slate-400">{i + 1}件目</span>{' '}
                                                    <span className="truncate">{item.title}</span>{' '}
                                                    <span className="font-medium text-slate-800">{formatMinutes(item.minutes)}</span>
                                                </span>
                                            ))}
                                            {workItemSummaries.length === 0 && <span className="text-slate-400">-</span>}
                                        </div>
                                        <div className="text-sm text-slate-700">
                                            <span className="text-slate-500">朝</span> {formatMinutes(report.morningLoadingMinutes)}
                                            <span className="mx-1.5 text-slate-300">|</span>
                                            <span className="text-slate-500">夕</span> {formatMinutes(report.eveningLoadingMinutes)}
                                        </div>
                                        <div className="text-sm text-slate-700">
                                            {report.earlyStartMinutes > 0 ? formatMinutes(report.earlyStartMinutes) : <span className="text-slate-300">-</span>}
                                        </div>
                                        <div className="text-sm text-slate-700">
                                            {report.overtimeMinutes > 0 ? formatMinutes(report.overtimeMinutes) : <span className="text-slate-300">-</span>}
                                        </div>
                                        <div className="flex justify-end">
                                            <button
                                                onClick={(e) => handleDelete(e, report.id)}
                                                className="p-1.5 text-slate-400 hover:text-red-500 rounded transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 統計情報 */}
            <div className="mt-4 text-sm text-slate-600">
                全 {filteredReports.length} 件の日報
                {(searchTerm || foremanFilter !== 'all' || dateFilter) && ` (${dailyReports.length}件中)`}
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
