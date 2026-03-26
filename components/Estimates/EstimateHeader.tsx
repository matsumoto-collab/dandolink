'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Customer } from '@/types/customer';
import { formatDateKey } from '@/utils/employeeUtils';


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
        : '案件を選択（任意）';

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
                            <span className="text-slate-600">案件を選択（任意）</span>
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

interface EstimateHeaderProps {
    projectId: string;
    setProjectId: (v: string) => void;
    estimateNumber: string;
    setEstimateNumber: (v: string) => void;
    title: string;
    setTitle: (v: string) => void;
    siteName: string;
    setSiteName: (v: string) => void;
    location: string;
    setLocation: (v: string) => void;
    customerId: string;
    setCustomerId: (v: string) => void;
    validUntil: string;
    setValidUntil: (v: string) => void;
    status: string;
    setStatus: (v: string) => void;
    projects: { id: string; title: string; customer?: string | null }[];
    customers: Customer[];
    onOpenCustomerModal: () => void;
}

export default function EstimateHeader({
    projectId, setProjectId,
    estimateNumber, setEstimateNumber,
    title, setTitle,
    siteName, setSiteName,
    location, setLocation,
    customerId, setCustomerId,
    validUntil, setValidUntil,
    status, setStatus,
    projects, customers,
    onOpenCustomerModal,
}: EstimateHeaderProps) {
    const inputClass = "w-full px-3 py-3 md:py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm";
    const labelClass = "block text-sm font-semibold text-slate-700 mb-1.5";

    return (
        <>
            {/* 基本情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-4">
                <div>
                    <label className={labelClass}>既存案件から作成</label>
                    <SearchableProjectSelect
                        value={projectId}
                        onChange={setProjectId}
                        projects={projects}
                        inputClass={inputClass}
                    />
                    <p className="text-xs text-slate-500 mt-1">案件を選択すると現場名・元請会社が自動入力されます</p>
                </div>

                <div>
                    <label className={labelClass}>見積番号</label>
                    <input type="text" value={estimateNumber} onChange={(e) => setEstimateNumber(e.target.value)} className={inputClass} placeholder="自動採番（手動入力も可）" />
                </div>

                <div>
                    <label className={labelClass}>タイトル <span className="text-slate-500">*</span></label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className={inputClass}
                        required
                        placeholder="例: ○○現場 見積書"
                    />
                </div>
            </div>

            {/* 現場情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-4">
                <div>
                    <label className={labelClass}>現場名</label>
                    <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} className={inputClass} placeholder="案件を選択するか手動で入力" />
                </div>

                <div>
                    <label className={labelClass}>現場住所</label>
                    <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} placeholder="案件を選択すると自動入力されます" />
                </div>

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
                    <label className={labelClass}>有効期限（発行日より1ヶ月）</label>
                    <input
                        type={validUntil === '発行日より1ヶ月' ? 'text' : 'date'}
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        onFocus={(e) => {
                            if (validUntil === '発行日より1ヶ月') {
                                const date = new Date();
                                date.setMonth(date.getMonth() + 1);
                                setValidUntil(formatDateKey(date));
                                setTimeout(() => { e.target.type = 'date'; e.target.focus(); }, 0);
                            }
                        }}
                        className={inputClass}
                    />
                </div>

                <div>
                    <label className={labelClass}>ステータス</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                        <option value="draft">下書き</option>
                        <option value="sent">送付済み</option>
                        <option value="approved">承認済み</option>
                        <option value="rejected">却下</option>
                    </select>
                </div>
            </div>
        </>
    );
}
