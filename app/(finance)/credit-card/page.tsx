'use client';

import React, { useState, useEffect } from 'react';
import { logger } from '@/lib/logger';
import type { ExpenseCategoryRef } from '@/types/receipt';
import CardReceiptInbox from '@/components/CreditCard/CardReceiptInbox';
import CardStatementList from '@/components/CreditCard/CardStatementList';
import CardStatementDetail from '@/components/CreditCard/CardStatementDetail';

const TABS = [
    { id: 'receipts', label: 'レシート受け箱' },
    { id: 'statements', label: '明細書' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// クレジットカード明細の仕分け・レシート照合。
// 日々: カード利用レシートを受け箱へ取り込み（AI読み取り）。
// 月次: 明細書PDFを取り込み → 明細行とレシートを照合し、費目を仕分ける。
export default function CreditCardPage() {
    const [activeTab, setActiveTab] = useState<TabId>('receipts');
    const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);
    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/expense-categories');
                if (res.ok) setCategories(await res.json());
            } catch (e) {
                logger.error('category fetch failed', e);
            }
        })();
    }, []);

    return (
        <div className="max-w-[1800px] mx-auto w-full min-w-0">
            <div className="mb-4">
                <h2 className="text-xl font-bold text-slate-900">クレジットカード</h2>
                <p className="text-sm text-slate-500 mt-1">
                    カード利用レシートを受け箱に取り込み、月次の明細書と照らし合わせて費目で仕分けます。
                </p>
            </div>

            {/* タブ */}
            <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-full sm:w-fit">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => {
                            setActiveTab(t.id);
                            if (t.id === 'receipts') setSelectedStatementId(null);
                        }}
                        className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {activeTab === 'receipts' ? (
                <CardReceiptInbox categories={categories} />
            ) : selectedStatementId ? (
                <CardStatementDetail
                    statementId={selectedStatementId}
                    categories={categories}
                    onBack={() => setSelectedStatementId(null)}
                />
            ) : (
                <CardStatementList onSelect={setSelectedStatementId} />
            )}
        </div>
    );
}
