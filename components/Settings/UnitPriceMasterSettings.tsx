'use client';

import React, { useState, useEffect } from 'react';
import { useUnitPriceMaster } from '@/hooks/useUnitPriceMaster';
import { UnitPriceMaster, UnitPriceMasterInput, TEMPLATE_LABELS, TemplateType } from '@/types/unitPrice';
import { Plus, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function UnitPriceMasterSettings() {
    const { unitPrices, ensureDataLoaded, addUnitPrice, updateUnitPrice, deleteUnitPrice } = useUnitPriceMaster();

    // コンポーネント表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
    }, [ensureDataLoaded]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<UnitPriceMaster | null>(null);
    const [filterTemplate, setFilterTemplate] = useState<TemplateType | 'all'>('all');

    const [formData, setFormData] = useState<UnitPriceMasterInput>({
        description: '',
        unit: '',
        unitPrice: 0,
        templates: [],
        notes: '',
    });

    const filteredUnitPrices = filterTemplate === 'all'
        ? unitPrices
        : unitPrices.filter(up => up.templates.includes(filterTemplate));

    const handleOpenForm = (item?: UnitPriceMaster) => {
        if (item) {
            setEditingItem(item);
            setFormData({
                description: item.description,
                unit: item.unit,
                unitPrice: item.unitPrice,
                templates: item.templates,
                notes: item.notes || '',
            });
        } else {
            setEditingItem(null);
            setFormData({
                description: '',
                unit: '',
                unitPrice: 0,
                templates: [],
                notes: '',
            });
        }
        setIsFormOpen(true);
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingItem(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.description || !formData.unit) {
            toast.error('品目と単位は必須です');
            return;
        }

        if (editingItem) {
            updateUnitPrice(editingItem.id, formData);
        } else {
            addUnitPrice(formData);
        }

        handleCloseForm();
    };

    const handleDelete = (id: string, description: string) => {
        if (confirm(`「${description}」を削除してもよろしいですか？`)) {
            deleteUnitPrice(id);
        }
    };

    const toggleTemplate = (template: TemplateType) => {
        setFormData(prev => ({
            ...prev,
            templates: prev.templates.includes(template)
                ? prev.templates.filter(t => t !== template)
                : [...prev.templates, template],
        }));
    };

    return (
        <div className="space-y-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg md:text-2xl font-bold text-gray-900">単価マスター管理</h2>
                <button
                    onClick={() => handleOpenForm()}
                    className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 text-sm md:text-base bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-lg hover:from-slate-800 hover:to-slate-900 transition-all"
                >
                    <Plus className="w-4 h-4 md:w-5 md:h-5" />
                    新規登録
                </button>
            </div>

            {/* テンプレートフィルター */}
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">テンプレートで絞り込み</label>
                <select
                    value={filterTemplate}
                    onChange={(e) => setFilterTemplate(e.target.value as TemplateType | 'all')}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                    <option value="all">全て</option>
                    {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>

            {/* 一覧 */}
            {filteredUnitPrices.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">単価マスターが登録されていません</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {filteredUnitPrices.map(item => (
                        <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-4">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-gray-900">{item.description}</h3>
                                    <div className="mt-2 space-y-1 text-sm text-gray-600">
                                        <p>単位: {item.unit} / 単価: ¥{item.unitPrice.toLocaleString()}</p>
                                        {item.templates.length > 0 && (
                                            <p>テンプレート: {item.templates.map(t => TEMPLATE_LABELS[t]).join(', ')}</p>
                                        )}
                                        {item.notes && <p className="text-gray-500">備考: {item.notes}</p>}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleOpenForm(item)}
                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id, item.description)}
                                        className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 登録・編集フォームモーダル */}
            {isFormOpen && (
                <div className="fixed inset-0 lg:left-64 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-2 md:p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-4 md:p-6">
                            <h3 className="text-xl font-bold text-gray-900 mb-4">
                                {editingItem ? '単価マスター編集' : '単価マスター登録'}
                            </h3>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* 品目・内容 */}
                                <div>
                                    <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
                                        品目・内容 <span className="text-slate-500">*</span>
                                    </label>
                                    <input
                                        id="description"
                                        type="text"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="例: 足場組立"
                                        required
                                    />
                                </div>

                                {/* 単位と単価 */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="unit" className="block text-sm font-semibold text-gray-700 mb-2">
                                            単位 <span className="text-slate-500">*</span>
                                        </label>
                                        <input
                                            id="unit"
                                            type="text"
                                            value={formData.unit}
                                            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="例: 式、m、個、日"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="unitPrice" className="block text-sm font-semibold text-gray-700 mb-2">
                                            単価 <span className="text-slate-500">*</span>
                                        </label>
                                        <input
                                            id="unitPrice"
                                            type="number"
                                            value={formData.unitPrice}
                                            onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            placeholder="50000"
                                            required
                                            min="0"
                                        />
                                    </div>
                                </div>

                                {/* テンプレート */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                                        所属するテンプレート
                                    </label>
                                    <div className="space-y-2">
                                        {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                                            <label key={key} className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={formData.templates.includes(key as TemplateType)}
                                                    onChange={() => toggleTemplate(key as TemplateType)}
                                                    className="w-4 h-4 text-slate-600 border-gray-300 rounded focus:ring-slate-500"
                                                />
                                                <span className="text-sm text-gray-700">{label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* 備考 */}
                                <div>
                                    <label htmlFor="notes" className="block text-sm font-semibold text-gray-700 mb-2">
                                        備考
                                    </label>
                                    <textarea
                                        id="notes"
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="備考を入力..."
                                    />
                                </div>

                                {/* ボタン */}
                                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                                    <button
                                        type="button"
                                        onClick={handleCloseForm}
                                        className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-6 py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-lg hover:from-slate-800 hover:to-slate-900 transition-all"
                                    >
                                        保存
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
