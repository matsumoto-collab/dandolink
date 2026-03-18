'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { EstimateItem } from '@/types/estimate';
import { UnitPriceMaster, UnitPriceSpecification } from '@/types/unitPrice';
import { Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';

interface ItemRowProps {
    item: EstimateItem;
    index: number;
    totalItems: number;
    onUpdate: (id: string, field: keyof EstimateItem, value: EstimateItem[keyof EstimateItem]) => void;
    onRemove: (id: string) => void;
    onMoveUp: (index: number) => void;
    onMoveDown: (index: number) => void;
    isChild?: boolean;
    unitPriceMasters?: UnitPriceMaster[];
    unitPriceSpecifications?: UnitPriceSpecification[];
    onSelectMaster?: (itemId: string, master: UnitPriceMaster) => void;
    // Drag & drop
    sortableRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, unknown>;
    dragListeners?: Record<string, unknown>;
}

/** 品目入力（単価マスター候補ドロップダウン付き） */
function DescriptionInput({ item, onUpdate, unitPriceMasters, onSelectMaster, className }: {
    item: EstimateItem;
    onUpdate: ItemRowProps['onUpdate'];
    unitPriceMasters?: UnitPriceMaster[];
    onSelectMaster?: (itemId: string, master: UnitPriceMaster) => void;
    className: string;
}) {
    const [showDropdown, setShowDropdown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 280, openUp: false });

    const filtered = unitPriceMasters?.filter(m =>
        !item.description || m.description.toLowerCase().includes(item.description.toLowerCase())
    ) || [];

    const updatePosition = useCallback(() => {
        if (inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect();
            const maxDropdownHeight = 256; // max-h-64 = 16rem = 256px
            const spaceBelow = window.innerHeight - rect.bottom;
            const openUp = spaceBelow < maxDropdownHeight && rect.top > spaceBelow;
            setDropdownPos({
                top: openUp ? rect.top - 4 : rect.bottom + 4,
                left: rect.left,
                width: Math.max(rect.width, 280),
                openUp,
            });
        }
    }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (inputRef.current?.contains(e.target as Node)) return;
            if (dropdownRef.current?.contains(e.target as Node)) return;
            setShowDropdown(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!unitPriceMasters?.length) {
        return (
            <input type="text" value={item.description} onChange={(e) => onUpdate(item.id, 'description', e.target.value)} className={className} placeholder="品目・内容" />
        );
    }

    const dropdown = showDropdown && filtered.length > 0 ? createPortal(
        <div
            ref={dropdownRef}
            className="fixed z-[9999] max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg"
            style={{
                left: dropdownPos.left,
                width: dropdownPos.width,
                ...(dropdownPos.openUp
                    ? { bottom: window.innerHeight - dropdownPos.top, top: 'auto' }
                    : { top: dropdownPos.top }),
            }}
        >
            <div className="px-3 py-1.5 text-xs font-medium text-slate-400 border-b border-slate-100">単価マスター</div>
            {filtered.map(m => (
                <button
                    key={m.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0"
                    onClick={() => {
                        onSelectMaster?.(item.id, m);
                        setShowDropdown(false);
                    }}
                >
                    <span className="font-medium text-sm text-slate-800">{m.description}</span>
                    {m.unitPrice > 0 && <span className="text-sm text-slate-500"> | ¥{m.unitPrice.toLocaleString()}</span>}
                </button>
            ))}
        </div>,
        document.body
    ) : null;

    return (
        <>
            <input
                ref={inputRef}
                type="text"
                value={item.description}
                onChange={(e) => {
                    onUpdate(item.id, 'description', e.target.value);
                    setShowDropdown(true);
                    updatePosition();
                }}
                onFocus={() => {
                    updatePosition();
                    setShowDropdown(true);
                }}
                className={className}
                placeholder="品目・内容"
            />
            {dropdown}
        </>
    );
}

/** 単価入力（マイナス値対応） */
function UnitPriceInput({ item, onUpdate, className }: { item: EstimateItem; onUpdate: ItemRowProps['onUpdate']; className: string }) {
    const [localValue, setLocalValue] = useState(item.unitPrice === 0 ? '' : String(item.unitPrice));

    useEffect(() => {
        setLocalValue(item.unitPrice === 0 ? '' : String(item.unitPrice));
    }, [item.unitPrice]);

    return (
        <input
            type="text"
            inputMode="text"
            value={localValue}
            onChange={(e) => {
                const val = e.target.value;
                setLocalValue(val);
                if (val === '' || val === '-') {
                    onUpdate(item.id, 'unitPrice', 0);
                } else if (!isNaN(Number(val))) {
                    onUpdate(item.id, 'unitPrice', Number(val));
                }
            }}
            onBlur={() => {
                setLocalValue(item.unitPrice === 0 ? '' : String(item.unitPrice));
            }}
            className={`${className} ${item.unitPrice < 0 ? 'text-red-600' : ''}`}
            placeholder="単価"
        />
    );
}

/** 規格入力（単価マスターに紐づく候補ドロップダウン付き） */
function SpecificationInput({ item, onUpdate, unitPriceMasters, specifications, className }: {
    item: EstimateItem;
    onUpdate: ItemRowProps['onUpdate'];
    unitPriceMasters?: UnitPriceMaster[];
    specifications?: UnitPriceSpecification[];
    className: string;
}) {
    const [showDropdown, setShowDropdown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 220, openUp: false });

    // Find the matching unit price master by description
    const matchedMaster = unitPriceMasters?.find(m => m.description === item.description);
    const masterSpecs = matchedMaster && specifications
        ? specifications.filter(s => s.unitPriceMasterId === matchedMaster.id)
        : [];

    const updatePosition = useCallback(() => {
        if (inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect();
            const maxH = 200;
            const spaceBelow = window.innerHeight - rect.bottom;
            const openUp = spaceBelow < maxH && rect.top > spaceBelow;
            setDropdownPos({
                top: openUp ? rect.top - 4 : rect.bottom + 4,
                left: rect.left,
                width: Math.max(rect.width, 220),
                openUp,
            });
        }
    }, []);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (inputRef.current?.contains(e.target as Node)) return;
            if (dropdownRef.current?.contains(e.target as Node)) return;
            setShowDropdown(false);
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (masterSpecs.length === 0) {
        return (
            <input type="text" value={item.specification || ''} onChange={(e) => onUpdate(item.id, 'specification', e.target.value)} className={className} placeholder="規格" />
        );
    }

    const filtered = masterSpecs.filter(s =>
        !item.specification || s.name.toLowerCase().includes((item.specification || '').toLowerCase())
    );

    const dropdown = showDropdown && filtered.length > 0 ? createPortal(
        <div
            ref={dropdownRef}
            className="fixed z-[9999] max-h-[200px] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg"
            style={{
                left: dropdownPos.left,
                width: dropdownPos.width,
                ...(dropdownPos.openUp
                    ? { bottom: window.innerHeight - dropdownPos.top, top: 'auto' }
                    : { top: dropdownPos.top }),
            }}
        >
            <div className="px-3 py-1.5 text-xs font-medium text-slate-400 border-b border-slate-100">規格候補</div>
            {filtered.map(s => (
                <button
                    key={s.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0 text-sm text-slate-800"
                    onClick={() => {
                        onUpdate(item.id, 'specification', s.name);
                        setShowDropdown(false);
                    }}
                >
                    {s.name}
                </button>
            ))}
        </div>,
        document.body
    ) : null;

    return (
        <>
            <input
                ref={inputRef}
                type="text"
                value={item.specification || ''}
                onChange={(e) => {
                    onUpdate(item.id, 'specification', e.target.value);
                    setShowDropdown(true);
                    updatePosition();
                }}
                onFocus={() => {
                    updatePosition();
                    setShowDropdown(true);
                }}
                className={className}
                placeholder="規格"
            />
            {dropdown}
        </>
    );
}

/** デスクトップ用テーブル行 */
export function ItemTableRow({ item, index, totalItems, onUpdate, onRemove, onMoveUp, onMoveDown, isChild, unitPriceMasters, unitPriceSpecifications, onSelectMaster, sortableRef, sortableStyle, sortableAttributes, dragListeners }: ItemRowProps) {
    const cellInputClass = "w-full px-2 py-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500";

    return (
        <tr ref={sortableRef} style={sortableStyle} {...(sortableAttributes || {})} className={`border-b border-slate-200 last:border-b-0 ${isChild ? 'bg-white' : 'bg-white'}`}>
            <td className="px-1 py-2 w-8">
                {dragListeners ? (
                    <button type="button" className="cursor-grab active:cursor-grabbing p-1 text-slate-400 hover:text-slate-600" {...dragListeners}>
                        <GripVertical className="w-4 h-4" />
                    </button>
                ) : null}
            </td>
            <td className="px-3 py-2">
                <div className={isChild ? 'pl-6' : ''}>
                    <DescriptionInput item={item} onUpdate={onUpdate} unitPriceMasters={unitPriceMasters} onSelectMaster={onSelectMaster} className={cellInputClass} />
                </div>
            </td>
            <td className="px-3 py-2">
                <SpecificationInput item={item} onUpdate={onUpdate} unitPriceMasters={unitPriceMasters} specifications={unitPriceSpecifications} className={cellInputClass} />
            </td>
            <td className="px-3 py-2">
                <input
                    type="text"
                    inputMode="decimal"
                    value={item.quantity === 0 ? '' : item.quantity}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                            onUpdate(item.id, 'quantity', 0);
                        } else if (!isNaN(Number(val))) {
                            onUpdate(item.id, 'quantity', Number(val));
                        }
                    }}
                    className={cellInputClass}
                    placeholder="数量"
                />
            </td>
            <td className="px-3 py-2">
                <input type="text" value={item.unit || ''} onChange={(e) => onUpdate(item.id, 'unit', e.target.value)} className={cellInputClass} placeholder="式、m、個" />
            </td>
            <td className="px-3 py-2">
                <UnitPriceInput item={item} onUpdate={onUpdate} className={cellInputClass} />
            </td>
            <td className="px-3 py-2">
                <select value={item.taxType} onChange={(e) => onUpdate(item.id, 'taxType', e.target.value as 'none' | 'standard')} className={cellInputClass}>
                    <option value="standard">10%</option>
                    <option value="none">なし</option>
                </select>
            </td>
            <td className="px-3 py-2">
                <div className={`text-right font-medium ${item.amount < 0 ? 'text-red-600' : ''}`}>
                    {item.amount < 0 ? `-¥${Math.abs(item.amount).toLocaleString()}` : `¥${item.amount.toLocaleString()}`}
                </div>
            </td>
            <td className="px-3 py-2">
                <input type="text" value={item.notes || ''} onChange={(e) => onUpdate(item.id, 'notes', e.target.value)} className={cellInputClass} placeholder="備考" />
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center justify-center gap-1">
                    <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="p-1 text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="上に移動" aria-label="上に移動">
                        <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onMoveDown(index)} disabled={index === totalItems - 1} className="p-1 text-slate-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="下に移動" aria-label="下に移動">
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
export function ItemCard({ item, index, totalItems, onUpdate, onRemove, onMoveUp, onMoveDown, unitPriceMasters, unitPriceSpecifications, onSelectMaster }: ItemRowProps) {
    const [isExpanded, setIsExpanded] = useState(!item.description);
    const mobileInputClass = "w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base";
    const mobileLabelClass = "block text-xs font-medium text-slate-500 mb-1";

    const amountDisplay = item.amount < 0
        ? `(${Math.abs(item.amount).toLocaleString()})`
        : `¥${item.amount.toLocaleString()}`;

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* 折りたたみヘッダー（常に表示） */}
            <div className="flex items-center gap-2 px-3 py-2.5">
                <button
                    type="button"
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">#{index + 1}</span>
                    {!isExpanded && (
                        <span className="text-sm text-slate-700 truncate">
                            {item.description || <span className="text-slate-400">未入力</span>}
                            <span className="text-slate-400 mx-1">──</span>
                            {item.quantity}{item.unit} × ¥{(item.unitPrice ?? 0).toLocaleString()} = {amountDisplay}
                        </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0} className="p-1.5 text-slate-500 rounded-lg active:bg-slate-100 disabled:opacity-30" aria-label="上に移動">
                        <ChevronUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onMoveDown(index)} disabled={index === totalItems - 1} className="p-1.5 text-slate-500 rounded-lg active:bg-slate-100 disabled:opacity-30" aria-label="下に移動">
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onRemove(item.id)} className="p-1.5 text-red-500 rounded-lg active:bg-red-50" aria-label="削除">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* 展開エリア */}
            <div className={`transition-all duration-150 ${isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                    {/* 品目 */}
                    <div>
                        <label className={mobileLabelClass}>品目・内容</label>
                        <DescriptionInput item={item} onUpdate={onUpdate} unitPriceMasters={unitPriceMasters} onSelectMaster={onSelectMaster} className={mobileInputClass} />
                    </div>

                    {/* 規格 */}
                    <div>
                        <label className={mobileLabelClass}>規格</label>
                        <SpecificationInput item={item} onUpdate={onUpdate} unitPriceMasters={unitPriceMasters} specifications={unitPriceSpecifications} className={mobileInputClass} />
                    </div>

                    {/* 数量・単位・単価 - 横並び */}
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className={mobileLabelClass}>数量</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={item.quantity === 0 ? '' : item.quantity}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '') {
                                        onUpdate(item.id, 'quantity', 0);
                                    } else if (!isNaN(Number(val))) {
                                        onUpdate(item.id, 'quantity', Number(val));
                                    }
                                }}
                                className={mobileInputClass}
                                placeholder="数量"
                            />
                        </div>
                        <div>
                            <label className={mobileLabelClass}>単位</label>
                            <input type="text" value={item.unit || ''} onChange={(e) => onUpdate(item.id, 'unit', e.target.value)} className={mobileInputClass} placeholder="式" />
                        </div>
                        <div>
                            <label className={mobileLabelClass}>単価</label>
                            <UnitPriceInput item={item} onUpdate={onUpdate} className={`${mobileInputClass}`} />
                        </div>
                    </div>

                    {/* 金額 + 税区分 */}
                    <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">税区分:</span>
                            <select value={item.taxType} onChange={(e) => onUpdate(item.id, 'taxType', e.target.value as 'none' | 'standard')} className="px-2 py-1 border border-slate-300 rounded text-sm bg-white">
                                <option value="standard">10%</option>
                                <option value="none">なし</option>
                            </select>
                        </div>
                        <div className={`text-lg font-bold ${item.amount < 0 ? 'text-slate-600' : 'text-slate-900'}`}>
                            {amountDisplay}
                        </div>
                    </div>

                    {/* 備考 */}
                    <div>
                        <label className={mobileLabelClass}>備考</label>
                        <input type="text" value={item.notes || ''} onChange={(e) => onUpdate(item.id, 'notes', e.target.value)} className={mobileInputClass} placeholder="備考" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ItemCard;
