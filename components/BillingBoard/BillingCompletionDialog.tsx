'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * この案件の請求が今回で終わりか（請求書の発行後に ProjectMaster.billingStatusOverride へ書き込む値）。
 * 'full' = 請求完了（請求済みにする） / 'partial' = まだ続く（一部請求にする）。
 */
export type BillingCompletion = 'full' | 'partial';

/** 確認ダイアログに並べる案件（請求書に含まれる案件）。 */
export interface BillingCompletionTarget {
    id: string;
    /** 表示名（正式名称 or 現場名）。 */
    title: string;
}

/** 請求先の切り替え候補（顧客マスタ）。 */
export interface BillingCustomerOption {
    id: string;
    name: string;
    shortName?: string | null;
}

interface BillingCompletionDialogProps {
    open: boolean;
    projects: BillingCompletionTarget[];
    /** 既存請求書への追記か（見出しの文言だけ変える）。 */
    isAppend?: boolean;
    submitting?: boolean;
    /** 案件の元請（＝ボードのグループ顧客）。請求先の既定値。 */
    sourceCustomerId: string;
    /** 元請の表示名（請求先を変えたときの注意書きに出す）。 */
    sourceCustomerName: string;
    /** 請求先に選べる顧客の一覧。 */
    customers: BillingCustomerOption[];
    onCancel: () => void;
    onConfirm: (completions: Record<string, BillingCompletion>, billingCustomerId: string) => void;
}

const OPTIONS: Array<{ value: BillingCompletion; label: string; hint: string }> = [
    { value: 'full', label: '請求完了', hint: '請求済みにする' },
    { value: 'partial', label: 'まだ続く', hint: '一部請求にする' },
];

/**
 * 請求書を発行する直前に、含まれる案件ごとに「請求完了／まだ続く」を必ず選ばせる確認ダイアログ。
 * 既定は常に未選択（過去の手動設定はプレフィルしない）。全案件を選ぶまで確定できない。
 *
 * ここで「請求先」も切り替えられる（A社の現場を、A社の依頼でB社へ請求するケース）。
 * 変えるのは請求書の宛名だけで、案件の元請（ProjectMaster.customerId）は触らない
 * ＝見積書の宛名・完了報告のLINE・元請表示・利益の顧客別集計は元請のまま保たれる。
 */
export default function BillingCompletionDialog({
    open,
    projects,
    isAppend,
    submitting,
    sourceCustomerId,
    sourceCustomerName,
    customers,
    onCancel,
    onConfirm,
}: BillingCompletionDialogProps) {
    const [choices, setChoices] = useState<Record<string, BillingCompletion>>({});
    // 請求先（宛名）。既定は元請。変更すると請求書の customerId だけがこの顧客になる。
    const [billingCustomerId, setBillingCustomerId] = useState(sourceCustomerId);

    // 開くたびに未選択へ戻す（前回の選択やDBの手動設定は引き継がない）。請求先も元請に戻す。
    useEffect(() => {
        if (!open) return;
        setChoices({});
        setBillingCustomerId(sourceCustomerId);
    }, [open, sourceCustomerId]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onCancel]);

    if (!open) return null;

    const remaining = projects.filter((p) => !choices[p.id]).length;
    // 請求先を元請から変えたか。変えた場合は既存請求書へのまとめ（追記）はせず、必ず新規で発行する
    // ＝元請の違う案件が1枚の請求書に混ざらないようにする。
    const redirected = !!billingCustomerId && billingCustomerId !== sourceCustomerId;
    const effectiveAppend = !!isAppend && !redirected;
    const billingCustomerName =
        customers.find((c) => c.id === billingCustomerId)?.name || sourceCustomerName;
    // 顧客一覧がまだ読み込めていなくても元請だけは必ず選択肢に出す（セレクトが空欄にならないように）
    const options = customers.some((c) => c.id === sourceCustomerId)
        ? customers
        : [{ id: sourceCustomerId, name: sourceCustomerName }, ...customers];

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
                <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-slate-900">
                            {effectiveAppend ? '当月の請求書に追記します' : '請求書を作成します'}
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                            案件ごとに、今回で請求が終わりかどうかを選んでください（案件の請求バッジに反映します）。
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                        aria-label="閉じる"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    {/* 請求先（宛名）。既定は案件の元請。A社の依頼でB社へ請求する場合だけ変更する。 */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <label htmlFor="billing-customer" className="block text-xs font-medium text-slate-600">
                            請求先（宛名）
                        </label>
                        <select
                            id="billing-customer"
                            value={billingCustomerId}
                            onChange={(e) => setBillingCustomerId(e.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
                        >
                            {options.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                    {c.id === sourceCustomerId ? '（元請）' : ''}
                                </option>
                            ))}
                        </select>
                        {redirected ? (
                            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                                この請求書の宛名は「{billingCustomerName}」になります。案件の元請は「{sourceCustomerName}」のまま変わりません
                                （見積書の宛名・完了報告の連絡先・案件一覧の表示は元請のままです）。
                                {isAppend ? '元請の当月請求書へのまとめはせず、単独の請求書として発行します。' : ''}
                            </p>
                        ) : (
                            <p className="mt-1.5 text-[11px] text-slate-500">
                                元請と違う会社に請求する場合だけ変更してください。
                            </p>
                        )}
                    </div>

                    {projects.map((p) => (
                        <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                            <div className="truncate text-sm font-medium text-slate-800">{p.title}</div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {OPTIONS.map((o) => (
                                    <label
                                        key={o.value}
                                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                                            choices[p.id] === o.value
                                                ? 'border-teal-500 bg-teal-50'
                                                : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name={`billing-completion-${p.id}`}
                                            className="mt-0.5"
                                            checked={choices[p.id] === o.value}
                                            onChange={() => setChoices((prev) => ({ ...prev, [p.id]: o.value }))}
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-medium text-slate-800">{o.label}</span>
                                            <span className="block text-[11px] text-slate-500">{o.hint}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
                    <span className="text-xs text-slate-500">
                        {remaining > 0 ? `未選択 ${remaining}件` : `${projects.length}件すべて選択済み`}
                    </span>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                            キャンセル
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => onConfirm(choices, billingCustomerId || sourceCustomerId)}
                            disabled={submitting || remaining > 0 || projects.length === 0 || !billingCustomerId}
                            isLoading={submitting}
                        >
                            {effectiveAppend ? '追記へ進む' : '請求書へ進む'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
