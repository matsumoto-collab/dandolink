'use client';

import React, { useState } from 'react';
import { useProjects } from '@/contexts/ProjectContext';
import { useEstimates } from '@/contexts/EstimateContext';
import { InvoiceInput } from '@/types/invoice';
import { EstimateItem } from '@/types/estimate';
import { Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface InvoiceFormProps {
    initialData?: Partial<InvoiceInput>;
    onSubmit: (data: InvoiceInput) => void;
    onCancel: () => void;
}

export default function InvoiceForm({ initialData, onSubmit, onCancel }: InvoiceFormProps) {
    const { projects } = useProjects();
    const { estimates } = useEstimates();
    const [projectId, setProjectId] = useState(initialData?.projectId || '');
    const [estimateId, setEstimateId] = useState(initialData?.estimateId || '');
    const [title, setTitle] = useState(initialData?.title || '');
    const [invoiceNumber, setInvoiceNumber] = useState(initialData?.invoiceNumber || `INV-${Date.now()}`);
    const [dueDate, setDueDate] = useState(() => {
        if (initialData?.dueDate) {
            return new Date(initialData.dueDate).toISOString().split('T')[0];
        }
        const date = new Date();
        date.setDate(date.getDate() + 30);
        return date.toISOString().split('T')[0];
    });
    const [status, setStatus] = useState<InvoiceInput['status']>(initialData?.status || 'draft');
    const [paidDate, setPaidDate] = useState(() => {
        if (initialData?.paidDate) {
            return new Date(initialData.paidDate).toISOString().split('T')[0];
        }
        return '';
    });
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [items, setItems] = useState<EstimateItem[]>(initialData?.items || [
        { id: `item-${Date.now()}`, description: '', quantity: 1, unitPrice: 0, amount: 0, taxType: 'standard' }
    ]);

    // 消費税率
    const TAX_RATE = 0.1;

    // 金額計算
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const tax = Math.floor(subtotal * TAX_RATE);
    const total = subtotal + tax;

    // 見積書から読み込み
    const loadFromEstimate = (estId: string) => {
        const estimate = estimates.find(e => e.id === estId);
        if (estimate) {
            setProjectId(estimate.projectId ?? '');
            setTitle(estimate.title);
            setItems(estimate.items);
            setNotes(estimate.notes || '');
        }
    };

    // 明細行の追加
    const addItem = () => {
        setItems([...items, {
            id: `item-${Date.now()}`,
            description: '',
            quantity: 1,
            unitPrice: 0,
            amount: 0,
            taxType: 'standard'
        }]);
    };

    // 明細行の削除
    const removeItem = (id: string) => {
        if (items.length > 1) {
            setItems(items.filter(item => item.id !== id));
        }
    };

    // 明細行の更新
    const updateItem = (id: string, field: keyof EstimateItem, value: any) => {
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

    // 送信
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!projectId || !title) {
            toast.error('案件とタイトルは必須です');
            return;
        }

        const data: InvoiceInput = {
            projectId,
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

        onSubmit(data);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* 基本情報 */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        見積書から読み込み
                    </label>
                    <select
                        value={estimateId}
                        onChange={(e) => {
                            setEstimateId(e.target.value);
                            if (e.target.value) {
                                loadFromEstimate(e.target.value);
                            }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">見積書を選択（任意）</option>
                        {estimates.map(estimate => (
                            <option key={estimate.id} value={estimate.id}>
                                {estimate.estimateNumber} - {estimate.title}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        請求番号
                    </label>
                    <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        案件 <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                    >
                        <option value="">案件を選択</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>
                                {project.title}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        タイトル <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        支払期限
                    </label>
                    <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                        ステータス
                    </label>
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as InvoiceInput['status'])}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="draft">下書き</option>
                        <option value="sent">送付済み</option>
                        <option value="paid">支払済み</option>
                        <option value="overdue">期限超過</option>
                    </select>
                </div>

                {status === 'paid' && (
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            支払日
                        </label>
                        <input
                            type="date"
                            value={paidDate}
                            onChange={(e) => setPaidDate(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                )}
            </div>

            {/* 明細 */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-semibold text-gray-700">
                        明細
                    </label>
                    <button
                        type="button"
                        onClick={addItem}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        行追加
                    </button>
                </div>

                <div className="border border-gray-300 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">品目・内容</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 w-24">数量</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 w-32">単価</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 w-32">金額</th>
                                <th className="px-4 py-3 w-12"></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {items.map((item) => (
                                <tr key={item.id}>
                                    <td className="px-4 py-2">
                                        <input
                                            type="text"
                                            value={item.description}
                                            onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            placeholder="品目・内容"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            min="0"
                                            step="0.1"
                                        />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input
                                            type="number"
                                            value={item.unitPrice}
                                            onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            min="0"
                                        />
                                    </td>
                                    <td className="px-4 py-2 text-right font-semibold">
                                        ¥{item.amount.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        <button
                                            type="button"
                                            onClick={() => removeItem(item.id)}
                                            disabled={items.length === 1}
                                            className="text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
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
        </form>
    );
}
