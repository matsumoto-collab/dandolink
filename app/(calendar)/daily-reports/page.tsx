'use client';

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useDebounce } from '@/hooks/useDebounce';
import { DailyReport } from '@/types/dailyReport';
import { formatDate } from '@/utils/dateUtils';
import { Plus, Search, Eye, Trash2, Clock, FileText, Calendar } from 'lucide-react';
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
        return report.workItems.reduce((sum, item) => {
            if (item.startTime && item.endTime) {
                const [sh, sm] = item.startTime.split(':').map(Number);
                const [eh, em] = item.endTime.split(':').map(Number);
                return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
            }
            return sum;
        }, 0);
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
            <div className="mb-6 flex flex-col gap-3 sm:gap-4">
                {/* 上段: 検索バーと新規追加ボタン */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    {/* 検索バー */}
                    <div className="flex-1 sm:max-w-md relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="職長名、備考で検索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                        />
                    </div>

                    {/* 新規追加ボタン */}
                    <button
                        onClick={handleAddNew}
                        className="
                            flex items-center justify-center gap-2 px-5 py-2.5
                            bg-gradient-to-r from-blue-600 to-blue-700
                            text-white font-semibold rounded-lg
                            hover:from-blue-700 hover:to-blue-800
                            active:scale-95
                            transition-all duration-200 shadow-md hover:shadow-lg
                        "
                    >
                        <Plus className="w-5 h-5" />
                        <span className="hidden sm:inline">新規日報追加</span>
                        <span className="sm:hidden">新規追加</span>
                    </button>
                </div>

                {/* 下段: フィルター */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="flex-1 sm:flex-none px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                        />
                        {dateFilter && (
                            <button
                                onClick={() => setDateFilter('')}
                                className="px-3 py-2.5 text-sm text-gray-600 hover:text-gray-800 transition-colors whitespace-nowrap"
                            >
                                クリア
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* モバイルカードビュー */}
            <div className="md:hidden flex-1 overflow-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loading text="読み込み中..." />
                    </div>
                ) : filteredReports.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg">
                        <p className="text-gray-500">
                            {searchTerm || foremanFilter !== 'all' || dateFilter ?
                                '検索結果が見つかりませんでした' :
                                '日報が登録されていません'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        {filteredReports.map((report) => {
                            const totalWork = getTotalWorkMinutes(report);

                            return (
                                <div
                                    key={report.id}
                                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow"
                                >
                                    {/* ヘッダー: 日付とアクション */}
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-gray-500" />
                                            <span className="text-base font-semibold text-gray-900">
                                                {formatDate(report.date, 'full')}
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleViewReport(report)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="詳細"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(report.id)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 職長名 */}
                                    <div className="text-sm text-gray-700 mb-3">
                                        職長: {getForemanName(report.foremanId)}
                                    </div>

                                    {/* 作業時間と積込時間 */}
                                    <div className="flex flex-wrap items-center gap-3 mb-3">
                                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                                            <Clock className="w-3 h-3" />
                                            作業 {formatMinutes(totalWork)}
                                        </span>
                                        <span className="text-xs text-gray-600">
                                            積込: 朝 {formatMinutes(report.morningLoadingMinutes)} / 夕 {formatMinutes(report.eveningLoadingMinutes)}
                                        </span>
                                    </div>

                                    {/* 備考 */}
                                    {report.notes && (
                                        <div className="text-sm text-gray-600 truncate border-t border-gray-100 pt-2 mt-2">
                                            {report.notes}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:block flex-1 overflow-auto bg-white rounded-xl shadow-lg border border-gray-200">
                {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loading text="読み込み中..." />
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
                selectedReport={selectedReport}
                onSaved={handleSaved}
                onDelete={handleDelete}
            />
        </div >
    );
}
