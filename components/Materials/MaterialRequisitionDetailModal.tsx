'use client';

import { X, Printer, Pencil } from 'lucide-react';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';
import StatusBadge from './ui/StatusBadge';
import type { MaterialRequisition } from '@/types/material';

interface MaterialRequisitionDetailModalProps {
    req: MaterialRequisition;
    onClose: () => void;
    onEdit: (req: MaterialRequisition) => void;
    onPrint: (id: string) => void;
}

function fmtMd(d: string | Date | null | undefined): string {
    if (!d) return '';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 材料出庫伝票の詳細モーダル（見積書/請求書と同じ「クリック→PDF表示」パターン）。
 * PDF はサーバー印刷ルート（inline PDF・同一オリジンで cookie 認証）を InlinePdfViewer で表示。
 * 「編集」で出庫伝票フォームへ（編集モードで読み込み）。
 */
export default function MaterialRequisitionDetailModal({ req, onClose, onEdit, onPrint }: MaterialRequisitionDetailModalProps) {
    const pdfUrl = `/api/materials/requisitions/${req.id}/print`;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-slate-200 shrink-0">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 truncate">{req.projectTitle || '伝票'}</span>
                            <StatusBadge status={req.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                            {fmtMd(req.date) && <span>{fmtMd(req.date)}</span>}
                            {req.foremanName && <span>{req.foremanName}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            onClick={() => onEdit(req)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-xl hover:bg-teal-700"
                        >
                            <Pencil className="w-4 h-4" />編集
                        </button>
                        <button
                            onClick={() => onPrint(req.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                            title="別タブで印刷用に開く"
                        >
                            <Printer className="w-4 h-4" /><span className="hidden sm:inline">印刷</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                            aria-label="閉じる"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* PDF プレビュー */}
                <div className="flex-1 overflow-hidden bg-slate-100">
                    <InlinePdfViewer url={pdfUrl} />
                </div>
            </div>
        </div>
    );
}
