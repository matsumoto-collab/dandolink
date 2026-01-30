'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import { FormField } from '../common/FormField';
import { useCustomerSearch } from '@/hooks/useCustomerSearch';
import { ConstructionContentType, CONSTRUCTION_CONTENT_LABELS } from '@/types/calendar';
import { isManagerOrAbove } from '@/utils/permissions';
import { ProjectMasterFormData } from '../ProjectMasterForm';

interface ManagerUser {
    id: string;
    displayName: string;
    role: string;
    isActive: boolean;
}

interface BasicInfoSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function BasicInfoSection({ formData, setFormData }: BasicInfoSectionProps) {
    const [managers, setManagers] = useState<ManagerUser[]>([]);
    const [isLoadingManagers, setIsLoadingManagers] = useState(true);

    const {
        filteredCustomers,
        searchTerm: customerSearchTerm,
        setSearchTerm: setCustomerSearchTerm,
        showDropdown: showCustomerDropdown,
        setShowDropdown: setShowCustomerDropdown,
    } = useCustomerSearch();

    useEffect(() => {
        const fetchManagers = async () => {
            setIsLoadingManagers(true);
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const users = await res.json();
                    const filtered = users.filter((u: ManagerUser) =>
                        isManagerOrAbove(u)
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

    return (
        <div className="space-y-4">
            {/* 工事内容 */}
            <FormField label="工事内容" required>
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
            </FormField>

            {/* 案件担当者 */}
            <FormField label="案件責任者" required>
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
            </FormField>

            {/* 現場名 */}
            <FormField label="現場名" required>
                <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="例: 松本様邸"
                />
            </FormField>

            {/* 元請け（顧客選択） */}
            <div className="relative">
                <FormField label="元請け" required>
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
                </FormField>
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
    );
}
