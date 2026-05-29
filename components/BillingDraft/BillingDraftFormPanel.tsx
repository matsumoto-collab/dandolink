'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import BottomSheet from '@/components/ui/BottomSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { logger } from '@/lib/logger';
import type {
    BillingDraft,
    CreateBillingDraftInput,
    UpdateBillingDraftInput,
} from '@/types/billingDraft';
import type { Customer } from '@/types/customer';
import type { ProjectMaster } from '@/types/calendar';

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
}

const TAX_RATE_OPTIONS = [
    { value: '0.10', label: '10%' },
    { value: '0.08', label: '8%' },
    { value: '0.00', label: '0%（非課税）' },
];

const projectLabel = (pm: ProjectMaster): string => pm.name || pm.title;

export default function BillingDraftFormPanel({
    open,
    draft,
    customers,
    projectMasters,
    onClose,
    onCreate,
    onUpdate,
}: BillingDraftFormPanelProps) {
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const isEdit = !!draft;
    const isEditableDraft = draft?.status === 'pending';

    const [projectId, setProjectId] = useState('');
    const [customerId, setCustomerId] = useState('');
    const [title, setTitle] = useState('');
    const [amount, setAmount] = useState('');
    const [taxRate, setTaxRate] = useState('0.10');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // open / draft の変化に合わせてフォームを初期化
    useEffect(() => {
        if (!open) return;
        if (draft) {
            setProjectId(draft.projectId);
            setCustomerId(draft.customerId);
            setTitle(draft.title);
            setAmount(draft.amount != null ? String(draft.amount) : '');
            setTaxRate(draft.taxRate != null ? String(draft.taxRate) : '0.10');
            setNote(draft.note ?? '');
        } else {
            setProjectId('');
            setCustomerId('');
            setTitle('');
            setAmount('');
            setTaxRate('0.10');
            setNote('');
        }
    }, [open, draft]);

    // 新規作成時のみ、案件選択で customerId を自動補完
    useEffect(() => {
        if (isEdit) return;
        if (!projectId) return;
        const pm = projectMasters.find((p) => p.id === projectId);
        if (pm?.customerId) {
            setCustomerId(pm.customerId);
        }
    }, [projectId, projectMasters, isEdit]);

    const selectedProject = useMemo(
        () => projectMasters.find((p) => p.id === projectId) ?? null,
        [projectMasters, projectId],
    );
    const selectedCustomer = useMemo(
        () => customers.find((c) => c.id === customerId) ?? null,
        [customers, customerId],
    );

    const titleTrimmed = title.trim();
    const canSubmit = !submitting && titleTrimmed.length > 0 && (
        isEdit ? isEditableDraft === true : !!projectId && !!customerId
    );

    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (!canSubmit) return;
            try {
                setSubmitting(true);
                if (isEdit && draft) {
                    await onUpdate(draft.id, {
                        title: titleTrimmed,
                        amount: amount.trim() === '' ? null : amount.trim(),
                        taxRate: taxRate.trim() || '0.10',
                        note: note.trim() === '' ? null : note.trim(),
                    });
                    toast.success('請求予定を更新しました');
                } else {
                    await onCreate({
                        projectId,
                        customerId,
                        title: titleTrimmed,
                        amount: amount.trim() === '' ? null : amount.trim(),
                        taxRate: taxRate.trim() || '0.10',
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
        [canSubmit, isEdit, draft, titleTrimmed, amount, taxRate, note, projectId, customerId, onUpdate, onCreate, onClose],
    );

    const headerTitle = isEdit ? '請求予定の編集' : '請求予定の新規作成';
    const submitLabel = isEdit ? '更新' : '保存して請求予定へ追加';

    const formBody = (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* 編集モードかつ pending でないときは注意書き */}
            {isEdit && !isEditableDraft && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {draft?.status === 'confirmed'
                        ? '確定済みのため編集できません。内容は閲覧のみです。'
                        : 'キャンセル済みのため編集できません。内容は閲覧のみです。'}
                </div>
            )}

            {/* 案件 */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    案件 <span className="text-red-500">*</span>
                </label>
                {isEdit ? (
                    <div className="text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
                        {selectedProject ? projectLabel(selectedProject) : '—'}
                    </div>
                ) : (
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
                )}
            </div>

            {/* 顧客 */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    顧客 <span className="text-red-500">*</span>
                </label>
                {isEdit ? (
                    <div className="text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2 border border-slate-200">
                        {selectedCustomer?.name ?? '—'}
                    </div>
                ) : (
                    <>
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
                    </>
                )}
            </div>

            {/* タイトル */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                    タイトル <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    maxLength={200}
                    disabled={isEdit && !isEditableDraft}
                    placeholder="例：○○邸 着手金"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
                />
            </div>

            {/* 金額 + 税率 */}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">金額（税抜）</label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        disabled={isEdit && !isEditableDraft}
                        placeholder="例：100000"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
                    />
                    <p className="text-xs text-slate-500 mt-1">未入力で保存可（後から編集できます）</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">税率</label>
                    <select
                        value={taxRate}
                        onChange={(e) => setTaxRate(e.target.value)}
                        disabled={isEdit && !isEditableDraft}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white disabled:bg-slate-50 disabled:text-slate-500"
                    >
                        {TAX_RATE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* メモ */}
            <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">メモ</label>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    disabled={isEdit && !isEditableDraft}
                    placeholder="補足情報など（任意）"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white disabled:bg-slate-50 disabled:text-slate-500 resize-y"
                />
            </div>

            {/* アクション */}
            <div className="pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                    キャンセル
                </Button>
                {(!isEdit || isEditableDraft) && (
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={!canSubmit}
                        isLoading={submitting}
                    >
                        {submitLabel}
                    </Button>
                )}
            </div>
        </form>
    );

    // 媒体サイズが確定するまでは描画しない（PC/モバイル切替時のチラつき回避）
    if (isDesktop === null) return null;

    if (isDesktop) {
        return (
            <SideDrawer open={open} onClose={onClose} title={headerTitle}>
                {formBody}
            </SideDrawer>
        );
    }

    return (
        <BottomSheet open={open} onClose={onClose} title={headerTitle}>
            {formBody}
        </BottomSheet>
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
                className={`fixed top-0 right-0 z-50 h-full w-full max-w-[520px] bg-white shadow-2xl border-l border-slate-200 transition-transform duration-200 ease-out ${
                    open ? 'translate-x-0' : 'translate-x-full'
                } flex flex-col`}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
                    <h3
                        id="billing-draft-panel-title"
                        className="text-base font-semibold text-slate-900"
                    >
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
