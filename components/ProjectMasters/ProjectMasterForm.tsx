'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, MapPin, Plus, Search } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import {
    ScaffoldingSpec,
    DEFAULT_SCAFFOLDING_SPEC,
    ConstructionContentType,
    CONSTRUCTION_CONTENT_LABELS
} from '@/types/calendar';
import { Customer } from '@/types/customer';

// 都道府県リスト
const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

export interface ProjectMasterFormData {
    title: string;
    customerId: string;
    customerName: string;
    constructionContent: ConstructionContentType | '';
    // 住所情報
    postalCode: string;
    prefecture: string;
    city: string;
    location: string;
    plusCode: string;
    // 工事情報
    area: string;
    areaRemarks: string;
    assemblyDate: string;
    demolitionDate: string;
    estimatedAssemblyWorkers: string;
    estimatedDemolitionWorkers: string;
    contractAmount: string;
    // 足場仕様
    scaffoldingSpec: ScaffoldingSpec;
    // その他
    remarks: string;
    createdBy: string[];
}

export const DEFAULT_FORM_DATA: ProjectMasterFormData = {
    title: '',
    customerId: '',
    customerName: '',
    constructionContent: '',
    postalCode: '',
    prefecture: '',
    city: '',
    location: '',
    plusCode: '',
    area: '',
    areaRemarks: '',
    assemblyDate: '',
    demolitionDate: '',
    estimatedAssemblyWorkers: '',
    estimatedDemolitionWorkers: '',
    contractAmount: '',
    scaffoldingSpec: DEFAULT_SCAFFOLDING_SPEC,
    remarks: '',
    createdBy: [],
};

interface ManagerUser {
    id: string;
    displayName: string;
    role: string;
}

interface ProjectMasterFormProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
    onSubmit: () => void;
    onCancel: () => void;
    isEdit?: boolean;
}

export function ProjectMasterForm({ formData, setFormData, onSubmit, onCancel, isEdit = false }: ProjectMasterFormProps) {
    // State for customers and managers
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerSearchTerm, setCustomerSearchTerm] = useState('');
    const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
    const [managers, setManagers] = useState<ManagerUser[]>([]);
    const [isLoadingManagers, setIsLoadingManagers] = useState(true);

    // Collapsible sections
    const [expandedSections, setExpandedSections] = useState({
        basic: true,
        address: true,
        construction: true,
        scaffolding: false,
        remarks: true,
    });
    const [expandedScaffoldingSections, setExpandedScaffoldingSections] = useState({
        section1: true,
        section2: false,
        section3: false,
    });

    // Fetch customers
    useEffect(() => {
        const fetchCustomers = async () => {
            try {
                const res = await fetch('/api/customers');
                if (res.ok) {
                    const data = await res.json();
                    setCustomers(data);
                }
            } catch (error) {
                console.error('Failed to fetch customers:', error);
            }
        };
        fetchCustomers();
    }, []);

    // Fetch managers
    useEffect(() => {
        const fetchManagers = async () => {
            setIsLoadingManagers(true);
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const users = await res.json();
                    const filtered = users.filter((u: ManagerUser) =>
                        u.role === 'admin' || u.role === 'manager'
                    );
                    setManagers(filtered);
                }
            } catch (error) {
                console.error('Failed to fetch managers:', error);
            } finally {
                setIsLoadingManagers(false);
            }
        };
        fetchManagers();
    }, []);

    // Postal code auto-fill
    const handlePostalCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/[^0-9]/g, '');
        setFormData({ ...formData, postalCode: value });

        if (value.length === 7) {
            try {
                const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${value}`);
                const data = await res.json();
                if (data.results && data.results[0]) {
                    const result = data.results[0];
                    setFormData(prev => ({
                        ...prev,
                        prefecture: result.address1,
                        city: result.address2 + result.address3,
                    }));
                }
            } catch (error) {
                console.error('Failed to fetch address:', error);
            }
        }
    };

    // Filter customers by search term
    const filteredCustomers = customers.filter(c =>
        c.name.toLowerCase().includes(customerSearchTerm.toLowerCase()) ||
        (c.shortName && c.shortName.toLowerCase().includes(customerSearchTerm.toLowerCase()))
    );

    // Toggle section
    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    // Get full address for map
    const getFullAddress = () => {
        const parts = [formData.prefecture, formData.city, formData.location].filter(Boolean);
        return parts.join('');
    };

    return (
        <div className="space-y-4">
            {/* 基本情報セクション */}
            <div className="border border-gray-200 rounded-lg">
                <button
                    type="button"
                    onClick={() => toggleSection('basic')}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <span className="font-bold text-gray-800">基本情報</span>
                    {expandedSections.basic ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.basic && (
                    <div className="p-4 space-y-4">
                        {/* 工事内容 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                工事内容 <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={formData.constructionContent}
                                onChange={(e) => setFormData({ ...formData, constructionContent: e.target.value as ConstructionContentType })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">選択してください</option>
                                {Object.entries(CONSTRUCTION_CONTENT_LABELS).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>

                        {/* 案件担当者 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                案件責任者 <span className="text-red-500">*</span>
                            </label>
                            <div className="flex flex-wrap gap-2 min-h-[42px] p-2 border border-gray-300 rounded-lg bg-white">
                                {isLoadingManagers ? (
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <ButtonLoading />
                                        <span className="text-sm">担当者を読み込み中...</span>
                                    </div>
                                ) : managers.length > 0 ? (
                                    managers.map(manager => (
                                        <label key={manager.id} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                                            <input
                                                type="checkbox"
                                                checked={formData.createdBy.includes(manager.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormData({ ...formData, createdBy: [...formData.createdBy, manager.id] });
                                                    } else {
                                                        setFormData({ ...formData, createdBy: formData.createdBy.filter(id => id !== manager.id) });
                                                    }
                                                }}
                                                className="w-4 h-4 text-blue-600 rounded"
                                            />
                                            <span className="text-sm text-gray-700">{manager.displayName}</span>
                                        </label>
                                    ))
                                ) : (
                                    <span className="text-sm text-gray-500">担当者が見つかりません</span>
                                )}
                            </div>
                        </div>

                        {/* 現場名 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                現場名 <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="例: 松本様邸"
                            />
                        </div>

                        {/* 元請け（顧客選択） */}
                        <div className="relative">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                元請け <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    value={customerSearchTerm || formData.customerName}
                                    onChange={(e) => {
                                        setCustomerSearchTerm(e.target.value);
                                        setShowCustomerDropdown(true);
                                    }}
                                    onFocus={() => setShowCustomerDropdown(true)}
                                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="顧客を検索..."
                                />
                            </div>
                            {showCustomerDropdown && (
                                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
                                    {filteredCustomers.map(customer => (
                                        <button
                                            key={customer.id}
                                            type="button"
                                            onClick={() => {
                                                setFormData({
                                                    ...formData,
                                                    customerId: customer.id,
                                                    customerName: customer.name,
                                                });
                                                setCustomerSearchTerm('');
                                                setShowCustomerDropdown(false);
                                            }}
                                            className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                                        >
                                            <span>{customer.name}</span>
                                            {customer.shortName && (
                                                <span className="text-sm text-gray-500">({customer.shortName})</span>
                                            )}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            window.open('/customers', '_blank');
                                        }}
                                        className="w-full px-4 py-2 text-left text-green-600 hover:bg-green-50 flex items-center gap-2 border-t"
                                    >
                                        <Plus className="w-4 h-4" />
                                        新しい顧客/外注などを作成
                                    </button>
                                </div>
                            )}
                            {formData.customerName && (
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full">
                                        {formData.customerName}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, customerId: '', customerName: '' })}
                                        className="text-gray-400 hover:text-red-500"
                                    >
                                        ×
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 住所セクション */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => toggleSection('address')}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <span className="font-bold text-gray-800">住所情報</span>
                    {expandedSections.address ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.address && (
                    <div className="p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 郵便番号 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">郵便番号</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={formData.postalCode}
                                        onChange={handlePostalCodeChange}
                                        maxLength={7}
                                        className="w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="1234567"
                                    />
                                    <span className="text-sm text-gray-500">市区町村が自動で入力されます</span>
                                </div>
                            </div>
                            {/* 都道府県 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">都道府県</label>
                                <select
                                    value={formData.prefecture}
                                    onChange={(e) => setFormData({ ...formData, prefecture: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="">選択してください</option>
                                    {PREFECTURES.map(pref => (
                                        <option key={pref} value={pref}>{pref}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        {/* 市区町村 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">市区町村</label>
                            <input
                                type="text"
                                value={formData.city}
                                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="市区町村"
                            />
                        </div>
                        {/* その他住所 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">その他住所</label>
                            <input
                                type="text"
                                value={formData.location}
                                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="番地、建物名など"
                            />
                        </div>
                        {/* Plus Code/座標 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Plus Code/座標（緯度,経度）</label>
                            <input
                                type="text"
                                value={formData.plusCode}
                                onChange={(e) => setFormData({ ...formData, plusCode: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="Plus Code/座標（緯度,経度）"
                            />
                        </div>
                        {/* Google Maps Preview */}
                        {getFullAddress() && (
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                                    <MapPin className="w-4 h-4" />
                                    地図プレビュー
                                </label>
                                <div className="border border-gray-200 rounded-lg overflow-hidden">
                                    <iframe
                                        title="Map Preview"
                                        width="100%"
                                        height="200"
                                        loading="lazy"
                                        style={{ border: 0 }}
                                        src={`https://maps.google.com/maps?q=${encodeURIComponent(getFullAddress())}&output=embed`}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 工事情報セクション */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => toggleSection('construction')}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <span className="font-bold text-gray-800">工事情報</span>
                    {expandedSections.construction ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.construction && (
                    <div className="p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 面積 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">m2</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={formData.area}
                                        onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="m2"
                                    />
                                </div>
                            </div>
                            {/* 面積備考 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
                                <input
                                    type="text"
                                    value={formData.areaRemarks}
                                    onChange={(e) => setFormData({ ...formData, areaRemarks: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="備考"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 組立日 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">組立日</label>
                                <input
                                    type="date"
                                    value={formData.assemblyDate}
                                    onChange={(e) => setFormData({ ...formData, assemblyDate: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            {/* 解体日 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">解体日</label>
                                <input
                                    type="date"
                                    value={formData.demolitionDate}
                                    onChange={(e) => setFormData({ ...formData, demolitionDate: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 予定組立人工 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">予定組立人工</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={formData.estimatedAssemblyWorkers}
                                        onChange={(e) => setFormData({ ...formData, estimatedAssemblyWorkers: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="予定組立人工"
                                    />
                                    <span className="text-sm text-gray-500">名</span>
                                </div>
                            </div>
                            {/* 予定解体人工 */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">予定解体人工</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={formData.estimatedDemolitionWorkers}
                                        onChange={(e) => setFormData({ ...formData, estimatedDemolitionWorkers: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        placeholder="予定解体人工"
                                    />
                                    <span className="text-sm text-gray-500">名</span>
                                </div>
                            </div>
                        </div>
                        {/* 請負金額 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">請負金額</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={formData.contractAmount}
                                    onChange={(e) => setFormData({ ...formData, contractAmount: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                    placeholder="請負金額"
                                />
                                <span className="text-sm text-gray-500">円(税抜)</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 足場仕様セクション */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => toggleSection('scaffolding')}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <span className="font-bold text-gray-800">足場仕様</span>
                    {expandedSections.scaffolding ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.scaffolding && (
                    <div className="p-4 space-y-4">
                        {/* 項目1 */}
                        <div className="border-b pb-4">
                            <button
                                type="button"
                                onClick={() => setExpandedScaffoldingSections(prev => ({ ...prev, section1: !prev.section1 }))}
                                className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"
                            >
                                {expandedScaffoldingSections.section1 ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                項目1
                            </button>
                            {expandedScaffoldingSections.section1 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4">
                                    {/* 一側足場 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">一側足場</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.singleSideScaffold}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, singleSideScaffold: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 本足場 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">本足場</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.mainScaffold}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, mainScaffold: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 外手摺 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">外手摺</span>
                                        <div className="flex gap-2">
                                            {['1本', '2本'].map(val => (
                                                <label key={val} className="flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="outerHandrail"
                                                        checked={formData.scaffoldingSpec.outerHandrail === val}
                                                        onChange={() => setFormData({
                                                            ...formData,
                                                            scaffoldingSpec: { ...formData.scaffoldingSpec, outerHandrail: val as '1本' | '2本' }
                                                        })}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm">{val}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    {/* 内手摺 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">内手摺</span>
                                        <input
                                            type="text"
                                            value={formData.scaffoldingSpec.innerHandrail}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                scaffoldingSpec: { ...formData.scaffoldingSpec, innerHandrail: e.target.value }
                                            })}
                                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                                            placeholder="本"
                                        />
                                    </div>
                                    {/* 落下防止手摺 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">落下防止手摺</span>
                                        <div className="flex gap-2">
                                            {['1本', '2本', '3本'].map(val => (
                                                <label key={val} className="flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="fallPreventionHandrail"
                                                        checked={formData.scaffoldingSpec.fallPreventionHandrail === val}
                                                        onChange={() => setFormData({
                                                            ...formData,
                                                            scaffoldingSpec: { ...formData.scaffoldingSpec, fallPreventionHandrail: val as '1本' | '2本' | '3本' }
                                                        })}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm">{val}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    {/* 巾木 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">巾木</span>
                                        <div className="flex gap-2">
                                            {['L型', '木'].map(val => (
                                                <label key={val} className="flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="baseboard"
                                                        checked={formData.scaffoldingSpec.baseboard === val}
                                                        onChange={() => setFormData({
                                                            ...formData,
                                                            scaffoldingSpec: { ...formData.scaffoldingSpec, baseboard: val as 'L型' | '木' }
                                                        })}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm">{val}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    {/* 小幅ネット */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">小幅ネット</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.narrowNet}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, narrowNet: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 壁つなぎ */}
                                    <div className="flex items-center gap-2 md:col-span-2">
                                        <span className="text-sm text-gray-600 w-24">壁つなぎ</span>
                                        <input
                                            type="text"
                                            value={formData.scaffoldingSpec.wallTie}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                scaffoldingSpec: { ...formData.scaffoldingSpec, wallTie: e.target.value }
                                            })}
                                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                                            placeholder="壁つなぎ"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 項目2 */}
                        <div className="border-b pb-4">
                            <button
                                type="button"
                                onClick={() => setExpandedScaffoldingSections(prev => ({ ...prev, section2: !prev.section2 }))}
                                className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"
                            >
                                {expandedScaffoldingSections.section2 ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                項目2
                            </button>
                            {expandedScaffoldingSections.section2 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4">
                                    {/* シート */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">シート</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.sheet}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, sheet: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* シート種別 */}
                                    <div className="flex items-center gap-2 md:col-span-2">
                                        <span className="text-sm text-gray-600 w-32">シート種別※カヤシートの場合</span>
                                        <input
                                            type="text"
                                            value={formData.scaffoldingSpec.sheetType}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                scaffoldingSpec: { ...formData.scaffoldingSpec, sheetType: e.target.value }
                                            })}
                                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                                            placeholder="シート種別※カヤシートの場合"
                                        />
                                    </div>
                                    {/* イメージシート */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">イメージシート</span>
                                        <div className="flex gap-2">
                                            {['持参', '現場'].map(val => (
                                                <label key={val} className="flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="imageSheet"
                                                        checked={formData.scaffoldingSpec.imageSheet === val}
                                                        onChange={() => setFormData({
                                                            ...formData,
                                                            scaffoldingSpec: { ...formData.scaffoldingSpec, imageSheet: val as '持参' | '現場' }
                                                        })}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm">{val}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    {/* 足場表示看板 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">足場表示看板</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.scaffoldSign}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, scaffoldSign: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 階段 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">階段</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.stairs}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, stairs: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* タラップ */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">タラップ</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.ladder}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, ladder: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 階段墜 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">階段墜</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.stairUnit}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, stairUnit: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 1・2コマアンチ */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">1・2コマアンチ</span>
                                        <div className="flex gap-2">
                                            {['400', '250'].map(val => (
                                                <label key={val} className="flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="cornerAnti"
                                                        checked={formData.scaffoldingSpec.cornerAnti === val}
                                                        onChange={() => setFormData({
                                                            ...formData,
                                                            scaffoldingSpec: { ...formData.scaffoldingSpec, cornerAnti: val as '400' | '250' }
                                                        })}
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm">{val}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 項目3 */}
                        <div>
                            <button
                                type="button"
                                onClick={() => setExpandedScaffoldingSections(prev => ({ ...prev, section3: !prev.section3 }))}
                                className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"
                            >
                                {expandedScaffoldingSections.section3 ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                項目3
                            </button>
                            {expandedScaffoldingSections.section3 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4">
                                    {/* 親綱 */}
                                    <div className="flex items-center gap-2 md:col-span-2">
                                        <span className="text-sm text-gray-600 w-24">親綱</span>
                                        <input
                                            type="text"
                                            value={formData.scaffoldingSpec.parentRope}
                                            onChange={(e) => setFormData({
                                                ...formData,
                                                scaffoldingSpec: { ...formData.scaffoldingSpec, parentRope: e.target.value }
                                            })}
                                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                                            placeholder="親綱"
                                        />
                                    </div>
                                    {/* 養生カバークッション */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-32">養生カバークッション</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.cushionCover}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, cushionCover: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* スペースチューブ */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">スペースチューブ</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.spaceTube}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, spaceTube: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                    {/* 切妻単管手摺 */}
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 w-24">切妻単管手摺</span>
                                        <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.scaffoldingSpec.gableHandrail}
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scaffoldingSpec: { ...formData.scaffoldingSpec, gableHandrail: e.target.checked }
                                                })}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm">必要</span>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 備考セクション */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => toggleSection('remarks')}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                    <span className="font-bold text-gray-800">備考</span>
                    {expandedSections.remarks ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
                {expandedSections.remarks && (
                    <div className="p-4">
                        <textarea
                            value={formData.remarks}
                            onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                            placeholder="備考"
                        />
                    </div>
                )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                    キャンセル
                </button>
                <button
                    type="button"
                    onClick={onSubmit}
                    className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                    {isEdit ? '更新' : '作成'}
                </button>
            </div>
        </div>
    );
}
