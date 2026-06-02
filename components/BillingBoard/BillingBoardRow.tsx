'use client';

import React, { useState } from 'react';
import { CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { BillingBoardRow as Row } from '@/types/billingBoard';

const yen = (n: number | null) => (n == null ? '—' : `¥${Math.round(n).toLocaleString()}`);
const md = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 請求状況バッジ（'full' はボードに出ないが念のため定義）。案件一覧の 3 段階表示に準拠。 */
const BILLING_BADGE: Record<string, { text: string; cls: string }> = {
    none: { text: '契約未設定', cls: 'bg-slate-100 text-slate-500' },
    unbilled: { text: '未請求', cls: 'bg-slate-100 text-slate-600' },
    partial: { text: '一部請求', cls: 'bg-amber-100 text-amber-700' },
    full: { text: '請求済', cls: 'bg-emerald-100 text-emerald-700' },
};

/** マスタに無いレガシー工事種別値のフォールバック（マスタ既定色に合わせる）。 */
const LEGACY_CTYPE: Record<string, { name: string; color: string }> = {
    assembly: { name: '組立', color: '#a8c8e8' },
    demolition: { name: '解体', color: '#f0a8a8' },
    other: { name: 'その他', color: '#fef08a' },
};

type CtypeMap = Record<string, { name: string; color: string }>;

function resolveCtype(id: string, map: CtypeMap): { name: string; color: string } {
    return map[id] ?? LEGACY_CTYPE[id] ?? { name: id, color: '#94a3b8' };
}

/** 工事種別チップ（マスタ色のドット＋名称）。 */
function CTypeChip({ id, map, small }: { id: string; map: CtypeMap; small?: boolean }) {
    const c = resolveCtype(id, map);
    return (
        <span
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium ${
                small ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[10px]'
            }`}
            style={{ borderColor: c.color, backgroundColor: `${c.color}22`, color: '#334155' }}
        >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
            {c.name}
        </span>
    );
}

interface BillingBoardRowProps {
    row: Row;
    /** 担当者の表示名（"山本、鈴木" など。未解決なら空文字）。 */
    assigneeNames: string;
    /** 工事種別 ID → 名称・色（/api/master-data/construction-types 由来）。 */
    ctypeMap: CtypeMap;
    /** User ID → 表示名（職長名の解決用、/api/users 由来）。 */
    userMap: Record<string, string>;
    /** この行で操作実行中はボタンを無効化。 */
    busy?: boolean;
    tab: 'pending' | 'hold' | 'excluded';
    onRequest: (row: Row) => void;
    onHold: (row: Row) => void;
    onExclude: (row: Row) => void;
    onRestore: (row: Row) => void;
}

const COLLAPSED_COUNT = 3;

export default function BillingBoardRow({
    row,
    assigneeNames,
    ctypeMap,
    userMap,
    busy,
    tab,
    onRequest,
    onHold,
    onExclude,
    onRestore,
}: BillingBoardRowProps) {
    const badge = BILLING_BADGE[row.billingStatus] ?? BILLING_BADGE.unbilled;
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? row.workHistory : row.workHistory.slice(0, COLLAPSED_COUNT);

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                {/* 左：案件情報 */}
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold text-slate-900">
                            {row.title || row.name}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                            {badge.text}
                        </span>
                        {row.status === 'completed' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                                <CheckCircle2 className="h-3 w-3" /> 完了
                            </span>
                        )}
                        {row.estimateCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                <FileText className="h-3 w-3" /> 見積{row.estimateCount}
                                {row.hasApprovedEstimate ? '・承認あり' : ''}
                            </span>
                        )}
                        {/* 工事種別チップ（色付き） */}
                        {row.constructionTypeIds.map((id) => (
                            <CTypeChip key={id} id={id} map={ctypeMap} />
                        ))}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span>{row.customerName || '顧客未設定'}</span>
                        <span>担当: {assigneeNames || '—'}</span>
                        <span>最終作業 {md(row.lastWorkDate)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                        <span className="text-slate-500">
                            契約 <span className="font-medium text-slate-700">{yen(row.contractAmount)}</span>
                        </span>
                        <span className="text-slate-500">
                            請求済 <span className="font-medium text-slate-700">{yen(row.invoicedAmount)}</span>
                        </span>
                        <span className="text-slate-500">
                            残 <span className="font-semibold text-slate-900">{yen(row.remainingAmount)}</span>
                        </span>
                    </div>
                </div>

                {/* 右：判断アクション（既に請求予定があるときは「請求する」を出さず重複起票を防ぐ） */}
                <div className="flex flex-shrink-0 items-center gap-2">
                    {row.hasPendingDraft && (
                        <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                            請求予定あり
                        </span>
                    )}
                    {tab === 'pending' && (
                        <>
                            {!row.hasPendingDraft && (
                                <Button type="button" variant="primary" onClick={() => onRequest(row)} disabled={busy}>
                                    請求する
                                </Button>
                            )}
                            <Button type="button" variant="outline" onClick={() => onHold(row)} disabled={busy}>
                                まだ
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => onExclude(row)} disabled={busy}>
                                対象外
                            </Button>
                        </>
                    )}
                    {tab === 'hold' && (
                        <>
                            {!row.hasPendingDraft && (
                                <Button type="button" variant="primary" onClick={() => onRequest(row)} disabled={busy}>
                                    請求する
                                </Button>
                            )}
                            <Button type="button" variant="outline" onClick={() => onRestore(row)} disabled={busy}>
                                判断に戻す
                            </Button>
                        </>
                    )}
                    {tab === 'excluded' && (
                        <Button type="button" variant="outline" onClick={() => onRestore(row)} disabled={busy}>
                            判断に戻す
                        </Button>
                    )}
                </div>
            </div>

            {/* 作業履歴（期間内・直近順。多いときは折りたたみ） */}
            {row.workHistory.length > 0 && (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="mb-1 text-[11px] font-medium text-slate-500">作業履歴（{row.workCount}件）</div>
                    <div className="space-y-1">
                        {shown.map((w, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="w-10 shrink-0 tabular-nums text-slate-500">{md(w.date)}</span>
                                {w.constructionType ? (
                                    <CTypeChip id={w.constructionType} map={ctypeMap} small />
                                ) : (
                                    <span className="text-slate-300">—</span>
                                )}
                                <span className="truncate text-slate-600">
                                    {(w.foremanId && userMap[w.foremanId]) || '—'}
                                    {w.memberCount ? `（${w.memberCount}名）` : ''}
                                </span>
                            </div>
                        ))}
                    </div>
                    {row.workCount > COLLAPSED_COUNT && (
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="mt-1 text-[11px] font-medium text-teal-700 hover:underline"
                        >
                            {expanded ? '閉じる' : `他 ${row.workCount - COLLAPSED_COUNT} 件を表示`}
                        </button>
                    )}
                    {expanded && row.workCount > row.workHistory.length && (
                        <div className="mt-1 text-[11px] text-slate-400">
                            最新 {row.workHistory.length} 件を表示（ほか {row.workCount - row.workHistory.length} 件）
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
