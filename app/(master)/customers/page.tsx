'use client';

import React, { useState, useEffect } from 'react';
import { useCustomers } from '@/hooks/useCustomers';
import { Customer, CustomerInput } from '@/types/customer';
import CustomerModal from '@/components/Customers/CustomerModal';
import { Button } from '@/components/ui/Button';
import { Plus, Search, Edit, Trash2, User, Mail, Phone, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CustomersPage() {
    const { customers, isLoading, isInitialized, ensureDataLoaded, addCustomer, updateCustomer, deleteCustomer } = useCustomers();

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
    const handleAddCustomer = async (data: CustomerInput) => {
        try {
            setIsSubmitting(true);
            await addCustomer(data);
            setIsModalOpen(false);
        } catch (error) {
            console.error('Failed to add customer:', error);
            toast.error(error instanceof Error ? error.message : '顧客の追加に失敗しました');
        } finally {
            setIsSubmitting(false);
        }
    };

    // 顧客を更新
    const handleUpdateCustomer = async (data: Partial<CustomerInput>) => {
        if (editingCustomer) {
            try {
                setIsSubmitting(true);
                await updateCustomer(editingCustomer.id, data);
                setEditingCustomer(null);
                setIsModalOpen(false);
            } catch (error) {
                console.error('Failed to update customer:', error);
                toast.error(error instanceof Error ? error.message : '顧客の更新に失敗しました');
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
                toast.error(error instanceof Error ? error.message : '顧客の削除に失敗しました');
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
        <div className="h-full flex flex-col p-3 md:p-6 overflow-hidden bg-slate-50">
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-3 md:mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 mb-2">
                        顧客一覧
                    </h1>
                    <p className="text-slate-600">{filteredCustomers.length}件の顧客データ</p>
                </div>
            </div>

            {/* 検索バー + 新規登録ボタン */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 mb-4 md:mb-6">
                <div className="relative w-full md:flex-1 md:max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="顧客名または担当者名で検索..."
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-transparent shadow-sm"
                    />
                </div>
                <Button
                    variant="primary"
                    onClick={() => setIsModalOpen(true)}
                    leftIcon={<Plus className="w-5 h-5" />}
                >
                    新規登録
                </Button>
            </div>

            {/* 顧客一覧（リスト形式） */}
            <div className="flex-1 overflow-y-auto space-y-3">
                {!isInitialized || isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="animate-spin w-8 h-8 border-4 border-slate-500 border-t-transparent rounded-full"></div>
                    </div>
                ) : filteredCustomers.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                        <User className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                        <p>{searchQuery ? '該当する顧客が見つかりません' : '顧客が登録されていません'}</p>
                        {!searchQuery && (
                            <Button
                                variant="ghost"
                                onClick={() => setIsModalOpen(true)}
                                className="mt-4"
                            >
                                最初の顧客を登録する
                            </Button>
                        )}
                    </div>
                ) : (
                    filteredCustomers.map((customer) => (
                        <div
                            key={customer.id}
                            className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                        >
                            <div className="p-3 md:p-4">
                                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                    {/* メイン情報 */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-base md:text-lg font-bold text-slate-800">{customer.name}</h3>
                                            {customer.shortName && (
                                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">
                                                    {customer.shortName}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 md:gap-4 mt-1 text-sm text-slate-600 flex-wrap">
                                            {customer.contactPersons && customer.contactPersons.length > 0 && (
                                                <span className="flex items-center gap-1">
                                                    <User className="w-3.5 h-3.5" />
                                                    {customer.contactPersons.map(cp => cp.name).join(', ')}
                                                </span>
                                            )}
                                            {customer.email && (
                                                <span className="flex items-center gap-1">
                                                    <Mail className="w-3.5 h-3.5" />
                                                    {customer.email}
                                                </span>
                                            )}
                                            {customer.phone && (
                                                <span className="flex items-center gap-1">
                                                    <Phone className="w-3.5 h-3.5" />
                                                    {customer.phone}
                                                </span>
                                            )}
                                            {customer.address && (
                                                <span className="flex items-center gap-1">
                                                    <MapPin className="w-3.5 h-3.5" />
                                                    {customer.address}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* PC: アクションボタン */}
                                    <div className="hidden md:flex items-center gap-2">
                                        <button
                                            onClick={() => handleEditClick(customer)}
                                            className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            title="編集"
                                        >
                                            <Edit className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustomer(customer.id, customer.name)}
                                            className="p-2.5 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                            title="削除"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>

                                {/* モバイル: アクションボタン行 */}
                                <div className="flex md:hidden items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                                    <button
                                        onClick={() => handleEditClick(customer)}
                                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                        編集
                                    </button>
                                    <button
                                        onClick={() => handleDeleteCustomer(customer.id, customer.name)}
                                        className="flex items-center justify-center gap-1.5 py-2.5 px-3 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

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
