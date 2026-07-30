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
    /** 請求判断（まだ/対象外/請求済み/判断に戻す）を変更できるか。締め分モードのみ true（任意範囲は閲覧専用）。 */
    canDecide: boolean;
    tab: 'pending' | 'hold' | 'excluded' | 'billed';
    /** ボード上の請求対象（クライアント保持・null=未選択）。請求書発行までの選択を表す。 */
    staged?: { amount: number; note?: string } | null;
    onRequest: (row: Row) => void;
    /** 手動で「請求済み」にする（実請求の有無に依らず請求済みタブへ送る）。 */
    onMarkBilled: (row: Row) => void;
    onUnstage?: (row: Row) => void;
    /** 見積が複数で見積金額が未設定のとき「見積を選択」を押した。 */
    onPickEstimate?: (row: Row) => void;
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
    canDecide,
    staged,
    onRequest,
    onMarkBilled,
    onUnstage,
    onPickEstimate,
    onHold,
    onExclude,
    onRestore,
}: BillingBoardRowProps) {
    const badge = BILLING_BADGE[row.billingStatus] ?? BILLING_BADGE.unbilled;
    const [expanded, setExpanded] = useState(false);
    const shown = expanded ? row.workHistory : row.workHistory.slice(0, COLLAPSED_COUNT);

    return (
        <div className={`p-4 transition-colors ${staged ? 'bg-teal-50/50' : 'hover:bg-slate-50/60'}`}>
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
                            見積金額{' '}
                            {row.needsEstimatePick ? (
                                <button
                                    type="button"
                                    onClick={() => onPickEstimate?.(row)}
                                    className="font-medium text-teal-700 hover:underline"
                                >
                                    見積を選択
                                </button>
                            ) : row.estimateCount > 1 && onPickEstimate ? (
                                // 見積が複数ある案件は金額自体を押して選び直せる（旧スナップショットから
                                // 「見積書に追従」へ移行するため。選び直すと見積の現在値で再計算される）
                                <button
                                    type="button"
                                    onClick={() => onPickEstimate(row)}
                                    title="どの見積を見積金額にするか選び直す"
                                    className="font-medium text-slate-700 underline decoration-dotted underline-offset-2 hover:text-teal-700"
                                >
                                    {yen(row.estimateAmount)}
                                </button>
                            ) : (
                                <span className="font-medium text-slate-700">{yen(row.estimateAmount)}</span>
                            )}
                        </span>
                        <span className="text-slate-500">
                            請求済 <span className="font-medium text-slate-700">{yen(row.invoicedAmount)}</span>
                        </span>
                        <span className="text-slate-500">
                            残 <span className="font-semibold text-slate-900">{yen(row.remainingAmount)}</span>
                        </span>
                    </div>
                </div>

                {/* 右：請求済み=請求額(full)/手動マーク／請求対象=金額+取消／それ以外=判断ボタン */}
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                    {tab === 'billed' ? (
                        row.monthlyInvoicedAmount > 0 ? (
                            <div className="text-right">
                                <div className="text-[10px] text-slate-500">この月の請求(税抜)</div>
                                <div className="text-lg font-bold text-emerald-700">{yen(row.monthlyInvoicedAmount)}</div>
                            </div>
                        ) : (
                            // 手動で「請求済み」にした案件（実際の請求書とは無関係）。判断に戻せるようにする。
                            <>
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                    <CheckCircle2 className="h-3 w-3" /> 手動で請求済み
                                </span>
                                {canDecide && (
                                    <Button type="button" variant="outline" onClick={() => onRestore(row)} disabled={busy}>
                                        判断に戻す
                                    </Button>
                                )}
                            </>
                        )
                    ) : staged ? (
                        <>
                            <div className="text-right">
                                <div className="text-[10px] text-slate-500">
                                    請求対象(税抜){staged.note ? `・${staged.note}` : ''}
                                </div>
                                <div className="text-base font-bold text-teal-700">{yen(staged.amount)}</div>
                            </div>
                            <Button type="button" variant="ghost" onClick={() => onUnstage?.(row)} disabled={busy}>
                                取消
                            </Button>
                        </>
                    ) : (
                        <>
                            {(tab === 'pending' || tab === 'hold') && (
                                <>
                                    <Button type="button" variant="primary" onClick={() => onRequest(row)} disabled={busy}>
                                        請求する
                                    </Button>
                                    {/* 手動で「請求済み」に（社外請求済み等）。請求済みタブへ送る。色は請求済バッジに合わせ緑系 */}
                                    {canDecide && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => onMarkBilled(row)}
                                            disabled={busy}
                                            leftIcon={<CheckCircle2 className="h-4 w-4" />}
                                            className="!border-emerald-300 !text-emerald-700 hover:!border-emerald-400 hover:!bg-emerald-50 focus:!ring-emerald-400"
                                        >
                                            請求済み
                                        </Button>
                                    )}
                                </>
                            )}
                            {canDecide && tab === 'pending' && (
                                <>
                                    <Button type="button" variant="outline" onClick={() => onHold(row)} disabled={busy}>
                                        まだ
                                    </Button>
                                    <Button type="button" variant="ghost" onClick={() => onExclude(row)} disabled={busy}>
                                        対象外
                                    </Button>
                                </>
                            )}
                            {canDecide && (tab === 'hold' || tab === 'excluded') && (
                                <Button type="button" variant="outline" onClick={() => onRestore(row)} disabled={busy}>
                                    判断に戻す
                                </Button>
                            )}
                        </>
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
