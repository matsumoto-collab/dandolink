'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { RefreshCw, Search, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { useEstimates } from '@/hooks/useEstimates';
import { useCompany } from '@/hooks/useCompany';
import { useCustomers } from '@/hooks/useCustomers';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useDebounce } from '@/hooks/useDebounce';
import { flattenEstimateItems, newBillingItemId } from '@/lib/billing/estimateToBillingItems';
import { closingDayLabel, formatClosingInvoiceTitle, dueDateFromClosing } from '@/lib/closingDay';
import BillingBoardRow from '@/components/BillingBoard/BillingBoardRow';
import EstimatePickerDialog, { type EstimateChoice } from '@/components/Estimates/EstimatePickerDialog';
import RequestBillingDialog, {
    type RequestBillingResult,
    type RequestBillingProfit,
} from '@/components/BillingBoard/RequestBillingDialog';
import type { BillingBoardRow as Row, BillingDecision } from '@/types/billingBoard';
import type { InvoiceItem, InvoiceInput, BillingTitle } from '@/types/invoice';
import type { Estimate, EstimateInput } from '@/types/estimate';
import type { Project } from '@/types/calendar';
import { logger } from '@/lib/logger';
import { useFinanceStore } from '@/stores/financeStore';

// 請求書プレビュー（既存の請求書作成フォームを転用・重いので遅延読み込み）
const InvoiceModal = dynamic(() => import('@/components/Invoices/InvoiceModal'), { ssr: false, loading: () => null });
// 見積書の編集フォーム（見積書メニューと同じモーダル。請求金額の指定中にその場で見積を直せるように）
const EstimateModal = dynamic(() => import('@/components/Estimates/EstimateModal'), { ssr: false, loading: () => null });

type TabKey = 'pending' | 'hold' | 'excluded' | 'billed';
type CtypeMap = Record<string, { name: string; color: string }>;
type PeriodMode = 'closing' | 'range';

const TABS: { key: TabKey; label: string }[] = [
    { key: 'pending', label: '判断待ち' },
    { key: 'hold', label: '保留' },
    { key: 'excluded', label: '対象外' },
    { key: 'billed', label: '請求済み' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
/** YYYY-MM-DD → "M/D"。 */
const mdYmd = (ymd: string) => {
    const p = ymd.split('-');
    return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : ymd;
};

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

/** 当月（JST）の YYYY-MM。 */
function currentMonthYm(): string {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}`;
}

/** YYYY-MM → "YYYY年M月"。 */
function ymLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    return `${y}年${m}月`;
}

/**
 * その行が現在のタブに属するか。
 * 「請求済み」タブ＝この締め月に請求した(monthlyInvoicedAmount>0) または 手動で「請求済み」にした案件(billingDecision='billed')。
 * 他タブはそのいずれも除外する（請求済みは「請求済み」タブだけに出す）。実請求は月ごとに判定し、月をまたいで貼り付かない。
 */
function inTab(r: Row, tab: TabKey): boolean {
    const billedThisMonth = r.monthlyInvoicedAmount > 0;
    if (tab === 'billed') return billedThisMonth || r.billingDecision === 'billed';
    if (billedThisMonth || r.billingDecision === 'billed') return false;
    if (tab === 'pending') return r.billingDecision === 'pending';
    if (tab === 'hold') return r.billingDecision === 'hold';
    return r.billingDecision === 'excluded';
}

/** 顧客ごとのグループ（締め分モードでは顧客の締め日ウィンドウ単位で並ぶ）。 */
interface CustomerGroup {
    key: string;
    customerId: string | null;
    customerName: string;
    closingDay: number;
    periodFrom: string;
    periodTo: string;
    rows: Row[];
}

/** ボード上で「請求する」した案件を、請求書発行まで保持する選択行（請求予定は作らない）。DB(BillingStagedLine)に永続化する。 */
interface StagedLine {
    customerId: string;
    items: InvoiceItem[]; // 各 item に projectMasterId を持たせる（請求済み按分のため）
    total: number; // items の税抜合計
    label: string; // 摘要 / 見積どおり 等（行表示用）
}

/** GET /api/billing-staged の1行（StagedLine ＋ キーとなる案件ID）。 */
type StagedLineResponse = StagedLine & { projectMasterId: string };

export default function BillingBoardPage() {
    const { data: session, status: sessionStatus } = useSession();
    const role = session?.user?.role;
    // 税理士(accountant)は閲覧のみで開放（請求判断・請求書発行の操作は canEdit で制御）
    const isAuthorized = role === 'admin' || role === 'manager' || role === 'accountant';
    const canEdit = role === 'admin' || role === 'manager';
    const myId = session?.user?.id;

    const { ensureDataLoaded: ensureEstimatesLoaded, getEstimatesByProject, updateEstimate } = useEstimates();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();
    const { projectMasters, fetchProjectMasters } = useProjectMasters();

    const [rows, setRows] = useState<Row[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [userMap, setUserMap] = useState<Record<string, string>>({});
    const [ctypeMap, setCtypeMap] = useState<CtypeMap>({});
    const [billingTitles, setBillingTitles] = useState<BillingTitle[]>([]); // 請求項目マスタ（請求項目で明細をつくる 用）

    // 表示モード：'closing'＝顧客ごとの締め分（既定）、'range'＝任意範囲（全顧客同一）。
    const [mode, setMode] = useState<PeriodMode>('closing');
    // 締め分モードの基準月（YYYY-MM、既定＝当月JST）。各顧客は自分の締め日でこの月分を集計。
    const [month, setMonth] = useState<string>(() => currentMonthYm());
    // 任意範囲モードの期間（YYYY-MM-DD）。日付指定で任意の範囲に変更できる。
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
    // 「請求する」金額指定ダイアログ（出来高対応）
    const [requestDialog, setRequestDialog] = useState<{ row: Row } | null>(null);
    const [requestSubmitting, setRequestSubmitting] = useState(false);
    // 金額指定ダイアログに出す利益サマリー（案件詳細の利益タブと同じ API）
    const [profit, setProfit] = useState<RequestBillingProfit | null>(null);
    const [profitLoading, setProfitLoading] = useState(false);
    // 見積を編集して保存したら利益サマリーも取り直す（この値を増やすと再取得）
    const [profitReloadKey, setProfitReloadKey] = useState(0);
    // 金額指定ダイアログから開く見積編集モーダル（請求ダイアログは開いたまま上に重ねる）
    const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
    // 「見積を選択」＝複数見積から見積金額を決めるピッカー（選択合計を案件の見積金額に保存）
    const [estimatePicker, setEstimatePicker] = useState<{ row: Row; choices: EstimateChoice[] } | null>(null);
    const [estimatePickerSubmitting, setEstimatePickerSubmitting] = useState(false);

    // 請求対象（DBに永続化・請求書発行まで保持）。key = projectId。
    // 別メニューへ移動しても消えず、端末をまたいで途中から再開できる。
    const [staged, setStaged] = useState<Record<string, StagedLine>>({});

    // 請求書プレビュー（顧客ごと）
    const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
    const [invoiceInitialData, setInvoiceInitialData] = useState<(Partial<InvoiceInput> & { updatedAt?: Date | string; updatedBy?: string }) | undefined>(undefined);
    const [issuingCustomerId, setIssuingCustomerId] = useState<string | null>(null);
    const [issuingProjectIds, setIssuingProjectIds] = useState<string[]>([]);
    // 当月まとめ: 既存の当月請求書へ追記する場合の対象ID（null=新規作成）と、その既存請求書が持つ案件ID。
    const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
    const [editingExistingProjectIds, setEditingExistingProjectIds] = useState<string[]>([]);
    // 既存請求書（当月まとめ判定用）。finance ストアから参照する。
    const financeInvoices = useFinanceStore((s) => s.invoices);

    // 月送り連打などで並走した fetch のうち、最後に発行したものだけを画面に反映する
    // （遅れて届いた古い期間の応答が新しい表示を上書きしない）。
    const fetchSeq = useRef(0);

    // 請求対象（staged）をDBから読み込む。ボード取得と同じタイミングで呼び、他端末での追加/取消も反映する。
    // 並走した場合に古い応答が新しい state を上書きしないよう seq でガードする。
    const stagedSeq = useRef(0);
    const fetchStaged = useCallback(async () => {
        const seq = ++stagedSeq.current;
        try {
            const res = await fetch('/api/billing-staged', { cache: 'no-store' });
            if (!res.ok) throw new Error('請求対象の取得に失敗しました');
            const list = (await res.json()) as StagedLineResponse[];
            if (seq !== stagedSeq.current) return; // 古い応答は捨てる
            const map: Record<string, StagedLine> = {};
            for (const l of Array.isArray(list) ? list : []) {
                map[l.projectMasterId] = {
                    customerId: l.customerId,
                    items: l.items ?? [],
                    total: l.total,
                    label: l.label,
                };
            }
            setStaged(map);
        } catch (e) {
            logger.error('Failed to fetch billing staged lines:', e);
        }
    }, []);

    const fetchBoard = useCallback(async () => {
        const seq = ++fetchSeq.current;
        void fetchStaged(); // 請求対象も一緒に最新化（「更新」ボタン・期間変更でも再取得される）
        try {
            setIsLoading(true);
            const qs = mode === 'closing' ? `month=${month}` : `from=${from}&to=${to}`;
            const res = await fetch(`/api/billing-board?${qs}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('請求判断ボードの取得に失敗しました');
            const data = (await res.json()) as Row[];
            if (seq !== fetchSeq.current) return; // 古い応答は捨てる
            setRows(data);
            setIsInitialized(true);
        } catch (e) {
            if (seq !== fetchSeq.current) return;
            logger.error('Failed to fetch billing board:', e);
            toast.error(e instanceof Error ? e.message : '取得に失敗しました');
        } finally {
            if (seq === fetchSeq.current) setIsLoading(false);
        }
    }, [mode, month, from, to, fetchStaged]);

    // 当月まとめ判定のため、既存請求書を最新化して読み込んでおく。
    useEffect(() => {
        if (!isAuthorized) return;
        void useFinanceStore.getState().fetchInvoices();
    }, [isAuthorized]);

    // 期間・モード変更時も含めてボードを再取得
    useEffect(() => {
        if (!isAuthorized) return;
        fetchBoard();
    }, [isAuthorized, fetchBoard]);

    // 初回のみ：見積・ユーザー・工事種別マスタ・自社情報・案件マスタを取得
    useEffect(() => {
        if (!isAuthorized) return;
        ensureEstimatesLoaded();
        ensureCompanyLoaded();
        ensureCustomersLoaded();
        fetchProjectMasters();
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
            try {
                const res = await fetch('/api/master-data/billing-titles');
                if (res.ok) {
                    const list = await res.json();
                    setBillingTitles(Array.isArray(list) ? list : []);
                }
            } catch (e) {
                logger.error('請求項目マスタの取得に失敗:', e);
            }
        })();
    }, [isAuthorized, ensureEstimatesLoaded, ensureCompanyLoaded, ensureCustomersLoaded, fetchProjectMasters]);

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

    // 締め分モードの基準月ナビ
    const shiftRefMonth = useCallback(
        (delta: number) => {
            const [y, m] = month.split('-').map(Number);
            const d = new Date(Date.UTC(y, m - 1 + delta, 1));
            setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
        },
        [month],
    );
    const goThisRefMonth = useCallback(() => setMonth(currentMonthYm()), []);

    // 任意範囲モードの暦月ナビ（末締め相当）
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

    // 顧客ごとにグループ化（締め分モードでは顧客の締め日ウィンドウ単位）。顧客名の五十音順。
    const customerGroups = useMemo<CustomerGroup[]>(() => {
        const map = new Map<string, CustomerGroup>();
        for (const r of visibleRows) {
            const key = r.customerId ?? '__none__';
            const g = map.get(key);
            if (g) g.rows.push(r);
            else
                map.set(key, {
                    key,
                    customerId: r.customerId,
                    customerName: r.customerName || '顧客未設定',
                    closingDay: r.customerClosingDay,
                    periodFrom: r.periodFrom,
                    periodTo: r.periodTo,
                    rows: [r],
                });
        }
        return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName, 'ja'));
    }, [visibleRows]);

    // 顧客グループの小計（請求済みタブ＝請求済み合計、それ以外＝残額合計。税抜）
    const groupSubtotal = useCallback(
        (g: CustomerGroup) =>
            tab === 'billed'
                ? g.rows.reduce((s, r) => s + (r.monthlyInvoicedAmount || 0), 0)
                : g.rows.reduce((s, r) => s + (r.remainingAmount ?? r.contractAmount ?? 0), 0),
        [tab],
    );

    // 顧客ごとの請求対象（staged を顧客単位に集約）
    const stagedByCustomer = useMemo(() => {
        const m = new Map<string, { projectIds: string[]; total: number; items: InvoiceItem[] }>();
        for (const [pid, line] of Object.entries(staged)) {
            const g = m.get(line.customerId) ?? { projectIds: [], total: 0, items: [] };
            g.projectIds.push(pid);
            g.total += line.total;
            g.items.push(...line.items);
            m.set(line.customerId, g);
        }
        return m;
    }, [staged]);

    // ── 請求対象に追加 / 取消（請求予定は作らず BillingStagedLine に保存）──────────
    // DB 保存が成功してから state を更新する（失敗時は state を触らない＝画面とDBがずれない）。
    const stageProject = useCallback(async (row: Row, items: InvoiceItem[], label: string) => {
        if (!row.customerId) {
            toast.error('顧客が未設定の案件です。先に案件へ顧客を設定してください');
            return;
        }
        const customerId = row.customerId;
        const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        try {
            const res = await fetch('/api/billing-staged', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ projectMasterId: row.id, customerId, items, total, label }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || '請求対象への追加に失敗しました');
            }
            setStaged((prev) => ({ ...prev, [row.id]: { customerId, items, total, label } }));
            toast.success('請求対象に追加しました');
        } catch (e) {
            logger.error('Failed to stage project:', e);
            toast.error(e instanceof Error ? e.message : '請求対象への追加に失敗しました');
        }
    }, []);

    const unstageProject = useCallback(async (row: Row) => {
        try {
            const res = await fetch('/api/billing-staged', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ projectMasterIds: [row.id] }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || '請求対象の取消に失敗しました');
            }
            setStaged((prev) => {
                const next = { ...prev };
                delete next[row.id];
                return next;
            });
        } catch (e) {
            logger.error('Failed to unstage project:', e);
            toast.error(e instanceof Error ? e.message : '請求対象の取消に失敗しました');
        }
    }, []);

    const itemsFromEstimates = useCallback(
        (row: Row, ests: Estimate[]): InvoiceItem[] =>
            ests.flatMap((e) => flattenEstimateItems(e.items ?? [])).map((it) => ({ ...it, projectMasterId: row.id })),
        [],
    );

    // 「請求する」→ 金額指定ダイアログを開く（見積は先にロードしておく）
    const handleRequest = useCallback(
        async (row: Row) => {
            await ensureEstimatesLoaded(); // クリック時点で見積が未ロードでも取り違えないよう保証
            setRequestDialog({ row });
        },
        [ensureEstimatesLoaded],
    );

    // 金額指定ダイアログを開いている案件の利益サマリーを取得する。
    // 取得失敗（税理士など権限が無い場合を含む）は非表示にするだけでトーストは出さない。
    const requestRowId = requestDialog?.row.id ?? null;
    useEffect(() => {
        if (!requestRowId) {
            setProfit(null);
            setProfitLoading(false);
            return;
        }
        let cancelled = false;
        setProfitLoading(true);
        (async () => {
            try {
                const res = await fetch(`/api/project-masters/${requestRowId}/profit`, { cache: 'no-store' });
                if (!res.ok) throw new Error('利益の取得に失敗しました');
                const d = (await res.json()) as {
                    revenue: number;
                    costBreakdown?: { totalCost?: number };
                    grossProfit: number;
                    profitMargin: number;
                };
                if (cancelled) return;
                setProfit({
                    revenue: Number(d.revenue) || 0,
                    totalCost: Number(d.costBreakdown?.totalCost) || 0,
                    grossProfit: Number(d.grossProfit) || 0,
                    profitMargin: Number(d.profitMargin) || 0,
                });
            } catch (e) {
                if (cancelled) return;
                logger.error('利益サマリーの取得に失敗:', e);
                setProfit(null);
            } finally {
                if (!cancelled) setProfitLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [requestRowId, profitReloadKey]);

    // ── 金額指定ダイアログからの見積編集 ────────────────────────
    const handleEditEstimate = useCallback((estimate: Estimate) => {
        setEditingEstimate(estimate);
    }, []);

    // 見積の保存（見積書メニューと同じ更新経路＝financeストアの updateEstimate）。
    // 保存後はストアが更新される＝ダイアログの見積・PDFプレビューが追従し、
    // 併せてボード金額（見積金額はライブ計算）と利益サマリーも取り直す。
    const handleEstimateSubmit = useCallback(
        async (data: EstimateInput) => {
            if (!editingEstimate) return;
            try {
                await updateEstimate(editingEstimate.id, data);
                toast.success('見積書を保存しました');
                setEditingEstimate(null);
                setProfitReloadKey((k) => k + 1);
                await fetchBoard();
            } catch (e) {
                logger.error('Failed to update estimate from billing board:', e);
                toast.error(e instanceof Error ? e.message : '見積書の保存に失敗しました');
            }
        },
        [editingEstimate, updateEstimate, fetchBoard],
    );

    // 見積から請求対象に追加（1件=自動 / 承認1件=自動 / 複数=ピッカー / 見積なし=契約1行）
    const stageFromEstimates = useCallback(
        async (row: Row) => {
            const ests = getEstimatesByProject(row.id) ?? [];
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
                await stageProject(row, [line], '契約金額');
                return;
            }
            const approved = ests.filter((e) => e.status === 'approved');
            if (ests.length === 1) {
                await stageProject(row, itemsFromEstimates(row, [ests[0]]), '見積どおり');
                return;
            }
            if (approved.length === 1) {
                await stageProject(row, itemsFromEstimates(row, [approved[0]]), '見積どおり');
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
        [getEstimatesByProject, stageProject, itemsFromEstimates],
    );

    // 金額指定ダイアログの確定（金額指定/残額すべて → 1行、見積どおり → 見積展開）
    const handleRequestConfirm = useCallback(
        async (result: RequestBillingResult) => {
            const dlg = requestDialog;
            if (!dlg) return;
            const row = dlg.row;
            setRequestSubmitting(true);
            try {
                if (result.kind === 'estimate') {
                    setRequestDialog(null);
                    await stageFromEstimates(row);
                } else if (result.kind === 'items') {
                    // 請求項目で明細をつくる：見積と違う名称の明細をそのまま請求対象へ（案件タグ付与）
                    const items = result.items.map((it) => ({ ...it, projectMasterId: row.id }));
                    const label =
                        items.length === 1 ? items[0].description?.trim() || '明細指定' : `${items.length}明細`;
                    await stageProject(row, items, label);
                    setRequestDialog(null);
                } else {
                    const line: InvoiceItem = {
                        id: newBillingItemId(),
                        description: result.note?.trim() || row.name || row.title,
                        quantity: 1,
                        unit: '式',
                        unitPrice: result.amount,
                        amount: result.amount,
                        taxType: 'standard',
                        projectMasterId: row.id,
                    };
                    await stageProject(row, [line], result.note?.trim() || '金額指定');
                    setRequestDialog(null);
                }
            } finally {
                setRequestSubmitting(false);
            }
        },
        [requestDialog, stageFromEstimates, stageProject],
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
                await stageProject(picker.row, itemsFromEstimates(picker.row, chosen), '見積どおり');
                setPicker(null);
            } finally {
                setPickerSubmitting(false);
            }
        },
        [picker, getEstimatesByProject, stageProject, itemsFromEstimates],
    );

    // ── 見積金額の選択（複数見積→選択合計を案件の見積金額に保存）──────────
    const handlePickEstimate = useCallback(
        async (row: Row) => {
            await ensureEstimatesLoaded();
            const ests = getEstimatesByProject(row.id) ?? [];
            if (ests.length === 0) {
                toast.error('見積がありません');
                return;
            }
            setEstimatePicker({
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
        [ensureEstimatesLoaded, getEstimatesByProject],
    );

    const handleEstimatePickerConfirm = useCallback(
        async (selectedIds: string[]) => {
            if (!estimatePicker) return;
            const chosen = (getEstimatesByProject(estimatePicker.row.id) ?? []).filter((e) => selectedIds.includes(e.id));
            if (chosen.length === 0) {
                toast.error('見積を選択してください');
                return;
            }
            setEstimatePickerSubmitting(true);
            try {
                // 金額（スナップショット）ではなく「どの見積を使うか」だけを保存する。
                // 金額はボード側で常に見積書の現在値から計算するため、見積書を修正すればボードも追従する。
                const res = await fetch(`/api/project-masters/${estimatePicker.row.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ billingEstimateIds: selectedIds }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error || '見積金額の設定に失敗しました');
                }
                toast.success('見積金額を設定しました');
                setEstimatePicker(null);
                await fetchBoard();
            } catch (e) {
                logger.error('Failed to set estimate amount:', e);
                toast.error(e instanceof Error ? e.message : '見積金額の設定に失敗しました');
            } finally {
                setEstimatePickerSubmitting(false);
            }
        },
        [estimatePicker, getEstimatesByProject, fetchBoard],
    );

    // 見積PDFプレビュー用の Blob 生成（見積＋案件＋自社情報）。案件は開いている請求ダイアログの行で解決。
    const renderEstimatePdf = useCallback(
        async (est: Estimate): Promise<Blob | null> => {
            if (!companyInfo || !requestDialog) return null;
            const pm = projectMasters.find((p) => p.id === requestDialog.row.id);
            if (!pm) return null;
            // 宛名は顧客マスタの現在値を優先（顧客名・敬称の変更に追従）。スナップショットはフォールバック
            const cust = pm.customerId ? customers.find((c) => c.id === pm.customerId) : undefined;
            const project = {
                id: pm.id,
                title: pm.title,
                startDate: new Date(),
                category: 'construction' as const,
                color: '#3B82F6',
                customer: cust?.name || pm.customerName || pm.customerShortName || '',
                customerHonorific: cust?.honorific || '御中',
                location: pm.location || '',
                createdAt: pm.createdAt,
                updatedAt: pm.updatedAt,
            } as unknown as Project;
            const { generateEstimatePDFBlobOnlyReact } = await import('@/utils/reactPdfGenerator');
            return generateEstimatePDFBlobOnlyReact(est, project, companyInfo, { includeDetails: true });
        },
        [companyInfo, projectMasters, customers, requestDialog],
    );

    // ── 請求判断（保留 / 対象外 / 戻す）───────────────────────
    const setDecision = useCallback(
        async (row: Row, decision: BillingDecision, successMsg: string) => {
            setBusyRowId(row.id);
            try {
                const res = await fetch(`/api/project-masters/${row.id}/billing-decision`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    // 判断は「案件×締め月」ごとに保存する。締め分モードは表示中の基準月、任意範囲は当月をキーにする。
                    body: JSON.stringify({ decision, periodKey: mode === 'closing' ? month : currentMonthYm() }),
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
        [fetchBoard, mode, month],
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
    // 手動で「請求済み」に（社外請求済み等、実請求を介さず請求済みタブへ送る）。判断に戻すで取り消せる。
    const handleMarkBilled = useCallback((row: Row) => setDecision(row, 'billed', '請求済みにしました'), [setDecision]);

    // ── 顧客ごとに請求書を作成（請求予定を介さず /api/invoices に直接発行）──────
    const handleCreateInvoiceForCustomer = useCallback(
        (custId: string) => {
            const sc = stagedByCustomer.get(custId);
            if (!sc || sc.items.length === 0) {
                toast.error('請求対象がありません');
                return;
            }
            const sampleRow = rows.find((r) => r.customerId === custId);
            const closingYmd = sampleRow?.periodTo;
            const periodFrom = sampleRow?.periodFrom;

            setIssuingCustomerId(custId);
            setIssuingProjectIds(sc.projectIds);

            // 当月まとめ: 締め分モードで、同じ顧客・同じ締め期間・編集可（下書き/担当確認済み）の
            // 既存請求書があれば、新規作成せずにその請求書へ今回の明細を追記する（編集モードで開く）。
            // 送付済/支払済/期限超過の請求書は対象外＝新規作成（顧客へ送った後の請求書は書き換えない）。
            const EDITABLE = new Set(['draft', 'confirmed']);
            const pad2 = (n: number) => String(n).padStart(2, '0');
            const toLocalYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const existing =
                mode === 'closing' && periodFrom && closingYmd
                    ? financeInvoices
                          .filter((inv) => inv.customerId === custId && EDITABLE.has(inv.status))
                          .filter((inv) => {
                              const ymd = toLocalYmd(new Date(inv.createdAt));
                              return ymd >= periodFrom && ymd <= closingYmd;
                          })
                          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
                    : undefined;

            if (existing) {
                // 既存の当月請求書へ追記（編集モードで開く）。明細＝既存＋今回、合計はフォームが自動再計算する。
                const existingPmIds = existing.projectMasterIds ?? existing.projectMasters?.map((p) => p.id) ?? [];
                const combinedPmIds = Array.from(new Set([...existingPmIds, ...sc.projectIds]));
                const combinedItems = [...(existing.items ?? []), ...sc.items];
                setEditingInvoiceId(existing.id);
                setEditingExistingProjectIds(existingPmIds);
                setInvoiceInitialData({
                    customerId: custId,
                    projectMasterIds: combinedPmIds,
                    items: combinedItems,
                    title: existing.title,
                    invoiceNumber: existing.invoiceNumber,
                    createdAt: new Date(existing.createdAt),
                    dueDate: new Date(existing.dueDate),
                    status: existing.status,
                    notes: existing.notes,
                    updatedAt: existing.updatedAt,
                    updatedBy: existing.updatedBy,
                });
                setIsInvoiceModalOpen(true);
                toast('当月の請求書に追記します。内容を確認して保存してください', { icon: 'ℹ️', duration: 4000 });
                return;
            }

            // 新規作成（従来どおり）。締め分なら締め日からタイトル・請求日・支払期限を自動生成。
            // 締め日が取れない（任意範囲モード等）ときは空欄で開き、従来どおり手入力させる。
            setEditingInvoiceId(null);
            setEditingExistingProjectIds([]);
            let title = '';
            let createdAt: Date | undefined;
            let dueDate: Date | undefined;
            if (mode === 'closing' && closingYmd && /^\d{4}-\d{2}-\d{2}$/.test(closingYmd)) {
                const [yy, mm, dd] = closingYmd.split('-').map(Number);
                title = formatClosingInvoiceTitle(yy, mm, dd);
                createdAt = new Date(yy, mm - 1, dd); // 請求日＝締め日（ローカル暦日）
                const [dyy, dmm, ddd] = dueDateFromClosing(yy, mm - 1, 'nextMonthEnd').split('-').map(Number);
                dueDate = new Date(dyy, dmm - 1, ddd);
            }
            setInvoiceInitialData({
                customerId: custId,
                projectMasterIds: sc.projectIds,
                items: sc.items,
                title,
                createdAt,
                dueDate,
            });
            setIsInvoiceModalOpen(true);
        },
        [stagedByCustomer, rows, mode, financeInvoices],
    );

    const handleCloseInvoiceModal = useCallback(() => {
        setIsInvoiceModalOpen(false);
        setInvoiceInitialData(undefined);
        setIssuingCustomerId(null);
        setIssuingProjectIds([]);
        setEditingInvoiceId(null);
        setEditingExistingProjectIds([]);
    }, []);

    const handleIssueInvoice = useCallback(
        async (data: InvoiceInput) => {
            const isUpdate = !!editingInvoiceId;
            try {
                // 既存の当月請求書へ追記する場合は PATCH（案件リンクは既存＋今回をまとめる）。新規は POST。
                const projectMasterIds = isUpdate
                    ? Array.from(new Set([...editingExistingProjectIds, ...issuingProjectIds]))
                    : issuingProjectIds;
                const res = await fetch(isUpdate ? `/api/invoices/${editingInvoiceId}` : '/api/invoices', {
                    method: isUpdate ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    cache: 'no-store',
                    body: JSON.stringify({
                        ...data,
                        customerId: issuingCustomerId,
                        projectMasterIds,
                        dueDate: data.dueDate instanceof Date ? data.dueDate.toISOString() : data.dueDate,
                    }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error || (isUpdate ? '請求書の更新に失敗しました' : '請求書の作成に失敗しました'));
                }
                toast.success(isUpdate ? '当月の請求書にまとめました（「請求書」で確認できます）' : '請求書を作成しました（「請求書」で確認できます）');
                // 請求書一覧（financeストア）を最新化（ボードはストアを介さず直接APIを叩くため）。
                const financeState = useFinanceStore.getState();
                if (financeState.invoicesInitialized) {
                    void financeState.fetchInvoices();
                }
                // 今回ステージした案件のみ請求対象から外す（DB＋画面の両方）。
                // DB 側の削除に失敗しても請求書の作成/更新自体は成功しているので、ログに留めてトーストは出さない。
                const issued = issuingProjectIds;
                if (issued.length > 0) {
                    try {
                        const delRes = await fetch('/api/billing-staged', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            cache: 'no-store',
                            body: JSON.stringify({ projectMasterIds: issued }),
                        });
                        if (!delRes.ok) throw new Error('請求対象の削除に失敗しました');
                    } catch (e) {
                        logger.error('Failed to clear staged lines after issuing invoice:', e);
                    }
                }
                setStaged((prev) => {
                    const next = { ...prev };
                    for (const pid of issued) delete next[pid];
                    return next;
                });
                setIsInvoiceModalOpen(false);
                setInvoiceInitialData(undefined);
                setIssuingCustomerId(null);
                setIssuingProjectIds([]);
                setEditingInvoiceId(null);
                setEditingExistingProjectIds([]);
                await fetchBoard();
            } catch (e) {
                logger.error('Failed to create/update invoice from board:', e);
                toast.error(e instanceof Error ? e.message : (isUpdate ? '請求書の更新に失敗しました' : '請求書の作成に失敗しました'));
            }
        },
        [issuingCustomerId, issuingProjectIds, editingInvoiceId, editingExistingProjectIds, fetchBoard],
    );

    if (sessionStatus === 'loading') return null;
    if (!isAuthorized) return null;

    return (
        <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col bg-slate-50">
            {/* ヘッダー（モバイルは説明文非表示） */}
            <div className="mb-3 sm:mb-4 flex flex-shrink-0 items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-slate-800">
                        <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6 text-slate-500" /> 請求待ち
                    </h1>
                    <p className="mt-1 hidden sm:block text-sm text-slate-500">
                        顧客ごと（締め日単位）に「請求する／まだ／対象外」で判断し、顧客ごとにまとめて請求書を作成します。
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

            {/* 期間コントロール（モバイルはラベル・注記を省いて1〜2行に） */}
            <div className="mb-3 sm:mb-4 flex flex-shrink-0 flex-wrap items-center gap-2">
                <span className="hidden sm:inline text-sm font-medium text-slate-600">表示期間</span>
                {/* モード切替 */}
                <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm">
                    {(
                        [
                            { key: 'closing', label: '締め分' },
                            { key: 'range', label: '任意範囲' },
                        ] as { key: PeriodMode; label: string }[]
                    ).map((m) => (
                        <button
                            key={m.key}
                            onClick={() => setMode(m.key)}
                            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                                mode === m.key ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>

                {mode === 'closing' ? (
                    <>
                        <button
                            onClick={() => shiftRefMonth(-1)}
                            className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50"
                            title="前月"
                        >
                            <ChevronLeft className="h-4 w-4 text-slate-600" />
                        </button>
                        <span className="min-w-0 sm:min-w-[8.5rem] px-1 text-center text-sm font-semibold text-slate-800 whitespace-nowrap">
                            {ymLabel(month)} 締め分
                        </span>
                        <button
                            onClick={() => shiftRefMonth(1)}
                            className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50"
                            title="翌月"
                        >
                            <ChevronRight className="h-4 w-4 text-slate-600" />
                        </button>
                        <button
                            onClick={goThisRefMonth}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                            今月
                        </button>
                        <span className="hidden sm:inline text-xs text-slate-500">各顧客の締め日で集計します</span>
                    </>
                ) : (
                    <>
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
                        <span className="hidden sm:inline text-xs text-slate-500">全顧客同一期間</span>
                    </>
                )}
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

            {mode === 'range' && (
                <div className="mb-3 flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    任意範囲では請求判断（まだ／対象外／請求済み）は変更できません。判断は「締め分」モードで行ってください。
                </div>
            )}

            {/* フィルタ（モバイルは検索を伸縮させて折返しを2行以内に） */}
            <div className="mb-3 sm:mb-4 flex flex-shrink-0 flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[160px] sm:flex-none sm:min-w-0">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="案件・顧客で検索..."
                        className="w-full sm:w-56 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
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

            {/* 一覧（顧客ごと） */}
            <div className="flex-1 space-y-4 overflow-auto pr-1">
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
                    customerGroups.map((g) => {
                        const sc = g.customerId ? stagedByCustomer.get(g.customerId) : undefined;
                        const stagedCount = sc?.projectIds.length ?? 0;
                        const canInvoice = canEdit && tab !== 'billed' && !!g.customerId && stagedCount > 0;
                        return (
                            <div key={g.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                                {/* 顧客ヘッダー帯（この顧客の囲みの見出し）。作業履歴のグレーと見分けがつくよう濃いめの背景にする */}
                                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-slate-200 px-4 py-2.5">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <span className="text-base font-bold text-slate-900">{g.customerName}</span>
                                        <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                            {closingDayLabel(g.closingDay)}
                                        </span>
                                        {mode === 'closing' && (
                                            <span className="tabular-nums text-xs text-slate-500">
                                                {mdYmd(g.periodFrom)}〜{mdYmd(g.periodTo)}
                                            </span>
                                        )}
                                        <span className="text-xs text-slate-400">{g.rows.length}件</span>
                                    </div>
                                    {canInvoice ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-slate-500">
                                                残(税抜){' '}
                                                <span className="font-semibold text-slate-700">{yen(groupSubtotal(g))}</span>
                                            </span>
                                            <Button
                                                type="button"
                                                variant="primary"
                                                onClick={() => handleCreateInvoiceForCustomer(g.customerId as string)}
                                                title="請求対象の案件をまとめて請求書にします"
                                            >
                                                請求書を作成（{stagedCount}件 {yen(sc?.total ?? 0)}）
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="text-right">
                                            <span className="text-[10px] text-slate-500">
                                                {tab === 'billed' ? '請求済み(税抜)' : '残(税抜)'}
                                            </span>
                                            <span className="ml-1.5 text-base font-bold text-slate-900">
                                                {yen(groupSubtotal(g))}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                {/* 案件行（顧客カード内で罫線区切り） */}
                                <div className="divide-y divide-slate-100">
                                    {g.rows.map((row) => (
                                        <BillingBoardRow
                                            key={row.id}
                                            row={row}
                                            assigneeNames={resolveNames(row.assigneeIds)}
                                            ctypeMap={ctypeMap}
                                            userMap={userMap}
                                            busy={busyRowId === row.id}
                                            tab={tab}
                                            canDecide={canEdit && mode === 'closing'}
                                            staged={
                                                staged[row.id]
                                                    ? { amount: staged[row.id].total, note: staged[row.id].label }
                                                    : null
                                            }
                                            onRequest={handleRequest}
                                            onMarkBilled={handleMarkBilled}
                                            onUnstage={unstageProject}
                                            onPickEstimate={handlePickEstimate}
                                            onHold={handleHold}
                                            onExclude={handleExclude}
                                            onRestore={handleRestore}
                                        />
                                    ))}
                                </div>
                            </div>
                        );
                    })
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

            <EstimatePickerDialog
                open={!!estimatePicker}
                projectTitle={estimatePicker ? estimatePicker.row.title : ''}
                estimates={estimatePicker?.choices ?? []}
                submitting={estimatePickerSubmitting}
                title="見積金額にする見積を選択（複数可）"
                confirmLabel="見積金額に設定"
                onClose={() => setEstimatePicker(null)}
                onConfirm={handleEstimatePickerConfirm}
            />

            {isInvoiceModalOpen && (
                <InvoiceModal
                    isOpen={isInvoiceModalOpen}
                    onClose={handleCloseInvoiceModal}
                    onSubmit={handleIssueInvoice}
                    initialData={invoiceInitialData}
                />
            )}

            {requestDialog &&
                (() => {
                    const ests = getEstimatesByProject(requestDialog.row.id) ?? [];
                    const estTotal = ests.length ? ests.reduce((s, e) => s + Number(e.subtotal || 0), 0) : null;
                    return (
                        <RequestBillingDialog
                            open
                            projectTitle={requestDialog.row.title || requestDialog.row.name || ''}
                            estimateAmount={requestDialog.row.estimateAmount}
                            invoicedAmount={requestDialog.row.invoicedAmount}
                            remainingAmount={requestDialog.row.remainingAmount}
                            estimateTotal={estTotal}
                            estimateCount={requestDialog.row.estimateCount}
                            estimates={ests}
                            billingTitles={billingTitles}
                            renderEstimatePdf={renderEstimatePdf}
                            onEditEstimate={canEdit ? handleEditEstimate : undefined}
                            profit={profit}
                            profitLoading={profitLoading}
                            submitting={requestSubmitting}
                            onClose={() => setRequestDialog(null)}
                            onConfirm={handleRequestConfirm}
                        />
                    );
                })()}

            {/* 見積編集モーダル（見積書メニューと同じフォーム）。
                EstimateModal は z-[70]・請求ダイアログは z-[80] なので、
                position:relative + z-[90] のラッパーで新しい重ね合わせコンテキストを作り、
                請求ダイアログを開いたまま確実にその上へ重ねる。 */}
            {editingEstimate && (
                <div className="relative z-[90]">
                    <EstimateModal
                        isOpen
                        onClose={() => setEditingEstimate(null)}
                        onSubmit={handleEstimateSubmit}
                        initialData={editingEstimate}
                    />
                </div>
            )}
        </div>
    );
}
