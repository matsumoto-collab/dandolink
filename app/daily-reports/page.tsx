'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useDailyReports } from '@/contexts/DailyReportContext';
import { useCalendarDisplay } from '@/contexts/CalendarDisplayContext';
import { useDebounce } from '@/hooks/useDebounce';
import { DailyReport } from '@/types/dailyReport';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Search, Eye, Trash2, Clock, FileText, Calendar, Loader2 } from 'lucide-react';

// モーダルを遅延読み込み
const DailyReportModal = dynamic(
    () => import('@/components/DailyReport/DailyReportModal'),
    { loading: () => <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"><Loader2 className="w-8 h-8 animate-spin text-white" /></div> }
);

export default function DailyReportPage() {
    const { dailyReports, fetchDailyReports, deleteDailyReport, isLoading } = useDailyReports();
    const { allForemen, getForemanName } = useCalendarDisplay();

    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [foremanFilter, setForemanFilter] = useState<string>('all');
    const [dateFilter, setDateFilter] = useState<string>('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);

    // データはContextで自動取得されるため、ここでのfetchは不要

    // 分を時間:分形式に変換
    const formatMinutes = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
    };

    // フィルタリング（useMemoでメモ化）
    const filteredReports = useMemo(() => {
        return dailyReports
            .filter(report => {
                // 職長フィルター
                if (foremanFilter !== 'all' && report.foremanId !== foremanFilter) {
                    return false;
                }

                // 日付フィルター
                if (dateFilter) {
                    const reportDate = report.date instanceof Date
                        ? report.date.toISOString().split('T')[0]
                        : new Date(report.date).toISOString().split('T')[0];
                    if (reportDate !== dateFilter) {
                        return false;
                    }
                }

                // 検索フィルター
                if (debouncedSearchTerm) {
                    const foremanName = getForemanName(report.foremanId).toLowerCase();
                    const notes = (report.notes || '').toLowerCase();
                    const search = debouncedSearchTerm.toLowerCase();
                    return foremanName.includes(search) || notes.includes(search);
                }

                return true;
            })
            .sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : new Date(a.date);
                const dateB = b.date instanceof Date ? b.date : new Date(b.date);
                return dateB.getTime() - dateA.getTime();
            });
    }, [dailyReports, foremanFilter, dateFilter, debouncedSearchTerm, getForemanName]);

    const handleDelete = async (id: string) => {
        if (confirm('この日報を削除してもよろしいですか?')) {
            try {
                await deleteDailyReport(id);
            } catch (error) {
                console.error('Failed to delete daily report:', error);
                alert('日報の削除に失敗しました');
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
        // 日報保存後にリストを更新
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);

        fetchDailyReports({
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
        });
    };

    // 総作業時間を計算
    const getTotalWorkMinutes = (report: DailyReport): number => {
        return report.workItems.reduce((sum, item) => sum + item.workMinutes, 0);
    };

    return (
        <div className="p-4 sm:p-6 h-full flex flex-col bg-gradient-to-br from-gray-50 to-white w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent mb-2">
                    日報一覧
                </h1>
                <p className="text-gray-600">登録されている日報を管理できます</p>
            </div>

            {/* ツールバー */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                {/* 検索バー */}
                <div className="flex-1 max-w-md relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="職長名、備考で検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                    />
                </div>

                {/* フィルター */}
                <div className="flex items-center gap-3">
                    {/* 職長フィルター */}
                    <select
                        value={foremanFilter}
                        onChange={(e) => setForemanFilter(e.target.value)}
                        className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                    >
                        <option value="all">全ての職長</option>
                        {allForemen.map(foreman => (
                            <option key={foreman.id} value={foreman.id}>
                                {foreman.displayName}
                            </option>
                        ))}
                    </select>

                    {/* 日付フィルター */}
                    <input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                    />
                    {dateFilter && (
                        <button
                            onClick={() => setDateFilter('')}
                            className="px-3 py-2.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            クリア
                        </button>
                    )}
                </div>

                {/* 新規追加ボタン */}
                <button
                    onClick={handleAddNew}
                    className="
                        flex items-center gap-2 px-5 py-2.5
                        bg-gradient-to-r from-blue-600 to-blue-700
                        text-white font-semibold rounded-lg
                        hover:from-blue-700 hover:to-blue-800
                        active:scale-95
                        transition-all duration-200 shadow-md hover:shadow-lg
                    "
                >
                    <Plus className="w-5 h-5" />
                    新規日報追加
                </button>
            </div>

            {/* テーブル */}
            <div className="flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-gray-200">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <span className="ml-3 text-gray-600">読み込み中...</span>
                    </div>
                ) : (
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gradient-to-r from-gray-100 to-gray-50 sticky top-0 z-10">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                    <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        日付
                                    </div>
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                    職長
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        作業時間
                                    </div>
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                    積込時間
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-800 uppercase tracking-wider">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4" />
                                        備考
                                    </div>
                                </th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-gray-800 uppercase tracking-wider">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {filteredReports.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                                        {searchTerm || foremanFilter !== 'all' || dateFilter ?
                                            '検索結果が見つかりませんでした' :
                                            '日報が登録されていません'}
                                    </td>
                                </tr>
                            ) : (
                                filteredReports.map((report) => {
                                    const totalWork = getTotalWorkMinutes(report);

                                    return (
                                        <tr
                                            key={report.id}
                                            className="hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-200"
                                        >
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm font-semibold text-gray-900">
                                                    {formatDate(report.date, 'full')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="text-sm text-gray-700">
                                                    {getForemanName(report.foremanId)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                                                    {formatMinutes(totalWork)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-gray-700">
                                                    <span className="text-gray-500">朝:</span> {formatMinutes(report.morningLoadingMinutes)}
                                                    <span className="mx-2 text-gray-300">|</span>
                                                    <span className="text-gray-500">夕:</span> {formatMinutes(report.eveningLoadingMinutes)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-gray-600 truncate max-w-xs block">
                                                    {report.notes || '-'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                                <button
                                                    onClick={() => handleViewReport(report)}
                                                    className="text-blue-600 hover:text-blue-800 mr-4 transition-colors"
                                                    title="詳細"
                                                >
                                                    <Eye className="w-5 h-5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(report.id)}
                                                    className="text-red-600 hover:text-red-800 transition-colors"
                                                    title="削除"
                                                >
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* 統計情報 */}
            <div className="mt-4 text-sm text-gray-600">
                全 {filteredReports.length} 件の日報
                {(searchTerm || foremanFilter !== 'all' || dateFilter) && ` (${dailyReports.length}件中)`}
            </div>

            {/* 日報入力モーダル */}
            <DailyReportModal
                isOpen={isModalOpen}
                onClose={handleModalClose}
                initialDate={selectedReport?.date instanceof Date ? selectedReport.date : selectedReport ? new Date(selectedReport.date) : undefined}
                foremanId={selectedReport?.foremanId}
                onSaved={handleSaved}
            />
        </div>
    );
}
