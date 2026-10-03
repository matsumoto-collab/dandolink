'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import {
    AlertTriangle,
    CalendarPlus,
    CheckCircle2,
    Eye,
    FileDown,
    Plus,
    RefreshCw,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { logger } from '@/lib/logger';
import {
    JOYO_LIMITS,
    buildDefaultItems,
    computeJoyoTotals,
    defaultIssueDate,
    defaultPaymentDate,
    defaultSubject,
    formatQuantity,
    hasDuplicateAutoKinds,
    itemAmount,
    recalcItems,
    roundQuantity,
    syncItemsWithCounts,
    type JoyoDayCounts,
    type JoyoItemKind,
    type JoyoStatementItem,
} from '@/lib/joyoStatement';
import type { JoyoStatementPdfIssuer } from '@/components/pdf/JoyoStatementPDF';
import type { JoyoPaidDayCounts, JoyoStatementRow } from '@/types/joyoStatement';
import JoyoNumberInput from './JoyoNumberInput';
import {
    JOYO_STATE_META,
    errorMessage,
    formatMd,
    formatMdWeek,
    isValidYmd,
    yen,
} from './joyoUi';

interface JoyoStatementEditorProps {
    /** 対象月（一覧で取り直したデータの年月） */
    year: number;
    month: number;
    /** 今日（JST）'YYYY-MM-DD'（API が返した値） */
    today: string;
    /** 一覧の1行（保存などのあと、取り直した一覧から同じ対象者の行が渡し直される） */
    row: JoyoStatementRow;
    settings: { title: string; footerNote: string };
    /** 自社情報。未登録なら null（プレビューを出さず、発行もできない） */
    issuer: JoyoStatementPdfIssuer | null;
    onClose: () => void;
    /** 一覧（GET）を取り直す。保存・発行・取り消し・削除が成功するたびに呼ぶ */
    onReload: () => Promise<void>;
    /** 支払予定に追加（Phase 4 でモーダルを配線する）。渡されたときだけボタンを出す */
    onAddToSchedule?: (row: JoyoStatementRow) => void;
}

/** 編集中の値 */
interface EditorForm {
    issueDate: string;
    paymentDate: string;
    subject: string;
    items: JoyoStatementItem[];
    includeAttendance: boolean;
    notes: string;
}

type BusyAction = 'save' | 'issue' | 'unissue' | 'delete' | 'pdf';

/** 出勤簿から作る行の種類と、出勤簿の区分の対応（確認文に出す言葉） */
const AUTO_KIND_INFO: { kind: Exclude<JoyoItemKind, 'manual'>; name: string; label: string; key: keyof JoyoPaidDayCounts }[] = [
    { kind: 'full', name: '常用（全日）', label: '出勤', key: 'present' },
    { kind: 'holiday_work', name: '常用（休日出勤）', label: '休日出勤', key: 'holidayWork' },
    { kind: 'night_shift', name: '常用（夜勤）', label: '夜勤', key: 'nightShift' },
];

/** 開いたときの値。保存済みならその値、未作成なら出勤簿と単価からの初期値（開いただけでは保存しない） */
function initialForm(year: number, month: number, row: JoyoStatementRow): EditorForm {
    const st = row.statement;
    if (st) {
        return {
            issueDate: st.issueDate,
            paymentDate: st.paymentDate,
            subject: st.subject,
            items: st.items.map((it) => ({ ...it })),
            includeAttendance: st.includeAttendance,
            notes: st.notes ?? '',
        };
    }
    return {
        issueDate: defaultIssueDate(year, month),
        paymentDate: defaultPaymentDate(year, month),
        subject: defaultSubject(year, month),
        items: buildDefaultItems(row.attendance.counts, row.contractor.unitPrice),
        includeAttendance: true,
        notes: '',
    };
}

/** 覚えていた日数と今の日数の違いを「出勤 23日 → 24日」の形で並べる */
function describeCountDiff(before: JoyoPaidDayCounts, after: JoyoPaidDayCounts): string {
    return AUTO_KIND_INFO.filter((k) => before[k.key] !== after[k.key])
        .map((k) => `${k.label} ${before[k.key]}日 → ${after[k.key]}日`)
        .join('、');
}

/** 出勤簿から作った行の数量が、出勤簿の日数と違う箇所（発行の確認に並べる） */
function describeQuantityMismatch(items: JoyoStatementItem[], counts: JoyoDayCounts): string[] {
    const lines: string[] = [];
    for (const k of AUTO_KIND_INFO) {
        const days = counts[k.key];
        const item = items.find((it) => it.kind === k.kind);
        if (item) {
            if (roundQuantity(item.quantity) !== days) {
                lines.push(`『${item.name || k.name}』の数量（${formatQuantity(item.quantity)}）が、出勤簿の${k.label}の日数（${days}日）と違います`);
            }
        } else if (days > 0) {
            lines.push(`出勤簿に${k.label}が${days}日ありますが、明細に『${k.name}』の行がありません`);
        }
    }
    return lines;
}

/** 「出勤簿の日数に合わせる」で変わる内容を並べる（黙って上書きしないため） */
function describeSyncChanges(before: JoyoStatementItem[], after: JoyoStatementItem[]): string[] {
    const lines: string[] = [];
    for (const k of AUTO_KIND_INFO) {
        const b = before.find((it) => it.kind === k.kind);
        const a = after.find((it) => it.kind === k.kind);
        if (b && a) {
            if (roundQuantity(b.quantity) !== a.quantity) {
                lines.push(`${b.name || k.name}の数量を ${formatQuantity(b.quantity)} → ${formatQuantity(a.quantity)} に入れ直します`);
            }
        } else if (b && !a) {
            lines.push(`${b.name || k.name}の行を消します（出勤簿の${k.label}が 0日になったため）`);
        } else if (!b && a) {
            lines.push(`${a.name}の行を足します（${formatQuantity(a.quantity)}日）`);
        }
    }
    return lines;
}

const inputBase =
    'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 read-only:bg-slate-50 read-only:text-slate-700 disabled:bg-slate-100';

/**
 * 支払明細書の編集モーダル（指示書 8-2）。
 * lg 以上は左＝入力・右＝ライブプレビュー、lg 未満は［プレビュー］で全画面表示。
 * 発行済みは入力欄をすべて読むだけにする。
 */
export default function JoyoStatementEditor({
    year,
    month,
    today,
    row,
    settings,
    issuer,
    onClose,
    onReload,
    onAddToSchedule,
}: JoyoStatementEditorProps) {
    const { contractor, attendance, statement, paymentSchedule } = row;
    const counts = attendance.counts;
    const isIssued = statement?.status === 'issued';
    const stateKey = statement ? statement.status : 'none';
    // 一度でも発行した下書きは書類番号が入っている（消せない）
    const neverIssued = !statement?.statementNo;

    const [form, setForm] = useState<EditorForm>(() => initialForm(year, month, row));
    // 開いたときの値（直しかけかどうかの判定に使う）
    const [initialJson] = useState(() => JSON.stringify(initialForm(year, month, row)));
    const isDirty = !isIssued && JSON.stringify(form) !== initialJson;
    // ［出勤簿の日数に合わせる］を押したあとは「変わっています」の知らせを消す（保存すると今の日数が基準になる）
    const [synced, setSynced] = useState(false);
    const [busy, setBusy] = useState<BusyAction | null>(null);
    const [showInvalid, setShowInvalid] = useState(false);
    const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
    // 二重押しを防ぐ同期ロック（state の反映を待たずに止める）
    const lockRef = useRef(false);
    const isLg = useMediaQuery('(min-width: 1024px)');

    const readOnly = isIssued || busy !== null;

    // 画面の合計はサーバーと同じ式（recalcItems → computeJoyoTotals）で出す
    const recalculated = useMemo(() => recalcItems(form.items), [form.items]);
    const totals = useMemo(() => computeJoyoTotals(recalculated), [recalculated]);
    const totalTooLarge =
        Math.abs(totals.total) > JOYO_LIMITS.maxTotal ||
        recalculated.some((it) => Math.abs(it.amount) > JOYO_LIMITS.maxTotal);

    const seenCounts: JoyoPaidDayCounts = {
        present: counts.present,
        holidayWork: counts.holidayWork,
        nightShift: counts.nightShift,
    };
    const changedText =
        row.attendanceChanged && statement?.attendanceCounts
            ? describeCountDiff(statement.attendanceCounts, seenCounts)
            : '';
    const monthNotFinished = today < defaultIssueDate(year, month);

    // ---- 閉じる（直しかけなら確認） ----
    const requestClose = useCallback(() => {
        if (lockRef.current) return;
        if (isDirty && !window.confirm('保存していない変更があります。破棄して閉じますか？')) return;
        onClose();
    }, [isDirty, onClose]);

    // Esc で閉じる（全画面プレビューが開いていればそちらを閉じる）
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            if (mobilePreviewOpen) setMobilePreviewOpen(false);
            else requestClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [mobilePreviewOpen, requestClose]);

    // 直しかけのままタブを閉じようとしたら確認する
    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    // ---- 入力 ----
    const updateItem = (index: number, patch: Partial<JoyoStatementItem>) => {
        setForm((f) => ({
            ...f,
            items: f.items.map((it, i) => {
                if (i !== index) return it;
                const next = { ...it, ...patch };
                return { ...next, amount: itemAmount(next.quantity, next.unitPrice) };
            }),
        }));
    };

    const addItem = () => {
        setForm((f) =>
            f.items.length >= JOYO_LIMITS.maxItems
                ? f
                : {
                      ...f,
                      items: [...f.items, { kind: 'manual', name: '', quantity: 1, unit: '式', unitPrice: 0, amount: 0, note: '' }],
                  },
        );
    };

    const removeItem = (index: number) => {
        setForm((f) => (f.items.length <= 1 ? f : { ...f, items: f.items.filter((_, i) => i !== index) }));
    };

    const handleSync = () => {
        const next = syncItemsWithCounts(form.items, counts, contractor.unitPrice);
        const changes = describeSyncChanges(form.items, next);
        if (changes.length === 0) {
            toast.success('明細の数量は、すでに出勤簿の日数と同じです');
            setSynced(true);
            return;
        }
        if (next.length > JOYO_LIMITS.maxItems) {
            toast.error(`明細が${JOYO_LIMITS.maxItems}行を超えるため合わせられません。手で足した行を減らしてください`);
            return;
        }
        if (!window.confirm(`${changes.join('\n')}\n\nよろしいですか？`)) return;
        setForm((f) => ({ ...f, items: next }));
        setSynced(true);
    };

    // ---- 保存の前の確かめ ----
    const nameMissing = (it: JoyoStatementItem) => it.name.trim() === '';

    /** 保存できない理由（無ければ null）。理由があれば入力欄を赤くする */
    const validate = (): string | null => {
        if (form.items.length === 0) return '明細を1行以上入れてください';
        if (form.items.some(nameMissing)) return '品名が空の行があります';
        if (!isValidYmd(form.issueDate)) return '発行日を入れてください';
        if (!isValidYmd(form.paymentDate)) return '支払日を入れてください';
        if (hasDuplicateAutoKinds(form.items)) return '『常用（全日）』などの出勤簿の行は、種類ごとに1行までです';
        if (totalTooLarge) return '金額が大きすぎます';
        return null;
    };

    /** API に送る形（amount はサーバーが数量×単価で入れ直すので送らない） */
    const buildPayload = () => ({
        contractorId: contractor.id,
        year,
        month,
        issueDate: form.issueDate,
        paymentDate: form.paymentDate,
        subject: form.subject.trim(),
        items: recalculated.map((it) => ({
            kind: it.kind,
            name: it.name.trim(),
            quantity: it.quantity,
            unit: it.unit.trim(),
            unitPrice: it.unitPrice,
            note: it.note.trim(),
        })),
        includeAttendance: form.includeAttendance,
        notes: form.notes.trim() || null,
        // 編集画面に出している日数（開いたとき・取り直したときの出勤簿）。サーバーはこれを基準として覚える
        seenCounts,
    });

    /** 同期ロックをかけて処理を走らせる。成功したら一覧を取り直す（編集画面は取り直した行で読み直される） */
    const runLocked = async (action: BusyAction, task: () => Promise<boolean>) => {
        if (lockRef.current) return;
        lockRef.current = true;
        setBusy(action);
        try {
            const ok = await task();
            if (ok) await onReload();
        } finally {
            lockRef.current = false;
            setBusy(null);
        }
    };

    const handleSave = () => {
        if (lockRef.current) return;
        const invalid = validate();
        if (invalid) {
            setShowInvalid(true);
            toast.error(invalid);
            return;
        }
        void runLocked('save', async () => {
            try {
                const res = await fetch('/api/joyo-statements', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildPayload()),
                });
                if (!res.ok) {
                    toast.error(await errorMessage(res, '保存に失敗しました'));
                    return false;
                }
                toast.success('下書きを保存しました');
                return true;
            } catch (e) {
                logger.error('支払明細書の保存に失敗:', e);
                toast.error('保存に失敗しました');
                return false;
            }
        });
    };

    const handleIssue = () => {
        if (lockRef.current) return;
        if (!issuer) {
            toast.error('自社情報が登録されていません');
            return;
        }
        const invalid = validate();
        if (invalid) {
            setShowInvalid(true);
            toast.error(invalid);
            return;
        }
        if (totals.total <= 0) {
            toast.error('合計金額が 0 円以下のため発行できません');
            return;
        }
        const mismatch = describeQuantityMismatch(form.items, counts);
        const message = [
            '発行済みにすると、中身が固定されます。よろしいですか？',
            ...(mismatch.length > 0 ? ['', ...mismatch.map((m) => `・${m}`)] : []),
        ].join('\n');
        if (!window.confirm(message)) return;
        void runLocked('issue', async () => {
            try {
                const res = await fetch('/api/joyo-statements/issue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(buildPayload()),
                });
                if (!res.ok) {
                    toast.error(await errorMessage(res, '発行に失敗しました'));
                    return false;
                }
                toast.success('発行済みにしました');
                return true;
            } catch (e) {
                logger.error('支払明細書の発行に失敗:', e);
                toast.error('発行に失敗しました');
                return false;
            }
        });
    };

    const handleUnissue = () => {
        if (lockRef.current || !statement) return;
        if (!window.confirm('発行を取り消して、下書きに戻します（書類番号はそのまま残ります）。よろしいですか？')) return;
        void runLocked('unissue', async () => {
            try {
                const res = await fetch(`/api/joyo-statements/${statement.id}/unissue`, { method: 'POST' });
                if (!res.ok) {
                    toast.error(await errorMessage(res, '発行の取り消しに失敗しました'));
                    return false;
                }
                toast.success('発行を取り消しました（下書きに戻りました）');
                return true;
            } catch (e) {
                logger.error('支払明細書の発行取り消しに失敗:', e);
                toast.error('発行の取り消しに失敗しました');
                return false;
            }
        });
    };

    const handleDelete = () => {
        if (lockRef.current || !statement) return;
        if (!window.confirm('この下書きを消します。よろしいですか？')) return;
        void runLocked('delete', async () => {
            try {
                const res = await fetch(`/api/joyo-statements/${statement.id}`, { method: 'DELETE' });
                if (!res.ok) {
                    toast.error(await errorMessage(res, '削除に失敗しました'));
                    return false;
                }
                toast.success('下書きを消しました');
                return true;
            } catch (e) {
                logger.error('支払明細書の削除に失敗:', e);
                toast.error('削除に失敗しました');
                return false;
            }
        });
    };

    const handleExportPdf = async () => {
        if (lockRef.current || !isIssued || !statement?.issuedSnapshot) return;
        lockRef.current = true;
        setBusy('pdf');
        try {
            const { buildJoyoStatementPdfProps, exportJoyoStatementPDF } = await import('@/utils/joyoStatementPdf');
            // 発行済みは写し（issuedSnapshot）から作るので、今の自社情報は使われない
            const props = buildJoyoStatementPdfProps({
                year,
                month,
                row,
                settings,
                issuer: issuer ?? statement.issuedSnapshot.issuer,
            });
            await exportJoyoStatementPDF(props);
            toast.success('PDFを出力しました');
        } catch (e) {
            logger.error('支払明細書PDF出力失敗:', e);
            toast.error(e instanceof Error ? e.message : 'PDF出力に失敗しました');
        } finally {
            lockRef.current = false;
            setBusy(null);
        }
    };

    // ---- プレビュー ----
    // 発行済みは写しから作るので自社情報が無くても出せる。下書き・未作成は自社情報が無ければ出さない
    const canPreview = isIssued ? !!statement?.issuedSnapshot : !!issuer;
    const previewSeed = useMemo(
        () =>
            JSON.stringify({
                form,
                status: statement?.status ?? null,
                updatedAt: statement?.updatedAt ?? null,
                contractor,
                records: attendance.records,
                settings,
                issuer,
            }),
        [form, statement?.status, statement?.updatedAt, contractor, attendance.records, settings, issuer],
    );

    const renderPdf = async (): Promise<Blob | null> => {
        if (!canPreview) return null;
        const snapIssuer = statement?.issuedSnapshot?.issuer ?? null;
        const pdfIssuer = issuer ?? snapIssuer;
        if (!pdfIssuer) return null;
        const { buildJoyoStatementPdfProps, generateJoyoStatementPdfBlob } = await import('@/utils/joyoStatementPdf');
        const props = buildJoyoStatementPdfProps({
            year,
            month,
            row,
            settings,
            issuer: pdfIssuer,
            draft: isIssued
                ? undefined
                : {
                      issueDate: form.issueDate,
                      paymentDate: form.paymentDate,
                      subject: form.subject,
                      items: form.items,
                      includeAttendance: form.includeAttendance,
                  },
        });
        return generateJoyoStatementPdfBlob(props);
    };

    const previewPane = canPreview ? (
        <LivePdfPreview seed={previewSeed} renderPdf={renderPdf} />
    ) : (
        <div className="flex h-full items-center justify-center bg-slate-100 px-6 text-center text-sm text-red-600">
            自社情報が登録されていないため、プレビューを出せません。『自社情報』で登録してください。
        </div>
    );

    // ---- 表示の部品 ----
    const countCells: { label: string; value: number }[] = [
        { label: '出勤', value: counts.present },
        { label: '休日出勤', value: counts.holidayWork },
        { label: '夜勤', value: counts.nightShift },
        { label: '休日の記録', value: counts.holiday },
        { label: '欠勤', value: counts.absent },
        { label: '有給', value: counts.paidLeave },
        { label: '代休', value: counts.compensatoryHoliday },
    ];
    const stateMeta = JOYO_STATE_META[stateKey];
    const scheduleAmountDiffers = !!paymentSchedule && !!statement && paymentSchedule.amount !== statement.total;

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0">
            <div className="absolute inset-0 bg-black/50" onClick={requestClose} />

            <div
                role="dialog"
                aria-modal="true"
                aria-label="支払明細書の編集"
                className="relative flex h-full w-full flex-1 flex-col bg-white lg:h-[92vh] lg:w-[96vw] lg:max-w-[1800px] lg:flex-none lg:rounded-lg lg:shadow-xl"
            >
                {/* ヘッダー */}
                <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 md:px-6">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold text-slate-900">
                                支払明細書<span className="mx-2 text-slate-300">|</span>
                                {contractor.recipientName}
                                <span className="mx-2 text-slate-300">|</span>
                                {year}年{month}月分
                            </h2>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stateMeta.className}`}>
                                {stateMeta.label}
                            </span>
                            {!contractor.isActive && (
                                <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                    利用停止
                                </span>
                            )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                            出勤簿の名前: {contractor.userDisplayName || '（ユーザーが見つかりません）'}
                            {statement?.statementNo && isIssued && ` ／ 書類番号 ${statement.statementNo}`}
                        </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="lg:hidden"
                            onClick={() => setMobilePreviewOpen(true)}
                            leftIcon={<Eye className="h-4 w-4" />}
                        >
                            プレビュー
                        </Button>
                        <button
                            type="button"
                            onClick={requestClose}
                            title="閉じる"
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* 本文: lg 以上は左＝入力（3/5）・右＝プレビュー（2/5） */}
                <div className="flex min-h-0 flex-1">
                    <div className="min-h-0 flex-1 overflow-y-auto lg:w-3/5 lg:flex-none lg:border-r lg:border-slate-200">
                        <div className="space-y-5 p-4 md:p-6">
                            {!issuer && !isIssued && (
                                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                    <span>自社情報が登録されていないため、発行できません。『自社情報』で登録してください。</span>
                                </div>
                            )}

                            {/* 出勤簿の集計（読むだけ） */}
                            <section>
                                <h3 className="mb-2 text-sm font-semibold text-slate-700">出勤簿の集計</h3>
                                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                                    {countCells.map((c) => (
                                        <div
                                            key={c.label}
                                            className={`rounded-lg border px-2 py-1.5 text-center ${
                                                c.value === 0 ? 'border-slate-100 bg-slate-50 text-slate-300' : 'border-slate-200 bg-white text-slate-800'
                                            }`}
                                        >
                                            <div className="text-[11px]">{c.label}</div>
                                            <div className="text-base font-semibold tabular-nums">{c.value}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 space-y-1.5 text-sm">
                                    {counts.missingDays.length > 0 && (
                                        <p className="text-amber-700">
                                            出勤簿に記録の無い日があります：{counts.missingDays.map(formatMdWeek).join('、')}。日数には入っていません。
                                        </p>
                                    )}
                                    {monthNotFinished && <p className="text-amber-700">この月はまだ終わっていません。</p>}
                                    {row.attendanceChanged && !isIssued && !synced && (
                                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                                            <span>前に見たときから出勤簿が変わっています{changedText && `（${changedText}）`}。</span>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleSync}
                                                disabled={readOnly}
                                                leftIcon={<RefreshCw className="h-4 w-4" />}
                                            >
                                                出勤簿の日数に合わせる
                                            </Button>
                                        </div>
                                    )}
                                    {row.attendanceChanged && isIssued && (
                                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                                            発行したあとで出勤簿が変わっています{changedText && `（${changedText}）`}。直すときは『発行を取り消す』を押してください。
                                        </p>
                                    )}
                                </div>
                            </section>

                            {/* 発行日・支払日・件名 */}
                            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="block text-sm">
                                    <span className="mb-1 block font-medium text-slate-700">発行日</span>
                                    <input
                                        type="date"
                                        value={form.issueDate}
                                        readOnly={readOnly}
                                        onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                                        className={`${inputBase} ${showInvalid && !isValidYmd(form.issueDate) ? 'border-red-400 bg-red-50' : ''}`}
                                    />
                                </label>
                                <label className="block text-sm">
                                    <span className="mb-1 block font-medium text-slate-700">支払日</span>
                                    <input
                                        type="date"
                                        value={form.paymentDate}
                                        readOnly={readOnly}
                                        onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                                        className={`${inputBase} ${showInvalid && !isValidYmd(form.paymentDate) ? 'border-red-400 bg-red-50' : ''}`}
                                    />
                                </label>
                                <label className="block text-sm sm:col-span-2">
                                    <span className="mb-1 block font-medium text-slate-700">件名</span>
                                    <input
                                        type="text"
                                        value={form.subject}
                                        readOnly={readOnly}
                                        maxLength={JOYO_LIMITS.subjectLength}
                                        onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                                        className={inputBase}
                                    />
                                </label>
                            </section>

                            {/* 明細 */}
                            <section>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold text-slate-700">
                                        明細
                                        <span className="ml-2 text-xs font-normal text-slate-400">
                                            {form.items.length}／{JOYO_LIMITS.maxItems}行
                                        </span>
                                    </h3>
                                    {!isIssued && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={addItem}
                                            disabled={readOnly || form.items.length >= JOYO_LIMITS.maxItems}
                                            leftIcon={<Plus className="h-4 w-4" />}
                                        >
                                            行を足す
                                        </Button>
                                    )}
                                </div>
                                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                    <table className="w-full min-w-[720px] text-sm">
                                        <thead className="bg-slate-50 text-xs text-slate-500">
                                            <tr>
                                                <th className="px-2 py-1.5 text-left font-medium">品名</th>
                                                <th className="w-20 px-2 py-1.5 text-right font-medium">数量</th>
                                                <th className="w-16 px-2 py-1.5 text-left font-medium">単位</th>
                                                <th className="w-28 px-2 py-1.5 text-right font-medium">単価</th>
                                                <th className="w-28 px-2 py-1.5 text-right font-medium">金額</th>
                                                <th className="px-2 py-1.5 text-left font-medium">備考</th>
                                                {!isIssued && <th className="w-10 px-1 py-1.5" aria-label="消す" />}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {form.items.map((it, i) => {
                                                const nameInvalid = showInvalid && nameMissing(it);
                                                return (
                                                    <tr key={i} className={nameInvalid ? 'bg-red-50' : ''}>
                                                        <td className="px-2 py-1">
                                                            <div className="flex items-center gap-1">
                                                                <input
                                                                    type="text"
                                                                    value={it.name}
                                                                    readOnly={readOnly}
                                                                    maxLength={JOYO_LIMITS.nameLength}
                                                                    aria-label="品名"
                                                                    onChange={(e) => updateItem(i, { name: e.target.value })}
                                                                    className={`${inputBase} min-w-[8rem] ${nameInvalid ? 'border-red-400 bg-red-50' : ''}`}
                                                                />
                                                                {it.kind !== 'manual' && (
                                                                    <span
                                                                        className="flex-shrink-0 rounded bg-sky-50 px-1 py-0.5 text-[10px] text-sky-700"
                                                                        title="出勤簿の日数から作った行"
                                                                    >
                                                                        出勤簿
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-2 py-1">
                                                            <JoyoNumberInput
                                                                value={it.quantity}
                                                                onChange={(v) => updateItem(i, { quantity: v })}
                                                                min={0}
                                                                max={JOYO_LIMITS.maxQuantity}
                                                                allowDecimal
                                                                roundOnCommit={roundQuantity}
                                                                maxLength={7}
                                                                readOnly={readOnly}
                                                                ariaLabel="数量"
                                                                className="w-full"
                                                            />
                                                        </td>
                                                        <td className="px-2 py-1">
                                                            <input
                                                                type="text"
                                                                value={it.unit}
                                                                readOnly={readOnly}
                                                                maxLength={JOYO_LIMITS.unitLength}
                                                                aria-label="単位"
                                                                onChange={(e) => updateItem(i, { unit: e.target.value })}
                                                                className={inputBase}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-1">
                                                            <JoyoNumberInput
                                                                value={it.unitPrice}
                                                                onChange={(v) => updateItem(i, { unitPrice: v })}
                                                                min={-JOYO_LIMITS.maxUnitPrice}
                                                                max={JOYO_LIMITS.maxUnitPrice}
                                                                comma
                                                                maxLength={9}
                                                                readOnly={readOnly}
                                                                ariaLabel="単価"
                                                                className="w-full"
                                                            />
                                                        </td>
                                                        {/* 金額は読むだけ（数量を丸めてから 数量×単価。保存後と同じ数字になる） */}
                                                        <td
                                                            className={`px-2 py-1 text-right tabular-nums ${
                                                                (recalculated[i]?.amount ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'
                                                            }`}
                                                        >
                                                            {yen(recalculated[i]?.amount ?? 0)}
                                                        </td>
                                                        <td className="px-2 py-1">
                                                            <input
                                                                type="text"
                                                                value={it.note}
                                                                readOnly={readOnly}
                                                                maxLength={JOYO_LIMITS.noteLength}
                                                                aria-label="備考"
                                                                onChange={(e) => updateItem(i, { note: e.target.value })}
                                                                className={`${inputBase} min-w-[8rem]`}
                                                            />
                                                        </td>
                                                        {!isIssued && (
                                                            <td className="px-1 py-1 text-center">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeItem(i)}
                                                                    disabled={readOnly || form.items.length <= 1}
                                                                    title={form.items.length <= 1 ? '明細は1行以上必要です' : 'この行を消す'}
                                                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                    数量は 0.5 などの小数も入れられます（小数第2位まで）。差し引く行は単価をマイナスにします。
                                </p>
                            </section>

                            {/* 合計 */}
                            <section className="flex flex-wrap items-end justify-end gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-right">
                                    <div className="text-xs text-slate-500">合計金額（税込）</div>
                                    <div className={`text-2xl font-bold tabular-nums ${totals.total < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                        {yen(totals.total)}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs text-slate-500">内消費税等（10%・自動）</div>
                                    <div className="text-base font-semibold tabular-nums text-slate-700">{yen(totals.tax)}</div>
                                </div>
                                {totalTooLarge && <p className="w-full text-right text-xs text-red-600">金額が大きすぎます</p>}
                            </section>

                            {/* 出勤簿を付ける・メモ */}
                            <section className="space-y-3">
                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={form.includeAttendance}
                                        disabled={readOnly}
                                        onChange={(e) => setForm((f) => ({ ...f, includeAttendance: e.target.checked }))}
                                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                    />
                                    2ページ目に出勤簿を付ける
                                </label>
                                <label className="block text-sm">
                                    <span className="mb-1 block font-medium text-slate-700">
                                        メモ <span className="text-xs font-normal text-slate-400">（書類には出ません）</span>
                                    </span>
                                    <textarea
                                        value={form.notes}
                                        readOnly={readOnly}
                                        maxLength={2000}
                                        rows={2}
                                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                                        className={inputBase}
                                    />
                                </label>
                            </section>

                            {/* 支払予定 */}
                            {paymentSchedule && (
                                <p className={`text-sm ${scheduleAmountDiffers ? 'text-red-600' : 'text-emerald-700'}`}>
                                    <CheckCircle2 className="mr-1 inline h-4 w-4 align-[-3px]" />
                                    支払予定に追加済み（{formatMd(paymentSchedule.paymentDate)} {yen(paymentSchedule.amount)}）
                                    {paymentSchedule.isPaid && '・支払済み'}
                                    {scheduleAmountDiffers && '　金額が明細の合計と違います'}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* 右: ライブプレビュー（lg 以上だけ描く） */}
                    <div className="hidden min-h-0 lg:flex lg:w-2/5 lg:flex-col">
                        {isLg === true && previewPane}
                    </div>
                </div>

                {/* 下のボタン */}
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 md:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                        {!isIssued && statement && neverIssued && (
                            <Button
                                type="button"
                                variant="dangerOutline"
                                size="sm"
                                onClick={handleDelete}
                                disabled={busy !== null}
                                isLoading={busy === 'delete'}
                                leftIcon={<Trash2 className="h-4 w-4" />}
                            >
                                この下書きを消す
                            </Button>
                        )}
                        {isIssued && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleUnissue}
                                disabled={busy !== null}
                                isLoading={busy === 'unissue'}
                                leftIcon={<Undo2 className="h-4 w-4" />}
                            >
                                発行を取り消す
                            </Button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {isIssued ? (
                            <>
                                {!paymentSchedule && onAddToSchedule && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => onAddToSchedule(row)}
                                        disabled={busy !== null}
                                        leftIcon={<CalendarPlus className="h-4 w-4" />}
                                    >
                                        支払予定に追加
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleExportPdf}
                                    disabled={busy !== null || !statement?.issuedSnapshot}
                                    isLoading={busy === 'pdf'}
                                    leftIcon={<FileDown className="h-4 w-4" />}
                                >
                                    PDF を出す
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleSave}
                                    disabled={busy !== null}
                                    isLoading={busy === 'save'}
                                >
                                    下書き保存
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleIssue}
                                    disabled={busy !== null || !issuer}
                                    isLoading={busy === 'issue'}
                                    title={!issuer ? '自社情報が登録されていないため発行できません' : undefined}
                                >
                                    発行済みにする
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* lg 未満: 全画面プレビュー */}
            {mobilePreviewOpen && (
                <div className="fixed inset-0 z-[110] flex flex-col bg-white lg:hidden">
                    <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
                        <h3 className="text-base font-semibold text-slate-900">プレビュー</h3>
                        <button
                            type="button"
                            onClick={() => setMobilePreviewOpen(false)}
                            title="閉じる"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1">{previewPane}</div>
                </div>
            )}
        </div>,
        document.body,
    );
}
