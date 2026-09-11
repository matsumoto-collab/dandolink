'use client';

/**
 * 設定 > 過去データ取込（管理者のみ）。
 * DandoLink 導入前（2024-01〜2026-04）の案件・売上・作業履歴を 4 つの CSV から取り込む。
 * 流れは「4 ファイルを選ぶ → ドライラン（件数・金額・エラー行を確認）→ 本実行」。
 * ドライランを通したファイルと同じでなければ本実行できない（サーバー側でも hash で確かめる）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, History, RotateCcw, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '@/components/ui/Button';
import type { BackfillPlanSummary } from '@/lib/backfill/engine';
import type { BackfillFileKind } from '@/lib/backfill/parse';

const FILE_SLOTS: { kind: BackfillFileKind; label: string; hint: string; match: (name: string) => boolean }[] = [
    { kind: 'projects', label: 'import_1_案件.csv', hint: '案件マスタ', match: (n) => n.includes('import_1') || n.includes('案件') },
    { kind: 'sales', label: 'import_2_売上.csv', hint: '現場別の売上（税抜）', match: (n) => n.includes('import_2') || (n.includes('売上') && !n.includes('調整')) },
    { kind: 'works', label: 'import_3_作業履歴.csv', hint: '日次の作業履歴', match: (n) => n.includes('import_3') || n.includes('作業履歴') },
    { kind: 'adjustments', label: 'import_4_売上調整.csv', hint: '顧客別・月別の売上調整', match: (n) => n.includes('import_4') || n.includes('売上調整') },
];

const FILE_LABELS: Record<BackfillFileKind, string> = {
    projects: 'import_1_案件.csv',
    sales: 'import_2_売上.csv',
    works: 'import_3_作業履歴.csv',
    adjustments: 'import_4_売上調整.csv',
};

interface BatchRow {
    id: string;
    status: string;
    createdByName: string;
    createdAt: string;
    rolledBackAt: string | null;
    summary: (BackfillPlanSummary & { deleted?: Record<string, number> }) | null;
    current: { projects: number; invoices: number; assignments: number; adjustments: number };
}

const yen = (n: number) => n.toLocaleString('ja-JP');

function formatDateTime(value: string): string {
    const d = new Date(value);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

export default function BackfillImportPanel() {
    const [files, setFiles] = useState<Partial<Record<BackfillFileKind, File>>>({});
    const [plan, setPlan] = useState<BackfillPlanSummary | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [batches, setBatches] = useState<BatchRow[]>([]);
    const [showAllWarnings, setShowAllWarnings] = useState(false);
    // 連打で二重に取り込まないための同期ロック（state だけだと素通りする）
    const busyRef = useRef(false);

    const loadBatches = useCallback(async () => {
        try {
            const res = await fetch('/api/backfill/batches', { cache: 'no-store' });
            if (res.ok) setBatches(await res.json());
        } catch {
            // 履歴が取れなくても取込自体はできる
        }
    }, []);

    useEffect(() => {
        void loadBatches();
    }, [loadBatches]);

    const allSelected = FILE_SLOTS.every((s) => files[s.kind]);

    /** 複数まとめて選ばれたファイルを、名前で 4 つの枠に振り分ける */
    const assignFiles = (list: FileList | null) => {
        if (!list) return;
        setFiles((prev) => {
            const next = { ...prev };
            for (const file of Array.from(list)) {
                const slot = FILE_SLOTS.find((s) => s.match(file.name));
                if (slot) next[slot.kind] = file;
            }
            return next;
        });
        // ファイルを変えたらドライランをやり直す
        setPlan(null);
    };

    const buildForm = () => {
        const form = new FormData();
        for (const s of FILE_SLOTS) form.append(s.kind, files[s.kind]!);
        return form;
    };

    const runDryRun = async () => {
        if (busyRef.current || !allSelected) return;
        busyRef.current = true;
        setIsChecking(true);
        setPlan(null);
        try {
            const res = await fetch('/api/backfill/dry-run', { method: 'POST', body: buildForm() });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? 'ドライランに失敗しました');
            setPlan(data);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'ドライランに失敗しました');
        } finally {
            busyRef.current = false;
            setIsChecking(false);
        }
    };

    const runApply = async () => {
        if (busyRef.current || !plan?.canApply) return;
        const c = plan.counts;
        const message =
            `次の内容で取り込みます。\n\n` +
            `案件 ${c.projects.total}件（新規 ${c.projects.create} / 上書き ${c.projects.update} / 消す ${c.projects.delete}）\n` +
            `売上 ${c.sales.total}件・作業履歴 ${c.works.total}行・売上調整 ${c.adjustments.total}件\n` +
            `売上の総合計 ${yen(plan.totals.grandTotal)}円（税抜）\n\n` +
            `進行中の案件には触れません。よろしいですか？`;
        if (!window.confirm(message)) return;
        busyRef.current = true;
        setIsApplying(true);
        try {
            const form = buildForm();
            form.append('hash', plan.hash);
            const res = await fetch('/api/backfill/apply', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? '取り込みに失敗しました');
            toast.success('取り込みました');
            setPlan(null);
            setFiles({});
            await loadBatches();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '取り込みに失敗しました', { duration: 8000 });
        } finally {
            busyRef.current = false;
            setIsApplying(false);
        }
    };

    const runRollback = async (batch: BatchRow) => {
        if (busyRef.current) return;
        try {
            const preview = await fetch(`/api/backfill/batches/${batch.id}/rollback`, { cache: 'no-store' }).then((r) => r.json());
            const c = preview.counts;
            const message =
                `このバッチで取り込んだ（上書きした）過去データを消します。\n\n` +
                `案件 ${c.projects} / 請求書 ${c.invoices} / 作業履歴 ${c.assignments} / 売上調整 ${c.adjustments}\n` +
                (preview.blocked?.length ? `（進行中のデータが紐づいている案件 ${preview.blocked.length}件は消しません）\n` : '') +
                `\n前のバッチの状態には戻りません。よろしいですか？`;
            if (!window.confirm(message)) return;
            busyRef.current = true;
            const res = await fetch(`/api/backfill/batches/${batch.id}/rollback`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? '取り消しに失敗しました');
            toast.success('取り消しました');
            await loadBatches();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '取り消しに失敗しました');
        } finally {
            busyRef.current = false;
        }
    };

    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">過去データ取込</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                    DandoLink 導入前（2024年1月〜2026年4月）の案件・売上・作業履歴を、4 つの CSV から取り込みます。
                    利益ダッシュボードなどの期間の集計は、2026年4月までをこの過去データ、2026年5月からを DandoLink のデータで数えます。
                    進行中の案件には一切触れません。同じファイルを取り込み直すと上書きされ、CSV から消えた過去データは消えます。
                </p>
            </div>

            {/* 1. ファイルを選ぶ */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h4 className="text-sm font-semibold text-slate-700">1. 4 つのファイルを選ぶ</h4>
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                        <FileUp className="w-4 h-4" />
                        まとめて選ぶ
                        <input
                            type="file"
                            accept=".csv,text/csv"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                                assignFiles(e.target.files);
                                e.target.value = '';
                            }}
                        />
                    </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {FILE_SLOTS.map((slot) => (
                        <label
                            key={slot.kind}
                            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 cursor-pointer ${
                                files[slot.kind] ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <span className="min-w-0">
                                <span className="block text-sm text-slate-700">{slot.label}</span>
                                <span className="block text-xs text-slate-400 truncate">
                                    {files[slot.kind]?.name ?? slot.hint}
                                </span>
                            </span>
                            {files[slot.kind] ? (
                                <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                            ) : (
                                <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        setFiles((prev) => ({ ...prev, [slot.kind]: file }));
                                        setPlan(null);
                                    }
                                    e.target.value = '';
                                }}
                            />
                        </label>
                    ))}
                </div>
                <div className="flex justify-end">
                    <Button variant="primary" isLoading={isChecking} disabled={!allSelected} onClick={() => void runDryRun()}>
                        2. ドライラン（書き込まずに確認）
                    </Button>
                </div>
            </div>

            {/* 2. ドライランの結果 */}
            {plan && <PlanView plan={plan} showAllWarnings={showAllWarnings} onToggleWarnings={() => setShowAllWarnings((v) => !v)} />}

            {plan && (
                <div className="flex items-center justify-end gap-3">
                    {!plan.canApply && (
                        <span className="text-sm text-red-600">エラーのある行を直してから、もう一度ドライランしてください</span>
                    )}
                    <Button variant="primary" isLoading={isApplying} disabled={!plan.canApply} onClick={() => void runApply()}>
                        3. 本実行（取り込む）
                    </Button>
                </div>
            )}

            {/* 取り込み履歴 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-3">
                    <History className="w-4 h-4" />
                    取り込み履歴
                </h4>
                {batches.length === 0 ? (
                    <p className="text-sm text-slate-400">まだ取り込んでいません</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 text-xs text-slate-500">
                                    <th className="px-2 py-2 text-left font-medium">日時</th>
                                    <th className="px-2 py-2 text-left font-medium">実行者</th>
                                    <th className="px-2 py-2 text-right font-medium whitespace-nowrap">いまこのバッチの行</th>
                                    <th className="px-2 py-2 text-left font-medium">状態</th>
                                    <th className="px-2 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {batches.map((b) => (
                                    <tr key={b.id}>
                                        <td className="px-2 py-2 whitespace-nowrap text-slate-700">{formatDateTime(b.createdAt)}</td>
                                        <td className="px-2 py-2 text-slate-600">{b.createdByName || '—'}</td>
                                        <td className="px-2 py-2 text-right text-xs text-slate-500 whitespace-nowrap">
                                            案件 {b.current.projects} / 請求書 {b.current.invoices} / 作業 {b.current.assignments} / 調整 {b.current.adjustments}
                                        </td>
                                        <td className="px-2 py-2 text-xs">
                                            {b.status === 'rolled_back' ? (
                                                <span className="text-slate-400">取り消し済み</span>
                                            ) : (
                                                <span className="text-teal-700">取り込み済み</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2 text-right">
                                            {b.status !== 'rolled_back' && (
                                                <button
                                                    type="button"
                                                    onClick={() => void runRollback(b)}
                                                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                                                >
                                                    <RotateCcw className="w-3 h-3" />
                                                    取り消す
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="mt-2 text-xs text-slate-400">
                    取り消すと、そのバッチで取り込んだ（上書きした）過去データが消えます。前のバッチの状態には戻りません。
                </p>
            </div>
        </div>
    );
}

function PlanView({
    plan,
    showAllWarnings,
    onToggleWarnings,
}: {
    plan: BackfillPlanSummary;
    showAllWarnings: boolean;
    onToggleWarnings: () => void;
}) {
    const rows: { label: string; key: keyof BackfillPlanSummary['counts'] }[] = [
        { label: '案件', key: 'projects' },
        { label: '売上（請求書）', key: 'sales' },
        { label: '作業履歴', key: 'works' },
        { label: '売上調整', key: 'adjustments' },
    ];
    const warnings = showAllWarnings ? plan.warnings : plan.warnings.slice(0, 10);

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-5">
            <h4 className="text-sm font-semibold text-slate-700">ドライランの結果（まだ書き込んでいません）</h4>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                            <th className="px-2 py-2 text-left font-medium" />
                            <th className="px-2 py-2 text-right font-medium">CSVの行</th>
                            <th className="px-2 py-2 text-right font-medium">新しく作る</th>
                            <th className="px-2 py-2 text-right font-medium">上書き</th>
                            <th className="px-2 py-2 text-right font-medium">CSVから消えたので消す</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                        {rows.map((r) => {
                            const c = plan.counts[r.key];
                            return (
                                <tr key={r.key}>
                                    <td className="px-2 py-1.5 text-slate-700">{r.label}</td>
                                    <td className="px-2 py-1.5 text-right">{yen(c.total)}</td>
                                    <td className="px-2 py-1.5 text-right">{yen(c.create)}</td>
                                    <td className="px-2 py-1.5 text-right">{yen(c.update)}</td>
                                    <td className={`px-2 py-1.5 text-right ${c.delete > 0 ? 'text-amber-700 font-medium' : ''}`}>{yen(c.delete)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="flex justify-between"><dt className="text-slate-500">現場別売上（税抜）</dt><dd className="tabular-nums">{yen(plan.totals.salesAmount)} 円</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">売上調整（税抜）</dt><dd className="tabular-nums">{yen(plan.totals.adjustmentAmount)} 円</dd></div>
                <div className="flex justify-between font-medium"><dt className="text-slate-700">売上の総合計（税抜）</dt><dd className="tabular-nums">{yen(plan.totals.grandTotal)} 円</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">自社の延べ人工</dt><dd className="tabular-nums">{yen(plan.totals.ownManDays)} 人工</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">外注の行（人数0で登録）</dt><dd className="tabular-nums">{yen(plan.totals.subcontractRows)} 行</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">人数を補完した行</dt><dd className="tabular-nums">{yen(plan.totals.filledRows)} 行</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">非現場の案件（集計から外す）</dt><dd className="tabular-nums">{yen(plan.totals.nonSiteProjects)} 件</dd></div>
            </dl>

            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                            <th className="px-2 py-2 text-left font-medium">期</th>
                            <th className="px-2 py-2 text-left font-medium">期間</th>
                            <th className="px-2 py-2 text-right font-medium">売上（税抜）</th>
                            <th className="px-2 py-2 text-right font-medium">延べ人工</th>
                            <th className="px-2 py-2 text-right font-medium">売上 ÷ 人工</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                        {plan.terms.map((t) => (
                            <tr key={t.term}>
                                <td className="px-2 py-1.5 text-slate-700">{t.label}</td>
                                <td className="px-2 py-1.5 text-slate-500 text-xs">{t.from} 〜 {t.to}</td>
                                <td className="px-2 py-1.5 text-right">{yen(t.sales)}</td>
                                <td className="px-2 py-1.5 text-right">{yen(t.manDays)}</td>
                                <td className="px-2 py-1.5 text-right">{t.salesPerManDay === null ? '—' : `${yen(t.salesPerManDay)} 円`}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-1 text-xs text-slate-400">第13期は2026年4月までの分だけです（5月からは DandoLink のデータで数えます）。</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 text-sm">
                <div>
                    <p className="text-slate-600">
                        職長: 既存ユーザーと一致 <span className="font-medium">{plan.mapping.foremenMatched}名</span>
                    </p>
                    {plan.mapping.foremenUnmatched.length > 0 && (
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                            一致しない（名前だけ残す）: {plan.mapping.foremenUnmatched.slice(0, 12).map((f) => `${f.name}（${f.rows}行）`).join('、')}
                            {plan.mapping.foremenUnmatched.length > 12 && ` ほか${plan.mapping.foremenUnmatched.length - 12}名`}
                        </p>
                    )}
                </div>
                <div>
                    <p className="text-slate-600">
                        顧客: 顧客マスタと一致 <span className="font-medium">{yen(plan.mapping.customersMatched)}件</span>
                    </p>
                    {plan.mapping.customersUnmatched.length > 0 && (
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                            一致しない {plan.mapping.customersUnmatched.length}社は顧客名の文字だけで持ちます（顧客マスタは増やしません）。
                            多い順: {plan.mapping.customersUnmatched.slice(0, 6).map((c) => `${c.name}（${c.projects}件）`).join('、')}
                        </p>
                    )}
                </div>
            </div>

            {plan.blockedDeletes.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    CSV から消えたが、進行中のデータが紐づいているため消さない案件 {plan.blockedDeletes.length}件:
                    {' '}{plan.blockedDeletes.slice(0, 10).map((b) => `${b.externalKey} ${b.title}（${b.reason}）`).join('、')}
                </div>
            )}

            {plan.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-red-700 mb-1">
                        <AlertTriangle className="w-4 h-4" />
                        エラー {plan.errors.length}件（直さないと取り込めません）
                    </p>
                    <ul className="text-xs text-red-700 space-y-0.5 max-h-60 overflow-y-auto">
                        {plan.errors.slice(0, 200).map((e, i) => (
                            <li key={i}>{FILE_LABELS[e.file]} {e.line}行目: {e.message}</li>
                        ))}
                    </ul>
                </div>
            )}

            {plan.warnings.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-sm font-medium text-slate-700 mb-1">注意 {plan.warnings.length}件（取り込みはできます）</p>
                    <ul className="text-xs text-slate-600 space-y-0.5 max-h-60 overflow-y-auto">
                        {warnings.map((w, i) => (
                            <li key={i}>{FILE_LABELS[w.file]} {w.line}行目: {w.message}</li>
                        ))}
                    </ul>
                    {plan.warnings.length > 10 && (
                        <button type="button" onClick={onToggleWarnings} className="mt-1 text-xs text-teal-700 hover:underline">
                            {showAllWarnings ? '閉じる' : `すべて表示（${plan.warnings.length}件）`}
                        </button>
                    )}
                </div>
            )}

            {plan.canApply && (
                <p className="flex items-center gap-1.5 text-sm text-teal-700">
                    <CheckCircle2 className="w-4 h-4" />
                    エラーはありません。内容を確かめてから本実行してください。
                </p>
            )}
        </div>
    );
}
