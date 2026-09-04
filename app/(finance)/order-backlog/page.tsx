'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import ProjectPickerModal from '@/components/OrderBacklog/ProjectPickerModal';
import ReportEditor, { type OrderBacklogEditorState } from '@/components/OrderBacklog/ReportEditor';
import ReportListPanel from '@/components/OrderBacklog/ReportListPanel';
import { buildOrderBacklogSheet } from '@/lib/orderBacklog/render';
import { DEFAULT_INDIVIDUAL_THRESHOLD, type OrderBacklogLineInput } from '@/lib/orderBacklog/types';
import { logger } from '@/lib/logger';
import type {
    OrderBacklogCandidateWarning,
    OrderBacklogCandidatesResponse,
    OrderBacklogReportDetail,
    OrderBacklogReportSummary,
} from '@/types/orderBacklog';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 今日（JST）の 'YYYY-MM-DD'。 */
function todayJst(): string {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

function emptyEditor(asOfDate = todayJst()): OrderBacklogEditorState {
    return {
        id: null,
        asOfDate,
        title: '',
        applicantName: '',
        individualThreshold: DEFAULT_INDIVIDUAL_THRESHOLD,
        unreceivedMode: 'remaining',
        taxMode: 'inclusive',
        notes: '',
        lines: [],
    };
}

/** API のエラーメッセージを拾う（本文が JSON でないときも落ちない）。 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = await res.json();
        return typeof body?.error === 'string' ? body.error : fallback;
    } catch {
        return fallback;
    }
}

/** 保存用のペイロード（API の zod と同じ形に整える）。 */
function toPayload(state: OrderBacklogEditorState) {
    return {
        asOfDate: state.asOfDate,
        title: state.title.trim() || null,
        applicantName: state.applicantName.trim() || null,
        individualThreshold: state.individualThreshold,
        unreceivedMode: state.unreceivedMode,
        taxMode: state.taxMode,
        notes: state.notes.trim() || null,
        lines: state.lines.map((line, index) => ({
            projectMasterId: line.projectMasterId,
            customerName: line.customerName,
            projectName: line.projectName,
            workKind: line.workKind,
            siteKind: line.siteKind,
            contractAmount: line.contractAmount,
            startYm: line.startYm,
            endYm: line.endYm,
            progressRate: line.progressRate,
            receivedAmount: line.receivedAmount,
            schedule: line.schedule ?? {},
            excluded: line.excluded,
            isManual: line.isManual,
            note: line.note ?? null,
            sortOrder: index,
        })),
    };
}

/**
 * 受注明細書（信用保証協会様式）。admin 限定（配線は components/MainContent.tsx 側で判定）。
 *
 * 左に保存済み一覧、右にエディタ（設定 → 明細 → 出力プレビュー）。
 * 候補は毎回 API（lib/orderBacklog/candidates）で作り直し、手直しした結果だけを保存する。
 */
export default function OrderBacklogPage() {
    const [reports, setReports] = useState<OrderBacklogReportSummary[]>([]);
    const [isListLoading, setIsListLoading] = useState(true);
    const [editor, setEditor] = useState<OrderBacklogEditorState | null>(null);
    const [warnings, setWarnings] = useState<OrderBacklogCandidateWarning[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [reproposingIndex, setReproposingIndex] = useState<number | null>(null);

    // 二重送信ガード（state だけだと連打がすり抜けるので ref の同期ロックを使う）
    const savingRef = useRef(false);
    // 保存の通信中に打った手直しを、返ってきたサーバーの行で上書きしないために「いまの編集状態」を常に持つ
    const editorRef = useRef<OrderBacklogEditorState | null>(null);
    editorRef.current = editor;

    const loadReports = useCallback(async () => {
        setIsListLoading(true);
        try {
            const res = await fetch('/api/order-backlog/reports', { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, '一覧の取得に失敗しました'));
            setReports((await res.json()) as OrderBacklogReportSummary[]);
        } catch (e) {
            logger.error('[order-backlog] 一覧取得に失敗', e);
            toast.error(e instanceof Error ? e.message : '一覧の取得に失敗しました');
        } finally {
            setIsListLoading(false);
        }
    }, []);

    useEffect(() => {
        loadReports();
    }, [loadReports]);

    // 未保存のままタブを閉じようとしたら確認する
    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    /** 未保存の変更を捨ててよいか確認する。 */
    const confirmDiscard = useCallback(() => {
        if (!isDirty) return true;
        return window.confirm('未保存の変更があります。破棄して続けますか？');
    }, [isDirty]);

    /** 候補 API。projectMasterIds を渡すと抽出条件を無視してその案件だけ返る。 */
    const fetchCandidates = useCallback(
        async (
            asOf: string,
            taxMode: OrderBacklogEditorState['taxMode'],
            projectMasterIds?: string[],
        ): Promise<OrderBacklogCandidatesResponse> => {
            const params = new URLSearchParams({ asOf, taxMode });
            if (projectMasterIds?.length) params.set('projectMasterIds', projectMasterIds.join(','));
            const res = await fetch(`/api/order-backlog/candidates?${params.toString()}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, '候補の取得に失敗しました'));
            return (await res.json()) as OrderBacklogCandidatesResponse;
        },
        [],
    );

    const patchEditor = useCallback((patch: Partial<OrderBacklogEditorState>) => {
        setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
        setIsDirty(true);
    }, []);

    const changeLine = useCallback((index: number, patch: Partial<OrderBacklogLineInput>) => {
        setEditor((prev) => {
            if (!prev) return prev;
            const lines = prev.lines.slice();
            lines[index] = { ...lines[index], ...patch };
            return { ...prev, lines };
        });
        setIsDirty(true);
    }, []);

    const removeLine = useCallback((index: number) => {
        setEditor((prev) => (prev ? { ...prev, lines: prev.lines.filter((_, i) => i !== index) } : prev));
        setIsDirty(true);
    }, []);

    /** 新規作成：候補を自動で作ってから編集に入る。 */
    const handleCreate = useCallback(async () => {
        if (!confirmDiscard()) return;
        const next = emptyEditor();
        setEditor(next);
        setWarnings([]);
        setIsDirty(true);
        setIsRegenerating(true);
        try {
            const { lines, warnings: w } = await fetchCandidates(next.asOfDate, next.taxMode);
            setEditor((prev) => (prev ? { ...prev, lines } : prev));
            setWarnings(w);
            toast.success(`候補を${lines.length}件作成しました`);
        } catch (e) {
            logger.error('[order-backlog] 候補作成に失敗', e);
            toast.error(e instanceof Error ? e.message : '候補の取得に失敗しました');
        } finally {
            setIsRegenerating(false);
        }
    }, [confirmDiscard, fetchCandidates]);

    const handleOpen = useCallback(
        async (id: string) => {
            if (editor?.id === id && !isDirty) return;
            if (!confirmDiscard()) return;
            try {
                const res = await fetch(`/api/order-backlog/reports/${id}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(await errorMessage(res, '受注明細書の取得に失敗しました'));
                const detail = (await res.json()) as OrderBacklogReportDetail;
                setEditor({
                    id: detail.report.id,
                    asOfDate: detail.report.asOfDate,
                    title: detail.report.title ?? '',
                    applicantName: detail.report.applicantName ?? '',
                    individualThreshold: detail.report.individualThreshold,
                    unreceivedMode: detail.report.unreceivedMode,
                    taxMode: detail.report.taxMode,
                    notes: detail.report.notes ?? '',
                    lines: detail.lines,
                });
                setWarnings([]);
                setIsDirty(false);
            } catch (e) {
                logger.error('[order-backlog] 取得に失敗', e);
                toast.error(e instanceof Error ? e.message : '受注明細書の取得に失敗しました');
            }
        },
        [confirmDiscard, editor?.id, isDirty],
    );

    /** 候補を作り直す（手直しは消える）。 */
    const handleRegenerate = useCallback(async () => {
        if (!editor) return;
        if (!window.confirm('候補を作り直すと、いまの明細（手直し・手動追加）は消えます。よろしいですか？')) return;
        setIsRegenerating(true);
        try {
            const { lines, warnings: w } = await fetchCandidates(editor.asOfDate, editor.taxMode);
            setEditor((prev) => (prev ? { ...prev, lines } : prev));
            setWarnings(w);
            setIsDirty(true);
            toast.success(`候補を${lines.length}件作成しました`);
        } catch (e) {
            logger.error('[order-backlog] 候補作成に失敗', e);
            toast.error(e instanceof Error ? e.message : '候補の取得に失敗しました');
        } finally {
            setIsRegenerating(false);
        }
    }, [editor, fetchCandidates]);

    /** 案件検索から手で足す（isManual=true で返る）。 */
    const handleAddProjects = useCallback(
        async (projectMasterIds: string[]) => {
            if (!editor || projectMasterIds.length === 0) return;
            setIsAdding(true);
            try {
                const { lines, warnings: w } = await fetchCandidates(
                    editor.asOfDate,
                    editor.taxMode,
                    projectMasterIds,
                );
                setEditor((prev) => {
                    if (!prev) return prev;
                    const existing = new Set(prev.lines.map((l) => l.projectMasterId).filter(Boolean));
                    const added = lines.filter((l) => !l.projectMasterId || !existing.has(l.projectMasterId));
                    return { ...prev, lines: [...prev.lines, ...added] };
                });
                setWarnings((prev) => [...prev, ...w]);
                setIsDirty(true);
                setIsPickerOpen(false);
                toast.success(`${lines.length}件を追加しました`);
            } catch (e) {
                logger.error('[order-backlog] 案件追加に失敗', e);
                toast.error(e instanceof Error ? e.message : '案件の追加に失敗しました');
            } finally {
                setIsAdding(false);
            }
        },
        [editor, fetchCandidates],
    );

    /** 1行ぶんの入金予定を提案し直す（配置が要るので候補 API を案件指定で呼び直す）。 */
    const handleReproposeSchedule = useCallback(
        async (index: number) => {
            if (!editor) return;
            const line = editor.lines[index];
            if (!line?.projectMasterId) return;
            setReproposingIndex(index);
            try {
                const { lines } = await fetchCandidates(editor.asOfDate, editor.taxMode, [line.projectMasterId]);
                const proposed = lines.find((l) => l.projectMasterId === line.projectMasterId);
                if (!proposed) {
                    toast.error('この案件の入金予定を提案できませんでした');
                    return;
                }
                changeLine(index, { schedule: proposed.schedule });
                toast.success('入金予定を再提案しました');
            } catch (e) {
                logger.error('[order-backlog] 入金予定の再提案に失敗', e);
                toast.error(e instanceof Error ? e.message : '入金予定の再提案に失敗しました');
            } finally {
                setReproposingIndex(null);
            }
        },
        [editor, fetchCandidates, changeLine],
    );

    const handleSave = useCallback(async () => {
        if (!editor || savingRef.current) return;
        savingRef.current = true;
        setIsSaving(true);
        try {
            const isNew = !editor.id;
            const res = await fetch(
                isNew ? '/api/order-backlog/reports' : `/api/order-backlog/reports/${editor.id}`,
                {
                    method: isNew ? 'POST' : 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(toPayload(editor)),
                },
            );
            if (!res.ok) throw new Error(await errorMessage(res, '保存に失敗しました'));
            const saved = (await res.json()) as OrderBacklogReportDetail;

            // 通信中に別の行を打っていたら、その手直しを消さずに残す（消すと「保存したら 0 に戻った」ように見える）。
            // 行は同じ順で返ってくるので、案件が一致する行には新しい id だけ写す。
            const latest = editorRef.current;
            const editedDuringSave = !!latest && latest.lines !== editor.lines;
            setEditor((prev) => {
                if (!prev) return prev;
                if (!editedDuringSave) return { ...prev, id: saved.report.id, lines: saved.lines };
                const sameShape =
                    prev.lines.length === saved.lines.length &&
                    prev.lines.every((l, i) => l.projectMasterId === saved.lines[i].projectMasterId);
                const lines = sameShape ? prev.lines.map((l, i) => ({ ...l, id: saved.lines[i].id })) : prev.lines;
                return { ...prev, id: saved.report.id, lines };
            });
            setIsDirty(editedDuringSave);
            const withAmount = saved.lines.filter((l) => !l.excluded && l.contractAmount > 0).length;
            toast.success(
                editedDuringSave
                    ? `保存しました（${saved.lines.length}行）。保存中に直した分はまだ未保存です`
                    : `保存しました（${saved.lines.length}行・金額入力 ${withAmount}行）`,
            );
            await loadReports();
        } catch (e) {
            logger.error('[order-backlog] 保存に失敗', e);
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            savingRef.current = false;
            setIsSaving(false);
        }
    }, [editor, loadReports]);

    const handleDelete = useCallback(
        async (id: string) => {
            if (!window.confirm('この受注明細書を削除します。よろしいですか？')) return;
            try {
                const res = await fetch(`/api/order-backlog/reports/${id}`, { method: 'DELETE' });
                if (!res.ok) throw new Error(await errorMessage(res, '削除に失敗しました'));
                toast.success('削除しました');
                if (editor?.id === id) {
                    setEditor(null);
                    setIsDirty(false);
                }
                await loadReports();
            } catch (e) {
                logger.error('[order-backlog] 削除に失敗', e);
                toast.error(e instanceof Error ? e.message : '削除に失敗しました');
            }
        },
        [editor?.id, loadReports],
    );

    /** 複製：明細をコピーして未保存の新規にする（入金予定は必要なら提案し直す）。 */
    const handleDuplicate = useCallback(
        async (id: string) => {
            if (!confirmDiscard()) return;
            const asOfDate = window.prompt('新しい基準日を YYYY-MM-DD で入力してください', todayJst());
            if (!asOfDate) return;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
                toast.error('基準日は YYYY-MM-DD 形式で入力してください');
                return;
            }
            try {
                const res = await fetch(`/api/order-backlog/reports/${id}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(await errorMessage(res, '受注明細書の取得に失敗しました'));
                const detail = (await res.json()) as OrderBacklogReportDetail;

                // id を落として新規扱いにする（保存で新しいレポートになる）
                let lines: OrderBacklogLineInput[] = detail.lines.map((l) => ({ ...l, id: undefined }));

                const repropose = window.confirm('入金予定を新しい基準日で提案し直しますか？（いいえ＝そのまま複製）');
                if (repropose) {
                    const ids = lines.map((l) => l.projectMasterId).filter((v): v is string => !!v);
                    if (ids.length > 0) {
                        const { lines: proposed } = await fetchCandidates(asOfDate, detail.report.taxMode, ids);
                        const byProject = new Map(proposed.map((p) => [p.projectMasterId, p]));
                        lines = lines.map((l) => {
                            const p = l.projectMasterId ? byProject.get(l.projectMasterId) : undefined;
                            return p ? { ...l, schedule: p.schedule, progressRate: p.progressRate } : l;
                        });
                    }
                }

                setEditor({
                    id: null,
                    asOfDate,
                    title: detail.report.title ? `${detail.report.title}（複製）` : '',
                    applicantName: detail.report.applicantName ?? '',
                    individualThreshold: detail.report.individualThreshold,
                    unreceivedMode: detail.report.unreceivedMode,
                    taxMode: detail.report.taxMode,
                    notes: detail.report.notes ?? '',
                    lines,
                });
                setWarnings([]);
                setIsDirty(true);
                toast.success('複製しました（保存すると新しい明細書になります）');
            } catch (e) {
                logger.error('[order-backlog] 複製に失敗', e);
                toast.error(e instanceof Error ? e.message : '複製に失敗しました');
            }
        },
        [confirmDiscard, fetchCandidates],
    );

    const fileBase = useMemo(
        () => `受注明細書_${(editor?.asOfDate ?? todayJst()).replace(/-/g, '')}`,
        [editor?.asOfDate],
    );

    const handleExportExcel = useCallback(async () => {
        if (!editor) return;
        if (!editor.id || isDirty) {
            toast.error('先に保存してください（保存した内容で Excel を作ります）');
            return;
        }
        setIsExporting(true);
        try {
            const res = await fetch(`/api/order-backlog/reports/${editor.id}/xlsx`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, 'Excel の出力に失敗しました'));
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${fileBase}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            logger.error('[order-backlog] Excel 出力に失敗', e);
            toast.error(e instanceof Error ? e.message : 'Excel の出力に失敗しました');
        } finally {
            setIsExporting(false);
        }
    }, [editor, isDirty, fileBase]);

    const handleExportPdf = useCallback(async () => {
        if (!editor) return;
        setIsExporting(true);
        try {
            const { exportOrderBacklogPDF } = await import('@/utils/orderBacklogPdf');
            const sheet = buildOrderBacklogSheet(
                {
                    asOfDate: editor.asOfDate,
                    individualThreshold: editor.individualThreshold,
                    unreceivedMode: editor.unreceivedMode,
                    applicantName: editor.applicantName || null,
                },
                editor.lines,
            );
            await exportOrderBacklogPDF(sheet, `${fileBase}.pdf`);
        } catch (e) {
            logger.error('[order-backlog] PDF 出力に失敗', e);
            toast.error(e instanceof Error ? e.message : 'PDF の出力に失敗しました');
        } finally {
            setIsExporting(false);
        }
    }, [editor, fileBase]);

    const excludeIds = useMemo(
        () => (editor?.lines ?? []).map((l) => l.projectMasterId).filter((v): v is string => !!v),
        [editor?.lines],
    );

    return (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-bold text-slate-800">受注明細書</h2>
                <span className="text-xs text-slate-500">信用保証協会に出す様式（A3横・単位 千円）</span>
            </div>

            <div className="flex-1 min-h-0 flex gap-4">
                <div className="w-72 flex-shrink-0">
                    <ReportListPanel
                        reports={reports}
                        isLoading={isListLoading}
                        activeId={editor?.id ?? null}
                        onCreate={handleCreate}
                        onOpen={handleOpen}
                        onDuplicate={handleDuplicate}
                        onDelete={handleDelete}
                    />
                </div>
                <div className="flex-1 min-w-0 overflow-y-auto pr-1">
                    {editor ? (
                        <ReportEditor
                            state={editor}
                            warnings={warnings}
                            isDirty={isDirty}
                            isSaving={isSaving}
                            isRegenerating={isRegenerating}
                            isExporting={isExporting}
                            reproposingIndex={reproposingIndex}
                            onPatch={patchEditor}
                            onChangeLine={changeLine}
                            onRemoveLine={removeLine}
                            onReproposeSchedule={handleReproposeSchedule}
                            onRegenerate={handleRegenerate}
                            onOpenPicker={() => setIsPickerOpen(true)}
                            onSave={handleSave}
                            onExportExcel={handleExportExcel}
                            onExportPdf={handleExportPdf}
                        />
                    ) : (
                        <div className="h-full flex items-center justify-center border border-dashed border-slate-300 rounded-lg text-sm text-slate-500">
                            左の一覧から開くか、「新規作成」で基準日の候補を作ってください。
                        </div>
                    )}
                </div>
            </div>

            <ProjectPickerModal
                isOpen={isPickerOpen}
                onClose={() => setIsPickerOpen(false)}
                excludeIds={excludeIds}
                onAdd={handleAddProjects}
                isAdding={isAdding}
            />
        </div>
    );
}
