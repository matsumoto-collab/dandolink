'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';
import { Plus, Minus } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ItemTableRow, ItemCard } from './ItemRow';

interface ItemsEditorProps {
    items: EstimateItem[];
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onReorder: (oldIndex: number, newIndex: number) => void;
    onAddItem: () => void;
    onAddDiscountItem: () => void;
    onOpenUnitPriceModal: () => void;
}

export default function ItemsEditor({ items, onUpdate, onRemove, onReorder, onAddItem, onAddDiscountItem, onOpenUnitPriceModal }: ItemsEditorProps) {
    const rowProps = (item: EstimateItem, index: number) => ({
        item, index,
        onUpdate, onRemove,
    });

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // ドラッグ開始判定距離を5pxに設定（誤動作防止）
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex((item) => item.id === active.id);
            const newIndex = items.findIndex((item) => item.id === over.id);
            onReorder(oldIndex, newIndex);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-semibold text-gray-700">明細</label>
                <div className="flex flex-wrap gap-2 justify-end">
                    <button type="button" onClick={onOpenUnitPriceModal} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 active:bg-slate-900 transition-colors">
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">マスターから</span>追加
                    </button>
                    <button type="button" onClick={onAddItem} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 active:bg-slate-900 transition-colors">
                        <Plus className="w-4 h-4" />行追加
                    </button>
                    <button type="button" onClick={onAddDiscountItem} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 active:bg-amber-800 transition-colors">
                        <Minus className="w-4 h-4" />値引き
                    </button>
                </div>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                {/* デスクトップ: テーブル表示 */}
                <div className="hidden md:block border border-gray-300 rounded-lg overflow-x-auto">
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
                        <SortableContext
                            items={items.map(i => i.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <tbody className="bg-white">
                                {items.map((item, index) => (
                                    <ItemTableRow key={item.id} {...rowProps(item, index)} />
                                ))}
                            </tbody>
                        </SortableContext>
                    </table>
                </div>

                {/* モバイル: カード表示 */}
                <div className="md:hidden space-y-3">
                    <SortableContext
                        items={items.map(i => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {items.map((item, index) => (
                            <ItemCard key={item.id} {...rowProps(item, index)} />
                        ))}
                    </SortableContext>
                </div>
            </DndContext>
        </div>
    );
}
