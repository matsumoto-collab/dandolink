'use client';

import React, { useState, useEffect } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import { useCustomers } from '@/contexts/CustomerContext';
import { EstimateInput, EstimateItem } from '@/types/estimate';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import CustomerModal from '../Customers/CustomerModal';
import UnitPriceMasterModal from './UnitPriceMasterModal';
import { UnitPriceMaster } from '@/types/unitPrice';

interface EstimateFormProps {
    initialData?: Partial<EstimateInput>;
    onSubmit: (data: EstimateInput) => void;
    onCancel: () => void;
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

    // タイトルテンプレート
    const titleTemplates = [
        { id: 'custom', label: 'カスタム（手動入力）', format: '' },
        { id: 'sama_kasetsu', label: '○○様 仮設工事', format: '{siteName}様 仮設工事' },
        { id: 'samatei_kasetsu', label: '○○様邸 仮設工事', format: '{siteName}様邸 仮設工事' },
        { id: 'sama_shinchiku', label: '○○様 新築工事', format: '{siteName}様 新築工事' },
        { id: 'samatei_shinchiku', label: '○○様邸 新築工事', format: '{siteName}様邸 新築工事' },
        { id: 'genba', label: '○○現場 仮設工事', format: '{siteName} 仮設工事' },
        { id: 'mitsumori', label: '○○ 見積書', format: '{siteName} 見積書' },
    ];

    // テンプレート選択時にタイトルを自動生成
    const handleTemplateChange = (templateId: string) => {
        setSelectedTemplate(templateId);
        const template = titleTemplates.find(t => t.id === templateId);
        if (template && template.format && siteName) {
            const generatedTitle = template.format.replace('{siteName}', siteName);
            setTitle(generatedTitle);
        }
    };
    const [estimateNumber, setEstimateNumber] = useState(() => {
        if (initialData?.estimateNumber) {
            return initialData.estimateNumber;
        }
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}${hours}${minutes}${seconds}`;
    });
    const [validUntil, setValidUntil] = useState(() => {
        if (initialData?.validUntil) {
            return new Date(initialData.validUntil).toISOString().split('T')[0];
        }
        return '\u767a\u884c\u65e5\u3088\u308a1\u30f6\u6708';
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

                // 元請会社から顧客を検索（正式名称、略称、部分一致で検索）
                if (selectedProject.customer) {
                    const customerName = selectedProject.customer;

                    // 1. 完全一致で検索（正式名称）
                    let customer = customers.find(c => c.name === customerName);

                    // 2. 略称で検索
                    if (!customer) {
                        customer = customers.find(c => c.shortName === customerName);
                    }

                    // 3. 正式名称に案件の元請名が含まれるか検索
                    if (!customer) {
                        customer = customers.find(c => c.name.includes(customerName));
                    }

                    // 4. 略称に案件の元請名が含まれるか検索
                    if (!customer) {
                        customer = customers.find(c => c.shortName?.includes(customerName));
                    }

                    // 5. 案件の元請名が正式名称または略称に含まれるか検索
                    if (!customer) {
                        customer = customers.find(c =>
                            customerName.includes(c.name) ||
                            (c.shortName && customerName.includes(c.shortName))
                        );
                    }

                    if (customer) {
                        setCustomerId(customer.id);
                    } else {
                        // 顧客が見つからない場合、customerId をクリア
                        setCustomerId('');
                    }
                }

                if (!title) {
                    setTitle(`${selectedProject.title} 見積書`);
                }
            }
        }
    }, [projectId, projects, customers, title]);

    // 消費税率
    const TAX_RATE = 0.1;

    // 金額計算（税区分に応じて計算）
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);

    // 税区分が「standard」(10%)の項目のみ消費税を計算
    const taxableAmount = items
        .filter(item => item.taxType === 'standard')
        .reduce((sum, item) => sum + item.amount, 0);

    const tax = Math.floor(taxableAmount * TAX_RATE);
    const total = subtotal + tax;

    // 明細行の追加
    const addItem = () => {
        setItems([...items, {
            id: `item-${Date.now()}`,
            description: '',
            specification: '',
            quantity: 1,
            unit: '',
            unitPrice: 0,
            amount: 0,
            taxType: 'standard',
            notes: '',
        }]);
    };

    // 単価マスターから選択した項目を追加
    const handleSelectFromMaster = (selectedMasters: UnitPriceMaster[]) => {
        const newItems = selectedMasters.map(master => ({
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description: master.description,
            specification: '',
            quantity: 1,
            unit: master.unit,
            unitPrice: master.unitPrice,
            amount: master.unitPrice,
            taxType: 'standard' as const,
            notes: '',
        }));

        // 既存の行から空の行（未入力の行）を除外
        const nonEmptyItems = items.filter(item =>
            item.description.trim() !== '' || item.unitPrice > 0
        );

        setItems([...nonEmptyItems, ...newItems]);
        setIsUnitPriceModalOpen(false);
    };

    // 明細行の削除
    const removeItem = (id: string) => {
        if (items.length > 1) {
            setItems(items.filter(item => item.id !== id));
        }
    };

    // 明細行の更新
    const updateItem = (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => {
        setItems(items.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };
                // 金額を自動計算
                if (field === 'quantity' || field === 'unitPrice') {
                    updated.amount = updated.quantity * updated.unitPrice;
                }
                return updated;
            }
            return item;
        }));
    };

    // 明細行を上に移動
    const moveItemUp = (index: number) => {
        if (index === 0) return; // 最初の行は上に移動できない
        const newItems = [...items];
        [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
        setItems(newItems);
    };

    // 明細行を下に移動
    const moveItemDown = (index: number) => {
        if (index === items.length - 1) return; // 最後の行は下に移動できない
        const newItems = [...items];
        [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
        setItems(newItems);
    };

    // 送信
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!title) {
            toast.error('タイトルは必須です');
            return;
        }

        const data: EstimateInput = {
            projectId: projectId || undefined,
            estimateNumber,
            title,
            items,
            subtotal,
            tax,
            total,
            validUntil: new Date(validUntil),
            status,
            notes: notes || undefined,
        };

        onSubmit(data);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* 基本情報 */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        案件（オプション）
                    </label>
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">案件を選択（任意）</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>
                                {project.title}{project.customer ? ` (${project.customer})` : ''}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                        案件を選択すると現場名・元請会社が自動入力されます
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        見積番号
                    </label>
                    <input
                        type="text"
                        value={estimateNumber}
                        onChange={(e) => setEstimateNumber(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        タイトルテンプレート
                    </label>
                    <select
                        value={selectedTemplate}
                        onChange={(e) => handleTemplateChange(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {titleTemplates.map(template => (
                            <option key={template.id} value={template.id}>
                                {template.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                        テンプレートを選択すると、現場名を使ってタイトルが自動生成されます
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        タイトル <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value);
                            setSelectedTemplate('custom'); // 手動編集時はカスタムに
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                        placeholder="例: ○○現場 見積書"
                    />
                </div>
            </div>

            {/* 現場情報 */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        現場名
                    </label>
                    <input
                        type="text"
                        value={siteName}
                        onChange={(e) => setSiteName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="案件を選択するか手動で入力"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        元請会社（顧客）
                    </label>
                    <div className="flex gap-2">
                        <select
                            value={customerId}
                            onChange={(e) => setCustomerId(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">選択してください</option>
                            {customers.map(customer => (
                                <option key={customer.id} value={customer.id}>
                                    {customer.name}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => setIsCustomerModalOpen(true)}
                            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
                        >
                            + 新規顧客
                        </button>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        有効期限（発行日より1ヶ月）
                    </label>
                    <input
                        type={validUntil === '発行日より1ヶ月' ? 'text' : 'date'}
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        onFocus={(e) => {
                            if (validUntil === '発行日より1ヶ月') {
                                const date = new Date();
                                date.setMonth(date.getMonth() + 1);
                                setValidUntil(date.toISOString().split('T')[0]);
                                setTimeout(() => {
                                    e.target.type = 'date';
                                    e.target.focus();
                                }, 0);
                            }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        ステータス
                    </label>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as EstimateInput['status'])}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="draft">下書き</option>
                        <option value="sent">送付済み</option>
                        <option value="approved">承認済み</option>
                        <option value="rejected">却下</option>
                    </select>
                </div>
            </div>

            {/* 明細 */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-semibold text-gray-700">
                        明細
                    </label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setIsUnitPriceModalOpen(true)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            マスターから追加
                        </button>
                        <button
                            type="button"
                            onClick={addItem}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            行追加
                        </button>
                    </div>
                </div>

                <div className="border border-gray-300 rounded-lg overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300">品目・内容</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-32">規格</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-20">数量</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-24">単位</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-32">単価</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-32">金額</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-28">税区分</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b border-gray-300 w-32">備考</th>
                                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-700 border-b border-gray-300 w-20">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, index) => (
                                <tr key={item.id} className="border-b border-gray-200 last:border-b-0">
                                    <td className="px-3 py-2">
                                        <input
                                            type="text"
                                            value={item.description}
                                            onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="品目・内容"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            type="text"
                                            value={item.specification || ''}
                                            onChange={(e) => updateItem(item.id, 'specification', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="規格"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                updateItem(item.id, 'quantity', isNaN(val) ? 0 : val);
                                            }}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            step="0.01"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            type="text"
                                            value={item.unit || ''}
                                            onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="式、m、個"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            type="number"
                                            value={item.unitPrice}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value);
                                                updateItem(item.id, 'unitPrice', isNaN(val) ? 0 : val);
                                            }}
                                            className={`w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${item.unitPrice < 0 ? 'text-red-600' : ''}`}
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className={`text-right font-medium ${item.amount < 0 ? 'text-red-600' : ''}`}>
                                            {item.amount < 0 ? `(${Math.abs(item.amount).toLocaleString()})` : `¥${item.amount.toLocaleString()}`}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <select
                                            value={item.taxType}
                                            onChange={(e) => updateItem(item.id, 'taxType', e.target.value as 'none' | 'standard')}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        >
                                            <option value="standard">10%</option>
                                            <option value="none">なし</option>
                                        </select>
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            type="text"
                                            value={item.notes || ''}
                                            onChange={(e) => updateItem(item.id, 'notes', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="備考"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => moveItemUp(index)}
                                                disabled={index === 0}
                                                className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                title="上に移動"
                                            >
                                                <ChevronUp className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => moveItemDown(index)}
                                                disabled={index === items.length - 1}
                                                className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                title="下に移動"
                                            >
                                                <ChevronDown className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeItem(item.id)}
                                                className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 合計 */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                    <span className="text-gray-700">小計:</span>
                    <span className="font-semibold">¥{subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                    <span className="text-gray-700">消費税(10%):</span>
                    <span className="font-semibold">¥{tax.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg border-t border-gray-300 pt-2">
                    <span className="font-bold text-gray-900">合計:</span>
                    <span className="font-bold text-blue-600">¥{total.toLocaleString()}</span>
                </div>
            </div>

            {/* 備考 */}
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                    備考
                </label>
                <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="備考を入力..."
                />
            </div>

            {/* ボタン */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                    キャンセル
                </button>
                <button
                    type="submit"
                    className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg"
                >
                    保存
                </button>
            </div>

            {/* 顧客登録モーダル */}
            <CustomerModal
                isOpen={isCustomerModalOpen}
                onClose={() => setIsCustomerModalOpen(false)}
                onSubmit={(data) => {
                    addCustomer(data);
                    setIsCustomerModalOpen(false);
                }}
                title="新規顧客登録"
            />

            {/* 単価マスター選択モーダル */}
            <UnitPriceMasterModal
                isOpen={isUnitPriceModalOpen}
                onClose={() => setIsUnitPriceModalOpen(false)}
                onSelect={handleSelectFromMaster}
            />
        </form>
    );
}

