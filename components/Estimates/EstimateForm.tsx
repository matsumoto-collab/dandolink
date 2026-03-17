'use client';

import React, { useState, useEffect } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCustomers } from '@/hooks/useCustomers';
import { EstimateInput, EstimateItem } from '@/types/estimate';
import { UnitPriceMaster } from '@/types/unitPrice';
import toast from 'react-hot-toast';
import { formatDateKey } from '@/utils/employeeUtils';
import CustomerModal from '../Customers/CustomerModal';
import UnitPriceMasterModal from './UnitPriceMasterModal';
import EstimateHeader from './EstimateHeader';
import ItemsEditor from './ItemsEditor';
import SummaryFooter from './SummaryFooter';
import ConditionNotes from './ConditionNotes';

interface EstimateFormProps {
    initialData?: Partial<EstimateInput>;
    onSubmit: (data: EstimateInput) => Promise<void> | void;
    onCancel: () => void;
}

/** 30日後の日付文字列を返す */
function getDefault30DaysLater(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return formatDateKey(date);
}

export default function EstimateForm({ initialData, onSubmit, onCancel }: EstimateFormProps) {
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { customers, addCustomer, ensureDataLoaded } = useCustomers();

    // 案件マスターと顧客データのフェッチ
    useEffect(() => {
        fetchProjectMasters();
        ensureDataLoaded();
    }, [fetchProjectMasters, ensureDataLoaded]);

    const [projectId, setProjectId] = useState(initialData?.projectId || '');
    const [title, setTitle] = useState(initialData?.title || '');
    const [siteName, setSiteName] = useState('');
    const [customerId, setCustomerId] = useState(initialData?.customerId || '');
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isUnitPriceModalOpen, setIsUnitPriceModalOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState('custom');

    // 見積番号: 空の場合は保存時にサーバー側で自動採番
    const [estimateNumber, setEstimateNumber] = useState(initialData?.estimateNumber || '');

    // 有効期限: デフォルト30日後
    const [validUntil, setValidUntil] = useState(() => {
        if (initialData?.validUntil) return formatDateKey(new Date(initialData.validUntil));
        return getDefault30DaysLater();
    });
    const [status, setStatus] = useState<EstimateInput['status']>(initialData?.status || 'draft');
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [items, setItems] = useState<EstimateItem[]>(initialData?.items || [
        { id: `item-${Date.now()}`, description: '', specification: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '' }
    ]);

    // 案件選択時に情報を自動入力
    useEffect(() => {
        if (projectId) {
            const selectedProject = projectMasters.find(p => p.id === projectId);
            if (selectedProject) {
                setSiteName(selectedProject.title || '');
                // 案件マスターに顧客IDが保持されている場合は直接セットする
                if (selectedProject.customerId) {
                    setCustomerId(selectedProject.customerId);
                } else {
                    // 古いデータへの後方互換性として名前での検索を残す
                    const customerName = selectedProject.customerName || selectedProject.customerShortName;
                    if (customerName) {
                        let customer = customers.find(c => c.name === customerName)
                            || customers.find(c => c.shortName === customerName)
                            || customers.find(c => c.name.includes(customerName))
                            || customers.find(c => c.shortName?.includes(customerName))
                            || customers.find(c => customerName.includes(c.name) || (c.shortName && customerName.includes(c.shortName)));
                        setCustomerId(customer?.id || '');
                    }
                }
                if (!title) setTitle(`${selectedProject.title} 見積書`);
            }
        }
    }, [projectId, projectMasters, customers, title]);

    // EstimateHeader 用の案件リスト
    const projectOptions = React.useMemo(() => {
        return projectMasters.map(pm => ({
            id: pm.id,
            title: pm.title,
            customer: pm.customerName || pm.customerShortName
        }));
    }, [projectMasters]);

    // 消費税率
    const TAX_RATE = 0.1;

    /** フラット化して全項目の金額を合算（カテゴリのamountは子項目合計なので直接使用） */
    const calcTotals = (list: EstimateItem[]) => {
        let sub = 0;
        let taxable = 0;
        for (const item of list) {
            if (item.isCategory) {
                // カテゴリの子項目を合算
                for (const child of item.children || []) {
                    sub += child.amount;
                    if (child.taxType === 'standard') taxable += child.amount;
                }
            } else {
                sub += item.amount;
                if (item.taxType === 'standard') taxable += item.amount;
            }
        }
        return { sub, taxable };
    };
    const { sub: subtotal, taxable: taxableAmount } = calcTotals(items);
    const tax = Math.floor(taxableAmount * TAX_RATE);
    const total = subtotal + tax;

    /** カテゴリのamountを子項目合計で再計算 */
    const recalcCategoryAmount = (item: EstimateItem): EstimateItem => {
        if (!item.isCategory) return item;
        const childrenTotal = (item.children || []).reduce((s, c) => s + c.amount, 0);
        return { ...item, amount: childrenTotal };
    };

    // 明細操作
    const addItem = () => {
        setItems([...items, { id: `item-${Date.now()}`, description: '', specification: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '' }]);
    };

    const addCategory = () => {
        setItems([...items, {
            id: `cat-${Date.now()}`,
            description: '',
            specification: '',
            quantity: 0,
            unit: '',
            unitPrice: 0,
            amount: 0,
            taxType: 'standard',
            notes: '',
            isCategory: true,
            children: [],
        }]);
    };

    const addChildItem = (categoryId: string) => {
        setItems(items.map(item => {
            if (item.id === categoryId && item.isCategory) {
                const newChild: EstimateItem = {
                    id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                    description: '', specification: '', quantity: 0, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '',
                };
                const updated = { ...item, children: [...(item.children || []), newChild] };
                return recalcCategoryAmount(updated);
            }
            return item;
        }));
    };

    const updateChildItem = (categoryId: string, childId: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => {
        setItems(items.map(item => {
            if (item.id === categoryId && item.isCategory) {
                const updatedChildren = (item.children || []).map(child => {
                    if (child.id === childId) {
                        const updated = { ...child, [field]: value };
                        if (field === 'quantity' || field === 'unitPrice') updated.amount = Math.round(updated.quantity * updated.unitPrice);
                        return updated;
                    }
                    return child;
                });
                const updated = { ...item, children: updatedChildren };
                return recalcCategoryAmount(updated);
            }
            return item;
        }));
    };

    const removeChildItem = (categoryId: string, childId: string) => {
        setItems(items.map(item => {
            if (item.id === categoryId && item.isCategory) {
                const updated = { ...item, children: (item.children || []).filter(c => c.id !== childId) };
                return recalcCategoryAmount(updated);
            }
            return item;
        }));
    };

    const moveChildItem = (categoryId: string, childIndex: number, direction: 'up' | 'down') => {
        setItems(items.map(item => {
            if (item.id === categoryId && item.isCategory) {
                const children = [...(item.children || [])];
                const swapIdx = direction === 'up' ? childIndex - 1 : childIndex + 1;
                if (swapIdx < 0 || swapIdx >= children.length) return item;
                [children[childIndex], children[swapIdx]] = [children[swapIdx], children[childIndex]];
                return { ...item, children };
            }
            return item;
        }));
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
            const data: EstimateInput = {
                projectId: projectId || undefined, customerId: customerId || undefined, estimateNumber, title, items, subtotal, tax, total,
                validUntil: new Date(validUntil), status, notes: notes || undefined,
            };
            await onSubmit(data);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
            <EstimateHeader
                projectId={projectId} setProjectId={setProjectId}
                estimateNumber={estimateNumber} setEstimateNumber={setEstimateNumber}
                selectedTemplate={selectedTemplate} setSelectedTemplate={setSelectedTemplate}
                title={title} setTitle={setTitle}
                siteName={siteName} setSiteName={setSiteName}
                customerId={customerId} setCustomerId={setCustomerId}
                validUntil={validUntil} setValidUntil={setValidUntil}
                status={status} setStatus={(v) => setStatus(v as EstimateInput['status'])}
                projects={projectOptions} customers={customers}
                onOpenCustomerModal={() => setIsCustomerModalOpen(true)}
            />

            <ItemsEditor
                items={items}
                onUpdate={updateItem}
                onRemove={removeItem}
                onMoveUp={moveItemUp}
                onMoveDown={moveItemDown}
                onAddItem={addItem}
                onAddCategory={addCategory}
                onAddChildItem={addChildItem}
                onUpdateChildItem={updateChildItem}
                onRemoveChildItem={removeChildItem}
                onMoveChildItem={moveChildItem}
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
