'use client';

import React, { useMemo } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Plus, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import LinesTable from '@/components/OrderBacklog/LinesTable';
import NumberInput from '@/components/OrderBacklog/NumberInput';
import OutputPreview from '@/components/OrderBacklog/OutputPreview';
import { monthColumns } from '@/lib/orderBacklog/render';
import type {
    OrderBacklogLineInput,
    TaxMode,
    UnreceivedMode,
} from '@/lib/orderBacklog/types';
import type { OrderBacklogCandidateWarning } from '@/types/orderBacklog';

/** 編集中の受注明細書（未保存も保存済みも同じ形で持つ）。 */
export interface OrderBacklogEditorState {
    /** 保存済みなら ID、未保存の新規なら null */
    id: string | null;
    asOfDate: string;
    title: string;
    applicantName: string;
    individualThreshold: number;
    unreceivedMode: UnreceivedMode;
    taxMode: TaxMode;
    notes: string;
    lines: OrderBacklogLineInput[];
}

interface ReportEditorProps {
    state: OrderBacklogEditorState;
    warnings: OrderBacklogCandidateWarning[];
    isDirty: boolean;
    isSaving: boolean;
    isRegenerating: boolean;
    isExporting: boolean;
    reproposingIndex: number | null;
    onPatch: (patch: Partial<OrderBacklogEditorState>) => void;
    onChangeLine: (index: number, patch: Partial<OrderBacklogLineInput>) => void;
    onRemoveLine: (index: number) => void;
    onReproposeSchedule: (index: number) => void;
    onRegenerate: () => void;
    onOpenPicker: () => void;
    onSave: () => void;
    onExportExcel: () => void;
    onExportPdf: () => void;
}

const labelClass = 'block text-[11px] font-medium text-slate-500 mb-1';
const inputClass =
    'w-full px-2 py-1.5 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-teal-500 focus:border-teal-500';

/** 受注明細書のエディタ（設定 → 明細 → 出力プレビュー）。 */
export default function ReportEditor({
    state,
    warnings,
    isDirty,
    isSaving,
    isRegenerating,
    isExporting,
    reproposingIndex,
    onPatch,
    onChangeLine,
    onRemoveLine,
    onReproposeSchedule,
    onRegenerate,
    onOpenPicker,
    onSave,
    onExportExcel,
    onExportPdf,
}: ReportEditorProps) {
    const columns = useMemo(() => monthColumns(state.asOfDate), [state.asOfDate]);

    const sheetReport = useMemo(
        () => ({
            asOfDate: state.asOfDate,
            individualThreshold: state.individualThreshold,
            unreceivedMode: state.unreceivedMode,
            applicantName: state.applicantName || null,
        }),
        [state.asOfDate, state.individualThreshold, state.unreceivedMode, state.applicantName],
    );

    const activeCount = state.lines.filter((l) => !l.excluded).length;

    return (
        <div className="flex flex-col gap-4">
            {/* 設定 */}
            <div className="border border-slate-200 rounded-lg bg-white p-4">
                <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    <div>
                        <label className={labelClass} htmlFor="ob-asof">
                            基準日
                        </label>
                        <input
                            id="ob-asof"
                            type="date"
                            value={state.asOfDate}
                            onChange={(e) => e.target.value && onPatch({ asOfDate: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                    <div className="col-span-2">
                        <label className={labelClass} htmlFor="ob-title">
                            タイトル（任意）
                        </label>
                        <input
                            id="ob-title"
                            type="text"
                            value={state.title}
                            placeholder="例: 2026年6月 ○○銀行"
                            onChange={(e) => onPatch({ title: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="ob-applicant">
                            申込人（空欄可）
                        </label>
                        <input
                            id="ob-applicant"
                            type="text"
                            value={state.applicantName}
                            onChange={(e) => onPatch({ applicantName: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="ob-threshold">
                            個別行の閾値（円）
                        </label>
                        <NumberInput
                            id="ob-threshold"
                            ariaLabel="個別行の閾値"
                            comma
                            value={state.individualThreshold}
                            onChange={(v) => onPatch({ individualThreshold: v })}
                            className="w-full text-sm py-1.5"
                        />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="ob-unreceived">
                            未受領の定義
                        </label>
                        <select
                            id="ob-unreceived"
                            value={state.unreceivedMode}
                            onChange={(e) => onPatch({ unreceivedMode: e.target.value as UnreceivedMode })}
                            className={`${inputClass} bg-white`}
                        >
                            <option value="remaining">契約額 − 出来高金額</option>
                            <option value="unpaid">出来高金額 − 既受領</option>
                        </select>
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="ob-tax">
                            契約額（候補作成時）
                        </label>
                        <select
                            id="ob-tax"
                            value={state.taxMode}
                            onChange={(e) => onPatch({ taxMode: e.target.value as TaxMode })}
                            className={`${inputClass} bg-white`}
                        >
                            <option value="inclusive">税込</option>
                            <option value="exclusive">税抜</option>
                        </select>
                    </div>
                    <div className="col-span-2 lg:col-span-5">
                        <label className={labelClass} htmlFor="ob-notes">
                            メモ
                        </label>
                        <input
                            id="ob-notes"
                            type="text"
                            value={state.notes}
                            onChange={(e) => onPatch({ notes: e.target.value })}
                            className={inputClass}
                        />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-100">
                    <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />}
                        onClick={onRegenerate}
                        disabled={isRegenerating}
                    >
                        候補を作り直す
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<Plus className="w-3.5 h-3.5" />}
                        onClick={onOpenPicker}
                    >
                        案件を追加
                    </Button>
                    <span className="text-xs text-slate-500">
                        {activeCount}件（除外 {state.lines.length - activeCount}件）
                        {isDirty && <span className="ml-2 text-amber-600 font-medium">未保存の変更があります</span>}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                            onClick={onExportExcel}
                            disabled={isExporting}
                        >
                            Excel
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            leftIcon={<Download className="w-3.5 h-3.5" />}
                            onClick={onExportPdf}
                            disabled={isExporting}
                        >
                            PDF
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            leftIcon={<Save className="w-3.5 h-3.5" />}
                            onClick={onSave}
                            isLoading={isSaving}
                            disabled={isSaving}
                        >
                            保存
                        </Button>
                    </div>
                </div>

                {warnings.length > 0 && (
                    <div className="mt-3 p-3 rounded border border-amber-200 bg-amber-50 text-xs text-amber-800">
                        <div className="flex items-center gap-1.5 font-semibold mb-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            候補作成時の注意（{warnings.length}件）
                        </div>
                        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                            {warnings.map((w, i) => (
                                <li key={`${w.projectMasterId}-${i}`}>
                                    {w.projectName}: {w.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <LinesTable
                lines={state.lines}
                columns={columns}
                individualThreshold={state.individualThreshold}
                unreceivedMode={state.unreceivedMode}
                onChangeLine={onChangeLine}
                onRemoveLine={onRemoveLine}
                onReproposeSchedule={onReproposeSchedule}
                reproposingIndex={reproposingIndex}
            />

            <OutputPreview report={sheetReport} lines={state.lines} />
        </div>
    );
}
