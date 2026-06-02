'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { RefreshCw, Search, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { useEstimates } from '@/hooks/useEstimates';
import { useBillingDrafts } from '@/hooks/useBillingDrafts';
import { useDebounce } from '@/hooks/useDebounce';
import { flattenEstimateItems, newBillingItemId } from '@/lib/billing/estimateToBillingItems';
import BillingBoardRow from '@/components/BillingBoard/BillingBoardRow';
import EstimatePickerDialog, { type EstimateChoice } from '@/components/Estimates/EstimatePickerDialog';
import type { BillingBoardRow as Row, BillingDecision } from '@/types/billingBoard';
import type { InvoiceItem } from '@/types/invoice';
import type { Estimate } from '@/types/estimate';
import { logger } from '@/lib/logger';

type TabKey = 'pending' | 'hold' | 'excluded' | 'billed';
type CtypeMap = Record<string, { name: string; color: string }>;

const TABS: { key: TabKey; label: string }[] = [
    { key: 'pending', label: '判断待ち' },
    { key: 'hold', label: '保留' },
    { key: 'excluded', label: '対象外' },
    { key: 'billed', label: '請求済み' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** 指定した年・月(0-11)の初日〜末日（YYYY-MM-DD）。 */
function monthBounds(year: number, month0: number): { from: string; to: string } {
    const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
    return { from: `${year}-${pad(month0 + 1)}-01`, to: `${year}-${pad(month0 + 1)}-${pad(last)}` };
}

/** 当月（JST）の初日〜末日。 */
function defaultMonth(): { from: string; to: string } {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return monthBounds(jst.getUTCFullYear(), jst.getUTCMonth());
}

/** その行が現在のタブに属するか（請求済み=full はそのタブのみ、他タブは full を除外）。 */
function inTab(r: Row, tab: TabKey): boolean {
    if (tab === 'billed') return r.billingStatus === 'full';
    if (r.billingStatus === 'full') return false; // 全額請求済みは「請求済み」タブだけに出す
    if (tab === 'pending') return r.billingDecision === 'pending' && !r.hasPendingDraft;
    if (tab === 'hold') return r.billingDecision === 'hold';
    return r.billingDecision === 'excluded';
}

export default function BillingBoardPage() {
    const { data: session, status: sessionStatus } = useSession();
    const role = session?.user?.role;
    const isAuthorized = role === 'admin' || role === 'manager';
    const myId = session?.user?.id;

    const { ensureDataLoaded: ensureEstimatesLoaded, getEstimatesByProject } = useEstimates();
    const { create } = useBillingDrafts();

    const [rows, setRows] = useState<Row[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [userMap, setUserMap] = useState<Record<string, string>>({});
    const [ctypeMap, setCtypeMap] = useState<CtypeMap>({});

    // 表示期間（既定＝当月）。日付指定で任意の範囲に変更できる。
    const [from, setFrom] = useState<string>(() => defaultMonth().from);
    const [to, setTo] = useState<string>(() => defaultMonth().to);

    const [tab, setTab] = useState<TabKey>('pending');
    const [assigneeId, setAssigneeId] = useState<string>(''); // '' = 全員
    const [customerId, setCustomerId] = useState<string>('');
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 250);
    const [completedOnly, setCompletedOnly] = useState(false);

    const [busyRowId, setBusyRowId] = useState<string | null>(null);
    const [picker, setPicker] = useState<{ row: Row; choices: EstimateChoice[] } | null>(null);
    const [pickerSubmitting, setPickerSubmitting] = useState(false);

    const fetchBoard = useCallback(async () => {
        try {
            setIsLoading(true);
            const res = await fetch(`/api/billing-board?from=${from}&to=${to}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('請求判断ボードの取得に失敗しました');
            const data = (await res.json()) as Row[];
            setRows(data);
            setIsInitialized(true);
        } catch (e) {
            logger.error('Failed to fetch billing board:', e);
            toast.error(e instanceof Error ? e.message : '取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, [from, to]);

    // 期間変更時も含めてボードを再取得
    useEffect(() => {
        if (!isAuthorized) return;
        fetchBoard();
    }, [isAuthorized, fetchBoard]);

    // 初回のみ：見積・ユーザー・工事種別マスタを取得
    useEffect(() => {
        if (!isAuthorized) return;
        ensureEstimatesLoaded();
        (async () => {
            try {
                const res = await fetch('/api/users', { cache: 'no-store' });
                if (res.ok) {
                    const users: Array<{ id: string; displayName: string }> = await res.json();
                    const m: Record<string, string> = {};
                    for (const u of users) m[u.id] = u.displayName;
                    setUserMap(m);
                }
            } catch (e) {
                logger.error('ユーザー一覧の取得に失敗:', e);
            }
            try {
                const res = await fetch('/api/master-data/construction-types');
                if (res.ok) {
                    const list: Array<{ id: string; name: string; color: string }> = await res.json();
                    const m: CtypeMap = {};
                    for (const t of Array.isArray(list) ? list : []) m[t.id] = { name: t.name, color: t.color };
                    setCtypeMap(m);
                }
            } catch (e) {
                logger.error('工事種別マスタの取得に失敗:', e);
            }
        })();
    }, [isAuthorized, ensureEstimatesLoaded]);

    // 既定の担当者フィルタ＝自分（自分が担当の案件が在るときだけ。無ければ全員のまま）。初回のみ。
    const didInitAssignee = useRef(false);
    useEffect(() => {
        if (didInitAssignee.current) return;
        if (!isInitialized || !myId) return;
        if (rows.some((r) => r.assigneeIds.includes(myId))) setAssigneeId(myId);
        didInitAssignee.current = true;
    }, [isInitialized, myId, rows]);

    const resolveNames = useCallback(
        (ids: string[]) => ids.map((id) => userMap[id]).filter(Boolean).join('、'),
        [userMap],
    );

    // 期間ナビ
    const shiftMonth = useCallback(
        (delta: number) => {
            const [y, m] = from.split('-').map(Number);
            const d = new Date(Date.UTC(y, m - 1 + delta, 1));
            const b = monthBounds(d.getUTCFullYear(), d.getUTCMonth());
            setFrom(b.from);
            setTo(b.to);
        },
        [from],
    );
    const goThisMonth = useCallback(() => {
        const b = defaultMonth();
        setFrom(b.from);
        setTo(b.to);
    }, []);

    // 担当者・顧客のフィルタ候補（取得済みの行から導出）
    const assigneeOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of rows) {
            for (const id of r.assigneeIds) {
                const name = userMap[id];
                if (name && !seen.has(id)) seen.set(id, name);
            }
        }
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [rows, userMap]);

    const customerOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of rows) {
            if (r.customerId && r.customerName && !seen.has(r.customerId)) seen.set(r.customerId, r.customerName);
        }
        return Array.from(seen.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }, [rows]);

    // タブ非依存のフィルタ（担当者・顧客・完了・検索）
    const passesFilters = useCallback(
        (r: Row) => {
            if (assigneeId && !r.assigneeIds.includes(assigneeId)) return false;
            if (customerId && r.customerId !== customerId) return false;
            if (completedOnly && r.status !== 'completed') return false;
            const q = debouncedSearch.trim().toLowerCase();
            if (q) {
                const hay = `${r.name ?? ''} ${r.title} ${r.customerName ?? ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        },
        [assigneeId, customerId, completedOnly, debouncedSearch],
    );

    const counts = useMemo(() => {
        const c: Record<TabKey, number> = { pending: 0, hold: 0, excluded: 0, billed: 0 };
        for (const r of rows) {
            if (!passesFilters(r)) continue;
            for (const t of TABS) if (inTab(r, t.key)) c[t.key] += 1;
        }
        return c;
    }, [rows, passesFilters]);

    const visibleRows = useMemo(
        () => rows.filter((r) => inTab(r, tab) && passesFilters(r)),
        [rows, tab, passesFilters],
    );

    // ── 請求予定の作成（請求する）─────────────────────────────
    const createDraftFromItems = useCallback(
        async (row: Row, items: InvoiceItem[]) => {
            if (!row.customerId) {
                toast.error('顧客が未設定の案件です。先に案件へ顧客を設定してください');
                return;
            }
            if (items.length === 0) {
                toast.error('明細を作成できませんでした');
                return;
            }
            setBusyRowId(row.id);
            try {
                await create({ projectId: row.id, customerId: row.customerId, title: row.title, items });
                toast.success('請求予定を作成しました（「請求予定」で内容確認・請求書化できます）');
                await fetchBoard();
            } catch (e) {
                logger.error('Failed to create billing draft from board:', e);
                toast.error(e instanceof Error ? e.message : '請求予定の作成に失敗しました');
            } finally {
                setBusyRowId(null);
            }
        },
        [create, fetchBoard],
    );

    const itemsFromEstimates = useCallback(
        (row: Row, ests: Estimate[]): InvoiceItem[] =>
            ests.flatMap((e) => flattenEstimateItems(e.items ?? [])).map((it) => ({ ...it, projectMasterId: row.id })),
        [],
    );

    const handleRequest = useCallback(
        async (row: Row) => {
            await ensureEstimatesLoaded(); // クリック時点で見積が未ロードでも取り違えないよう保証
            const ests = getEstimatesByProject(row.id) ?? [];

            // 見積なし → 契約金額 1 行で作成
            if (ests.length === 0) {
                const line: InvoiceItem = {
                    id: newBillingItemId(),
                    description: row.name || row.title,
                    quantity: 1,
                    unit: '式',
                    unitPrice: row.contractAmount ?? 0,
                    amount: row.contractAmount ?? 0,
                    taxType: 'standard',
                    projectMasterId: row.id,
                };
                await createDraftFromItems(row, [line]);
                return;
            }

            const approved = ests.filter((e) => e.status === 'approved');
            if (ests.length === 1) {
                await createDraftFromItems(row, itemsFromEstimates(row, [ests[0]]));
                return;
            }
            if (approved.length === 1) {
                await createDraftFromItems(row, itemsFromEstimates(row, [approved[0]]));
                return;
            }
            // 複数見積 → 選択ダイアログ
            setPicker({
                row,
                choices: ests.map((e) => ({
                    id: e.id,
                    estimateNumber: e.estimateNumber,
                    title: e.title,
                    status: e.status,
                    subtotal: e.subtotal,
                })),
            });
        },
        [ensureEstimatesLoaded, getEstimatesByProject, createDraftFromItems, itemsFromEstimates],
    );

    const handlePickerConfirm = useCallback(
        async (selectedIds: string[]) => {
            if (!picker) return;
            const chosen = (getEstimatesByProject(picker.row.id) ?? []).filter((e) => selectedIds.includes(e.id));
            if (chosen.length === 0) {
                toast.error('見積を選択してください');
                return;
            }
            setPickerSubmitting(true);
            try {
                await createDraftFromItems(picker.row, itemsFromEstimates(picker.row, chosen));
                setPicker(null);
            } finally {
                setPickerSubmitting(false);
            }
        },
        [picker, getEstimatesByProject, createDraftFromItems, itemsFromEstimates],
    );

    // ── 請求判断（保留 / 対象外 / 戻す）───────────────────────
    const setDecision = useCallback(
        async (row: Row, decision: BillingDecision, successMsg: string) => {
            setBusyRowId(row.id);
            try {
                const res = await fetch(`/api/project-masters/${row.id}/billing-decision`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ decision }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || '更新に失敗しました');
                }
                toast.success(successMsg);
                await fetchBoard();
            } catch (e) {
                logger.error('Failed to update billing decision:', e);
                toast.error(e instanceof Error ? e.message : '更新に失敗しました');
            } finally {
                setBusyRowId(null);
            }
        },
        [fetchBoard],
    );

    const handleHold = useCallback((row: Row) => setDecision(row, 'hold', '保留にしました'), [setDecision]);
    const handleExclude = useCallback(
        (row: Row) => {
            if (!window.confirm(`「${row.title || row.name}」を請求対象外にします。よろしいですか？`)) return;
            setDecision(row, 'excluded', '対象外にしました');
        },
        [setDecision],
    );
    const handleRestore = useCallback((row: Row) => setDecision(row, 'pending', '判断待ちに戻しました'), [setDecision]);

    if (sessionStatus === 'loading') return null;
    if (!isAuthorized) return null;

    return (
        <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col bg-slate-50">
            {/* ヘッダー */}
            <div className="mb-4 flex flex-shrink-0 items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
                        <ClipboardList className="h-6 w-6 text-slate-500" /> 請求待ち
                    </h1>
                    <p className="mt-1 text-sm text-slate-500">
                        指定期間に作業した案件を、担当者が「請求する／まだ／対象外」で判断します。請求すると「請求予定」に追加されます。
                    </p>
                </div>
                <Button
                    variant="secondary"
                    leftIcon={<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />}
                    onClick={fetchBoard}
                    disabled={isLoading}
                >
                    更新
                </Button>
            </div>

            {/* 期間コントロール */}
            <div className="mb-4 flex flex-shrink-0 flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-600">表示期間</span>
                <button
                    onClick={() => shiftMonth(-1)}
                    className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50"
                    title="前月"
                >
                    <ChevronLeft className="h-4 w-4 text-slate-600" />
                </button>
                <input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <span className="text-slate-400">〜</span>
                <input
                    type="date"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <button
                    onClick={() => shiftMonth(1)}
                    className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50"
                    title="翌月"
                >
                    <ChevronRight className="h-4 w-4 text-slate-600" />
                </button>
                <button
                    onClick={goThisMonth}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                >
                    今月
                </button>
            </div>

            {/* タブ */}
            <div className="mb-4 flex flex-shrink-0 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:w-fit">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none ${
                            tab === t.key ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        {t.label}
                        <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-teal-100' : 'text-slate-400'}`}>
                            {counts[t.key]}
                        </span>
                    </button>
                ))}
            </div>

            {/* フィルタ */}
            <div className="mb-4 flex flex-shrink-0 flex-wrap items-center gap-2">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="案件・顧客で検索..."
                        className="w-56 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
                <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                    <option value="">担当者: 全員</option>
                    {assigneeOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                            担当: {a.name}
                        </option>
                    ))}
                </select>
                <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                    <option value="">顧客: すべて</option>
                    {customerOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </select>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                    <input
                        type="checkbox"
                        checked={completedOnly}
                        onChange={(e) => setCompletedOnly(e.target.checked)}
                    />
                    完了のみ
                </label>
            </div>

            {/* 一覧 */}
            <div className="flex-1 space-y-2 overflow-auto pr-1">
                {!isInitialized ? (
                    [...Array(4)].map((_, i) => (
                        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
                            <div className="mb-2 h-5 w-1/3 rounded bg-slate-200" />
                            <div className="h-4 w-2/3 rounded bg-slate-200" />
                        </div>
                    ))
                ) : visibleRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-sm">
                        {tab === 'pending'
                            ? 'この期間に判断待ちの案件はありません'
                            : tab === 'hold'
                              ? '保留中の案件はありません'
                              : tab === 'excluded'
                                ? '対象外の案件はありません'
                                : 'この期間に請求済みの案件はありません'}
                    </div>
                ) : (
                    visibleRows.map((row) => (
                        <BillingBoardRow
                            key={row.id}
                            row={row}
                            assigneeNames={resolveNames(row.assigneeIds)}
                            ctypeMap={ctypeMap}
                            userMap={userMap}
                            busy={busyRowId === row.id}
                            tab={tab}
                            onRequest={handleRequest}
                            onHold={handleHold}
                            onExclude={handleExclude}
                            onRestore={handleRestore}
                        />
                    ))
                )}
            </div>

            <EstimatePickerDialog
                open={!!picker}
                projectTitle={picker ? picker.row.title : ''}
                estimates={picker?.choices ?? []}
                submitting={pickerSubmitting}
                onClose={() => setPicker(null)}
                onConfirm={handlePickerConfirm}
            />
        </div>
    );
}
