'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Settings, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import { logger } from '@/lib/logger';
import { buildDefaultItems, computeJoyoTotals } from '@/lib/joyoStatement';
import type { JoyoStatementRow, JoyoStatementsResponse } from '@/types/joyoStatement';
import JoyoStatementEditor from './JoyoStatementEditor';
import JoyoSettingsModal from './JoyoSettingsModal';
import AddJoyoToScheduleModal from './AddJoyoToScheduleModal';
import { JOYO_STATE_META, errorMessage, formatMd, formatMdWeek, previousMonthJst, yen } from './joyoUi';

/** 単価の列: 明細に「常用（全日）」の行があればその単価、無ければ対象者の単価 */
function rowUnitPrice(row: JoyoStatementRow): number {
    const full = row.statement?.items.find((it) => it.kind === 'full');
    return full ? full.unitPrice : row.contractor.unitPrice;
}

/** 設定モーダルの開き方 */
interface SettingsState {
    startWithNewContractor: boolean;
}

/**
 * 支払明細書（常用で来ている一人親方向け）の一覧（指示書 8-1）。
 * 月を選ぶ → 対象者ごとに出勤簿の日数・金額・状態が並ぶ → ［開く］で編集画面。
 * 保存などが成功するたびに一覧（GET）を取り直し、編集画面は取り直した一覧から同じ対象者の行を読み直す。
 */
export default function JoyoStatementsPage() {
    const { data: session } = useSession();
    const role = (session?.user?.role ?? '').toLowerCase();
    const canView = role === 'admin';

    const initial = previousMonthJst();
    const [year, setYear] = useState<number>(initial.year);
    const [month, setMonth] = useState<number>(initial.month);
    const [data, setData] = useState<JoyoStatementsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [editingContractorId, setEditingContractorId] = useState<string | null>(null);
    const [settingsState, setSettingsState] = useState<SettingsState | null>(null);
    // 「支払予定に追加」を開いている対象者（行は取り直した一覧から読む）
    const [scheduleContractorId, setScheduleContractorId] = useState<string | null>(null);
    // 月を続けて送ったとき、古い月の応答で上書きしないための番号
    const requestSeqRef = useRef(0);

    const fetchList = useCallback(
        async (y: number, m: number) => {
            if (!canView) return;
            const seq = ++requestSeqRef.current;
            setLoading(true);
            try {
                const params = new URLSearchParams({ year: String(y), month: String(m) });
                const res = await fetch(`/api/joyo-statements?${params}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(await errorMessage(res, '支払明細書の取得に失敗しました'));
                const json = (await res.json()) as JoyoStatementsResponse;
                if (seq !== requestSeqRef.current) return;
                setData(json);
                setLoadError(null);
            } catch (e) {
                if (seq !== requestSeqRef.current) return;
                logger.error('支払明細書の一覧取得失敗:', e);
                const msg = e instanceof Error ? e.message : '支払明細書の取得に失敗しました';
                setLoadError(msg);
                toast.error(msg);
            } finally {
                if (seq === requestSeqRef.current) setLoading(false);
            }
        },
        [canView],
    );

    useEffect(() => {
        void fetchList(year, month);
    }, [fetchList, year, month]);

    /** 今の月を取り直す（編集画面・設定の保存のあと） */
    const reload = useCallback(() => fetchList(year, month), [fetchList, year, month]);

    const goPrev = () => {
        if (month === 1) {
            setYear((y) => y - 1);
            setMonth(12);
        } else {
            setMonth((m) => m - 1);
        }
    };
    const goNext = () => {
        if (month === 12) {
            setYear((y) => y + 1);
            setMonth(1);
        } else {
            setMonth((m) => m + 1);
        }
    };

    // 表示中のデータが選んでいる月のものか（月送りの直後は前の月のデータが残っている）
    const dataMatches = !!data && data.year === year && data.month === month;
    const rows = dataMatches ? data.rows : [];
    // 編集画面は、取り直した一覧から同じ対象者の行を読み直す
    const editingRow = dataMatches && editingContractorId ? data.rows.find((r) => r.contractor.id === editingContractorId) ?? null : null;

    // 支払予定に追加するのは、発行済みで未追加の明細だけ（取り直して追加済みになったら出さない）
    const scheduleRow =
        dataMatches && scheduleContractorId
            ? data.rows.find(
                  (r) =>
                      r.contractor.id === scheduleContractorId &&
                      r.statement?.status === 'issued' &&
                      !r.paymentSchedule,
              ) ?? null
            : null;

    // 取り直して追加済みになった・発行が取り消されたなどで対象外になったら、開く状態も消す
    // （残しておくと、あとで支払予定の行が消されたときに勝手に開いてしまうため）
    useEffect(() => {
        if (scheduleContractorId && dataMatches && !loading && !scheduleRow) setScheduleContractorId(null);
    }, [scheduleContractorId, dataMatches, loading, scheduleRow]);

    // 取り直した一覧にその対象者が居なくなったら（利用停止の人の下書きを消したなど）編集画面を閉じる
    useEffect(() => {
        if (editingContractorId && dataMatches && !loading && !editingRow) setEditingContractorId(null);
    }, [editingContractorId, dataMatches, loading, editingRow]);

    if (!canView) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
                <p className="text-slate-500">権限がありません</p>
            </div>
        );
    }

    return (
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1800px] flex-col gap-3">
            {/* 見出し・月送り・設定 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-xl font-bold text-slate-900">支払明細書</h1>
                    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
                        <button
                            type="button"
                            onClick={goPrev}
                            className="rounded-l-xl px-2 py-2 text-slate-600 hover:bg-slate-50"
                            aria-label="前の月"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <span className="min-w-[120px] px-3 py-2 text-center text-sm font-semibold tabular-nums text-slate-700">
                            {year}年{month}月分
                        </span>
                        <button
                            type="button"
                            onClick={goNext}
                            className="rounded-r-xl px-2 py-2 text-slate-600 hover:bg-slate-50"
                            aria-label="次の月"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSettingsState({ startWithNewContractor: false })}
                    leftIcon={<Settings className="h-4 w-4" />}
                    disabled={!data}
                >
                    対象者・書類の設定
                </Button>
            </div>

            {/* 自社情報が未登録 */}
            {dataMatches && !data.issuer && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>自社情報が登録されていません。『自社情報』で登録してください。</span>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
                {!dataMatches && loading ? (
                    <div className="flex h-full items-center justify-center">
                        <Loading text="支払明細書を読み込み中..." />
                    </div>
                ) : !dataMatches && loadError ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white py-10 text-center">
                        <p className="text-sm text-red-600">{loadError}</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
                            もう一度読み込む
                        </Button>
                    </div>
                ) : dataMatches && rows.length === 0 ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
                        <p className="text-slate-600">対象者がまだ登録されていません</p>
                        <p className="text-xs text-slate-400">
                            利用停止にした対象者は、その月の明細があるときだけ表示されます。
                        </p>
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => setSettingsState({ startWithNewContractor: true })}
                            leftIcon={<UserPlus className="h-4 w-4" />}
                        >
                            対象者を登録する
                        </Button>
                    </div>
                ) : dataMatches ? (
                    <div className="relative">
                        {loading && (
                            <div className="pointer-events-none sticky top-2 z-20 flex justify-center">
                                <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs text-slate-600 shadow">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    更新中...
                                </div>
                            </div>
                        )}
                        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                            <table className="w-full min-w-[880px] text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">宛名</th>
                                        <th className="px-3 py-2 text-left font-medium">出勤簿の日数</th>
                                        <th className="px-3 py-2 text-right font-medium">単価</th>
                                        <th className="px-3 py-2 text-right font-medium">合計金額</th>
                                        <th className="px-3 py-2 text-left font-medium">状態</th>
                                        <th className="px-3 py-2 text-left font-medium">支払予定</th>
                                        <th className="px-3 py-2" aria-label="操作" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {rows.map((row) => (
                                        <JoyoListRow
                                            key={row.contractor.id}
                                            row={row}
                                            onOpen={() => setEditingContractorId(row.contractor.id)}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : null}
            </div>

            {editingRow && data && (
                <JoyoStatementEditor
                    // 保存・発行・取り消し・削除のあとは、取り直した明細で入力欄を作り直す
                    key={`${editingRow.contractor.id}:${editingRow.statement?.id ?? 'new'}:${editingRow.statement?.status ?? ''}:${editingRow.statement?.updatedAt ?? ''}`}
                    year={data.year}
                    month={data.month}
                    today={data.today}
                    row={editingRow}
                    settings={data.settings}
                    issuer={data.issuer}
                    onClose={() => setEditingContractorId(null)}
                    onReload={reload}
                    onAddToSchedule={(row) => setScheduleContractorId(row.contractor.id)}
                />
            )}

            {scheduleRow && (
                <AddJoyoToScheduleModal
                    row={scheduleRow}
                    onClose={() => setScheduleContractorId(null)}
                    onAdded={reload}
                />
            )}

            {settingsState && data && (
                <JoyoSettingsModal
                    settings={data.settings}
                    startWithNewContractor={settingsState.startWithNewContractor}
                    onClose={() => setSettingsState(null)}
                    onChanged={reload}
                />
            )}
        </div>
    );
}

/** 一覧の1行 */
function JoyoListRow({ row, onOpen }: { row: JoyoStatementRow; onOpen: () => void }) {
    const { contractor, attendance, statement, paymentSchedule } = row;
    const counts = attendance.counts;
    const unitPrice = rowUnitPrice(row);
    // 未作成なら、開いたときの初期値（出勤簿の日数×対象者の単価）での見込み
    const total = statement ? statement.total : computeJoyoTotals(buildDefaultItems(counts, contractor.unitPrice)).total;
    const stateMeta = JOYO_STATE_META[statement ? statement.status : 'none'];
    const scheduleAmountDiffers = !!paymentSchedule && !!statement && paymentSchedule.amount !== statement.total;

    return (
        <tr onClick={onOpen} className="cursor-pointer align-top hover:bg-teal-100">
            <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-slate-900">{contractor.recipientName}</span>
                    {!contractor.isActive && (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                            利用停止
                        </span>
                    )}
                </div>
                <div className="text-xs text-slate-400">（{contractor.userDisplayName || 'ユーザーが見つかりません'}）</div>
            </td>
            <td className="px-3 py-2.5 text-slate-700">
                <div className="tabular-nums">
                    出勤 {counts.present}日
                    {counts.holidayWork > 0 && `／休日出勤 ${counts.holidayWork}日`}
                    {counts.nightShift > 0 && `／夜勤 ${counts.nightShift}日`}
                </div>
                {counts.missingDays.length > 0 && (
                    <div className="text-xs text-amber-700" title={counts.missingDays.map(formatMdWeek).join('、')}>
                        記録の無い日 {counts.missingDays.length}日
                    </div>
                )}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{yen(unitPrice)}</td>
            <td className="px-3 py-2.5 text-right tabular-nums">
                {statement ? (
                    <span className="font-semibold text-slate-900">{yen(total)}</span>
                ) : (
                    <span className="text-slate-400">
                        {yen(total)}
                        <span className="ml-0.5 text-xs">（見込み）</span>
                    </span>
                )}
            </td>
            <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stateMeta.className}`}>
                        {stateMeta.label}
                    </span>
                    {row.attendanceChanged && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                            出勤簿が変わっています
                        </span>
                    )}
                </div>
            </td>
            <td className="px-3 py-2.5 text-slate-700">
                {paymentSchedule ? (
                    <>
                        <div className="tabular-nums">
                            {formatMd(paymentSchedule.paymentDate)} {yen(paymentSchedule.amount)}
                            {paymentSchedule.isPaid && (
                                <span className="ml-1 rounded bg-emerald-50 px-1 text-xs text-emerald-700">済</span>
                            )}
                        </div>
                        {scheduleAmountDiffers && <div className="text-xs font-medium text-red-600">金額が違います</div>}
                    </>
                ) : (
                    <span className="text-slate-400">—</span>
                )}
            </td>
            <td className="px-3 py-2.5 text-right">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpen();
                    }}
                >
                    開く
                </Button>
            </td>
        </tr>
    );
}
