'use client';

import React, { useState, useMemo } from 'react';
import { useUnitPriceMaster } from '@/hooks/useUnitPriceMaster';
import { UnitPriceMaster, TemplateType, TEMPLATE_LABELS } from '@/types/unitPrice';
import { X } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface UnitPriceMasterModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (items: UnitPriceMaster[]) => void;
}

export default function UnitPriceMasterModal({ isOpen, onClose, onSelect }: UnitPriceMasterModalProps) {
    const { getUnitPricesByTemplate } = useUnitPriceMaster();
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('frequent');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const modalRef = useModalKeyboard(isOpen, onClose);

    // テンプレートで絞り込んだ項目を取得
    const templateItems = useMemo(() => {
        return getUnitPricesByTemplate(selectedTemplate);
    }, [selectedTemplate, getUnitPricesByTemplate]);

    // 項目の選択/選択解除
    const toggleItem = (id: string) => {
        const newSelected = new Set(selectedItems);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedItems(newSelected);
    };

    // 選択した項目を追加
    const handleAdd = () => {
        const itemsToAdd = templateItems.filter(item => selectedItems.has(item.id));
        onSelect(itemsToAdd);
        setSelectedItems(new Set());
        onClose();
    };

    // モーダルを閉じる
    const handleClose = () => {
        setSelectedItems(new Set());
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* ヘッダー */}
                <div className="p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold text-gray-900">単価マスターから項目を追加</h3>
                        <button
                            onClick={handleClose}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 用途タブ */}
                <div className="px-6 pt-4 border-b border-gray-200">
                    <div className="flex gap-2 overflow-x-auto">
                        {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => {
                                    setSelectedTemplate(key as TemplateType);
                                    setSelectedItems(new Set());
                                }}
                                className={`px-4 py-2 rounded-t-lg font-medium whitespace-nowrap transition-colors ${selectedTemplate === key
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 項目一覧 */}
                <div className="flex-1 overflow-y-auto p-6">
                    {templateItems.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            該当する項目がありません
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {templateItems.map(item => (
                                <label
                                    key={item.id}
                                    className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${selectedItems.has(item.id)
                                        ? 'border-slate-500 bg-slate-50'
                                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedItems.has(item.id)}
                                        onChange={() => toggleItem(item.id)}
                                        className="mt-1 w-4 h-4 text-slate-600 border-gray-300 rounded focus:ring-slate-500"
                                    />
                                    <div className="flex-1">
                                        <div className="font-semibold text-gray-900">{item.description}</div>
                                        <div className="text-sm text-gray-600 mt-1">
                                            単位: {item.unit} / 単価: ¥{item.unitPrice.toLocaleString()}
                                        </div>
                                        {item.notes && (
                                            <div className="text-xs text-gray-500 mt-1">
                                                備考: {item.notes}
                                            </div>
                                        )}
                                    </div>
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                {/* フッター */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                            選択中: <span className="font-bold text-gray-900">{selectedItems.size}件</span>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleClose}
                                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={handleAdd}
                                disabled={selectedItems.size === 0}
                                className="px-6 py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-lg hover:from-slate-800 hover:to-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                追加 ({selectedItems.size}件)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
