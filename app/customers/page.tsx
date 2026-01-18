'use client';

import React, { useState, useEffect } from 'react';
import { useCustomers } from '@/contexts/CustomerContext';
import { Customer } from '@/types/customer';
import CustomerModal from '@/components/Customers/CustomerModal';
import { Plus, Search, Edit, Trash2, User, Mail, Phone, MapPin } from 'lucide-react';

export default function CustomersPage() {
    const { customers, ensureDataLoaded, addCustomer, updateCustomer, deleteCustomer } = useCustomers();

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
    }, [ensureDataLoaded]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // 検索フィルター
    const filteredCustomers = customers.filter(customer =>
        customer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.shortName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customer.contactPersons?.some(cp => cp.name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    // 新規顧客を追加
    const handleAddCustomer = async (data: any) => {
        try {
            setIsSubmitting(true);
            await addCustomer(data);
            setIsModalOpen(false);
        } catch (error) {
            console.error('Failed to add customer:', error);
            alert(error instanceof Error ? error.message : '顧客の追加に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    // 顧客を更新
    const handleUpdateCustomer = async (data: any) => {
        if (editingCustomer) {
            try {
                setIsSubmitting(true);
                await updateCustomer(editingCustomer.id, data);
                setEditingCustomer(null);
                setIsModalOpen(false);
            } catch (error) {
                console.error('Failed to update customer:', error);
                alert(error instanceof Error ? error.message : '顧客の更新に失敗しました');
            } finally {
                setIsSubmitting(false);
            }
        }
    };

    // 顧客を削除
    const handleDeleteCustomer = async (id: string, name: string) => {
        if (confirm(`「${name}」を削除してもよろしいですか？`)) {
            try {
                await deleteCustomer(id);
            } catch (error) {
                console.error('Failed to delete customer:', error);
                alert(error instanceof Error ? error.message : '顧客の削除に失敗しました');
            }
        }
    };


    // 編集モーダルを開く
    const handleEditClick = (customer: Customer) => {
        setEditingCustomer(customer);
        setIsModalOpen(true);
    };

    // モーダルを閉じる
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingCustomer(null);
    };

    return (
        <div className="p-4 sm:p-6 space-y-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-700 to-slate-900 bg-clip-text text-transparent">
                    顧客一覧
                </h1>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-lg hover:from-slate-800 hover:to-slate-900 transition-all shadow-md hover:shadow-lg"
                >
                    <Plus className="w-5 h-5" />
                    新規登録
                </button>
            </div>

            {/* 検索バー */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="顧客名または担当者名で検索..."
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
            </div>

            {/* 顧客一覧 */}
            {filteredCustomers.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">
                        {searchQuery ? '該当する顧客が見つかりません' : '顧客が登録されていません'}
                    </p>
                    {!searchQuery && (
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="mt-4 text-slate-700 hover:text-slate-900 font-medium"
                        >
                            最初の顧客を登録する
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredCustomers.map((customer) => (
                        <div
                            key={customer.id}
                            className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-lg transition-shadow"
                        >
                            {/* 会社名 */}
                            <div className="flex items-start justify-between mb-3">
                                <h3 className="text-lg font-bold text-gray-900 flex-1">
                                    {customer.name}
                                </h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleEditClick(customer)}
                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                        title="編集"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteCustomer(customer.id, customer.name)}
                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="削除"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* 詳細情報 */}
                            <div className="space-y-2 text-sm">
                                {customer.shortName && (
                                    <div className="text-gray-500">
                                        略称: {customer.shortName}
                                    </div>
                                )}
                                {customer.contactPersons && customer.contactPersons.length > 0 && (
                                    <div className="flex items-start gap-2 text-gray-600">
                                        <User className="w-4 h-4 mt-0.5" />
                                        <div className="flex-1">
                                            {customer.contactPersons.map((cp) => (
                                                <div key={cp.id}>
                                                    {cp.name}
                                                    {cp.phone && <span className="text-gray-400 ml-2">({cp.phone})</span>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {customer.email && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Mail className="w-4 h-4" />
                                        <span className="truncate">{customer.email}</span>
                                    </div>
                                )}
                                {customer.phone && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Phone className="w-4 h-4" />
                                        <span>{customer.phone}</span>
                                    </div>
                                )}
                                {customer.fax && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <Phone className="w-4 h-4" />
                                        <span>FAX: {customer.fax}</span>
                                    </div>
                                )}
                                {customer.address && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <MapPin className="w-4 h-4" />
                                        <a
                                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="truncate hover:text-blue-600 hover:underline"
                                            title="Google Mapsで開く"
                                        >
                                            {customer.address}
                                        </a>
                                    </div>
                                )}
                            </div>

                            {/* 備考 */}
                            {customer.notes && (
                                <div className="mt-3 pt-3 border-t border-gray-200">
                                    <p className="text-xs text-gray-500 line-clamp-2">
                                        {customer.notes}
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* モーダル */}
            <CustomerModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSubmit={editingCustomer ? handleUpdateCustomer : handleAddCustomer}
                initialData={editingCustomer || undefined}
                title={editingCustomer ? '顧客編集' : '顧客登録'}
            />
        </div>
    );
}
