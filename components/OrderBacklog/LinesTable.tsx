'use client';

import React, { memo } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import NumberInput from '@/components/OrderBacklog/NumberInput';
import { foldScheduleToColumns, scheduleTotal, setScheduleColumn } from '@/components/OrderBacklog/scheduleColumns';
import { ORDER_BACKLOG_BUCKETS, unreceivedAmountYen } from '@/lib/orderBacklog/buckets';
import { bucketKeyFor } from '@/lib/orderBacklog/classify';
import type { MonthColumn } from '@/lib/orderBacklog/render';
import type { OrderBacklogLineInput, UnreceivedMode } from '@/lib/orderBacklog/types';
import type { OrderBacklogCandidateWarning } from '@/types/orderBacklog';

interface LinesTableProps {
    lines: OrderBacklogLineInput[];
    columns: MonthColumn[];
    /** 候補作成時の注意書きを案件IDで引けるようにしたもの（見積複数の行を黄色にする） */
    warningsByProject: Record<string, OrderBacklogCandidateWarning[]>;
    individualThreshold: number;
    unreceivedMode: UnreceivedMode;
    onChangeLine: (index: number, patch: Partial<OrderBacklogLineInput>) => void;
    onRemoveLine: (index: number) => void;
    onReproposeSchedule: (index: number) => void;
    /** 入金予定を再提案中の行（多重クリック防止） */
    reproposingIndex: number | null;
}

const yen = (n: number) => n.toLocaleString();

/** 集約対象の行に出す区分名（例: 「→ その他仮設工事（～50万の工事）」）。個別行は null。 */
function bucketHint(line: OrderBacklogLineInput, threshold: number): string | null {
    const key = bucketKeyFor(line, threshold);
    if (!key) return null;
    const def = ORDER_BACKLOG_BUCKETS.find((b) => b.key === key);
    return def ? `→ ${def.topLabel}（${def.bottom}）` : null;
}

interface LineRowProps {
    line: OrderBacklogLineInput;
    index: number;
    columns: MonthColumn[];
    rowWarnings: OrderBacklogCandidateWarning[] | undefined;
    individualThreshold: number;
    unreceivedMode: UnreceivedMode;
    isReproposing: boolean;
    onChangeLine: (index: number, patch: Partial<OrderBacklogLineInput>) => void;
    onRemoveLine: (index: number) => void;
    onReproposeSchedule: (index: number) => void;
}

/**
 * 明細1行。本番データで候補が 350 行前後になるため、1マス打つたびに全行が再描画されないよう
 * memo 化する（props は全てプリミティブか、変更時だけ差し替わる line オブジェクト）。
 */
const LineRow = memo(function LineRow({
    line,
    index,
    columns,
    rowWarnings,
    individualThreshold,
    unreceivedMode,
    isReproposing,
    onChangeLine,
    onRemoveLine,
    onReproposeSchedule,
}: LineRowProps) {
    const baseYm = columns[0]?.key ?? '';
    const hint = bucketHint(line, individualThreshold);
    const unreceived = unreceivedAmountYen(line, unreceivedMode);
    const total = scheduleTotal(line.schedule);
    const gap = total - unreceived;
    const monthValues = foldScheduleToColumns(line.schedule, baseYm);
    // 契約額 0 は出力に載らない＝赤。見積が複数ある案件は黄（何を契約額にしたか確認してもらう）
    const noAmount = !line.excluded && line.contractAmount <= 0;
    const multiEstimate = rowWarnings?.find((w) => w.kind === 'multiple_estimates');
    const rowClass = line.excluded
        ? 'bg-slate-50 text-slate-400'
        : noAmount
          ? 'bg-red-50 hover:bg-red-100'
          : multiEstimate
            ? 'bg-amber-50 hover:bg-amber-100'
            : 'hover:bg-slate-50';

    return (
        <tr className={rowClass}>
            <td className="px-2 py-1 text-center">
                <input
                    type="checkbox"
                    aria-label="この行を出力から外す"
                    checked={line.excluded}
                    onChange={(e) => onChangeLine(index, { excluded: e.target.checked })}
                    className="w-4 h-4 accent-slate-600"
                />
            </td>
            <td className="px-2 py-1 text-center text-slate-500">{index + 1}</td>
            <td className="px-2 py-1">
                <input
                    type="text"
                    aria-label="契約先"
                    value={line.customerName}
                    onChange={(e) => onChangeLine(index, { customerName: e.target.value })}
                    className="w-44 px-1.5 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                />
            </td>
            <td className="px-2 py-1">
                <input
                    type="text"
                    aria-label="工事名"
                    value={line.projectName}
                    onChange={(e) => onChangeLine(index, { projectName: e.target.value })}
                    className="w-56 px-1.5 py-1 border border-slate-300 rounded focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                />
                {noAmount ? (
                    <div className="mt-0.5 text-[10px] text-red-600">契約額が 0 のため出力に含まれません</div>
                ) : (
                    hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>
                )}
                {noAmount && (
                    <span
                        className="inline-block mt-0.5 mr-1 px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700"
                        title="見積が無いか、どの見積が契約か決まっていません。金額を入力してください"
                    >
                        金額未入力
                    </span>
                )}
                {multiEstimate && (
                    <span
                        className="inline-block mt-0.5 mr-1 px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800 cursor-help"
                        title={multiEstimate.message}
                    >
                        見積複数
                    </span>
                )}
                {line.isManual && (
                    <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded bg-slate-100 text-slate-500">
                        手動追加
                    </span>
                )}
            </td>
            <td className="px-2 py-1">
                <select
                    aria-label="工事の種類"
                    value={line.workKind}
                    onChange={(e) => onChangeLine(index, { workKind: e.target.value as OrderBacklogLineInput['workKind'] })}
                    className="px-1 py-1 border border-slate-300 rounded bg-white"
                >
                    <option value="temp">仮設</option>
                    <option value="new">新築</option>
                </select>
            </td>
            <td className="px-2 py-1">
                <select
                    aria-label="現場の種類"
                    value={line.siteKind}
                    onChange={(e) => onChangeLine(index, { siteKind: e.target.value as OrderBacklogLineInput['siteKind'] })}
                    className="px-1 py-1 border border-slate-300 rounded bg-white"
                >
                    <option value="house">住宅</option>
                    <option value="other">他</option>
                </select>
            </td>
            <td className="px-2 py-1">
                <NumberInput
                    ariaLabel="契約額"
                    comma
                    value={line.contractAmount}
                    onChange={(v) => onChangeLine(index, { contractAmount: v })}
                    className="w-28"
                />
            </td>
            <td className="px-2 py-1">
                <input
                    type="month"
                    aria-label="着工"
                    value={line.startYm ?? ''}
                    onChange={(e) => onChangeLine(index, { startYm: e.target.value || null })}
                    className="px-1 py-1 border border-slate-300 rounded"
                />
            </td>
            <td className="px-2 py-1">
                <input
                    type="month"
                    aria-label="完成予定"
                    value={line.endYm ?? ''}
                    onChange={(e) => onChangeLine(index, { endYm: e.target.value || null })}
                    className="px-1 py-1 border border-slate-300 rounded"
                />
            </td>
            <td className="px-2 py-1">
                <NumberInput
                    ariaLabel="出来高"
                    value={line.progressRate}
                    max={100}
                    onChange={(v) => onChangeLine(index, { progressRate: v })}
                    className="w-14"
                />
            </td>
            <td className="px-2 py-1">
                <NumberInput
                    ariaLabel="既受領"
                    comma
                    value={line.receivedAmount}
                    onChange={(v) => onChangeLine(index, { receivedAmount: v })}
                    className="w-28"
                />
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-slate-700">{yen(unreceived)}</td>
            {columns.map((c, ci) => (
                <td key={c.key} className="px-2 py-1">
                    <NumberInput
                        ariaLabel={`${c.label}の入金予定`}
                        comma
                        value={monthValues[ci] ?? 0}
                        onChange={(v) =>
                            onChangeLine(index, { schedule: setScheduleColumn(line.schedule, columns, ci, v) })
                        }
                        className="w-[5.5rem]"
                    />
                </td>
            ))}
            <td
                className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${
                    gap !== 0 ? 'text-red-600 font-semibold' : 'text-slate-500'
                }`}
                title={gap !== 0 ? `未受領との差 ${yen(gap)} 円` : undefined}
            >
                {yen(total)}
                {gap !== 0 && <div className="text-[10px]">差 {yen(gap)}</div>}
            </td>
            <td className="px-2 py-1 whitespace-nowrap">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onReproposeSchedule(index)}
                        disabled={!line.projectMasterId || isReproposing}
                        title={
                            line.projectMasterId
                                ? 'この行の入金予定を再提案'
                                : '案件に紐づいていない行は再提案できません'
                        }
                        className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isReproposing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        type="button"
                        onClick={() => onRemoveLine(index)}
                        title="この行を削除"
                        className="p-1 rounded text-red-500 hover:bg-red-50"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </td>
        </tr>
    );
});

/**
 * 受注明細書の明細テーブル（編集用）。
 * 個別行と集約対象を同じ表に出し、集約対象には行き先の区分名を薄く添える。
 * 入金予定の 9 列は基準日から決まり、行合計が未受領と合わないときは赤で知らせる。
 */
export default function LinesTable({
    lines,
    columns,
    warningsByProject,
    individualThreshold,
    unreceivedMode,
    onChangeLine,
    onRemoveLine,
    onReproposeSchedule,
    reproposingIndex,
}: LinesTableProps) {
    if (lines.length === 0) {
        return (
            <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg">
                明細がありません。「候補を作り直す」か「案件を追加」で行を作ってください。
            </div>
        );
    }

    return (
        // 行が 100〜200 になるので、表そのものを縦横スクロールする枡にする。
        // 横スクロールバーが表の最下部（画面の外）に隠れて「右端が見えない」状態にならないように、
        // 高さを画面の 6 割に抑え、見出し行は固定する。
        <div className="overflow-auto max-h-[60vh] border border-slate-200 rounded-lg bg-white">
            <table className="min-w-max text-xs">
                <thead className="bg-slate-100 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
                    <tr>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">除外</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">符号</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap text-left">契約先</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap text-left">工事名</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">工事</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">現場</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap text-right">契約額(円)</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">着工</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">完成予定</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap">出来高%</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap text-right">既受領(円)</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap text-right">未受領(自動)</th>
                        {columns.map((c) => (
                            <th key={c.key} className="px-2 py-2 font-medium whitespace-nowrap text-right">
                                {c.label}
                            </th>
                        ))}
                        <th className="px-2 py-2 font-medium whitespace-nowrap text-right">入金予定計</th>
                        <th className="px-2 py-2 font-medium whitespace-nowrap"> </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {lines.map((line, index) => (
                        <LineRow
                            key={line.id ?? line.projectMasterId ?? `row-${index}`}
                            line={line}
                            index={index}
                            columns={columns}
                            rowWarnings={line.projectMasterId ? warningsByProject[line.projectMasterId] : undefined}
                            individualThreshold={individualThreshold}
                            unreceivedMode={unreceivedMode}
                            isReproposing={reproposingIndex === index}
                            onChangeLine={onChangeLine}
                            onRemoveLine={onRemoveLine}
                            onReproposeSchedule={onReproposeSchedule}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
