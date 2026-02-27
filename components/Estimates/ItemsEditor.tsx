'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';
import { Plus, Minus, Layers } from 'lucide-react';
import { ItemTableRow, ItemCard } from './ItemRow';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    arrayMove,
} from '@dnd-kit/sortable';

interface ItemsEditorProps {
    items: EstimateItem[];
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
    onAddItem: () => void;
    onAddDiscountItem: () => void;
    onAddGroupItem?: () => void;
    onReorder?: (items: EstimateItem[]) => void;
    onOpenUnitPriceModal: () => void;
}

export default function ItemsEditor({ items, onUpdate, onRemove, onMoveUp, onMoveDown, onAddItem, onAddDiscountItem, onAddGroupItem, onReorder, onOpenUnitPriceModal }: ItemsEditorProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            const oldIndex = items.findIndex(i => i.id === active.id);
            const newIndex = items.findIndex(i => i.id === over.id);
            const reordered = arrayMove(items, oldIndex, newIndex);
            onReorder?.(reordered);
        }
    };

    // グループの子明細の合計を計算
    const getGroupAmount = (groupId: string) => {
        return items.filter(i => i.groupId === groupId).reduce((sum, i) => sum + i.amount, 0);
    };

    const rowProps = (item: EstimateItem, index: number) => ({
        item, index, totalItems: items.length,
        onUpdate, onRemove, onMoveUp, onMoveDown,
        groupAmount: item.isGroup ? getGroupAmount(item.id) : undefined,
    });

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-semibold text-gray-700">明細</label>
                <div className="flex flex-wrap gap-2 justify-end">
                    <button type="button" onClick={onOpenUnitPriceModal} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 active:bg-slate-900 transition-colors">
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">マスターから</span>追加
                    </button>
                    {onAddGroupItem && (
                        <button type="button" onClick={onAddGroupItem} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
                            <Layers className="w-4 h-4" />大項目
                        </button>
                    )}
                    <button type="button" onClick={onAddItem} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 active:bg-slate-900 transition-colors">
                        <Plus className="w-4 h-4" />行追加
                    </button>
                    <button type="button" onClick={onAddDiscountItem} className="flex items-center gap-1 px-3 py-2 md:py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 active:bg-amber-800 transition-colors">
                        <Minus className="w-4 h-4" />値引き
                    </button>
                </div>
            </div>

            {/* デスクトップ: テーブル表示 with dnd */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                    <div className="hidden md:block border border-gray-300 rounded-lg overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-1 py-2 text-center text-xs font-semibold text-gray-700 border-b border-gray-300 w-8"></th>
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
                                    <ItemTableRow key={item.id} {...rowProps(item, index)} />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* モバイル: カード表示 */}
                    <div className="md:hidden space-y-3">
                        {items.map((item, index) => (
                            <ItemCard key={item.id} {...rowProps(item, index)} />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    );
}
