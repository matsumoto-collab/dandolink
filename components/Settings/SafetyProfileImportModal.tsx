'use client';

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { FileUp, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
    buildProfileFromRow,
    guessFieldForHeader,
    normalizeNameForMatch,
    IMPORT_FIELDS,
    IMPORT_NAME_FIELD,
} from '@/lib/safetyImport';
import { getSafetyTargetGroup, SAFETY_TARGET_GROUP_LABELS } from '@/lib/safetyDocuments';
import type { SafetyTargetDto } from '@/types/safety';
import { logger } from '@/lib/logger';

/**
 * 作業員名簿Excelの取込モーダル（FR-5）。
 * パースは SheetJS（公式レジストリ版）でクライアント完結し、サーバーへは
 * 列マッピング済みのJSONのみ送信する。様式が元請ごとに異なるため固定マッピングにしない。
 * §7.4 の禁止項目（健康保険番号等）はマッピング先の選択肢に存在しない（FR-5-4）。
 */

interface SafetyProfileImportModalProps {
    targets: SafetyTargetDto[];
    onClose: () => void;
    onImported: () => void;
}

type Step = 'file' | 'mapping' | 'preview';

interface SheetData {
    name: string;
    rows: unknown[][];
}

interface PreviewRow {
    rowIndex: number;
    name: string;
    profile: Record<string, string | number | boolean | null>;
    filledCount: number;
    match: SafetyTargetDto | null;
    action: 'create-worker' | 'update' | 'skip';
}

const INPUT_CLASS =
    'w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm text-sm';

const cellText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
};

export default function SafetyProfileImportModal({ targets, onClose, onImported }: SafetyProfileImportModalProps) {
    const [step, setStep] = useState<Step>('file');
    const [isParsing, setIsParsing] = useState(false);
    const [sheets, setSheets] = useState<SheetData[]>([]);
    const [sheetIndex, setSheetIndex] = useState(0);
    const [headerRowNo, setHeaderRowNo] = useState(1); // 1-based 表示
    const [mapping, setMapping] = useState<Record<number, string>>({});
    const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const sheet = sheets[sheetIndex] ?? null;
    const headerRowIndex = headerRowNo - 1;
    const headerRow = useMemo(() => (sheet?.rows[headerRowIndex] ?? []) as unknown[], [sheet, headerRowIndex]);
    const dataRows = useMemo(() => (sheet ? sheet.rows.slice(headerRowIndex + 1) : []), [sheet, headerRowIndex]);

    const handleFile = async (file: File) => {
        setIsParsing(true);
        try {
            // インポート画面でのみ動的ロード（バンドル影響の抑制。FR-5-2b）
            const XLSX = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
            const parsed: SheetData[] = workbook.SheetNames.map((name) => ({
                name,
                rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
                    header: 1,
                    defval: null,
                }),
            }));
            if (parsed.length === 0 || parsed.every((s) => s.rows.length === 0)) {
                toast.error('シートにデータがありません');
                return;
            }
            setSheets(parsed);
            setSheetIndex(0);
            setHeaderRowNo(1);
            setMapping({});
            setStep('mapping');
        } catch (error) {
            logger.error('Excelパースエラー:', error);
            toast.error('ファイルの読み込みに失敗しました。形式（.xlsx / .xls）を確認してください。');
        } finally {
            setIsParsing(false);
        }
    };

    /** ヘッダー行のテキストからマッピングを自動推測（同じフィールドへの重複割当は先勝ち） */
    const autoGuessMapping = (row: unknown[]): Record<number, string> => {
        const next: Record<number, string> = {};
        const used = new Set<string>();
        row.forEach((cell, colIndex) => {
            const guessed = guessFieldForHeader(cellText(cell));
            if (guessed && !used.has(guessed)) {
                next[colIndex] = guessed;
                used.add(guessed);
            }
        });
        return next;
    };

    // ヘッダー行確定時に自動マッピング（mapping が空のときのみ）
    React.useEffect(() => {
        if (step !== 'mapping' || headerRow.length === 0) return;
        setMapping((prev) => (Object.keys(prev).length > 0 ? prev : autoGuessMapping(headerRow)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, headerRow]);

    const setColumnField = (colIndex: number, field: string) => {
        setMapping((prev) => {
            const next = { ...prev };
            // 同一フィールドは1列のみ（他列の同フィールド割当を解除）
            if (field) {
                for (const [k, v] of Object.entries(next)) {
                    if (v === field) delete next[Number(k)];
                }
                next[colIndex] = field;
            } else {
                delete next[colIndex];
            }
            return next;
        });
    };

    const nameMapped = Object.values(mapping).includes(IMPORT_NAME_FIELD);

    const buildPreview = () => {
        if (!nameMapped) {
            toast.error('「氏名」列のマッピングは必須です');
            return;
        }
        const nameToTarget = new Map<string, SafetyTargetDto>();
        for (const t of targets) {
            const key = normalizeNameForMatch(t.name);
            if (key && !nameToTarget.has(key)) nameToTarget.set(key, t);
        }

        const rows: PreviewRow[] = [];
        dataRows.forEach((row, i) => {
            const { name, profile } = buildProfileFromRow(row as unknown[], mapping);
            if (!name) return; // 氏名が空の行はスキップ（罫線だけの行・小計行など）
            const match = nameToTarget.get(normalizeNameForMatch(name)) ?? null;
            rows.push({
                rowIndex: headerRowIndex + 1 + i,
                name,
                profile,
                filledCount: Object.keys(profile).length,
                match,
                action: match ? 'update' : 'create-worker',
            });
        });
        if (rows.length === 0) {
            toast.error('取込対象の行が見つかりません（ヘッダー行の指定を確認してください）');
            return;
        }
        setPreviewRows(rows);
        setStep('preview');
    };

    const setRowAction = (index: number, action: PreviewRow['action']) => {
        setPreviewRows((prev) => prev.map((r, i) => (i === index ? { ...r, action } : r)));
    };

    const importCount = previewRows.filter((r) => r.action !== 'skip').length;

    const handleSubmit = async () => {
        const rows = previewRows
            .filter((r) => r.action !== 'skip')
            .map((r) =>
                r.action === 'update' && r.match
                    ? {
                          name: r.name,
                          action: 'update' as const,
                          targetSource: r.match.source,
                          targetId: r.match.sourceId,
                          profile: r.profile,
                      }
                    : { name: r.name, action: 'create-worker' as const, profile: r.profile }
            );
        if (rows.length === 0) {
            toast.error('取込対象がありません');
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await fetch('/api/safety-profiles/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '取込に失敗しました');
            }
            const { created, updated } = await res.json();
            toast.success(`取込が完了しました（新規 ${created}名 / 更新 ${updated}名）`);
            onImported();
        } catch (error) {
            logger.error('Excelインポートエラー:', error);
            toast.error(error instanceof Error ? error.message : '取込に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    const sampleValues = (colIndex: number): string =>
        dataRows
            .slice(0, 2)
            .map((row) => cellText((row as unknown[])[colIndex]))
            .filter(Boolean)
            .join(' / ');

    return createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                {/* ヘッダー */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <FileUp className="w-4 h-4 text-teal-600" />
                        Excelから作業員を取込
                        <span className="text-xs font-normal text-slate-400">
                            {step === 'file' ? '1/3 ファイル選択' : step === 'mapping' ? '2/3 列の対応付け' : '3/3 確認'}
                        </span>
                    </h3>
                    <button type="button" onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg" aria-label="閉じる">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* 本体 */}
                <div className="flex-1 min-h-0 overflow-y-auto p-5">
                    {step === 'file' && (
                        <div className="space-y-4">
                            <p className="text-sm text-slate-600">
                                手持ちの作業員名簿Excel（.xlsx / .xls）から安全情報を一括登録します。
                                様式は問いません — 次の画面で列とのひも付けを指定します。
                            </p>
                            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-12 cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-colors">
                                <FileUp className="w-8 h-8 text-slate-400" />
                                <span className="text-sm text-slate-600">
                                    {isParsing ? '読み込み中...' : 'クリックしてファイルを選択（.xlsx / .xls）'}
                                </span>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    className="hidden"
                                    disabled={isParsing}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFile(file);
                                        e.target.value = '';
                                    }}
                                />
                            </label>
                            <p className="text-xs text-slate-400">
                                ※ 健康保険の記号・番号、基礎年金番号、マイナンバーは法令により取り込めません（取込先の項目自体がありません）。
                            </p>
                        </div>
                    )}

                    {step === 'mapping' && sheet && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-end gap-3">
                                {sheets.length > 1 && (
                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">シート</label>
                                        <select
                                            value={sheetIndex}
                                            onChange={(e) => {
                                                setSheetIndex(Number(e.target.value));
                                                setHeaderRowNo(1);
                                                setMapping({});
                                            }}
                                            className={INPUT_CLASS}
                                        >
                                            {sheets.map((s, i) => (
                                                <option key={s.name} value={i}>
                                                    {s.name}（{s.rows.length}行）
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1">
                                        見出し行（この行の次からがデータ行）
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={Math.max(1, sheet.rows.length)}
                                        value={headerRowNo}
                                        onChange={(e) => {
                                            const n = Number(e.target.value);
                                            if (Number.isInteger(n) && n >= 1 && n <= sheet.rows.length) {
                                                setHeaderRowNo(n);
                                                setMapping({});
                                            }
                                        }}
                                        className={`${INPUT_CLASS} w-28`}
                                    />
                                </div>
                                <p className="text-xs text-slate-400 pb-2">
                                    列見出しから自動で対応付けています。違う場合は選び直してください。
                                </p>
                            </div>

                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr className="text-left text-xs text-slate-500">
                                            <th className="px-3 py-2 font-medium w-12">列</th>
                                            <th className="px-3 py-2 font-medium">Excelの見出し</th>
                                            <th className="px-3 py-2 font-medium">データ例</th>
                                            <th className="px-3 py-2 font-medium w-64">取込先の項目</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {headerRow.map((cell, colIndex) => (
                                            <tr key={colIndex} className="border-b border-slate-100">
                                                <td className="px-3 py-1.5 text-slate-400 text-xs">{colIndex + 1}</td>
                                                <td className="px-3 py-1.5 text-slate-800">{cellText(cell) || '（空）'}</td>
                                                <td className="px-3 py-1.5 text-slate-500 text-xs max-w-[200px] truncate">
                                                    {sampleValues(colIndex)}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                    <select
                                                        value={mapping[colIndex] ?? ''}
                                                        onChange={(e) => setColumnField(colIndex, e.target.value)}
                                                        className={`${INPUT_CLASS} py-1.5 ${mapping[colIndex] ? 'border-teal-300 bg-teal-50/40' : ''}`}
                                                    >
                                                        <option value="">取り込まない</option>
                                                        {IMPORT_FIELDS.map((f) => (
                                                            <option key={f.value} value={f.value}>
                                                                {f.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {!nameMapped && (
                                <p className="text-xs text-amber-600">
                                    「氏名（必須）」をどれか1列に割り当ててください。
                                </p>
                            )}
                        </div>
                    )}

                    {step === 'preview' && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600">
                                {previewRows.length}名が見つかりました。既存の作業員と氏名が一致した行は「更新」、
                                一致しなかった行は<strong className="font-semibold">職方として新規作成</strong>します。
                            </p>
                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr className="text-left text-xs text-slate-500">
                                            <th className="px-3 py-2 font-medium">氏名</th>
                                            <th className="px-3 py-2 font-medium text-center">取込項目数</th>
                                            <th className="px-3 py-2 font-medium">既存と一致</th>
                                            <th className="px-3 py-2 font-medium w-44">処理</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewRows.map((row, index) => (
                                            <tr key={`${row.rowIndex}-${row.name}`} className="border-b border-slate-100">
                                                <td className="px-3 py-1.5 text-slate-800 font-medium">{row.name}</td>
                                                <td className="px-3 py-1.5 text-center text-slate-600 tabular-nums">
                                                    {row.filledCount}
                                                </td>
                                                <td className="px-3 py-1.5 text-xs text-slate-500">
                                                    {row.match
                                                        ? `${SAFETY_TARGET_GROUP_LABELS[getSafetyTargetGroup(row.match.source, row.match.role)]}: ${row.match.name}`
                                                        : '—'}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                    <select
                                                        value={row.action}
                                                        onChange={(e) => setRowAction(index, e.target.value as PreviewRow['action'])}
                                                        className={`${INPUT_CLASS} py-1.5`}
                                                    >
                                                        {row.match ? (
                                                            <option value="update">既存を更新</option>
                                                        ) : (
                                                            <option value="create-worker">新規作成（職方）</option>
                                                        )}
                                                        <option value="skip">スキップ</option>
                                                    </select>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* フッター */}
                <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-200">
                    <div>
                        {step !== 'file' && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setStep(step === 'preview' ? 'mapping' : 'file')}
                            >
                                戻る
                            </Button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={onClose}>
                            キャンセル
                        </Button>
                        {step === 'mapping' && (
                            <Button size="sm" onClick={buildPreview} disabled={!nameMapped}>
                                確認へ進む
                            </Button>
                        )}
                        {step === 'preview' && (
                            <Button size="sm" onClick={handleSubmit} isLoading={isSubmitting} disabled={importCount === 0}>
                                {importCount}名を取り込む
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
