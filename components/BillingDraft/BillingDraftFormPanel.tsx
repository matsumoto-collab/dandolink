'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Plus, FileDown, Minus, List } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import ProjectContextSection from '@/components/BillingDraft/ProjectContextSection';
import ItemCard from '@/components/Estimates/ItemRow';
import SummaryFooter from '@/components/Estimates/SummaryFooter';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEstimates } from '@/hooks/useEstimates';
import { useInvoices } from '@/hooks/useInvoices';
import { useCompany } from '@/hooks/useCompany';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';
import { logger } from '@/lib/logger';
import type {
    BillingDraft,
    CreateBillingDraftInput,
    ProjectContext,
    UpdateBillingDraftInput,
} from '@/types/billingDraft';
import type { Customer } from '@/types/customer';
import type { ProjectMaster, Project } from '@/types/calendar';
import type { InvoiceItem, BillingTitle } from '@/types/invoice';
import type { EstimateItem } from '@/types/estimate';

interface BillingDraftFormPanelProps {
    /** パネルの開閉。false のときは何も描画しない（アニメーションのため Drawer/Sheet 側に open を渡す） */
    open: boolean;
    /** null = 新規作成モード、それ以外 = 編集モード */
    draft: BillingDraft | null;
    customers: Customer[];
    projectMasters: ProjectMaster[];
    onClose: () => void;
    onCreate: (data: CreateBillingDraftInput) => Promise<void>;
    onUpdate: (id: string, data: UpdateBillingDraftInput) => Promise<void>;
    /**
     * Phase 2: 新規作成モードのときに案件 ID を初期値として入れる（カレンダー右クリック / 案件詳細ボタンで使用）。
     * draft が指定されている（編集モード）ときは無視される。
     */
    initialProjectId?: string;
    /** Phase 2: 同じく顧客 ID を初期値として入れる。draft 指定時は無視。 */
    initialCustomerId?: string;
    /**
     * Phase 2: パネル上部に表示する案件サマリ（契約金額 / 過去合計 / 見積書 / 履歴）。
     * 未指定（請求予定タブからの起動時）は表示なし。
     */
    projectContext?: ProjectContext;
}

const TAX_RATE = 0.1;

/** 案件セレクト等の表示用：短縮名を優先（コンパクト表示）。 */
const projectLabel = (pm: ProjectMaster): string => pm.name || pm.title;

/**
 * 見出しの既定値：請求書のセクション見出しと同じ「正式名称」を使う。
 * title は name + 敬称 + 工事名称 の自動合成（例: 佐藤様邸 仮設工事）なので、
 * 短縮名(name)ではなく title を優先し、敬称・工事名称まで含めて初期表示する。
 */
const projectHeading = (pm: ProjectMaster): string => pm.title || pm.name || '';

let itemSeq = 0;
function newItemId(): string {
    itemSeq += 1;
    return `bd-item-${Date.now().toString(36)}-${itemSeq}`;
}

/** 空の明細行 */
function makeEmptyItem(): InvoiceItem {
    return { id: newItemId(), description: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, taxType: 'standard' };
}

/** 値引き行（仕切り書に倣い 数量 -1 × 単価 = マイナス金額） */
function makeDiscountItem(): InvoiceItem {
    return { id: newItemId(), description: '値引き', quantity: -1, unit: '', unitPrice: 0, amount: 0, taxType: 'standard' };
}

/** 見積明細 → 請求明細（請求で使わない原価・カテゴリは落とす。カテゴリは子に展開） */
function estimateItemToBilling(it: EstimateItem): InvoiceItem {
    return {
        id: newItemId(),
        description: it.description,
        specification: it.specification,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        amount: it.amount,
        taxType: it.taxType,
        notes: it.notes,
    };
}

function flattenEstimateItems(items: EstimateItem[]): InvoiceItem[] {
    const out: InvoiceItem[] = [];
    for (const it of items) {
        if (it.isCategory) {
            for (const child of it.children ?? []) out.push(estimateItemToBilling(child));
        } else {
            out.push(estimateItemToBilling(it));
        }
    }
    return out;
}

export default function BillingDraftFormPanel({
    open,
    draft,
    customers,
    projectMasters,
    onClose,
    onCreate,
    onUpdate,
    initialProjectId,
    initialCustomerId,
    projectContext,
}: BillingDraftFormPanelProps) {
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const isEdit = !!draft;
    const isEditableDraft = draft?.status === 'pending';
    const readOnly = isEdit && !isEditableDraft;

    const [projectId, setProjectId] = useState('');
    const [customerId, setCustomerId] = useState('');
    const [sectionTitle, setSectionTitle] = useState('');
    const [items, setItems] = useState<InvoiceItem[]>([]);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [billingTitles, setBillingTitles] = useState<BillingTitle[]>([]);
    const [billingTitleMenuOpen, setBillingTitleMenuOpen] = useState(false);

    // 案件を選んで開いた場合（カレンダー右クリック / 案件詳細 / 編集）は案件・顧客をコンパクト表示にする
    const preSelected = isEdit || !!initialProjectId;

    // 見積書（見積から引用 + PDF閲覧用）・請求書（PDF閲覧用）・会社情報（PDF用）。遅延ロード。
    const { estimates, ensureDataLoaded: ensureEstimatesLoaded } = useEstimates();
    const { invoices, ensureDataLoaded: ensureInvoicesLoaded } = useInvoices();
    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    useEffect(() => {
        if (!open) return;
        ensureEstimatesLoaded();
        ensureInvoicesLoaded();
        ensureCompanyLoaded();
    }, [open, ensureEstimatesLoaded, ensureInvoicesLoaded, ensureCompanyLoaded]);

    // 請求書項目マスタ（「請求書項目から追加」用）を開いたときに取得
    useEffect(() => {
        if (!open) return;
        fetch('/api/master-data/billing-titles')
            .then((r) => (r.ok ? r.json() : []))
            .then((data) => setBillingTitles(Array.isArray(data) ? data : []))
            .catch(() => {});
    }, [open]);

    // 「請求書項目から追加」ドロップダウンの外側クリックで閉じる
    useEffect(() => {
        if (!billingTitleMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (!(e.target as HTMLElement)?.closest('[data-billing-title-menu]')) {
                setBillingTitleMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [billingTitleMenuOpen]);

    // open / draft の変化に合わせてフォームを初期化。
    useEffect(() => {
        if (!open) return;
        if (draft) {
            setProjectId(draft.projectId);
            setCustomerId(draft.customerId);
            setSectionTitle(draft.title);
            setNote(draft.note ?? '');
            if (Array.isArray(draft.items) && draft.items.length > 0) {
                // 新モデル: 保存済み明細をそのまま編集
                setItems(draft.items.map((it) => ({ ...it, id: it.id || newItemId() })));
            } else if (draft.amount != null && Number(draft.amount) !== 0) {
                // 旧モデル（単一 title+amount）: 1 明細に変換して編集可能にする
                const amt = Number(draft.amount);
                setItems([{
                    id: newItemId(),
                    description: draft.title,
                    quantity: 1,
                    unit: '式',
                    unitPrice: amt,
                    amount: amt,
                    taxType: Number(draft.taxRate) > 0 ? 'standard' : 'none',
                }]);
            } else {
                setItems([]);
            }
        } else {
            setProjectId(initialProjectId ?? '');
            setCustomerId(initialCustomerId ?? '');
            setSectionTitle('');
            setItems([]);
            setNote('');
        }
    }, [open, draft, initialProjectId, initialCustomerId]);

    // 新規作成時のみ：案件選択で customerId を自動補完し、見出し未入力なら案件名を既定にする
    useEffect(() => {
        if (isEdit || !projectId) return;
        const pm = projectMasters.find((p) => p.id === projectId);
        if (pm?.customerId) setCustomerId(pm.customerId);
        setSectionTitle((prev) => (prev.trim() === '' && pm ? projectHeading(pm) : prev));
    }, [projectId, projectMasters, isEdit]);

    const selectedProject = useMemo(
        () => projectMasters.find((p) => p.id === projectId) ?? null,
        [projectMasters, projectId],
    );
    const selectedCustomer = useMemo(
        () => customers.find((c) => c.id === customerId) ?? null,
        [customers, customerId],
    );
    const projectEstimates = useMemo(
        () => estimates.filter((e) => e.projectId === projectId),
        [estimates, projectId],
    );

    // ── 見積書 / 請求書 PDF のインライン表示 ──────────────
    const [pdfPreview, setPdfPreview] = useState<{ url: string; title: string } | null>(null);
    const [pdfLoading, setPdfLoading] = useState(false);

    // PDF 生成用の一時 Project（選択中の案件マスタ＋顧客から組み立て。InvoiceForm と同じ方式）
    const pdfProject = useMemo(() => {
        const p: Project & { customerPostalCode?: string; customerAddress?: string } = {
            id: selectedProject?.id ?? '',
            title: selectedProject?.title ?? '',
            startDate: new Date(),
            category: 'construction',
            color: '#3B82F6',
            customer: selectedCustomer?.name ?? '',
            customerHonorific: selectedCustomer?.honorific ?? '御中',
            location: [selectedProject?.prefecture, selectedProject?.city, selectedProject?.location].filter(Boolean).join(''),
            customerPostalCode: selectedCustomer?.postalCode ?? '',
            customerAddress: selectedCustomer?.address ?? '',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        return p;
    }, [selectedProject, selectedCustomer]);

    const closePdfPreview = useCallback(() => {
        setPdfPreview((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return null;
        });
    }, []);
    useEffect(() => () => { if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url); }, [pdfPreview?.url]);

    const handleViewEstimate = useCallback(async (estimateId: string) => {
        const est = estimates.find((e) => e.id === estimateId);
        if (!est) { toast.error('見積書が見つかりません'); return; }
        if (!companyInfo) { toast.error('会社情報を読み込み中です。少し待って再度お試しください'); return; }
        try {
            setPdfLoading(true);
            const { generateEstimatePDFBlobReact } = await import('@/utils/reactPdfGenerator');
            const url = await generateEstimatePDFBlobReact(est, pdfProject, companyInfo, { creatorName: est.createdByName || '' });
            setPdfPreview({ url, title: `見積書　${est.estimateNumber}` });
        } catch (e) {
            logger.error('見積PDF生成エラー:', e);
            toast.error('PDF の生成に失敗しました');
        } finally {
            setPdfLoading(false);
        }
    }, [estimates, companyInfo, pdfProject]);

    const handleViewInvoice = useCallback(async (invoiceId: string) => {
        const inv = invoices.find((i) => i.id === invoiceId);
        if (!inv) { toast.error('請求書が見つかりません'); return; }
        if (!companyInfo) { toast.error('会社情報を読み込み中です。少し待って再度お試しください'); return; }
        try {
            setPdfLoading(true);
            const { generateInvoicePDFBlobReact } = await import('@/utils/reactPdfGenerator');
            const url = await generateInvoicePDFBlobReact(inv, pdfProject, companyInfo, inv.projectMasters, { includeCopy: true, includeDetails: false });
            setPdfPreview({ url, title: `請求書　${inv.invoiceNumber}` });
        } catch (e) {
            logger.error('請求書PDF生成エラー:', e);
            toast.error('PDF の生成に失敗しました');
        } finally {
            setPdfLoading(false);
        }
    }, [invoices, companyInfo, pdfProject]);

    // ── 明細操作 ───────────────────────────────────────
    const addItem = useCallback(() => setItems((prev) => [...prev, makeEmptyItem()]), []);
    const addDiscount = useCallback(() => setItems((prev) => [...prev, makeDiscountItem()]), []);

    const updateItem = useCallback(
        (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => {
            setItems((prev) =>
                prev.map((it) => {
                    if (it.id !== id) return it;
                    const updated = { ...it, [field]: value } as InvoiceItem;
                    if (field === 'quantity' || field === 'unitPrice') {
                        updated.amount = Math.round((updated.quantity || 0) * (updated.unitPrice || 0));
                    }
                    return updated;
                }),
            );
        },
        [],
    );

    const removeItem = useCallback((id: string) => setItems((prev) => prev.filter((it) => it.id !== id)), []);

    const moveUp = useCallback(
        (index: number) =>
            setItems((prev) => {
                if (index <= 0) return prev;
                const a = [...prev];
                [a[index - 1], a[index]] = [a[index], a[index - 1]];
                return a;
            }),
        [],
    );
    const moveDown = useCallback(
        (index: number) =>
            setItems((prev) => {
                if (index >= prev.length - 1) return prev;
                const a = [...prev];
                [a[index], a[index + 1]] = [a[index + 1], a[index]];
                return a;
            }),
        [],
    );

    const loadFromEstimate = useCallback(() => {
        if (projectEstimates.length === 0) {
            toast.error('この案件に紐づく見積書がありません');
            return;
        }
        const latest = [...projectEstimates].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];
        const loaded = flattenEstimateItems(latest.items ?? []);
        if (loaded.length === 0) {
            toast.error('見積書に明細がありません');
            return;
        }
        setItems((prev) => [...prev, ...loaded]);
        toast.success(`${latest.estimateNumber} の明細を読み込みました（不要な行は削除・まとめてください）`);
    }, [projectEstimates]);

    const addFromBillingTitle = useCallback((bt: BillingTitle) => {
        const qty = bt.quantity ?? 1;
        setItems((prev) => [
            ...prev,
            {
                id: newItemId(),
                description: bt.name,
                quantity: qty,
                unit: bt.unit || '式',
                unitPrice: 0,
                amount: 0,
                taxType: 'standard',
            },
        ]);
        setBillingTitleMenuOpen(false);
    }, []);

    // ── 合計（税別小計 / 消費税 / 税込）───────────────────
    const subtotal = useMemo(() => items.reduce((s, it) => s + (it.amount || 0), 0), [items]);
    const tax = useMemo(
        () =>
            Math.floor(
                items.filter((it) => it.taxType === 'standard').reduce((s, it) => s + (it.amount || 0), 0) * TAX_RATE,
            ),
        [items],
    );
    const total = subtotal + tax;

    const headingTrimmed = sectionTitle.trim();
    const canSubmit =
        !submitting && headingTrimmed.length > 0 && (isEdit ? isEditableDraft === true : !!projectId && !!customerId);

    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (!canSubmit) return;
            try {
                setSubmitting(true);
                // 完全に空の行（品名なし・金額0）は落とす。projectMasterId を付けて請求書のセクション化に備える。
                const payloadItems = items
                    .filter((it) => it.description.trim() !== '' || (it.amount || 0) !== 0)
                    .map((it) => ({ ...it, projectMasterId: projectId }));
                if (isEdit && draft) {
                    await onUpdate(draft.id, {
                        title: headingTrimmed,
                        items: payloadItems,
                        note: note.trim() === '' ? null : note.trim(),
                    });
                    toast.success('請求予定を更新しました');
                } else {
                    await onCreate({
                        projectId,
                        customerId,
                        title: headingTrimmed,
                        items: payloadItems,
                        note: note.trim() === '' ? null : note.trim(),
                    });
                    toast.success('請求予定を作成しました');
                }
                onClose();
            } catch (err) {
                logger.error('Failed to submit billing draft:', err);
                toast.error(err instanceof Error ? err.message : '保存に失敗しました');
            } finally {
                setSubmitting(false);
            }
        },
        [canSubmit, items, projectId, customerId, isEdit, draft, headingTrimmed, note, onUpdate, onCreate, onClose],
    );

    const headerTitle = isEdit ? '請求予定の編集' : '請求予定の新規作成';
    const submitLabel = isEdit ? '更新' : '保存して請求予定へ追加';

    const formBody = (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Phase 2 起動経路：案件サマリ（契約金額・過去合計・見積書・履歴） */}
            {projectContext && (
                <ProjectContextSection
                    projectContext={projectContext}
                    onViewEstimate={handleViewEstimate}
                    onViewInvoice={handleViewInvoice}
                />
            )}

            {/* 編集モードかつ pending でないときは注意書き */}
            {readOnly && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {draft?.status === 'confirmed'
                        ? '確定済みのため編集できません。内容は閲覧のみです。'
                        : 'キャンセル済みのため編集できません。内容は閲覧のみです。'}
                </div>
            )}

            {/* 案件・顧客：案件を選んで開いた場合（カレンダー/案件詳細/編集）はコンパクト1行で縦を節約。
                請求予定タブからの新規作成（案件未選択）のときだけ選択 UI を出す。 */}
            {preSelected ? (
                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs">
                    <span className="font-semibold text-slate-700">{selectedCustomer?.name ?? '顧客未設定'}</span>
                    <span className="text-slate-300">/</span>
                    <span className="text-slate-600">{selectedProject ? projectLabel(selectedProject) : '—'}</span>
                </div>
            ) : (
                <>
                    {/* 案件 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            案件 <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            required
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                        >
                            <option value="">案件を選択...</option>
                            {projectMasters.map((pm) => (
                                <option key={pm.id} value={pm.id}>
                                    {projectLabel(pm)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* 顧客 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            顧客 <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={customerId}
                            onChange={(e) => setCustomerId(e.target.value)}
                            required
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                        >
                            <option value="">顧客を選択...</option>
                            {customers.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        {selectedProject?.customerId && (
                            <p className="text-xs text-slate-500 mt-1">
                                案件選択時に自動で設定されます。必要に応じて変更できます。
                            </p>
                        )}
                    </div>
                </>
            )}

            {/* 見出し（請求書の現場名） */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    見出し（請求書の現場名）<span className="text-red-500">*</span>
                </label>
                {readOnly ? (
                    <div className="text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
                        {sectionTitle || '—'}
                    </div>
                ) : (
                    <input
                        type="text"
                        value={sectionTitle}
                        onChange={(e) => setSectionTitle(e.target.value)}
                        required
                        maxLength={200}
                        placeholder={selectedProject ? projectHeading(selectedProject) : '例：○○邸 仮設工事'}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                    />
                )}
                <p className="text-xs text-slate-500 mt-1">請求書ではこの見出しの下に明細が並びます（既定は案件名）。</p>
            </div>

            {/* 明細 */}
            <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <label className="text-sm font-medium text-slate-700">
                        明細
                        <span className="ml-1 text-xs font-normal text-slate-400">請求書にそのまま出ます</span>
                    </label>
                    {!readOnly && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {projectEstimates.length > 0 && (
                                <button
                                    type="button"
                                    onClick={loadFromEstimate}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    <FileDown className="w-3.5 h-3.5" /> 見積から引用
                                </button>
                            )}
                            <div className="relative" data-billing-title-menu>
                                <button
                                    type="button"
                                    onClick={() => setBillingTitleMenuOpen((v) => !v)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    <List className="w-3.5 h-3.5" /> 請求書項目から追加
                                </button>
                                {billingTitleMenuOpen && (
                                    <div className="absolute left-0 z-50 mt-1 w-56 bg-white border border-slate-300 rounded-lg shadow-lg">
                                        {billingTitles.length > 0 ? (
                                            <ul className="max-h-52 overflow-y-auto py-1">
                                                {billingTitles.map((bt) => (
                                                    <li
                                                        key={bt.id}
                                                        className="px-3 py-2 hover:bg-slate-100 cursor-pointer text-sm text-slate-700"
                                                        onClick={() => addFromBillingTitle(bt)}
                                                    >
                                                        {bt.name}
                                                        {(bt.quantity != null || bt.unit) && (
                                                            <span className="ml-1 text-slate-400">
                                                                ({bt.quantity != null ? bt.quantity : ''}{bt.unit ? ` ${bt.unit}` : ''})
                                                            </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="px-3 py-2 text-xs text-slate-500">請求書項目マスタがありません</div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={addDiscount}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                            >
                                <Minus className="w-3.5 h-3.5" /> 値引き
                            </button>
                            <button
                                type="button"
                                onClick={addItem}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> 行追加
                            </button>
                        </div>
                    )}
                </div>

                {readOnly ? (
                    items.length === 0 ? (
                        <p className="text-sm text-slate-400 py-3 text-center">明細がありません</p>
                    ) : (
                        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                            {items.map((it) => (
                                <div key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                                    <span className="flex-1 min-w-0 truncate text-slate-700">{it.description || '—'}</span>
                                    <span className="text-xs text-slate-500 whitespace-nowrap">
                                        {it.quantity}
                                        {it.unit} × ¥{(it.unitPrice || 0).toLocaleString()}
                                    </span>
                                    <span
                                        className={`w-24 text-right font-medium ${it.amount < 0 ? 'text-red-600' : 'text-slate-800'}`}
                                    >
                                        {it.amount < 0
                                            ? `-¥${Math.abs(it.amount).toLocaleString()}`
                                            : `¥${it.amount.toLocaleString()}`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )
                ) : items.length === 0 ? (
                    <div className="border border-dashed border-slate-300 rounded-xl px-4 py-6 text-center">
                        <p className="text-sm text-slate-500">明細がありません。</p>
                        <p className="text-xs text-slate-400 mt-1">
                            「行追加」または「見積から引用」で明細を追加してください。
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.map((it, index) => (
                            <ItemCard
                                key={it.id}
                                item={it}
                                index={index}
                                totalItems={items.length}
                                onUpdate={updateItem}
                                onRemove={removeItem}
                                onMoveUp={moveUp}
                                onMoveDown={moveDown}
                            />
                        ))}
                    </div>
                )}

                {items.length > 0 && (
                    <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
                        <SummaryFooter subtotal={subtotal} tax={tax} total={total} />
                    </div>
                )}
            </div>

            {/* メモ */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">メモ</label>
                {readOnly ? (
                    <div className="text-sm text-slate-600 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200 whitespace-pre-wrap min-h-[2.5rem]">
                        {note || '—'}
                    </div>
                ) : (
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        placeholder="補足情報など（任意）"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white resize-y"
                    />
                )}
            </div>

            {/* アクション */}
            <div className="pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                    キャンセル
                </Button>
                {!readOnly && (
                    <Button type="submit" variant="primary" disabled={!canSubmit} isLoading={submitting}>
                        {submitLabel}
                    </Button>
                )}
            </div>

        </form>
    );

    const pdfOverlay = (pdfPreview || pdfLoading) ? (
        <div className="fixed inset-0 lg:left-48 z-[80] bg-black/70 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
                <h3 className="text-base font-semibold text-slate-800">{pdfPreview?.title ?? 'PDF を生成しています…'}</h3>
                <button
                    type="button"
                    onClick={closePdfPreview}
                    className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                    aria-label="閉じる"
                >
                    <X className="w-6 h-6" />
                </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100">
                {pdfPreview ? (
                    <InlinePdfViewer url={pdfPreview.url} />
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-600" />
                    </div>
                )}
            </div>
        </div>
    ) : null;

    // 媒体サイズが確定するまでは描画しない（PC/モバイル切替時のチラつき回避）
    if (isDesktop === null) return null;

    if (isDesktop) {
        return (
            <>
                <SideDrawer open={open} onClose={onClose} title={headerTitle}>
                    {formBody}
                </SideDrawer>
                {pdfOverlay}
            </>
        );
    }

    return (
        <>
            <BottomSheet open={open} onClose={onClose} title={headerTitle}>
                {formBody}
            </BottomSheet>
            {pdfOverlay}
        </>
    );
}

interface SideDrawerProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}

/** PC 用：右からスライドインするドロワー。BottomSheet と対になるラッパー。 */
function SideDrawer({ open, onClose, title, children }: SideDrawerProps) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    return (
        <>
            <div
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
                    open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
                aria-hidden
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="billing-draft-panel-title"
                className={`fixed top-0 right-0 z-50 h-full w-full max-w-[720px] bg-white shadow-2xl border-l border-slate-200 transition-transform duration-200 ease-out ${
                    open ? 'translate-x-0' : 'translate-x-full'
                } flex flex-col`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
                    <h3 id="billing-draft-panel-title" className="text-base font-semibold text-slate-900">
                        {title}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            </div>
        </>
    );
}
