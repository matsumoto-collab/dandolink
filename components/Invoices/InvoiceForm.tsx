'use client';

import React, { useState, useEffect } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCustomers } from '@/hooks/useCustomers';
import { useEstimates } from '@/hooks/useEstimates';
import { InvoiceInput } from '@/types/invoice';
import { EstimateItem } from '@/types/estimate';
import { UnitPriceMaster } from '@/types/unitPrice';
import toast from 'react-hot-toast';
import { formatDateKey } from '@/utils/employeeUtils';
import CustomerModal from '../Customers/CustomerModal';
import UnitPriceMasterModal from '../Estimates/UnitPriceMasterModal';
import ItemsEditor from '../Estimates/ItemsEditor';
import SummaryFooter from '../Estimates/SummaryFooter';
import ConditionNotes from '../Estimates/ConditionNotes';
import InvoiceHeader from './InvoiceHeader';

interface InvoiceFormProps {
    initialData?: Partial<InvoiceInput>;
    onSubmit: (data: InvoiceInput) => Promise<void> | void;
    onCancel: () => void;
}

/** 30日後の日付文字列を返す */
function getDefault30DaysLater(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return formatDateKey(date);
}

export default function InvoiceForm({ initialData, onSubmit, onCancel }: InvoiceFormProps) {
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { customers, addCustomer, ensureDataLoaded } = useCustomers();
    const { estimates } = useEstimates();

    // データのフェッチ
    useEffect(() => {
        fetchProjectMasters();
        ensureDataLoaded();
    }, [fetchProjectMasters, ensureDataLoaded]);

    const [projectId, setProjectId] = useState(initialData?.projectId || '');
    const [estimateId, setEstimateId] = useState(initialData?.estimateId || '');
    const [title, setTitle] = useState(initialData?.title || '');
    const [customerId, setCustomerId] = useState('');
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isUnitPriceModalOpen, setIsUnitPriceModalOpen] = useState(false);

    // 請求番号: 新規作成時はAPIから連番取得
    const [invoiceNumber, setInvoiceNumber] = useState(initialData?.invoiceNumber || '');

    useEffect(() => {
        if (!initialData?.invoiceNumber) {
            fetch('/api/invoices/next-number')
                .then(res => res.json())
                .then(data => { if (data.nextNumber) setInvoiceNumber(data.nextNumber); })
                .catch(() => {
                    // フォールバック: タイムスタンプ形式
                    setInvoiceNumber(`INV-${Date.now()}`);
                });
        }
    }, [initialData?.invoiceNumber]);

    // 支払期限: デフォルト30日後
    const [dueDate, setDueDate] = useState(() => {
        if (initialData?.dueDate) return formatDateKey(new Date(initialData.dueDate));
        return getDefault30DaysLater();
    });
    const [status, setStatus] = useState<InvoiceInput['status']>(initialData?.status || 'draft');
    const [paidDate, setPaidDate] = useState(() => {
        if (initialData?.paidDate) return formatDateKey(new Date(initialData.paidDate));
        return '';
    });
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [items, setItems] = useState<EstimateItem[]>(initialData?.items || [
        { id: `item-${Date.now()}`, description: '', specification: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '' }
    ]);

    // 案件選択時に情報を自動入力
    useEffect(() => {
        if (projectId) {
            const selectedProject = projectMasters.find(p => p.id === projectId);
            if (selectedProject) {
                if (selectedProject.customerId) {
                    setCustomerId(selectedProject.customerId);
                } else {
                    const customerName = selectedProject.customerName || selectedProject.customerShortName;
                    if (customerName) {
                        const customer = customers.find(c => c.name === customerName)
                            || customers.find(c => c.shortName === customerName)
                            || customers.find(c => c.name.includes(customerName))
                            || customers.find(c => c.shortName?.includes(customerName));
                        setCustomerId(customer?.id || '');
                    }
                }
                if (!title) setTitle(`${selectedProject.title} 請求書`);
            }
        }
    }, [projectId, projectMasters, customers, title]);

    // 見積書から読み込み
    const loadFromEstimate = (estId: string) => {
        const estimate = estimates.find(e => e.id === estId);
        if (estimate) {
            setProjectId(estimate.projectId ?? '');
            setTitle(estimate.title.replace('見積書', '請求書'));
            setItems(estimate.items);
            setNotes(estimate.notes || '');
            if (estimate.customerId) setCustomerId(estimate.customerId);
        }
    };

    // 案件リスト
    const projectOptions = React.useMemo(() => {
        return projectMasters.map(pm => ({
            id: pm.id,
            title: pm.title,
            customer: pm.customerName || pm.customerShortName
        }));
    }, [projectMasters]);

    // 消費税率
    const TAX_RATE = 0.1;
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const taxableAmount = items.filter(item => item.taxType === 'standard').reduce((sum, item) => sum + item.amount, 0);
    const tax = Math.floor(taxableAmount * TAX_RATE);
    const total = subtotal + tax;

    // 明細操作
    const addItem = () => {
        setItems([...items, { id: `item-${Date.now()}`, description: '', specification: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '' }]);
    };

    const handleSelectFromMaster = (selectedMasters: UnitPriceMaster[]) => {
        const newItems = selectedMasters.map(master => ({
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description: master.description, specification: '', quantity: 1, unit: master.unit,
            unitPrice: master.unitPrice, amount: Math.round(1 * master.unitPrice), taxType: 'standard' as const, notes: '',
        }));
        const nonEmptyItems = items.filter(item => item.description.trim() !== '' || item.unitPrice > 0);
        setItems([...nonEmptyItems, ...newItems]);
        setIsUnitPriceModalOpen(false);
    };

    const removeItem = (id: string) => { if (items.length > 1) setItems(items.filter(item => item.id !== id)); };

    const updateItem = (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => {
        setItems(items.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };
                if (field === 'quantity' || field === 'unitPrice') updated.amount = Math.round(updated.quantity * updated.unitPrice);
                return updated;
            }
            return item;
        }));
    };

    const moveItemUp = (index: number) => {
        if (index === 0) return;
        const newItems = [...items];
        [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
        setItems(newItems);
    };

    const moveItemDown = (index: number) => {
        if (index === items.length - 1) return;
        const newItems = [...items];
        [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
        setItems(newItems);
    };

    const [isSubmitting, setIsSubmitting] = useState(false);

    // 送信
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title) { toast.error('タイトルは必須です'); return; }
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const data: InvoiceInput = {
                projectId: projectId || '',
                estimateId: estimateId || undefined,
                invoiceNumber,
                title,
                items,
                subtotal,
                tax,
                total,
                dueDate: new Date(dueDate),
                status,
                paidDate: paidDate ? new Date(paidDate) : undefined,
                notes: notes || undefined,
            };
            await onSubmit(data);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
            <InvoiceHeader
                projectId={projectId} setProjectId={setProjectId}
                estimateId={estimateId} setEstimateId={setEstimateId}
                onLoadFromEstimate={loadFromEstimate}
                invoiceNumber={invoiceNumber} setInvoiceNumber={setInvoiceNumber}
                title={title} setTitle={setTitle}
                customerId={customerId} setCustomerId={setCustomerId}
                dueDate={dueDate} setDueDate={setDueDate}
                status={status} setStatus={(v) => setStatus(v as InvoiceInput['status'])}
                paidDate={paidDate} setPaidDate={setPaidDate}
                projects={projectOptions} customers={customers} estimates={estimates}
                onOpenCustomerModal={() => setIsCustomerModalOpen(true)}
            />

            <ItemsEditor
                items={items}
                onUpdate={updateItem}
                onRemove={removeItem}
                onMoveUp={moveItemUp}
                onMoveDown={moveItemDown}
                onAddItem={addItem}
                onOpenUnitPriceModal={() => setIsUnitPriceModalOpen(true)}
            />

            <ConditionNotes notes={notes} setNotes={setNotes} />

            {/* 合計エリア（sticky） */}
            <div className="sticky bottom-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-white border-t border-slate-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
                <SummaryFooter subtotal={subtotal} tax={tax} total={total} />
            </div>

            {/* ボタン */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 safe-area-bottom">
                <button type="button" onClick={onCancel} className="w-full sm:w-auto px-6 py-3 md:py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors text-base md:text-sm">
                    キャンセル
                </button>
                <button type="submit" disabled={isSubmitting} className="w-full sm:w-auto px-6 py-3 md:py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 active:bg-slate-900 transition-all shadow-md text-base md:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                    {isSubmitting ? '保存中...' : '保存'}
                </button>
            </div>

            <CustomerModal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)}
                onSubmit={(data) => { addCustomer(data); setIsCustomerModalOpen(false); }} title="新規顧客登録" />
            <UnitPriceMasterModal isOpen={isUnitPriceModalOpen} onClose={() => setIsUnitPriceModalOpen(false)} onSelect={handleSelectFromMaster} />
        </form>
    );
}
