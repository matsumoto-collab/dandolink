'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCustomers } from '@/hooks/useCustomers';
import { useEstimates } from '@/hooks/useEstimates';
import { InvoiceInput, InvoiceItem, BillingTitle } from '@/types/invoice';
import { UnitPriceMaster } from '@/types/unitPrice';
import toast from 'react-hot-toast';
import { formatDateKey } from '@/utils/employeeUtils';
import CustomerModal from '../Customers/CustomerModal';
import UnitPriceMasterModal from '../Estimates/UnitPriceMasterModal';
import ItemsEditor from '../Estimates/ItemsEditor';
import SummaryFooter from '../Estimates/SummaryFooter';
import ConditionNotes from '../Estimates/ConditionNotes';
import InvoiceHeader from './InvoiceHeader';
import { FileDown, Plus, List } from 'lucide-react';

interface InvoiceFormProps {
    initialData?: Partial<InvoiceInput>;
    onSubmit: (data: InvoiceInput) => Promise<void> | void;
    onCancel: () => void;
}

function getDefault30DaysLater(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return formatDateKey(date);
}

export default function InvoiceForm({ initialData, onSubmit, onCancel }: InvoiceFormProps) {
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { customers, addCustomer, ensureDataLoaded } = useCustomers();
    const { estimates, ensureDataLoaded: ensureEstimatesLoaded } = useEstimates();

    // 請求項目マスタ
    const [billingTitles, setBillingTitles] = useState<BillingTitle[]>([]);

    useEffect(() => {
        fetchProjectMasters();
        ensureDataLoaded();
        ensureEstimatesLoaded();
        fetch('/api/master-data/billing-titles')
            .then(r => r.ok ? r.json() : [])
            .then(setBillingTitles)
            .catch(() => {});
    }, [fetchProjectMasters, ensureDataLoaded, ensureEstimatesLoaded]);

    // 基本情報
    const [customerId, setCustomerId] = useState(initialData?.customerId || '');
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
        initialData?.projectMasterIds || (initialData?.projectId ? [initialData.projectId] : [])
    );
    const [title, setTitle] = useState(initialData?.title || '');
    const [invoiceNumber, setInvoiceNumber] = useState(initialData?.invoiceNumber || '');
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
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isUnitPriceModalOpen, setIsUnitPriceModalOpen] = useState(false);
    const [unitPriceTargetPmId, setUnitPriceTargetPmId] = useState<string>('');

    // 明細: 案件ごとにグループ化 { [projectMasterId]: InvoiceItem[] }
    const [itemsByProject, setItemsByProject] = useState<Record<string, InvoiceItem[]>>(() => {
        if (initialData?.items && initialData.items.length > 0) {
            // 既存データ: projectMasterId でグループ化
            const grouped: Record<string, InvoiceItem[]> = {};
            for (const item of initialData.items) {
                const pmId = item.projectMasterId || initialData.projectId || '_default';
                if (!grouped[pmId]) grouped[pmId] = [];
                grouped[pmId].push(item);
            }
            return grouped;
        }
        return {};
    });

    // 顧客変更時にcustomerIdから案件を自動特定
    useEffect(() => {
        if (!customerId || initialData?.customerId) return;
        // 顧客変更でprojectIdsをリセット
        setSelectedProjectIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerId]);

    // 初回: customerId未設定で、projectMasterIdsがある場合にcustomerIdを逆引き
    useEffect(() => {
        if (customerId || selectedProjectIds.length === 0) return;
        const pm = projectMasters.find(p => selectedProjectIds.includes(p.id));
        if (pm?.customerId) {
            setCustomerId(pm.customerId);
        } else if (pm?.customerName) {
            const c = customers.find(c => c.name === pm.customerName || c.shortName === pm.customerName);
            if (c) setCustomerId(c.id);
        }
    }, [customerId, selectedProjectIds, projectMasters, customers]);

    // 顧客に紐付く案件一覧
    const customerProjects = React.useMemo(() => {
        if (!customerId) return [];
        const customer = customers.find(c => c.id === customerId);
        if (!customer) return [];
        return projectMasters
            .filter(pm => {
                if (pm.customerId === customerId) return true;
                if (pm.customerName === customer.name || pm.customerName === customer.shortName) return true;
                if (pm.customerShortName === customer.shortName || pm.customerShortName === customer.name) return true;
                return false;
            })
            .map(pm => ({ id: pm.id, title: pm.title }));
    }, [customerId, customers, projectMasters]);

    const handleToggleProject = useCallback((pmId: string) => {
        setSelectedProjectIds(prev => {
            if (prev.includes(pmId)) {
                // 案件を外す → その案件の明細も削除
                setItemsByProject(prevItems => {
                    const next = { ...prevItems };
                    delete next[pmId];
                    return next;
                });
                return prev.filter(id => id !== pmId);
            }
            return [...prev, pmId];
        });
    }, []);

    // 見積書から案件の明細を読み込み
    const loadFromEstimate = useCallback((pmId: string) => {
        const pmEstimates = estimates.filter(e => e.projectId === pmId);
        if (pmEstimates.length === 0) {
            toast.error('この案件に紐付く見積書がありません');
            return;
        }
        // 最新の見積書を使用
        const latest = pmEstimates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const items: InvoiceItem[] = latest.items.map(item => ({
            ...item,
            projectMasterId: pmId,
        }));
        setItemsByProject(prev => ({ ...prev, [pmId]: items }));
        if (!title) {
            setTitle(latest.title.replace('見積書', '請求書'));
        }
        toast.success(`${latest.estimateNumber} の明細を読み込みました`);
    }, [estimates, title]);

    // 請求項目マスタから追加
    const addFromBillingTitle = useCallback((pmId: string, bt: BillingTitle) => {
        const qty = bt.quantity ?? 1;
        const newItem: InvoiceItem = {
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description: bt.name,
            specification: '',
            quantity: qty,
            unit: bt.unit || '式',
            unitPrice: 0,
            amount: 0,
            taxType: 'standard',
            notes: '',
            projectMasterId: pmId,
        };
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: [...(prev[pmId] || []), newItem],
        }));
    }, []);

    // 空の明細を追加
    const addEmptyItem = useCallback((pmId: string) => {
        const newItem: InvoiceItem = {
            id: `item-${Date.now()}`,
            description: '',
            specification: '',
            quantity: 0,
            unit: '',
            unitPrice: 0,
            amount: 0,
            taxType: 'standard',
            notes: '',
            projectMasterId: pmId,
        };
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: [...(prev[pmId] || []), newItem],
        }));
    }, []);

    // 単価マスタから追加
    const handleSelectFromMaster = (selectedMasters: UnitPriceMaster[]) => {
        const pmId = unitPriceTargetPmId;
        const newItems: InvoiceItem[] = selectedMasters.map(master => {
            const qty = master.quantity ?? 1;
            return {
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description: master.description,
            specification: '',
            quantity: qty,
            unit: master.unit,
            unitPrice: master.unitPrice,
            amount: Math.round(qty * master.unitPrice),
            taxType: 'standard' as const,
            notes: '',
            projectMasterId: pmId,
        };
        });
        setItemsByProject(prev => {
            const existing = prev[pmId] || [];
            const nonEmpty = existing.filter(item => item.description.trim() !== '' || item.unitPrice > 0);
            return { ...prev, [pmId]: [...nonEmpty, ...newItems] };
        });
        setIsUnitPriceModalOpen(false);
    };

    // 明細操作（案件内）
    const updateItem = (pmId: string, id: string, field: string, value: unknown) => {
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: (prev[pmId] || []).map(item => {
                if (item.id === id) {
                    const updated = { ...item, [field]: value };
                    if (field === 'quantity' || field === 'unitPrice') {
                        updated.amount = Math.round(updated.quantity * updated.unitPrice);
                    }
                    return updated;
                }
                return item;
            }),
        }));
    };

    const removeItem = (pmId: string, id: string) => {
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: (prev[pmId] || []).filter(item => item.id !== id),
        }));
    };

    const moveItemUp = (pmId: string, index: number) => {
        if (index === 0) return;
        setItemsByProject(prev => {
            const items = [...(prev[pmId] || [])];
            [items[index - 1], items[index]] = [items[index], items[index - 1]];
            return { ...prev, [pmId]: items };
        });
    };

    const moveItemDown = (pmId: string, index: number) => {
        setItemsByProject(prev => {
            const items = [...(prev[pmId] || [])];
            if (index >= items.length - 1) return prev;
            [items[index], items[index + 1]] = [items[index + 1], items[index]];
            return { ...prev, [pmId]: items };
        });
    };

    const reorderItems = (pmId: string, fromIndex: number, toIndex: number) => {
        setItemsByProject(prev => {
            const items = [...(prev[pmId] || [])];
            const [moved] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, moved);
            return { ...prev, [pmId]: items };
        });
    };

    const reorderChildItems = (pmId: string, parentId: string, fromIndex: number, toIndex: number) => {
        setItemsByProject(prev => {
            const items = (prev[pmId] || []).map(item => {
                if (item.id === parentId && item.children) {
                    const children = [...item.children];
                    const [moved] = children.splice(fromIndex, 1);
                    children.splice(toIndex, 0, moved);
                    return { ...item, children };
                }
                return item;
            });
            return { ...prev, [pmId]: items };
        });
    };

    // 全明細をフラット化
    const allItems = React.useMemo(() => {
        return Object.values(itemsByProject).flat();
    }, [itemsByProject]);

    // 消費税率
    const TAX_RATE = 0.1;
    const subtotal = allItems.reduce((sum, item) => sum + item.amount, 0);
    const taxableAmount = allItems.filter(item => item.taxType === 'standard').reduce((sum, item) => sum + item.amount, 0);
    const tax = Math.floor(taxableAmount * TAX_RATE);
    const total = subtotal + tax;

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title) { toast.error('タイトルは必須です'); return; }
        if (selectedProjectIds.length === 0) { toast.error('案件を選択してください'); return; }
        if (allItems.length === 0) { toast.error('明細を1つ以上入力してください'); return; }
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const data: InvoiceInput = {
                projectId: selectedProjectIds[0],
                projectMasterIds: selectedProjectIds,
                customerId,
                invoiceNumber,
                title,
                items: allItems,
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

    // 請求項目マスタ選択ドロップダウン
    const [billingDropdownPmId, setBillingDropdownPmId] = useState<string | null>(null);

    return (
        <form onSubmit={handleSubmit} className="space-y-5 md:space-y-6">
            <InvoiceHeader
                customerId={customerId} setCustomerId={setCustomerId}
                invoiceNumber={invoiceNumber} setInvoiceNumber={setInvoiceNumber}
                title={title} setTitle={setTitle}
                dueDate={dueDate} setDueDate={setDueDate}
                status={status} setStatus={(v) => setStatus(v as InvoiceInput['status'])}
                paidDate={paidDate} setPaidDate={setPaidDate}
                customers={customers}
                onOpenCustomerModal={() => setIsCustomerModalOpen(true)}
                selectedProjectIds={selectedProjectIds}
                onToggleProject={handleToggleProject}
                customerProjects={customerProjects}
            />

            {/* 案件ごとの明細セクション */}
            {selectedProjectIds.map(pmId => {
                const pm = projectMasters.find(p => p.id === pmId);
                const pmItems = itemsByProject[pmId] || [];
                const pmEstimates = estimates.filter(e => e.projectId === pmId);

                return (
                    <div key={pmId} className="border border-slate-200 rounded-xl overflow-hidden">
                        {/* 案件ヘッダー */}
                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <h3 className="text-sm font-semibold text-slate-800">
                                    {pm?.title || '不明な案件'}
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {pmEstimates.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => loadFromEstimate(pmId)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                        >
                                            <FileDown className="w-3.5 h-3.5" />
                                            見積書から読込
                                        </button>
                                    )}
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setBillingDropdownPmId(billingDropdownPmId === pmId ? null : pmId)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                        >
                                            <List className="w-3.5 h-3.5" />
                                            請求項目から追加
                                        </button>
                                        {billingDropdownPmId === pmId && billingTitles.length > 0 && (
                                            <div className="absolute right-0 z-50 mt-1 w-64 bg-white border border-slate-300 rounded-lg shadow-lg">
                                                <ul className="max-h-48 overflow-y-auto py-1">
                                                    {billingTitles.map(bt => (
                                                        <li
                                                            key={bt.id}
                                                            className="px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm"
                                                            onClick={() => {
                                                                addFromBillingTitle(pmId, bt);
                                                                setBillingDropdownPmId(null);
                                                            }}
                                                        >
                                                            {bt.name}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setUnitPriceTargetPmId(pmId);
                                            setIsUnitPriceModalOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                    >
                                        単価マスタ
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => addEmptyItem(pmId)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        行追加
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 明細 */}
                        <div className="p-4">
                            {pmItems.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-4">
                                    明細がありません。上のボタンから追加してください。
                                </p>
                            ) : (
                                <ItemsEditor
                                    items={pmItems}
                                    onUpdate={(id, field, value) => updateItem(pmId, id, field as string, value)}
                                    onRemove={(id) => removeItem(pmId, id)}
                                    onMoveUp={(index) => moveItemUp(pmId, index)}
                                    onMoveDown={(index) => moveItemDown(pmId, index)}
                                    onReorder={(fromIndex, toIndex) => reorderItems(pmId, fromIndex, toIndex)}
                                    onReorderChildItem={(parentId, fromIndex, toIndex) => reorderChildItems(pmId, parentId, fromIndex, toIndex)}
                                    onAddItem={() => addEmptyItem(pmId)}
                                    onOpenUnitPriceModal={() => {
                                        setUnitPriceTargetPmId(pmId);
                                        setIsUnitPriceModalOpen(true);
                                    }}
                                    hideAddButtons={true}
                                />
                            )}
                        </div>
                    </div>
                );
            })}

            {selectedProjectIds.length === 0 && (
                <div className="text-center py-8 text-slate-500 border border-dashed border-slate-300 rounded-xl">
                    <p>顧客を選択し、案件にチェックを入れてください</p>
                </div>
            )}

            <ConditionNotes notes={notes} setNotes={setNotes} />

            {/* 合計エリア */}
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
