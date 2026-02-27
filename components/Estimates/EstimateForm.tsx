'use client';

import React, { useState, useEffect } from 'react';
import { useProjects } from '@/hooks/useProjects';
import { useCustomers } from '@/hooks/useCustomers';
import { EstimateInput, EstimateItem } from '@/types/estimate';
import { UnitPriceMaster } from '@/types/unitPrice';
import toast from 'react-hot-toast';
import CustomerModal from '../Customers/CustomerModal';
import UnitPriceMasterModal from './UnitPriceMasterModal';
import EstimateHeader from './EstimateHeader';
import ItemsEditor from './ItemsEditor';
import SummaryFooter from './SummaryFooter';
import ConditionNotes from './ConditionNotes';

interface EstimateFormProps {
    initialData?: Partial<EstimateInput>;
    onSubmit: (data: EstimateInput) => void;
    onCancel: () => void;
}

/** 30日後の日付文字列を返す */
function getDefault30DaysLater(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
}

export default function EstimateForm({ initialData, onSubmit, onCancel }: EstimateFormProps) {
    const { projects } = useProjects();
    const { customers, addCustomer } = useCustomers();
    const [projectId, setProjectId] = useState(initialData?.projectId || '');
    const [title, setTitle] = useState(initialData?.title || '');
    const [siteName, setSiteName] = useState('');
    const [customerId, setCustomerId] = useState('');
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isUnitPriceModalOpen, setIsUnitPriceModalOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState('custom');

    // 見積番号: 新規作成時はAPIから連番取得
    const [estimateNumber, setEstimateNumber] = useState(initialData?.estimateNumber || '');

    useEffect(() => {
        if (!initialData?.estimateNumber) {
            fetch('/api/estimates/next-number')
                .then(res => res.json())
                .then(data => { if (data.nextNumber) setEstimateNumber(data.nextNumber); })
                .catch(() => {
                    // フォールバック: タイムスタンプ形式
                    const now = new Date();
                    const pad = (n: number) => String(n).padStart(2, '0');
                    setEstimateNumber(`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`);
                });
        }
    }, [initialData?.estimateNumber]);

    // 有効期限: デフォルト30日後
    const [validUntil, setValidUntil] = useState(() => {
        if (initialData?.validUntil) return new Date(initialData.validUntil).toISOString().split('T')[0];
        return getDefault30DaysLater();
    });
    const [status, setStatus] = useState<EstimateInput['status']>(initialData?.status || 'draft');
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [items, setItems] = useState<EstimateItem[]>(initialData?.items || [
        { id: `item-${Date.now()}`, description: '', specification: '', quantity: 1, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '' }
    ]);

    // 案件選択時に情報を自動入力
    useEffect(() => {
        if (projectId) {
            const selectedProject = projects.find(p => p.id === projectId);
            if (selectedProject) {
                setSiteName(selectedProject.title || '');
                if (selectedProject.customer) {
                    const customerName = selectedProject.customer;
                    let customer = customers.find(c => c.name === customerName)
                        || customers.find(c => c.shortName === customerName)
                        || customers.find(c => c.name.includes(customerName))
                        || customers.find(c => c.shortName?.includes(customerName))
                        || customers.find(c => customerName.includes(c.name) || (c.shortName && customerName.includes(c.shortName)));
                    setCustomerId(customer?.id || '');
                }
                if (!title) setTitle(`${selectedProject.title} 見積書`);
            }
        }
    }, [projectId, projects, customers, title]);

    // 消費税率
    const TAX_RATE = 0.1;
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const taxableAmount = items.filter(item => item.taxType === 'standard').reduce((sum, item) => sum + item.amount, 0);
    const tax = Math.floor(taxableAmount * TAX_RATE);
    const total = subtotal + tax;

    // 明細操作
    const addItem = () => {
        setItems([...items, { id: `item-${Date.now()}`, description: '', specification: '', quantity: 1, unit: '', unitPrice: 0, amount: 0, taxType: 'standard', notes: '' }]);
    };

    // 値引き行追加
    const addDiscountItem = () => {
        setItems([...items, {
            id: `item-${Date.now()}-discount`,
            description: '値引き',
            specification: '',
            quantity: 1,
            unit: '式',
            unitPrice: 0,
            amount: 0,
            taxType: 'none',
            notes: '',
        }]);
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

    // 送信
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title) { toast.error('タイトルは必須です'); return; }
        const data: EstimateInput = {
            projectId: projectId || undefined, estimateNumber, title, items, subtotal, tax, total,
            validUntil: new Date(validUntil), status, notes: notes || undefined,
        };
        onSubmit(data);
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
                projects={projects} customers={customers}
                onOpenCustomerModal={() => setIsCustomerModalOpen(true)}
            />

            <ItemsEditor
                items={items}
                onUpdate={updateItem}
                onRemove={removeItem}
                onMoveUp={moveItemUp}
                onMoveDown={moveItemDown}
                onAddItem={addItem}
                onAddDiscountItem={addDiscountItem}
                onOpenUnitPriceModal={() => setIsUnitPriceModalOpen(true)}
            />

            <SummaryFooter subtotal={subtotal} tax={tax} total={total} />

            <ConditionNotes notes={notes} setNotes={setNotes} />

            {/* ボタン */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200 safe-area-bottom">
                <button type="button" onClick={onCancel} className="w-full sm:w-auto px-6 py-3 md:py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 active:bg-gray-100 transition-colors text-base md:text-sm">
                    キャンセル
                </button>
                <button type="submit" className="w-full sm:w-auto px-6 py-3 md:py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 active:from-blue-800 active:to-blue-900 transition-all shadow-md text-base md:text-sm font-medium">
                    保存
                </button>
            </div>

            <CustomerModal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)}
                onSubmit={(data) => { addCustomer(data); setIsCustomerModalOpen(false); }} title="新規顧客登録" />
            <UnitPriceMasterModal isOpen={isUnitPriceModalOpen} onClose={() => setIsUnitPriceModalOpen(false)} onSelect={handleSelectFromMaster} />
        </form>
    );
}
