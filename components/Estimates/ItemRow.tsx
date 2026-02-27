'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';
import { Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ItemRowProps {
    item: EstimateItem;
    index: number;
    totalItems: number;
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
    groupAmount?: number;
}

/** デスクトップ用テーブル行 */
export function ItemTableRow({ item, index, totalItems, onUpdate, onRemove, onMoveUp, onMoveDown, groupAmount }: ItemRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const cellInputClass = "w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500";
    const isGroup = item.isGroup;
    const displayAmount = isGroup ? (groupAmount ?? 0) : item.amount;

    return (
        <tr
            ref={setNodeRef}
            style={style}
            className={`border-b border-gray-200 last:border-b-0 ${isGroup ? 'bg-gray-100' : item.groupId ? 'bg-white' : ''}`}
        >
            {/* ドラッグハンドル */}
            <td className="px-1 py-2 text-center">
                <button type="button" {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600">
                    <GripVertical className="w-4 h-4" />
                </button>
            </td>
            <td className={`px-3 py-2 ${item.groupId ? 'pl-8' : ''}`}>
                {isGroup ? (
                    <div className="flex items-center gap-2">
                        <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} className={`${cellInputClass} font-bold`} placeholder="大項目名" />
                        <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-600">
                            <input type="checkbox" checked={item.showAsLumpSum || false} onChange={(e) => onUpdate(item.id, 'showAsLumpSum', e.target.checked)} className="rounded" />
                            一式
                        </label>
                    </div>
                ) : (
                    <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} className={cellInputClass} placeholder="品目・内容" />
                )}
            </td>
            <td className="px-3 py-2">
                {!isGroup && <input type="text" value={item.specification || ''} onChange={(e) => onUpdate(item.id, 'specification', e.target.value)} className={cellInputClass} placeholder="規格" />}
            </td>
            <td className="px-3 py-2">
                {!isGroup && <input type="number" value={item.quantity} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'quantity', isNaN(val) ? 0 : val); }} className={cellInputClass} step="0.01" />}
            </td>
            <td className="px-3 py-2">
                {!isGroup && <input type="text" value={item.unit || ''} onChange={(e) => onUpdate(item.id, 'unit', e.target.value)} className={cellInputClass} placeholder="式、m、個" />}
            </td>
            <td className="px-3 py-2">
                {!isGroup && <input type="number" value={item.unitPrice} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'unitPrice', isNaN(val) ? 0 : val); }} className={`${cellInputClass} ${item.unitPrice < 0 ? 'text-slate-600' : ''}`} />}
            </td>
            <td className="px-3 py-2">
                <div className={`text-right font-medium ${isGroup ? 'font-bold' : ''} ${displayAmount < 0 ? 'text-slate-600' : ''}`}>
                    {displayAmount < 0 ? `(${Math.abs(displayAmount).toLocaleString()})` : `¥${displayAmount.toLocaleString()}`}
                </div>
            </td>
            <td className="px-3 py-2">
                {!isGroup && (
                    <select value={item.taxType} onChange={(e) => onUpdate(item.id, 'taxType', e.target.value as 'none' | 'standard')} className={cellInputClass}>
                        <option value="standard">10%</option>
                        <option value="none">なし</option>
                    </select>
                )}
            </td>
            <td className="px-3 py-2">
                {!isGroup && <input type="text" value={item.notes || ''} onChange={(e) => onUpdate(item.id, 'notes', e.target.value)} className={cellInputClass} placeholder="備考" />}
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="上に移動" aria-label="上に移動">
                        <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onMoveDown(index)} disabled={index === totalItems - 1} className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="下に移動" aria-label="下に移動">
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onRemove(item.id)} className="p-1 text-slate-600 hover:bg-slate-50 rounded transition-colors" title="削除" aria-label="削除">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}

/** モバイル用カード */
export function ItemCard({ item, index, totalItems, onUpdate, onRemove, onMoveUp, onMoveDown, groupAmount }: ItemRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const mobileInputClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base";
    const mobileLabelClass = "block text-xs font-medium text-gray-500 mb-1";
    const isGroup = item.isGroup;
    const displayAmount = isGroup ? (groupAmount ?? 0) : item.amount;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`bg-white border rounded-xl p-4 space-y-3 shadow-sm ${isGroup ? 'border-indigo-300 bg-indigo-50' : item.groupId ? 'border-gray-200 ml-4 border-l-4 border-l-indigo-300' : 'border-gray-200'}`}
        >
            {/* ヘッダー: ドラッグ + 番号 + 操作ボタン */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button type="button" {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-gray-400 touch-none">
                        <GripVertical className="w-5 h-5" />
                    </button>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${isGroup ? 'text-indigo-600 bg-indigo-100' : 'text-slate-500 bg-slate-100'}`}>
                        {isGroup ? '大項目' : `#${index + 1}`}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="p-2 text-gray-500 rounded-lg active:bg-gray-100 disabled:opacity-30" aria-label="上に移動">
                        <ChevronUp className="w-5 h-5" />
                    </button>
                    <button type="button" onClick={() => onMoveDown(index)} disabled={index === totalItems - 1} className="p-2 text-gray-500 rounded-lg active:bg-gray-100 disabled:opacity-30" aria-label="下に移動">
                        <ChevronDown className="w-5 h-5" />
                    </button>
                    <button type="button" onClick={() => onRemove(item.id)} className="p-2 text-red-500 rounded-lg active:bg-red-50" aria-label="削除">
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* 品目 */}
            <div>
                <label className={mobileLabelClass}>{isGroup ? '大項目名' : '品目・内容'}</label>
                <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} className={`${mobileInputClass} ${isGroup ? 'font-bold' : ''}`} placeholder={isGroup ? '大項目名' : '品目・内容'} />
            </div>

            {isGroup ? (
                <>
                    {/* 一式チェック */}
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={item.showAsLumpSum || false} onChange={(e) => onUpdate(item.id, 'showAsLumpSum', e.target.checked)} className="rounded" />
                        PDF出力時に「一式」表示
                    </label>
                    {/* グループ合計 */}
                    <div className="bg-indigo-100 rounded-lg px-3 py-2.5 text-right">
                        <span className="text-xs text-indigo-600 mr-2">グループ合計:</span>
                        <span className="text-lg font-bold text-indigo-900">¥{displayAmount.toLocaleString()}</span>
                    </div>
                </>
            ) : (
                <>
                    {/* 規格 */}
                    <div>
                        <label className={mobileLabelClass}>規格</label>
                        <input type="text" value={item.specification || ''} onChange={(e) => onUpdate(item.id, 'specification', e.target.value)} className={mobileInputClass} placeholder="規格" />
                    </div>

                    {/* 数量・単位・単価 */}
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className={mobileLabelClass}>数量</label>
                            <input type="number" value={item.quantity} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'quantity', isNaN(val) ? 0 : val); }} className={mobileInputClass} step="0.01" inputMode="decimal" />
                        </div>
                        <div>
                            <label className={mobileLabelClass}>単位</label>
                            <input type="text" value={item.unit || ''} onChange={(e) => onUpdate(item.id, 'unit', e.target.value)} className={mobileInputClass} placeholder="式" />
                        </div>
                        <div>
                            <label className={mobileLabelClass}>単価</label>
                            <input type="number" value={item.unitPrice} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'unitPrice', isNaN(val) ? 0 : val); }} className={`${mobileInputClass} ${item.unitPrice < 0 ? 'text-slate-600' : ''}`} inputMode="numeric" />
                        </div>
                    </div>

                    {/* 金額 + 税区分 */}
                    <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">税区分:</span>
                            <select value={item.taxType} onChange={(e) => onUpdate(item.id, 'taxType', e.target.value as 'none' | 'standard')} className="px-2 py-1 border border-gray-300 rounded text-sm bg-white">
                                <option value="standard">10%</option>
                                <option value="none">なし</option>
                            </select>
                        </div>
                        <div className={`text-lg font-bold ${item.amount < 0 ? 'text-slate-600' : 'text-gray-900'}`}>
                            {item.amount < 0 ? `(${Math.abs(item.amount).toLocaleString()})` : `¥${item.amount.toLocaleString()}`}
                        </div>
                    </div>

                    {/* 備考 */}
                    <div>
                        <label className={mobileLabelClass}>備考</label>
                        <input type="text" value={item.notes || ''} onChange={(e) => onUpdate(item.id, 'notes', e.target.value)} className={mobileInputClass} placeholder="備考" />
                    </div>
                </>
            )}
        </div>
    );
}

export default ItemCard;
