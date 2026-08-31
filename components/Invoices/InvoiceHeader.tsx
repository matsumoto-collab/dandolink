'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Customer } from '@/types/customer';
import { matchesSearch } from '@/utils/searchNormalize';
import SearchableCustomerSelect from '@/components/ui/SearchableCustomerSelect';
import { DUE_DATE_PRESETS, dueDateFromClosing } from '@/lib/closingDay';

function TitleAutocomplete({ value, onChange, inputClass }: { value: string; onChange: (v: string) => void; inputClass: string }) {
    const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string }>>([]);
    const [isOpen, setIsOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetch('/api/master-data/invoice-titles')
            .then(r => r.ok ? r.json() : [])
            .then(setSuggestions)
            .catch(() => {});
    }, []);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = value
        ? suggestions.filter(s => matchesSearch(s.name, value))
        : suggestions;

    return (
        <div className="relative" ref={wrapRef}>
            <input
                type="text"
                value={value}
                onChange={(e) => { onChange(e.target.value); setIsOpen(true); }}
                onFocus={() => setIsOpen(true)}
                className={inputClass}
                required
                placeholder="例: ○○現場 請求書"
            />
            {isOpen && filtered.length > 0 && (
                <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filtered.map(s => (
                        <li
                            key={s.id}
                            className="px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm"
                            onMouseDown={(e) => { e.preventDefault(); onChange(s.name); setIsOpen(false); }}
                        >
                            {s.name}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

interface InvoiceHeaderProps {
    customerId: string;
    setCustomerId: (v: string) => void;
    invoiceNumber: string;
    setInvoiceNumber: (v: string) => void;
    title: string;
    setTitle: (v: string) => void;
    dueDate: string;
    setDueDate: (v: string) => void;
    issueDate: string;
    setIssueDate: (v: string) => void;
    status: string;
    setStatus: (v: string) => void;
    paidDate: string;
    setPaidDate: (v: string) => void;
    customers: Customer[];
    onOpenCustomerModal: () => void;
    // 案件選択
    selectedProjectIds: string[];
    onToggleProject: (pmId: string) => void;
    customerProjects: Array<{ id: string; title: string }>;
    /** 選択中の案件の元請のうち、請求先と異なるもの（請求先を切り替えたときだけ入る）。 */
    sourceCustomerNames?: string[];
}

export default function InvoiceHeader({
    customerId, setCustomerId,
    invoiceNumber, setInvoiceNumber,
    title, setTitle,
    dueDate, setDueDate,
    issueDate, setIssueDate,
    status, setStatus,
    paidDate, setPaidDate,
    customers,
    onOpenCustomerModal,
    selectedProjectIds,
    onToggleProject,
    customerProjects,
    sourceCustomerNames,
}: InvoiceHeaderProps) {
    const inputClass = "w-full px-3 py-3 md:py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm";
    const labelClass = "block text-sm font-semibold text-slate-700 mb-1.5";

    return (
        <>
            {/* 基本情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className={labelClass}>元請会社（顧客） <span className="text-slate-500">*</span></label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <SearchableCustomerSelect
                            value={customerId}
                            onChange={setCustomerId}
                            customers={customers}
                            placeholder="元請会社を選択"
                            searchPlaceholder="元請会社を検索..."
                            inputClass={"flex-1 px-3 py-3 md:py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm"}
                        />
                        <button type="button" onClick={onOpenCustomerModal} className="px-4 py-3 md:py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 active:bg-teal-800 transition-colors whitespace-nowrap text-sm font-medium">
                            + 新規顧客
                        </button>
                    </div>
                    {sourceCustomerNames && sourceCustomerNames.length > 0 ? (
                        <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800">
                            案件の元請は「{sourceCustomerNames.join('、')}」です。この請求書の宛名だけが上の会社になります
                            （案件マスタの元請は変更しません）。
                        </p>
                    ) : (
                        <p className="text-xs text-slate-500 mt-1">顧客を選択すると、その顧客の案件が表示されます</p>
                    )}
                </div>

                <div>
                    <label className={labelClass}>請求番号</label>
                    <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputClass} placeholder="自動採番（手動入力も可）" />
                </div>

                <div>
                    <label className={labelClass}>タイトル <span className="text-slate-500">*</span></label>
                    <TitleAutocomplete value={title} onChange={setTitle} inputClass={inputClass} />
                </div>

                <div>
                    <label className={labelClass}>請求日</label>
                    <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputClass} />
                </div>

                <div>
                    <label className={labelClass}>支払期限</label>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
                    {issueDate && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {DUE_DATE_PRESETS.map((p) => {
                                const [yy, mm] = issueDate.split('-').map(Number);
                                const ymd = dueDateFromClosing(yy, mm - 1, p.key);
                                const active = dueDate === ymd;
                                return (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() => setDueDate(ymd)}
                                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                            active
                                                ? 'border-teal-600 bg-teal-600 text-white'
                                                : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div>
                    <label className={labelClass}>ステータス</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                        <option value="draft">下書き</option>
                        <option value="confirmed">担当確認済み</option>
                        <option value="sent">送付済み</option>
                        <option value="paid">支払済み</option>
                        <option value="overdue">期限超過</option>
                    </select>
                </div>

                {status === 'paid' && (
                    <div>
                        <label className={labelClass}>支払日</label>
                        <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={inputClass} />
                    </div>
                )}
            </div>

            {/* 案件選択（顧客選択後に表示） */}
            {customerId && (
                <div>
                    <label className={labelClass}>案件を選択</label>
                    {customerProjects.length === 0 ? (
                        <p className="text-sm text-slate-500 py-2">この顧客に紐付く案件がありません</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {customerProjects.map(pm => (
                                <label
                                    key={pm.id}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                                        selectedProjectIds.includes(pm.id)
                                            ? 'border-slate-500 bg-slate-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedProjectIds.includes(pm.id)}
                                        onChange={() => onToggleProject(pm.id)}
                                        className="w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                    />
                                    <span className="text-sm text-slate-800 truncate">{pm.title}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
