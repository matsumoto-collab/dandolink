// プレースホルダー実装。Phase 1 の次タスクで実機能に置き換え予定。
'use client';

import React from 'react';
import { FileSearch, Plus } from 'lucide-react';

interface SiteSurveyTabProps {
    projectMasterId: string;
}

export default function SiteSurveyTab({ projectMasterId }: SiteSurveyTabProps) {
    return (
        <div className="py-4">
            <div className="flex items-center gap-3 mb-4">
                <FileSearch className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-semibold text-slate-900">現場調査</h3>
                <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                    準備中
                </span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                <p className="text-sm text-slate-600 mb-4">
                    まだ調査が登録されていません
                </p>
                <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-300 text-white text-sm font-medium cursor-not-allowed"
                >
                    <Plus className="w-4 h-4" />
                    新規作成
                </button>
                <p className="text-xs text-slate-400 mt-2">次のタスクで有効化されます</p>
            </div>

            <div className="mt-6 bg-white border border-slate-200 rounded-xl p-5">
                <h4 className="text-sm font-semibold text-slate-800 mb-3">この機能で何ができる？</h4>
                <ul className="text-sm text-slate-600 space-y-2 list-disc list-inside">
                    <li>建物の形状をスマホで作図</li>
                    <li>自動で外周・床面積・足場掛面積を計算</li>
                    <li>ピン・メモで現場の特記事項を記録</li>
                    <li>セクション別の高さ・開口部を指定</li>
                    <li>案件詳細・見積書と一気通貫で連動</li>
                </ul>
            </div>

            <p className="mt-4 text-xs text-slate-400 text-center">
                ProjectMaster ID: {projectMasterId}
            </p>
        </div>
    );
}
