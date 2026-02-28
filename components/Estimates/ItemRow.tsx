'use client';

import React from 'react';
import { EstimateItem } from '@/types/estimate';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';

interface ItemRowProps {
    item: EstimateItem;
    index: number;
    totalItems: number;
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
}

/** デスクトップ用テーブル行 */
export function ItemTableRow({ item, index, totalItems, onUpdate, onRemove, onMoveUp, onMoveDown }: ItemRowProps) {
    const cellInputClass = "w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500";

    return (
        <tr className="border-b border-gray-200 last:border-b-0">
            <td className="px-3 py-2">
                <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} className={cellInputClass} placeholder="品目・内容" />
            </td>
            <td className="px-3 py-2">
                <input type="text" value={item.specification || ''} onChange={(e) => onUpdate(item.id, 'specification', e.target.value)} className={cellInputClass} placeholder="規格" />
            </td>
            <td className="px-3 py-2">
                <input type="number" value={item.quantity} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'quantity', isNaN(val) ? 0 : val); }} className={`${cellInputClass} text-slate-500`} step="0.01" />
            </td>
            <td className="px-3 py-2">
                <input type="text" value={item.unit || ''} onChange={(e) => onUpdate(item.id, 'unit', e.target.value)} className={cellInputClass} placeholder="式、m、個" />
            </td>
            <td className="px-3 py-2">
                <input type="number" value={item.unitPrice} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'unitPrice', isNaN(val) ? 0 : val); }} className={`${cellInputClass} ${item.unitPrice < 0 ? 'text-slate-600' : ''}`} />
            </td>
            <td className="px-3 py-2">
                <div className={`text-right font-medium ${item.amount < 0 ? 'text-slate-600' : ''}`}>
                    {item.amount < 0 ? `(${Math.abs(item.amount).toLocaleString()})` : `¥${item.amount.toLocaleString()}`}
                </div>
            </td>
            <td className="px-3 py-2">
                <select value={item.taxType} onChange={(e) => onUpdate(item.id, 'taxType', e.target.value as 'none' | 'standard')} className={cellInputClass}>
                    <option value="standard">10%</option>
                    <option value="none">なし</option>
                </select>
            </td>
            <td className="px-3 py-2">
                <input type="text" value={item.notes || ''} onChange={(e) => onUpdate(item.id, 'notes', e.target.value)} className={cellInputClass} placeholder="備考" />
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
export function ItemCard({ item, index, totalItems, onUpdate, onRemove, onMoveUp, onMoveDown }: ItemRowProps) {
    const mobileInputClass = "w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base";
    const mobileLabelClass = "block text-xs font-medium text-gray-500 mb-1";

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 shadow-sm">
            {/* ヘッダー: 番号 + 操作ボタン */}
            <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">#{index + 1}</span>
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
                <label className={mobileLabelClass}>品目・内容</label>
                <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} className={mobileInputClass} placeholder="品目・内容" />
            </div>

            {/* 規格 */}
            <div>
                <label className={mobileLabelClass}>規格</label>
                <input type="text" value={item.specification || ''} onChange={(e) => onUpdate(item.id, 'specification', e.target.value)} className={mobileInputClass} placeholder="規格" />
            </div>

            {/* 数量・単位・単価 - 横並び */}
            <div className="grid grid-cols-3 gap-2">
                <div>
                    <label className={mobileLabelClass}>数量</label>
                    <input type="number" value={item.quantity} onChange={(e) => { const val = parseFloat(e.target.value); onUpdate(item.id, 'quantity', isNaN(val) ? 0 : val); }} className={`${mobileInputClass} text-slate-500`} step="0.01" inputMode="decimal" />
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
        </div>
    );
}

export default ItemCard;
