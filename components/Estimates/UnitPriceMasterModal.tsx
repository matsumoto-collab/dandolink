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
    const { unitPrices, ensureDataLoaded } = useUnitPriceMaster();
    const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('frequent');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const modalRef = useModalKeyboard(isOpen, onClose);

    // テンプレートで絞り込んだ項目を取得
    const templateItems = useMemo(() => {
        return unitPrices.filter(up => up.templates.includes(selectedTemplate));
    }, [selectedTemplate, unitPrices]);

    // モーダルが開いたときにデータを確実にロードする
    React.useEffect(() => {
        if (isOpen) {
            ensureDataLoaded();
        }
    }, [isOpen, ensureDataLoaded]);

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
        <div className="fixed inset-0 lg:left-64 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black/50 hidden lg:block" onClick={handleClose} />
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-4xl lg:mx-4 lg:max-h-[90vh] overflow-hidden">
                {/* ヘッダー */}
                <div className="p-6 border-b border-slate-200">
                    <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold text-slate-900">単価マスターから項目を追加</h3>
                        <button
                            onClick={handleClose}
                            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 用途タブ */}
                <div className="px-6 pt-4 border-b border-slate-200">
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
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                        <div className="text-center py-12 text-slate-500">
                            該当する項目がありません
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {templateItems.map(item => (
                                <label
                                    key={item.id}
                                    className={`flex items-start gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${selectedItems.has(item.id)
                                        ? 'border-slate-500 bg-slate-50'
                                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedItems.has(item.id)}
                                        onChange={() => toggleItem(item.id)}
                                        className="mt-1 w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                    />
                                    <div className="flex-1">
                                        <div className="font-semibold text-slate-900">{item.description}</div>
                                        <div className="text-sm text-slate-600 mt-1">
                                            単位: {item.unit} / 単価: ¥{item.unitPrice.toLocaleString()}
                                        </div>
                                        {item.notes && (
                                            <div className="text-xs text-slate-500 mt-1">
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
                <div className="p-6 border-t border-slate-200 bg-slate-50">
                    <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-600">
                            選択中: <span className="font-bold text-slate-900">{selectedItems.size}件</span>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={handleClose}
                                className="px-6 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={handleAdd}
                                disabled={selectedItems.size === 0}
                                className="px-6 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
