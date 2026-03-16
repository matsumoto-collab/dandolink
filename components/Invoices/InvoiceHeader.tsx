'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Customer } from '@/types/customer';
import { Estimate } from '@/types/estimate';

function SearchableProjectSelect({
    value,
    onChange,
    projects,
    inputClass
}: {
    value: string;
    onChange: (value: string) => void;
    projects: { id: string; title: string; customer?: string | null }[];
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

    const filteredProjects = projects.filter(p => {
        const query = searchQuery.toLowerCase();
        return p.title.toLowerCase().includes(query) || (p.customer && p.customer.toLowerCase().includes(query));
    });

    const selectedProject = projects.find(p => p.id === value);
    const displayText = selectedProject
        ? `${selectedProject.title}${selectedProject.customer ? ` (${selectedProject.customer})` : ''}`
        : '案件を選択';

    return (
        <div className="relative" ref={dropdownRef}>
            <div
                className={`${inputClass} flex justify-between items-center cursor-pointer bg-white`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={`truncate ${!selectedProject ? 'text-slate-500' : ''}`}>
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
                                placeholder="案件を検索..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                            />
                            {searchQuery && (
                                <button
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSearchQuery('');
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                    <ul className="max-h-60 overflow-y-auto overscroll-contain">
                        <li
                            className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm flex items-center justify-between ${!value ? 'bg-slate-50 font-medium' : ''}`}
                            onClick={() => {
                                onChange('');
                                setIsOpen(false);
                                setSearchQuery('');
                            }}
                        >
                            <span className="text-slate-600">案件を選択</span>
                            {!value && (
                                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </li>
                        {filteredProjects.length === 0 ? (
                            <li className="px-4 py-3 text-sm text-slate-500 text-center">
                                該当する案件がありません
                            </li>
                        ) : (
                            filteredProjects.map(project => (
                                <li
                                    key={project.id}
                                    className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm flex items-center justify-between ${project.id === value ? 'bg-slate-50 font-medium' : ''}`}
                                    onClick={() => {
                                        onChange(project.id);
                                        setIsOpen(false);
                                        setSearchQuery('');
                                    }}
                                >
                                    <div className="flex flex-col">
                                        <span>{project.title}</span>
                                        {project.customer && (
                                            <span className="text-xs text-slate-500 mt-0.5">{project.customer}</span>
                                        )}
                                    </div>
                                    {project.id === value && (
                                        <svg className="w-4 h-4 text-slate-500 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

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
    const displayText = selectedCustomer ? selectedCustomer.name : '選択してください';

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
                            {searchQuery && (
                                <button
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSearchQuery('');
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                    <ul className="max-h-60 overflow-y-auto overscroll-contain">
                        <li
                            className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm flex items-center justify-between ${!value ? 'bg-slate-50 font-medium' : ''}`}
                            onClick={() => {
                                onChange('');
                                setIsOpen(false);
                                setSearchQuery('');
                            }}
                        >
                            <span className="text-slate-600">選択してください</span>
                            {!value && (
                                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </li>
                        {filteredCustomers.length === 0 ? (
                            <li className="px-4 py-3 text-sm text-slate-500 text-center">
                                該当する元請会社がありません
                            </li>
                        ) : (
                            filteredCustomers.map(customer => (
                                <li
                                    key={customer.id}
                                    className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm flex items-center justify-between ${customer.id === value ? 'bg-slate-50 font-medium' : ''}`}
                                    onClick={() => {
                                        onChange(customer.id);
                                        setIsOpen(false);
                                        setSearchQuery('');
                                    }}
                                >
                                    <div className="flex flex-col">
                                        <span>{customer.name}</span>
                                        {customer.shortName && (
                                            <span className="text-xs text-slate-500 mt-0.5">{customer.shortName}</span>
                                        )}
                                    </div>
                                    {customer.id === value && (
                                        <svg className="w-4 h-4 text-slate-500 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

function SearchableEstimateSelect({
    value,
    onChange,
    estimates,
    inputClass
}: {
    value: string;
    onChange: (value: string) => void;
    estimates: Estimate[];
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

    const filteredEstimates = estimates.filter(e => {
        const query = searchQuery.toLowerCase();
        return e.estimateNumber.toLowerCase().includes(query)
            || e.title.toLowerCase().includes(query)
            || (e.notes && e.notes.toLowerCase().includes(query));
    });

    const selectedEstimate = estimates.find(e => e.id === value);
    const displayText = selectedEstimate
        ? `${selectedEstimate.estimateNumber} - ${selectedEstimate.title}`
        : '見積書を選択（任意）';

    return (
        <div className="relative" ref={dropdownRef}>
            <div
                className={`${inputClass} flex justify-between items-center cursor-pointer bg-white`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={`truncate ${!selectedEstimate ? 'text-slate-500' : ''}`}>
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
                                placeholder="見積番号・タイトルで検索..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                            />
                            {searchQuery && (
                                <button
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSearchQuery('');
                                    }}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                    <ul className="max-h-60 overflow-y-auto overscroll-contain">
                        <li
                            className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm flex items-center justify-between ${!value ? 'bg-slate-50 font-medium' : ''}`}
                            onClick={() => {
                                onChange('');
                                setIsOpen(false);
                                setSearchQuery('');
                            }}
                        >
                            <span className="text-slate-600">見積書を選択（任意）</span>
                            {!value && (
                                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </li>
                        {filteredEstimates.length === 0 ? (
                            <li className="px-4 py-3 text-sm text-slate-500 text-center">
                                該当する見積書がありません
                            </li>
                        ) : (
                            filteredEstimates.map(estimate => (
                                <li
                                    key={estimate.id}
                                    className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm flex items-center justify-between ${estimate.id === value ? 'bg-slate-50 font-medium' : ''}`}
                                    onClick={() => {
                                        onChange(estimate.id);
                                        setIsOpen(false);
                                        setSearchQuery('');
                                    }}
                                >
                                    <div className="flex flex-col">
                                        <span>{estimate.estimateNumber} - {estimate.title}</span>
                                        <span className="text-xs text-slate-500 mt-0.5">
                                            ¥{estimate.total.toLocaleString()}
                                            {estimate.status === 'approved' && ' (承認済み)'}
                                            {estimate.status === 'sent' && ' (送付済み)'}
                                        </span>
                                    </div>
                                    {estimate.id === value && (
                                        <svg className="w-4 h-4 text-slate-500 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

interface InvoiceHeaderProps {
    projectId: string;
    setProjectId: (v: string) => void;
    estimateId: string;
    setEstimateId: (v: string) => void;
    onLoadFromEstimate: (estId: string) => void;
    invoiceNumber: string;
    setInvoiceNumber: (v: string) => void;
    title: string;
    setTitle: (v: string) => void;
    customerId: string;
    setCustomerId: (v: string) => void;
    dueDate: string;
    setDueDate: (v: string) => void;
    status: string;
    setStatus: (v: string) => void;
    paidDate: string;
    setPaidDate: (v: string) => void;
    projects: { id: string; title: string; customer?: string | null }[];
    customers: Customer[];
    estimates: Estimate[];
    onOpenCustomerModal: () => void;
}

export default function InvoiceHeader({
    projectId, setProjectId,
    estimateId, setEstimateId, onLoadFromEstimate,
    invoiceNumber, setInvoiceNumber,
    title, setTitle,
    customerId, setCustomerId,
    dueDate, setDueDate,
    status, setStatus,
    paidDate, setPaidDate,
    projects, customers, estimates,
    onOpenCustomerModal,
}: InvoiceHeaderProps) {
    const inputClass = "w-full px-3 py-3 md:py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm";
    const labelClass = "block text-sm font-semibold text-slate-700 mb-1.5";

    return (
        <>
            {/* 基本情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-4">
                <div>
                    <label className={labelClass}>見積書から読み込み</label>
                    <SearchableEstimateSelect
                        value={estimateId}
                        onChange={(v) => {
                            setEstimateId(v);
                            if (v) onLoadFromEstimate(v);
                        }}
                        estimates={estimates}
                        inputClass={inputClass}
                    />
                    <p className="text-xs text-slate-500 mt-1">見積書を選択すると明細・案件情報が自動入力されます</p>
                </div>

                <div>
                    <label className={labelClass}>請求番号</label>
                    <input type="text" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={inputClass} />
                </div>

                <div>
                    <label className={labelClass}>案件</label>
                    <SearchableProjectSelect
                        value={projectId}
                        onChange={setProjectId}
                        projects={projects}
                        inputClass={inputClass}
                    />
                    <p className="text-xs text-slate-500 mt-1">案件を選択すると元請会社が自動入力されます</p>
                </div>

                <div>
                    <label className={labelClass}>タイトル <span className="text-slate-500">*</span></label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className={inputClass}
                        required
                        placeholder="例: ○○現場 請求書"
                    />
                </div>
            </div>

            {/* 顧客・期限情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-4">
                <div>
                    <label className={labelClass}>元請会社（顧客）</label>
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
                </div>

                <div>
                    <label className={labelClass}>支払期限</label>
                    <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className={inputClass}
                    />
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
                        <input
                            type="date"
                            value={paidDate}
                            onChange={(e) => setPaidDate(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                )}
            </div>
        </>
    );
}
