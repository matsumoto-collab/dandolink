'use client';

import React, { useState } from 'react';
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EstimateItem } from '@/types/estimate';
import { UnitPriceMaster } from '@/types/unitPrice';
import { Plus, Star, ClipboardList, PenLine, ChevronDown, ChevronRight, FolderPlus, GripVertical } from 'lucide-react';
import { ItemTableRow, ItemCard } from './ItemRow';

interface ItemsEditorProps {
    items: EstimateItem[];
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
    onAddItem: () => void;
    onAddCategory?: () => void;
    onAddChildItem?: (categoryId: string) => void;
    onUpdateChildItem?: (categoryId: string, childId: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemoveChildItem?: (categoryId: string, childId: string) => void;
    onMoveChildItem?: (categoryId: string, childIndex: number, direction: 'up' | 'down') => void;
    onReorder?: (fromIndex: number, toIndex: number) => void;
    onOpenUnitPriceModal: () => void;
    hideAddButtons?: boolean;
    unitPriceMasters?: UnitPriceMaster[];
    onSelectMaster?: (itemId: string, master: UnitPriceMaster) => void;
}

/** カテゴリ行（デスクトップ） */
function CategoryTableRow({
    item, index, totalItems, isExpanded, onToggle,
    onUpdate, onRemove, onMoveUp, onMoveDown,
    sortableRef, sortableStyle, sortableAttributes, dragListeners,
}: {
    item: EstimateItem; index: number; totalItems: number;
    isExpanded: boolean; onToggle: () => void;
    onUpdate: ItemsEditorProps['onUpdate'];
    onRemove: ItemsEditorProps['onRemove'];
    onMoveUp: ItemsEditorProps['onMoveUp'];
    onMoveDown: ItemsEditorProps['onMoveDown'];
    sortableRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, unknown>;
    dragListeners?: Record<string, unknown>;
}) {
    const { ChevronUp, ChevronDown: ChevronDownIcon, Trash2 } = require('lucide-react');
    return (
        <tr ref={sortableRef} style={sortableStyle} {...(sortableAttributes || {})} className="border-b border-slate-200 bg-slate-50">
            {dragListeners && (
                <td className="px-1 py-2 w-8">
                    <button type="button" className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600" {...dragListeners}>
                        <GripVertical className="w-4 h-4" />
                    </button>
                </td>
            )}
            <td className="px-3 py-2" colSpan={6}>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onToggle} className="p-0.5 text-slate-500 hover:text-slate-700">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <input
                        type="text"
                        value={item.description}
                        onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
                        className="flex-1 px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500 font-medium"
                        placeholder="カテゴリ名（例: 仮設工事）"
                    />
                </div>
            </td>
            <td className="px-3 py-2">
                <div className="text-right font-bold text-slate-800">
                    ¥{item.amount.toLocaleString()}
                </div>
            </td>
            <td className="px-3 py-2">
                <span className="text-xs text-slate-400">{(item.children || []).length}項目</span>
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="p-1 text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-30" title="上に移動">
                        <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onMoveDown(index)} disabled={index === totalItems - 1} className="p-1 text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-30" title="下に移動">
                        <ChevronDownIcon className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onRemove(item.id)} className="p-1 text-slate-600 hover:bg-slate-50 rounded transition-colors" title="削除">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}

/** カテゴリ行（モバイル） */
function CategoryCard({
    item, index, totalItems, isExpanded, onToggle,
    onUpdate, onRemove, onMoveUp, onMoveDown,
    onAddChildItem, onUpdateChildItem, onRemoveChildItem, onMoveChildItem,
    unitPriceMasters, onSelectMaster,
}: {
    item: EstimateItem; index: number; totalItems: number;
    isExpanded: boolean; onToggle: () => void;
    onUpdate: ItemsEditorProps['onUpdate'];
    onRemove: ItemsEditorProps['onRemove'];
    onMoveUp: ItemsEditorProps['onMoveUp'];
    onMoveDown: ItemsEditorProps['onMoveDown'];
    onAddChildItem: (categoryId: string) => void;
    onUpdateChildItem: (categoryId: string, childId: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemoveChildItem: (categoryId: string, childId: string) => void;
    onMoveChildItem: (categoryId: string, childIndex: number, direction: 'up' | 'down') => void;
    unitPriceMasters?: UnitPriceMaster[];
    onSelectMaster?: (itemId: string, master: UnitPriceMaster) => void;
}) {
    const { ChevronUp, ChevronDown: ChevronDownIcon, Trash2 } = require('lucide-react');
    const children = item.children || [];

    return (
        <div className="bg-white border border-slate-300 rounded-xl shadow-sm overflow-hidden">
            {/* カテゴリヘッダー */}
            <div className="bg-slate-50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button type="button" onClick={onToggle} className="p-1 text-slate-500">
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </button>
                    <input
                        type="text"
                        value={item.description}
                        onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base font-medium"
                        placeholder="カテゴリ名"
                    />
                </div>
                <div className="flex items-center gap-1 ml-2">
                    <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="p-2 text-slate-500 disabled:opacity-30"><ChevronUp className="w-5 h-5" /></button>
                    <button type="button" onClick={() => onMoveDown(index)} disabled={index === totalItems - 1} className="p-2 text-slate-500 disabled:opacity-30"><ChevronDownIcon className="w-5 h-5" /></button>
                    <button type="button" onClick={() => onRemove(item.id)} className="p-2 text-red-500"><Trash2 className="w-5 h-5" /></button>
                </div>
            </div>
            {/* 合計 */}
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs text-slate-500">{children.length}項目</span>
                <span className="font-bold text-slate-800">¥{item.amount.toLocaleString()}</span>
            </div>
            {/* 子項目 */}
            {isExpanded && (
                <div className="p-3 space-y-3 border-t border-slate-200">
                    {children.map((child, ci) => (
                        <ItemCard
                            key={child.id}
                            item={child}
                            index={ci}
                            totalItems={children.length}
                            onUpdate={(id, field, value) => onUpdateChildItem(item.id, id, field, value)}
                            onRemove={(id) => onRemoveChildItem(item.id, id)}
                            onMoveUp={(idx) => onMoveChildItem(item.id, idx, 'up')}
                            onMoveDown={(idx) => onMoveChildItem(item.id, idx, 'down')}
                            unitPriceMasters={unitPriceMasters}
                            onSelectMaster={onSelectMaster}
                        />
                    ))}
                    <button
                        type="button"
                        onClick={() => onAddChildItem(item.id)}
                        className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 w-full justify-center py-2"
                    >
                        <Plus className="w-4 h-4" /> 項目を追加
                    </button>
                </div>
            )}
        </div>
    );
}

/** ドラッグ可能なテーブル行ラッパー */
function SortableItemTableRow(props: React.ComponentProps<typeof ItemTableRow>) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id });
    return (
        <ItemTableRow
            {...props}
            sortableRef={setNodeRef}
            sortableStyle={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
            sortableAttributes={attributes as unknown as Record<string, unknown>}
            dragListeners={listeners as unknown as Record<string, unknown>}
        />
    );
}

/** ドラッグ可能なカテゴリ行ラッパー */
function SortableCategoryTableRow(props: React.ComponentProps<typeof CategoryTableRow>) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.item.id });
    return (
        <CategoryTableRow
            {...props}
            sortableRef={setNodeRef}
            sortableStyle={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
            sortableAttributes={attributes as unknown as Record<string, unknown>}
            dragListeners={listeners as unknown as Record<string, unknown>}
        />
    );
}

export default function ItemsEditor({
    items, onUpdate, onRemove, onMoveUp, onMoveDown, onAddItem,
    onAddCategory, onAddChildItem, onUpdateChildItem, onRemoveChildItem, onMoveChildItem,
    onReorder, onOpenUnitPriceModal, hideAddButtons, unitPriceMasters, onSelectMaster,
}: ItemsEditorProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id || !onReorder) return;
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) onReorder(oldIndex, newIndex);
    };

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const rowProps = (item: EstimateItem, index: number) => ({
        item, index, totalItems: items.length,
        onUpdate, onRemove, onMoveUp, onMoveDown,
        unitPriceMasters, onSelectMaster,
    });

    return (
        <div>
            {/* ツールバー */}
            {!hideAddButtons && <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 active:bg-slate-100 transition-colors" title="マスターに登録（未実装）" disabled>
                        <Star className="w-3.5 h-3.5" /> マスターに登録
                    </button>
                    <button type="button" onClick={onOpenUnitPriceModal} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 active:bg-slate-100 transition-colors">
                        <ClipboardList className="w-3.5 h-3.5" /> 単価マスターから一括追加
                    </button>
                    <button type="button" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 active:bg-slate-100 transition-colors" title="項目を選択して一括入力（未実装）" disabled>
                        <PenLine className="w-3.5 h-3.5" /> 項目を選択して一括入力
                    </button>
                </div>
            </div>}

            {/* デスクトップ: テーブル表示 */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            <div className="hidden md:block border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full min-w-[800px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="w-8"></th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">項目</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 w-28">規格</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 w-20">数量</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 w-20">単位</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 w-28">単価</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 w-24">税率</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 w-28">金額</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600 w-28">備考</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 w-20">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => {
                            if (item.isCategory && onUpdateChildItem && onRemoveChildItem && onMoveChildItem && onAddChildItem) {
                                const isExpanded = expandedCategories.has(item.id);
                                const children = item.children || [];
                                return (
                                    <React.Fragment key={item.id}>
                                        <SortableCategoryTableRow
                                            item={item} index={index} totalItems={items.length}
                                            isExpanded={isExpanded} onToggle={() => toggleCategory(item.id)}
                                            onUpdate={onUpdate} onRemove={onRemove} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
                                        />
                                        {isExpanded && children.map((child, ci) => (
                                            <ItemTableRow
                                                key={child.id}
                                                item={child}
                                                index={ci}
                                                totalItems={children.length}
                                                onUpdate={(id, field, value) => onUpdateChildItem(item.id, id, field, value)}
                                                onRemove={(id) => onRemoveChildItem(item.id, id)}
                                                onMoveUp={(idx) => onMoveChildItem(item.id, idx, 'up')}
                                                onMoveDown={(idx) => onMoveChildItem(item.id, idx, 'down')}
                                                isChild
                                                unitPriceMasters={unitPriceMasters}
                                                onSelectMaster={onSelectMaster}
                                            />
                                        ))}
                                        {isExpanded && (
                                            <tr className="border-b border-slate-200">
                                                <td colSpan={10} className="px-3 py-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => onAddChildItem(item.id)}
                                                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 ml-8"
                                                    >
                                                        <Plus className="w-3.5 h-3.5" /> 子項目を追加
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            }
                            return <SortableItemTableRow key={item.id} {...rowProps(item, index)} />;
                        })}
                    </tbody>
                </table>
            </div>
            </SortableContext>
            </DndContext>

            {/* テーブル下部の行追加ボタン */}
            {!hideAddButtons && <div className="mt-2 flex items-center gap-3 flex-wrap">
                <button type="button" onClick={onAddItem} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors">
                    <Plus className="w-4 h-4" /> 項目行を追加
                </button>
                {onAddCategory && (
                    <button type="button" onClick={onAddCategory} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 transition-colors">
                        <FolderPlus className="w-4 h-4" /> カテゴリを追加
                    </button>
                )}
            </div>}

            <p className="hidden md:block mt-1.5 text-xs text-slate-400">
                各行は左端のハンドルをドラッグして並び替えられます。
            </p>

            {/* モバイル: カード表示 */}
            <div className="md:hidden space-y-3 mt-3">
                {items.map((item, index) => {
                    if (item.isCategory && onAddChildItem && onUpdateChildItem && onRemoveChildItem && onMoveChildItem) {
                        return (
                            <CategoryCard
                                key={item.id}
                                item={item} index={index} totalItems={items.length}
                                isExpanded={expandedCategories.has(item.id)}
                                onToggle={() => toggleCategory(item.id)}
                                onUpdate={onUpdate} onRemove={onRemove} onMoveUp={onMoveUp} onMoveDown={onMoveDown}
                                onAddChildItem={onAddChildItem}
                                onUpdateChildItem={onUpdateChildItem}
                                onRemoveChildItem={onRemoveChildItem}
                                onMoveChildItem={onMoveChildItem}
                                unitPriceMasters={unitPriceMasters}
                                onSelectMaster={onSelectMaster}
                            />
                        );
                    }
                    return <ItemCard key={item.id} {...rowProps(item, index)} />;
                })}
            </div>
        </div>
    );
}
