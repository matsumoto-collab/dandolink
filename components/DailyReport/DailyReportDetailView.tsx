'use client';

import React, { useState } from 'react';
import { DailyReport } from '@/types/dailyReport';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { formatDate } from '@/utils/dateUtils';
import { Clock, FileText, Truck, User, Calendar, Trash2 } from 'lucide-react';

interface DailyReportDetailViewProps {
    report: DailyReport;
    onEdit: () => void;
    onClose: () => void;
    onDelete: () => void;
}

export default function DailyReportDetailView({ report, onEdit, onClose, onDelete }: DailyReportDetailViewProps) {
    const { getForemanName } = useCalendarDisplay();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const reportDate = report.date instanceof Date ? report.date : new Date(report.date);

    // 分を時間:分形式に変換
    const formatMinutes = (minutes: number): string => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}:${mins.toString().padStart(2, '0')}`;
    };

    // 作業時間の差分計算
    const calcWorkMinutes = (startTime: string, endTime: string): number => {
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    };

    // 総作業時間
    const totalWorkMinutes = report.workItems.reduce((sum, item) => {
        if (item.startTime && item.endTime) {
            return sum + calcWorkMinutes(item.startTime, item.endTime);
        }
        return sum;
    }, 0);

    const confirmDelete = () => {
        onDelete();
        setShowDeleteConfirm(false);
    };

    return (
        <div className="space-y-6">
            {/* ヘッダー */}
            <div className="border-b border-gray-200 pb-4">
                <div className="flex items-center gap-2 mb-1">
                    <Calendar className="w-5 h-5 text-gray-400" />
                    <h3 className="text-2xl font-bold text-gray-900">
                        {formatDate(reportDate, 'full')}
                    </h3>
                </div>
                <div className="flex items-center gap-2 mt-2">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-lg text-gray-600">
                        {getForemanName(report.foremanId)}
                    </span>
                </div>
            </div>

            {/* 案件ごとの作業時間 */}
            <div>
                <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    案件ごとの作業時間
                </h4>
                {report.workItems.length === 0 ? (
                    <div className="p-4 bg-gray-50 rounded-lg text-gray-500 text-center text-sm">
                        登録された案件はありません
                    </div>
                ) : (
                    <div className="space-y-2">
                        {report.workItems.map((item) => {
                            const title = item.assignment?.projectMaster?.title || '(案件名不明)';
                            const customer = item.assignment?.projectMaster?.customerName;
                            const start = item.startTime || '08:00';
                            const end = item.endTime || '17:00';
                            const workMin = calcWorkMinutes(start, end);

                            return (
                                <div key={item.assignmentId} className="p-3 bg-gray-50 rounded-lg">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <div className="font-medium text-gray-800">{title}</div>
                                            {customer && (
                                                <div className="text-sm text-gray-500">{customer}</div>
                                            )}
                                        </div>
                                        <span className="text-sm font-medium text-slate-700 bg-slate-50 px-2 py-0.5 rounded">
                                            {formatMinutes(workMin)}
                                        </span>
                                    </div>
                                    <div className="text-sm text-gray-600 mt-1">
                                        {start} 〜 {end}
                                    </div>
                                </div>
                            );
                        })}
                        <div className="flex justify-end pt-1">
                            <span className="text-sm font-semibold text-gray-700">
                                合計: {formatMinutes(totalWorkMinutes)}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* 積込時間 */}
            <div>
                <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                    <Truck className="w-4 h-4" />
                    積込時間
                </h4>
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1">朝積込</div>
                        <div className="text-base font-medium text-gray-900">
                            {formatMinutes(report.morningLoadingMinutes)}
                        </div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1">夕積込</div>
                        <div className="text-base font-medium text-gray-900">
                            {formatMinutes(report.eveningLoadingMinutes)}
                        </div>
                    </div>
                </div>
            </div>

            {/* 早出・残業 */}
            {(report.earlyStartMinutes > 0 || report.overtimeMinutes > 0) && (
                <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        早出・残業
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                        {report.earlyStartMinutes > 0 && (
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="text-xs text-gray-500 mb-1">早出</div>
                                <div className="text-base font-medium text-gray-900">
                                    {formatMinutes(report.earlyStartMinutes)}
                                </div>
                            </div>
                        )}
                        {report.overtimeMinutes > 0 && (
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="text-xs text-gray-500 mb-1">残業</div>
                                <div className="text-base font-medium text-gray-900">
                                    {formatMinutes(report.overtimeMinutes)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 備考 */}
            {report.notes && (
                <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        備考
                    </h4>
                    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{report.notes}</p>
                    </div>
                </div>
            )}

            {/* 削除確認ダイアログ */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 lg:left-64 z-[60] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setShowDeleteConfirm(false)} />
                    <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            日報を削除しますか？
                        </h3>
                        <p className="text-sm text-gray-600 mb-4">
                            {formatDate(reportDate, 'full')} の日報を削除します。この操作は元に戻せません。
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-md hover:bg-slate-800 transition-colors font-medium"
                            >
                                削除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* アクションボタン */}
            <div className="space-y-3 pt-4 border-t border-gray-200">
                <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full px-4 py-2 border border-slate-300 bg-slate-50 rounded-md text-slate-700 hover:bg-slate-100 transition-colors font-medium flex items-center justify-center gap-2"
                >
                    <Trash2 className="w-4 h-4" />
                    削除
                </button>
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                    >
                        閉じる
                    </button>
                    <button
                        onClick={onEdit}
                        className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors font-medium"
                    >
                        編集
                    </button>
                </div>
            </div>
        </div>
    );
}
