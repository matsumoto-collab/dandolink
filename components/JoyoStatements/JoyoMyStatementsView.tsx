'use client';

/**
 * 「支払明細書」の画面 — 本人（常用で来ている一人親方。支払明細書の対象者として登録されている人）。
 *
 *  - 読むのは GET /api/joyo-statements/me だけ（サーバーがセッションの本人の発行済みの明細だけを返す。人の ID は送らない）
 *  - 見せるのは、発行済みの明細のカード（対象月の新しい順）: 対象月・書類番号・合計・発行日・支払日
 *  - 「開く」で PDF のプレビュー（モーダル。スマホは全画面）、「PDF を保存」で保存（スマホは共有シート）
 *  - PDF は発行した時点の写し（issuedSnapshot）から作る（管理者が LINE で送っているものと同じ）
 *  - 編集・発行・取り消し・設定・支払予定のボタンは出さない（見るだけ）
 *
 * react-pdf は押されたときに `await import('@/utils/joyoStatementPdf')` で読み込む（最初の表示に含めない）。
 * スマホで見る画面なので、幅 320px でもはみ出さないように、表ではなくカードを縦に並べる。
 * 作りは components/Allowances/AllowancesMemberView.tsx と同じ（古い答えを捨てる連番・読み込み中・失敗のときの「読み直す」）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Eye, FileDown, X } from 'lucide-react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import type { JoyoMyStatementDto, JoyoMyStatementsResponse } from '@/types/joyoStatement';
import { errorMessage, formatYmdJa, yenJa } from './joyoUi';

const MY_STATEMENTS_URL = '/api/joyo-statements/me';

/** 発行済みの写しから PDF の props を作る（react-pdf はここで初めて読み込む） */
async function loadPdfProps(userId: string, statement: JoyoMyStatementDto) {
    const mod = await import('@/utils/joyoStatementPdf');
    return { mod, props: mod.buildIssuedJoyoStatementPdfProps({ userId, statement }) };
}

export default function JoyoMyStatementsView() {
    const [data, setData] = useState<JoyoMyStatementsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [failMessage, setFailMessage] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState<JoyoMyStatementDto | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);

    // 古い読み込みの答えを捨てるための連番（「読み直す」を続けて押したとき）
    const seqRef = useRef(0);
    // PDF 保存の二重押しを防ぐ同期ロック
    const saveLockRef = useRef(false);

    const fetchMine = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const res = await fetch(MY_STATEMENTS_URL, { cache: 'no-store' });
            if (!res.ok) {
                const message =
                    res.status === 403 ? 'アクセス権限がありません' : await errorMessage(res, '支払明細書を読めませんでした');
                if (seq !== seqRef.current) return;
                setData(null);
                setFailMessage(message);
                return;
            }
            const body = (await res.json()) as JoyoMyStatementsResponse;
            if (seq !== seqRef.current) return;
            setData(body);
            setFailMessage(null);
        } catch (e) {
            if (seq !== seqRef.current) return;
            logger.error('支払明細書（本人）の取得に失敗:', e);
            setData(null);
            setFailMessage('支払明細書を読めませんでした');
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMine();
    }, [fetchMine]);

    const handleSave = async (statement: JoyoMyStatementDto) => {
        if (!data || saveLockRef.current) return;
        saveLockRef.current = true;
        setSavingId(statement.id);
        try {
            const { mod, props } = await loadPdfProps(data.userId, statement);
            await mod.exportJoyoStatementPDF(props);
        } catch (e) {
            logger.error('支払明細書PDF（本人）の保存に失敗:', e);
            toast.error('PDF を保存できませんでした');
        } finally {
            saveLockRef.current = false;
            setSavingId(null);
        }
    };

    const statements = data?.statements ?? [];

    return (
        <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col gap-3 max-w-2xl w-full mx-auto min-w-0">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">支払明細書</h1>
                    <p className="mt-0.5 text-xs text-slate-500">発行された自分の支払明細書だけが表示されます。</p>
                </div>

                {data === null ? (
                    failMessage && !loading ? (
                        <div className="text-center py-12 px-4 bg-white rounded-xl border border-slate-200">
                            <p className="text-slate-500">{failMessage}</p>
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchMine()}>
                                読み直す
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <Loading text="支払明細書を読み込み中..." />
                        </div>
                    )
                ) : statements.length === 0 ? (
                    <div className="text-center py-12 px-4 bg-white rounded-xl border border-slate-200">
                        <p className="text-slate-500">発行された支払明細書は、まだありません</p>
                    </div>
                ) : (
                    <ul className="flex flex-col gap-3 pb-2">
                        {statements.map((s) => (
                            <li key={s.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 min-w-0">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <p className="text-base font-semibold text-slate-900">
                                        {s.year}年{s.month}月分
                                    </p>
                                    {s.statementNo && (
                                        <p className="text-xs text-slate-500 tabular-nums break-all">No. {s.statementNo}</p>
                                    )}
                                </div>
                                <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums break-all">{yenJa(s.total)}</p>
                                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                                    <dt className="text-slate-500">発行日</dt>
                                    <dd className="text-slate-800 tabular-nums">{formatYmdJa(s.issueDate)}</dd>
                                    <dt className="text-slate-500">支払日</dt>
                                    <dd className="text-slate-800 tabular-nums">{formatYmdJa(s.paymentDate)}</dd>
                                </dl>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setPreviewing(s)}
                                        leftIcon={<Eye className="h-4 w-4" />}
                                    >
                                        開く
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="primary"
                                        onClick={() => handleSave(s)}
                                        disabled={savingId !== null}
                                        isLoading={savingId === s.id}
                                        leftIcon={<FileDown className="h-4 w-4" />}
                                    >
                                        PDF を保存
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {previewing && data && (
                <JoyoMyStatementPreview
                    userId={data.userId}
                    statement={previewing}
                    saving={savingId !== null}
                    onSave={() => handleSave(previewing)}
                    onClose={() => setPreviewing(null)}
                />
            )}
        </div>
    );
}

/**
 * PDF のプレビュー（PC はモーダル・スマホ＝lg 未満は全画面）。
 * 管理者の編集画面（JoyoStatementEditor）のプレビューと同じやり方: LivePdfPreview・createPortal・z-index・閉じるボタン・Esc。
 */
function JoyoMyStatementPreview({
    userId,
    statement,
    saving,
    onSave,
    onClose,
}: {
    userId: string;
    statement: JoyoMyStatementDto;
    saving: boolean;
    onSave: () => void;
    onClose: () => void;
}) {
    // Esc で閉じる
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const renderPdf = async (): Promise<Blob | null> => {
        const { mod, props } = await loadPdfProps(userId, statement);
        return mod.generateJoyoStatementPdfBlob(props);
    };

    if (typeof document === 'undefined') return null;

    return createPortal(
        // スマホは、アプリの上の帯（と iPhone の上の余白）の下から全画面。置き方は JoyoStatementEditor の外枠と同じ
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`支払明細書 ${statement.year}年${statement.month}月分`}
                className="relative flex h-full w-full flex-1 flex-col bg-white lg:h-[92vh] lg:w-[96vw] lg:max-w-[1000px] lg:flex-none lg:rounded-lg lg:shadow-xl"
            >
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                    <h3 className="min-w-0 truncate text-base font-semibold text-slate-900">
                        支払明細書　{statement.year}年{statement.month}月分
                    </h3>
                    <div className="flex flex-shrink-0 items-center gap-1">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onSave}
                            disabled={saving}
                            isLoading={saving}
                            leftIcon={<FileDown className="h-4 w-4" />}
                        >
                            保存
                        </Button>
                        <button
                            type="button"
                            onClick={onClose}
                            title="閉じる"
                            aria-label="閉じる"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>
                <div className="min-h-0 flex-1">
                    <LivePdfPreview seed={statement.id} renderPdf={renderPdf} />
                </div>
            </div>
        </div>,
        document.body,
    );
}
