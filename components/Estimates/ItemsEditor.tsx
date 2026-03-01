'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';
import { Plus, Star, ClipboardList, PenLine } from 'lucide-react';
import { ItemTableRow, ItemCard } from './ItemRow';

interface ItemsEditorProps {
    items: EstimateItem[];
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
    onAddItem: () => void;
    onOpenUnitPriceModal: () => void;
}

export default function ItemsEditor({ items, onUpdate, onRemove, onMoveUp, onMoveDown, onAddItem, onOpenUnitPriceModal }: ItemsEditorProps) {
    const rowProps = (item: EstimateItem, index: number) => ({
        item, index, totalItems: items.length,
        onUpdate, onRemove, onMoveUp, onMoveDown,
    });

    return (
        <div>
            {/* ツールバー */}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                    {/* マスターに登録 */}
                    <button
                        type="button"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        title="マスターに登録（未実装）"
                        disabled
                    >
                        <Star className="w-3.5 h-3.5" />
                        マスターに登録
                    </button>
                    {/* 単価マスターから一括追加 */}
                    <button
                        type="button"
                        onClick={onOpenUnitPriceModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    >
                        <ClipboardList className="w-3.5 h-3.5" />
                        単価マスターから一括追加
                    </button>
                    {/* 項目を選択して一括入力 */}
                    <button
                        type="button"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 active:bg-gray-100 transition-colors"
                        title="項目を選択して一括入力（未実装）"
                        disabled
                    >
                        <PenLine className="w-3.5 h-3.5" />
                        項目を選択して一括入力
                    </button>
                </div>
            </div>

            {/* デスクトップ: テーブル表示 */}
            <div className="hidden md:block border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full min-w-[800px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">項目</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">規格</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">数量</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">単位</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-28">単価</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-24">税率</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-28">金額</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-28">備考</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-20">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => (
                            <ItemTableRow key={item.id} {...rowProps(item, index)} />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* テーブル下部の行追加ボタン */}
            <div className="mt-2 flex items-center gap-3 flex-wrap">
                <button
                    type="button"
                    onClick={onAddItem}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    項目行を追加
                </button>
            </div>

            {/* 操作ヒント（デスクトップのみ） */}
            <p className="hidden md:block mt-1.5 text-xs text-gray-400">
                各行はドラッグ&amp;ドロップで並び替えられます。Enter (+Shift) / Tab (+Shift) キーでセルの移動ができます。
            </p>

            {/* モバイル: カード表示 */}
            <div className="md:hidden space-y-3 mt-3">
                {items.map((item, index) => (
                    <ItemCard key={item.id} {...rowProps(item, index)} />
                ))}
            </div>
        </div>
    );
}
