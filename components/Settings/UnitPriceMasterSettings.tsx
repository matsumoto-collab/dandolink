'use client';

import React, { useState, useEffect } from 'react';
import { useUnitPriceMaster } from '@/hooks/useUnitPriceMaster';
import { UnitPriceMaster, UnitPriceMasterInput, UnitPriceTemplate, UnitPriceCategory, UnitPriceSpecification } from '@/types/unitPrice';
import { Plus, Edit, Trash2, Settings } from 'lucide-react';
import toast from 'react-hot-toast';

type SubTab = 'items' | 'templates' | 'categories';

export default function UnitPriceMasterSettings() {
    const {
        unitPrices, ensureDataLoaded, addUnitPrice, updateUnitPrice, deleteUnitPrice,
        unitPriceTemplates, addUnitPriceTemplate, updateUnitPriceTemplate, deleteUnitPriceTemplate,
        unitPriceCategories, addUnitPriceCategory, updateUnitPriceCategory, deleteUnitPriceCategory,
        unitPriceSpecifications, addUnitPriceSpecification, updateUnitPriceSpecification, deleteUnitPriceSpecification,
    } = useUnitPriceMaster();

    useEffect(() => {
        ensureDataLoaded();
    }, [ensureDataLoaded]);

    const [subTab, setSubTab] = useState<SubTab>('items');

    return (
        <div className="space-y-6">
            {/* サブタブ */}
            <div className="flex gap-2 border-b border-slate-200 pb-0">
                {([
                    { id: 'items' as const, label: '単価項目' },
                    { id: 'templates' as const, label: 'テンプレート' },
                    { id: 'categories' as const, label: 'カテゴリ' },
                ]).map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setSubTab(tab.id)}
                        className={`px-4 py-2 font-medium text-sm rounded-t-lg transition-colors ${
                            subTab === tab.id
                                ? 'bg-slate-700 text-white'
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {subTab === 'items' && (
                <UnitPriceItemsTab
                    unitPrices={unitPrices}
                    templates={unitPriceTemplates}
                    categories={unitPriceCategories}
                    specifications={unitPriceSpecifications}
                    onAdd={addUnitPrice}
                    onUpdate={updateUnitPrice}
                    onDelete={deleteUnitPrice}
                    onAddSpec={addUnitPriceSpecification}
                    onUpdateSpec={updateUnitPriceSpecification}
                    onDeleteSpec={deleteUnitPriceSpecification}
                />
            )}
            {subTab === 'templates' && (
                <SimpleListTab
                    title="テンプレート管理"
                    items={unitPriceTemplates}
                    onAdd={(name) => addUnitPriceTemplate({ name, sortOrder: unitPriceTemplates.length })}
                    onUpdate={(id, name) => updateUnitPriceTemplate(id, { name })}
                    onDelete={deleteUnitPriceTemplate}
                    placeholder="例: 大規模見積用"
                />
            )}
            {subTab === 'categories' && (
                <CategoryListTab
                    categories={unitPriceCategories}
                    onAdd={addUnitPriceCategory}
                    onUpdate={updateUnitPriceCategory}
                    onDelete={deleteUnitPriceCategory}
                />
            )}
        </div>
    );
}

// ========== カテゴリ管理（数量・単位付き） ==========
function CategoryListTab({ categories, onAdd, onUpdate, onDelete }: {
    categories: UnitPriceCategory[];
    onAdd: (data: { name: string; sortOrder: number; quantity?: number; unit?: string }) => Promise<void>;
    onUpdate: (id: string, data: { name?: string; quantity?: number; unit?: string }) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const [newName, setNewName] = useState('');
    const [newQuantity, setNewQuantity] = useState('');
    const [newUnit, setNewUnit] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingQuantity, setEditingQuantity] = useState('');
    const [editingUnit, setEditingUnit] = useState('');

    const handleAdd = async () => {
        if (!newName.trim()) {
            toast.error('カテゴリ名を入力してください');
            return;
        }
        try {
            await onAdd({
                name: newName.trim(),
                sortOrder: categories.length,
                ...(newQuantity && { quantity: Number(newQuantity) }),
                ...(newUnit.trim() && { unit: newUnit.trim() }),
            });
            setNewName('');
            setNewQuantity('');
            setNewUnit('');
            toast.success('追加しました');
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleUpdate = async (id: string) => {
        if (!editingName.trim()) return;
        try {
            await onUpdate(id, {
                name: editingName.trim(),
                quantity: editingQuantity ? Number(editingQuantity) : undefined,
                unit: editingUnit.trim() || undefined,
            });
            setEditingId(null);
            toast.success('更新しました');
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`「${name}」を削除してもよろしいですか？`)) return;
        try {
            await onDelete(id);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    const startEdit = (cat: UnitPriceCategory) => {
        setEditingId(cat.id);
        setEditingName(cat.name);
        setEditingQuantity(cat.quantity ? String(cat.quantity) : '');
        setEditingUnit(cat.unit || '');
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">カテゴリ管理</h3>

            {/* 新規追加 */}
            <div className="flex gap-2 items-end">
                <div className="flex-1">
                    <label className="block text-xs text-slate-500 mb-1">カテゴリ名</label>
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                        placeholder="例: 足場工事"
                    />
                </div>
                <div className="w-20">
                    <label className="block text-xs text-slate-500 mb-1">数量</label>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={newQuantity}
                        onChange={(e) => setNewQuantity(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                        placeholder="1"
                    />
                </div>
                <div className="w-20">
                    <label className="block text-xs text-slate-500 mb-1">単位</label>
                    <input
                        type="text"
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                        placeholder="式"
                    />
                </div>
                <button
                    onClick={handleAdd}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all font-medium shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    追加
                </button>
            </div>

            {/* 一覧 */}
            {categories.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                    <p className="text-slate-500">まだ登録がありません</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {categories.map(cat => (
                        <div key={cat.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3">
                            {editingId === cat.id ? (
                                <>
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(cat.id)}
                                        className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        autoFocus
                                    />
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={editingQuantity}
                                        onChange={(e) => setEditingQuantity(e.target.value)}
                                        className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-center"
                                        placeholder="数量"
                                    />
                                    <input
                                        type="text"
                                        value={editingUnit}
                                        onChange={(e) => setEditingUnit(e.target.value)}
                                        className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-center"
                                        placeholder="単位"
                                    />
                                    <button onClick={() => handleUpdate(cat.id)} className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700">保存</button>
                                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50">取消</button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 font-medium text-slate-900">{cat.name}</span>
                                    {(cat.quantity || cat.unit) && (
                                        <span className="text-sm text-slate-500">
                                            {cat.quantity != null && cat.quantity > 0 ? cat.quantity : ''}{cat.unit ? ` ${cat.unit}` : ''}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => startEdit(cat)}
                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(cat.id, cat.name)}
                                        className="p-2 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ========== テンプレート・カテゴリ共通の簡易リスト管理 ==========
function SimpleListTab({ title, items, onAdd, onUpdate, onDelete, placeholder }: {
    title: string;
    items: (UnitPriceTemplate | UnitPriceCategory)[];
    onAdd: (name: string) => Promise<void>;
    onUpdate: (id: string, name: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    placeholder: string;
}) {
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    const handleAdd = async () => {
        if (!newName.trim()) {
            toast.error('名前を入力してください');
            return;
        }
        try {
            await onAdd(newName.trim());
            setNewName('');
            toast.success('追加しました');
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleUpdate = async (id: string) => {
        if (!editingName.trim()) return;
        try {
            await onUpdate(id, editingName.trim());
            setEditingId(null);
            toast.success('更新しました');
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`「${name}」を削除してもよろしいですか？`)) return;
        try {
            await onDelete(id);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    return (
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>

            {/* 新規追加 */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                    placeholder={placeholder}
                />
                <button
                    onClick={handleAdd}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all font-medium shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4" />
                    追加
                </button>
            </div>

            {/* 一覧 */}
            {items.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                    <p className="text-slate-500">まだ登録がありません</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {items.map(item => (
                        <div key={item.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3">
                            {editingId === item.id ? (
                                <>
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(item.id)}
                                        className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        autoFocus
                                    />
                                    <button onClick={() => handleUpdate(item.id)} className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700">保存</button>
                                    <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50">取消</button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 font-medium text-slate-900">{item.name}</span>
                                    <button
                                        onClick={() => { setEditingId(item.id); setEditingName(item.name); }}
                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id, item.name)}
                                        className="p-2 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ========== 規格管理パネル（単価項目ごと） ==========
function SpecificationsPanel({ unitPriceMasterId, specifications, onAdd, onUpdate, onDelete }: {
    unitPriceMasterId: string;
    specifications: UnitPriceSpecification[];
    onAdd: (data: { unitPriceMasterId: string; name: string; sortOrder: number }) => Promise<void>;
    onUpdate: (id: string, data: { name: string }) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const specs = specifications.filter(s => s.unitPriceMasterId === unitPriceMasterId);
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    const handleAdd = async () => {
        if (!newName.trim()) return;
        try {
            await onAdd({ unitPriceMasterId, name: newName.trim(), sortOrder: specs.length });
            setNewName('');
            toast.success('規格を追加しました');
        } catch {
            toast.error('追加に失敗しました');
        }
    };

    const handleUpdate = async (id: string) => {
        if (!editingName.trim()) return;
        try {
            await onUpdate(id, { name: editingName.trim() });
            setEditingId(null);
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await onDelete(id);
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    return (
        <div className="mt-3 pl-4 border-l-2 border-slate-200">
            <p className="text-xs font-semibold text-slate-500 mb-2">規格一覧</p>
            {specs.length > 0 && (
                <div className="space-y-1 mb-2">
                    {specs.map(spec => (
                        <div key={spec.id} className="flex items-center gap-2 text-sm">
                            {editingId === spec.id ? (
                                <>
                                    <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(spec.id)}
                                        className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-slate-500"
                                        autoFocus
                                    />
                                    <button onClick={() => handleUpdate(spec.id)} className="text-xs px-2 py-1 bg-slate-700 text-white rounded">保存</button>
                                    <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 border border-slate-300 rounded">取消</button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 text-slate-700">{spec.name}</span>
                                    <button onClick={() => { setEditingId(spec.id); setEditingName(spec.name); }} className="p-1 text-slate-400 hover:text-slate-600">
                                        <Edit className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => handleDelete(spec.id)} className="p-1 text-slate-400 hover:text-slate-600">
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-slate-500"
                    placeholder="新しい規格を追加..."
                />
                <button
                    onClick={handleAdd}
                    disabled={!newName.trim()}
                    className="px-2 py-1 bg-slate-700 text-white rounded-lg text-xs hover:bg-slate-600 disabled:opacity-50"
                >
                    追加
                </button>
            </div>
        </div>
    );
}

// ========== 単価項目タブ ==========
function UnitPriceItemsTab({ unitPrices, templates, categories, specifications, onAdd, onUpdate, onDelete, onAddSpec, onUpdateSpec, onDeleteSpec }: {
    unitPrices: UnitPriceMaster[];
    templates: UnitPriceTemplate[];
    categories: UnitPriceCategory[];
    specifications: UnitPriceSpecification[];
    onAdd: (data: UnitPriceMasterInput) => Promise<void>;
    onUpdate: (id: string, data: Partial<UnitPriceMasterInput>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onAddSpec: (data: { unitPriceMasterId: string; name: string; sortOrder: number }) => Promise<void>;
    onUpdateSpec: (id: string, data: { name: string }) => Promise<void>;
    onDeleteSpec: (id: string) => Promise<void>;
}) {
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<UnitPriceMaster | null>(null);
    const [filterTemplate, setFilterTemplate] = useState<string>('all');
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [expandedSpecId, setExpandedSpecId] = useState<string | null>(null);

    const [formData, setFormData] = useState<UnitPriceMasterInput>({
        description: '',
        unit: '',
        quantity: undefined,
        unitPrice: 0,
        templates: [],
        categoryId: undefined,
        notes: '',
    });

    const filteredUnitPrices = unitPrices.filter(up => {
        if (filterTemplate !== 'all' && !up.templates.includes(filterTemplate)) return false;
        if (filterCategory !== 'all') {
            if (filterCategory === 'none' && up.categoryId) return false;
            if (filterCategory !== 'none' && up.categoryId !== filterCategory) return false;
        }
        return true;
    });

    const handleOpenForm = (item?: UnitPriceMaster) => {
        if (item) {
            setEditingItem(item);
            setFormData({
                description: item.description,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                templates: item.templates,
                categoryId: item.categoryId,
                notes: item.notes || '',
            });
        } else {
            setEditingItem(null);
            setFormData({
                description: '',
                unit: '',
                quantity: undefined,
                unitPrice: 0,
                templates: [],
                categoryId: undefined,
                notes: '',
            });
        }
        setIsFormOpen(true);
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingItem(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.description || !formData.unit) {
            toast.error('品目と単位は必須です');
            return;
        }

        try {
            if (editingItem) {
                await onUpdate(editingItem.id, formData);
            } else {
                await onAdd(formData);
            }
            handleCloseForm();
        } catch {
            toast.error('保存に失敗しました');
        }
    };

    const handleDelete = (id: string, description: string) => {
        if (confirm(`「${description}」を削除してもよろしいですか？`)) {
            onDelete(id);
        }
    };

    const toggleTemplate = (templateId: string) => {
        setFormData(prev => ({
            ...prev,
            templates: prev.templates.includes(templateId)
                ? prev.templates.filter(t => t !== templateId)
                : [...prev.templates, templateId],
        }));
    };

    const getCategoryName = (categoryId?: string) => {
        if (!categoryId) return null;
        return categories.find(c => c.id === categoryId)?.name;
    };

    const getTemplateNames = (templateIds: string[]) => {
        return templateIds
            .map(id => templates.find(t => t.id === id)?.name)
            .filter(Boolean)
            .join(', ');
    };

    const getSpecCount = (unitPriceMasterId: string) => {
        return specifications.filter(s => s.unitPriceMasterId === unitPriceMasterId).length;
    };

    return (
        <div className="space-y-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">単価マスター管理</h3>
                <button
                    onClick={() => handleOpenForm()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg"
                >
                    <Plus className="w-4 h-4 md:w-5 md:h-5" />
                    新規登録
                </button>
            </div>

            {/* フィルター */}
            <div className="flex flex-wrap gap-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">テンプレートで絞り込み</label>
                    <select
                        value={filterTemplate}
                        onChange={(e) => setFilterTemplate(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                    >
                        <option value="all">全て</option>
                        {templates.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">カテゴリで絞り込み</label>
                    <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                    >
                        <option value="all">全て</option>
                        <option value="none">未分類</option>
                        {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 一覧 */}
            {filteredUnitPrices.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                    <p className="text-slate-500">単価マスターが登録されていません</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {filteredUnitPrices.map(item => (
                        <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-3 md:p-4">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-slate-900">{item.description}</h3>
                                    <div className="mt-2 space-y-1 text-sm text-slate-600">
                                        <p>{item.quantity != null && `数量: ${item.quantity} / `}単位: {item.unit} / 単価: ¥{item.unitPrice.toLocaleString()}</p>
                                        {item.templates.length > 0 && (
                                            <p>テンプレート: {getTemplateNames(item.templates)}</p>
                                        )}
                                        {getCategoryName(item.categoryId) && (
                                            <p>カテゴリ: {getCategoryName(item.categoryId)}</p>
                                        )}
                                        {item.notes && <p className="text-slate-500">備考: {item.notes}</p>}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setExpandedSpecId(expandedSpecId === item.id ? null : item.id)}
                                        className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors relative"
                                        title="規格管理"
                                    >
                                        <Settings className="w-4 h-4" />
                                        {getSpecCount(item.id) > 0 && (
                                            <span className="absolute -top-1 -right-1 bg-slate-600 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                                                {getSpecCount(item.id)}
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleOpenForm(item)}
                                        className="p-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(item.id, item.description)}
                                        className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-xl transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {expandedSpecId === item.id && (
                                <SpecificationsPanel
                                    unitPriceMasterId={item.id}
                                    specifications={specifications}
                                    onAdd={onAddSpec}
                                    onUpdate={onUpdateSpec}
                                    onDelete={onDeleteSpec}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 登録・編集フォームモーダル */}
            {isFormOpen && (
                <div className="fixed inset-0 lg:left-48 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-2 md:p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-4 md:p-6">
                            <h3 className="text-xl font-bold text-slate-900 mb-4">
                                {editingItem ? '単価マスター編集' : '単価マスター登録'}
                            </h3>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* 品目・内容 */}
                                <div>
                                    <label htmlFor="description" className="block text-sm font-semibold text-slate-700 mb-2">
                                        品目・内容 <span className="text-slate-500">*</span>
                                    </label>
                                    <input
                                        id="description"
                                        type="text"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                        placeholder="例: 足場組立"
                                        required
                                    />
                                </div>

                                {/* 数量・単位・単価 */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label htmlFor="quantity" className="block text-sm font-semibold text-slate-700 mb-2">
                                            数量
                                        </label>
                                        <input
                                            id="quantity"
                                            type="number"
                                            value={formData.quantity ?? ''}
                                            onChange={(e) => setFormData({ ...formData, quantity: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                            placeholder="例: 1"
                                            step="any"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="unit" className="block text-sm font-semibold text-slate-700 mb-2">
                                            単位 <span className="text-slate-500">*</span>
                                        </label>
                                        <input
                                            id="unit"
                                            type="text"
                                            value={formData.unit}
                                            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                            placeholder="例: 式、m、個、日"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="unitPrice" className="block text-sm font-semibold text-slate-700 mb-2">
                                            単価 <span className="text-slate-500">*</span>
                                        </label>
                                        <input
                                            id="unitPrice"
                                            type="number"
                                            value={formData.unitPrice}
                                            onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                            placeholder="50000"
                                            required
                                            min="0"
                                        />
                                    </div>
                                </div>

                                {/* カテゴリ */}
                                <div>
                                    <label htmlFor="categoryId" className="block text-sm font-semibold text-slate-700 mb-2">
                                        カテゴリ
                                    </label>
                                    <select
                                        id="categoryId"
                                        value={formData.categoryId || ''}
                                        onChange={(e) => setFormData({ ...formData, categoryId: e.target.value || undefined })}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    >
                                        <option value="">未分類</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* テンプレート */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        所属するテンプレート
                                    </label>
                                    {templates.length === 0 ? (
                                        <p className="text-sm text-slate-500">テンプレートが登録されていません。「テンプレート」タブから追加してください。</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {templates.map(t => (
                                                <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.templates.includes(t.id)}
                                                        onChange={() => toggleTemplate(t.id)}
                                                        className="w-4 h-4 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                                    />
                                                    <span className="text-sm text-slate-700">{t.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 備考 */}
                                <div>
                                    <label htmlFor="notes" className="block text-sm font-semibold text-slate-700 mb-2">
                                        備考
                                    </label>
                                    <textarea
                                        id="notes"
                                        value={formData.notes}
                                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                        rows={3}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                        placeholder="備考を入力..."
                                    />
                                </div>

                                {/* ボタン */}
                                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                                    <button
                                        type="button"
                                        onClick={handleCloseForm}
                                        className="px-6 py-2.5 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-6 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 transition-all"
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
