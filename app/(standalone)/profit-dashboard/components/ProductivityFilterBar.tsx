'use client';

/**
 * 「一人当たりの稼ぎ」タブの上に出す絞り込みバー（kei 要望 2026-09-12）。
 * ここで決めた条件が、下の「売上 ÷ 人工」と「一人当たりの稼ぎ」の両方に効く。
 */
import React from 'react';
import { Loader2, X } from 'lucide-react';
import {
    MAX_DAY_RANGE_DAYS,
    presetKeyOf,
    productivityPresets,
    rangeDays,
    type ProductivityFilter,
    type ProductivityOptions,
} from './productivityFilter';

const SELECT_CLASS =
    'h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 max-w-[190px] focus:outline-none focus:ring-2 focus:ring-teal-500/40';
const DATE_CLASS =
    'h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500/40';

interface Props {
    filter: ProductivityFilter;
    onChange: (next: ProductivityFilter) => void;
    options: ProductivityOptions;
    loading?: boolean;
}

export default function ProductivityFilterBar({ filter, onChange, options, loading }: Props) {
    const presets = productivityPresets();
    const activePreset = presetKeyOf(filter.from, filter.to);
    const days = rangeDays(filter.from, filter.to);
    const dayDisabled = days > MAX_DAY_RANGE_DAYS || days <= 0;

    // 期間を変えたとき、日別のままでは出せない長さになったら月別へ戻す
    const setRange = (from: string, to: string) => {
        const nextDays = rangeDays(from, to);
        const granularity = nextDays > MAX_DAY_RANGE_DAYS ? 'month' : filter.granularity;
        onChange({ ...filter, from, to, granularity });
    };

    const filtersOn = !!(filter.assigneeId || filter.customerKey || filter.content);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 sm:p-4 space-y-2.5">
            {/* 期間 */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-600 w-14 shrink-0">期間</span>
                {presets.map((p) => (
                    <button
                        key={p.key}
                        type="button"
                        onClick={() => setRange(p.from, p.to)}
                        className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                            activePreset === p.key
                                ? 'bg-teal-600 text-white border-teal-600'
                                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                        }`}
                    >
                        {p.label}
                    </button>
                ))}
                <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
                <input
                    type="date"
                    value={filter.from}
                    max={filter.to}
                    onChange={(e) => e.target.value && setRange(e.target.value, filter.to)}
                    className={DATE_CLASS}
                    aria-label="開始日"
                />
                <span className="text-xs text-slate-400">〜</span>
                <input
                    type="date"
                    value={filter.to}
                    min={filter.from}
                    onChange={(e) => e.target.value && setRange(filter.from, e.target.value)}
                    className={DATE_CLASS}
                    aria-label="終了日"
                />
                {activePreset === null && <span className="text-xs text-slate-400">（日付を指定）</span>}
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
            </div>

            {/* 表示の細かさ・担当者・顧客・工事内容 */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-600 w-14 shrink-0">絞り込み</span>

                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                    {([
                        { value: 'month', label: '月別' },
                        { value: 'day', label: '日別' },
                    ] as const).map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            disabled={o.value === 'day' && dayDisabled}
                            onClick={() => onChange({ ...filter, granularity: o.value })}
                            title={o.value === 'day' && dayDisabled ? `日別は${MAX_DAY_RANGE_DAYS}日までの期間で選べます` : undefined}
                            className={`px-3 py-1 text-xs whitespace-nowrap rounded-md transition-colors ${
                                filter.granularity === o.value
                                    ? 'bg-teal-600 text-white'
                                    : o.value === 'day' && dayDisabled
                                        ? 'text-slate-300 cursor-not-allowed'
                                        : 'text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>

                <select
                    value={filter.assigneeId}
                    onChange={(e) => onChange({ ...filter, assigneeId: e.target.value })}
                    className={SELECT_CLASS}
                    aria-label="担当者"
                >
                    <option value="">担当者：すべて</option>
                    {options.assignees.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>

                <select
                    value={filter.customerKey}
                    onChange={(e) => onChange({ ...filter, customerKey: e.target.value })}
                    className={SELECT_CLASS}
                    aria-label="顧客"
                >
                    <option value="">顧客：すべて</option>
                    {options.customers.map((c) => (
                        <option key={c.key} value={c.key}>{c.name}</option>
                    ))}
                </select>

                <select
                    value={filter.content}
                    onChange={(e) => onChange({ ...filter, content: e.target.value })}
                    className={SELECT_CLASS}
                    aria-label="工事内容"
                >
                    <option value="">工事内容：すべて</option>
                    {options.contents.map((c) => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>

                {filtersOn && (
                    <button
                        type="button"
                        onClick={() => onChange({ ...filter, assigneeId: '', customerKey: '', content: '' })}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    >
                        <X className="w-3 h-3" />
                        絞り込みを解除
                    </button>
                )}
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
                担当者は案件マスタの担当者で、過去データ（2026年4月まで）の案件には担当者・工事内容が入っていません。
                担当者や工事内容で絞ると、その期間の過去データは対象から外れます。
            </p>
        </div>
    );
}
