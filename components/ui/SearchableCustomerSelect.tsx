'use client';

import React, { useEffect, useRef, useState } from 'react';
import { matchesSearch } from '@/utils/searchNormalize';

/** 顧客セレクトに必要な最小の形（Customer 型そのものを要求しない）。 */
export interface SelectableCustomer {
    id: string;
    name: string;
    shortName?: string | null;
}

interface SearchableCustomerSelectProps {
    value: string;
    onChange: (value: string) => void;
    customers: SelectableCustomer[];
    /** 閉じているときの入力欄の見た目（呼び出し側のフォームに合わせる）。 */
    inputClass: string;
    /** 未選択時のプレースホルダ。 */
    placeholder?: string;
    /** 検索欄のプレースホルダ。 */
    searchPlaceholder?: string;
    /** 「選択してください」（値を空に戻す行）を出すか。必須の欄では false にする。 */
    allowEmpty?: boolean;
    /** 選択肢の右側に出す補足ラベル（例: 元請の顧客に「（元請）」を付ける）。 */
    optionSuffix?: (customer: SelectableCustomer) => string;
}

/**
 * 検索して選べる顧客セレクト。
 * 顧客が増えても目当ての会社にたどり着けるよう、名称・略称の両方で絞り込める。
 * 請求書フォームのヘッダーと、請求待ちボードの請求先選択で共有する。
 */
export default function SearchableCustomerSelect({
    value,
    onChange,
    customers,
    inputClass,
    placeholder = '顧客を選択',
    searchPlaceholder = '顧客を検索...',
    allowEmpty = true,
    optionSuffix,
}: SearchableCustomerSelectProps) {
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

    // 閉じたら次に開いたときのために検索語を捨てる
    useEffect(() => {
        if (!isOpen) setSearchQuery('');
    }, [isOpen]);

    const filteredCustomers = customers.filter(c =>
        matchesSearch(c.name, searchQuery) || matchesSearch(c.shortName, searchQuery)
    );

    const selectedCustomer = customers.find(c => c.id === value);
    const displayText = selectedCustomer
        ? `${selectedCustomer.name}${optionSuffix ? optionSuffix(selectedCustomer) : ''}`
        : placeholder;

    const select = (id: string) => {
        onChange(id);
        setIsOpen(false);
        setSearchQuery('');
    };

    return (
        <div className="relative flex-1" ref={dropdownRef}>
            <div
                className={`${inputClass} flex justify-between items-center cursor-pointer bg-white`}
                onClick={() => setIsOpen(!isOpen)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsOpen((v) => !v);
                    } else if (e.key === 'Escape') {
                        setIsOpen(false);
                    }
                }}
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
                                placeholder={searchPlaceholder}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                            />
                        </div>
                    </div>
                    <ul className="max-h-60 overflow-y-auto overscroll-contain">
                        {allowEmpty && (
                            <li
                                className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm ${!value ? 'bg-slate-50 font-medium' : ''}`}
                                onClick={() => select('')}
                            >
                                <span className="text-slate-600">選択してください</span>
                            </li>
                        )}
                        {filteredCustomers.length === 0 ? (
                            <li className="px-4 py-3 text-sm text-slate-500">該当する顧客がありません</li>
                        ) : (
                            filteredCustomers.map(customer => (
                                <li
                                    key={customer.id}
                                    className={`px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm ${customer.id === value ? 'bg-slate-50 font-medium' : ''}`}
                                    onClick={() => select(customer.id)}
                                >
                                    <div className="flex flex-col">
                                        <span>
                                            {customer.name}
                                            {optionSuffix ? optionSuffix(customer) : ''}
                                        </span>
                                        {customer.shortName && (
                                            <span className="text-xs text-slate-500 mt-0.5">{customer.shortName}</span>
                                        )}
                                    </div>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
