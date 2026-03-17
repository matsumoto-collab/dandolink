'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Customer } from '@/types/customer';

function SearchableCustomerSelect({
    value,
    onChange,
    customers,
    inputClass
}: {
    value: string;
    onChange: (value: string) => void;
    customers: Customer[];
    inputClass: string;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredCustomers = customers.filter(c => {
        const query = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(query) || (c.shortName && c.shortName.toLowerCase().includes(query));
    });

    const selectedCustomer = customers.find(c => c.id === value);
    const displayText = selectedCustomer ? selectedCustomer.name : '元請会社を選択';

    return (
        <div className="relative flex-1" ref={dropdownRef}>
            <div
                className={`${inputClass} flex justify-between items-center cursor-pointer bg-white`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={`truncate ${!selectedCustomer ? 'text-slate-500' : ''}`}>
                    {displayText}
                </span>
                <span className="text-slate-400 ml-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </span>
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg">
                    <div className="p-2 border-b border-slate-200 sticky top-0 bg-white rounded-t-lg">
                        <div className="relative">
                            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </span>
                            <input
                                type="text"
                                className="w-full pl-9 pr-8 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
                                placeholder="元請会社を検索..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                            />
                        </div>
                    </div>
                    <ul className="max-h-60 overflow-y-auto overscroll-contain">
                        <li
                            className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm ${!value ? 'bg-slate-50 font-medium' : ''}`}
                            onClick={() => { onChange(''); setIsOpen(false); setSearchQuery(''); }}
                        >
                            <span className="text-slate-600">選択してください</span>
                        </li>
                        {filteredCustomers.map(customer => (
                            <li
                                key={customer.id}
                                className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm ${customer.id === value ? 'bg-slate-50 font-medium' : ''}`}
                                onClick={() => { onChange(customer.id); setIsOpen(false); setSearchQuery(''); }}
                            >
                                <div className="flex flex-col">
                                    <span>{customer.name}</span>
                                    {customer.shortName && <span className="text-xs text-slate-500 mt-0.5">{customer.shortName}</span>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
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
}

export default function InvoiceHeader({
    customerId, setCustomerId,
    invoiceNumber, setInvoiceNumber,
    title, setTitle,
    dueDate, setDueDate,
    status, setStatus,
    paidDate, setPaidDate,
    customers,
    onOpenCustomerModal,
    selectedProjectIds,
    onToggleProject,
    customerProjects,
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
                            inputClass={"flex-1 px-3 py-3 md:py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm"}
                        />
                        <button type="button" onClick={onOpenCustomerModal} className="px-4 py-3 md:py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 active:bg-slate-900 transition-colors whitespace-nowrap text-sm font-medium">
                            + 新規顧客
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">顧客を選択すると、その顧客の案件が表示されます</p>
                </div>

                <div>
                    <label className={labelClass}>請求番号</label>
                    <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputClass} placeholder="自動採番（手動入力も可）" />
                </div>

                <div>
                    <label className={labelClass}>タイトル <span className="text-slate-500">*</span></label>
                    <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} required placeholder="例: ○○現場 請求書" />
                </div>

                <div>
                    <label className={labelClass}>支払期限</label>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
                </div>

                <div>
                    <label className={labelClass}>ステータス</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                        <option value="draft">下書き</option>
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
