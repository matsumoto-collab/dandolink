'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useCustomers } from '@/hooks/useCustomers';
import { Customer, CustomerInput } from '@/types/customer';
import CustomerModal from '@/components/Customers/CustomerModal';
import { Button } from '@/components/ui/Button';
import { Plus, Search, Edit, Trash2, User, Phone } from 'lucide-react';
import toast from 'react-hot-toast';
import LastUpdatedLabel from '@/components/ui/LastUpdatedLabel';
import { logger } from '@/lib/logger';
import { matchesSearch } from '@/utils/searchNormalize';
import { closingDayLabel } from '@/lib/closingDay';

export default function CustomersPage() {
    const { customers, isLoading, isInitialized, ensureDataLoaded, addCustomer, updateCustomer, deleteCustomer } = useCustomers();

    // ページ表示時にデータを読み込み
    useEffect(() => {
        ensureDataLoaded();
    }, [ensureDataLoaded]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [_isSubmitting, setIsSubmitting] = useState(false);

    // 検索フィルター
    const filteredCustomers = customers.filter(customer =>
        matchesSearch(customer.name, searchQuery) ||
        matchesSearch(customer.shortName, searchQuery) ||
        customer.contactPersons?.some(cp => matchesSearch(cp.name, searchQuery))
    );

    // フィルター変更時にページをリセット
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery]);

    const totalPages = Math.ceil(filteredCustomers.length / ITEMS_PER_PAGE);
    const paginatedCustomers = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredCustomers.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [filteredCustomers, currentPage]);

    // 新規顧客を追加
    const handleAddCustomer = async (data: CustomerInput) => {
        try {
            setIsSubmitting(true);
            await addCustomer(data);
            setIsModalOpen(false);
        } catch (error) {
            logger.error('Failed to add customer:', error);
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
                logger.error('Failed to update customer:', error);
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
                logger.error('Failed to delete customer:', error);
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
        <div className="h-full flex flex-col overflow-hidden bg-slate-50">
            {/* ヘッダー（モバイルは新規登録をタイトル行へ統合・件数はタイトル横に） */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 mb-3 sm:mb-6">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">
                        顧客一覧
                        <span className="sm:hidden ml-2 text-sm font-normal text-slate-500">{filteredCustomers.length}件</span>
                    </h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">{filteredCustomers.length}件の顧客データ</p>
                </div>
                <div className="sm:hidden flex-shrink-0">
                    <Button
                        variant="primary"
                        onClick={() => setIsModalOpen(true)}
                        leftIcon={<Plus className="w-5 h-5" />}
                    >
                        新規登録
                    </Button>
                </div>
            </div>

            {/* 検索バー + 新規登録ボタン（ボタンは sm+ のみ。モバイルはタイトル行に表示） */}
            <div className="flex-shrink-0 flex flex-col md:flex-row md:items-center gap-2 sm:gap-3 md:gap-4 mb-3 sm:mb-4 md:mb-6">
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
                <div className="hidden sm:block">
                    <Button
                        variant="primary"
                        onClick={() => setIsModalOpen(true)}
                        leftIcon={<Plus className="w-5 h-5" />}
                        className="w-full md:w-auto"
                    >
                        新規登録
                    </Button>
                </div>
            </div>

            {/* モバイルカードビュー */}
            <div className="md:hidden flex-1 overflow-y-auto space-y-3">
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
                    paginatedCustomers.map((customer) => (
                        <div
                            key={customer.id}
                            className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                        >
                            <div className="p-3">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <h3 className="text-base font-bold text-slate-800">{customer.name}</h3>
                                    {customer.shortName && (
                                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-700">
                                            {customer.shortName}
                                        </span>
                                    )}
                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-teal-50 text-teal-700">
                                        {closingDayLabel(customer.closingDay)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
                                    {customer.contactPersons && customer.contactPersons.length > 0 && (
                                        <span className="flex items-center gap-1">
                                            <User className="w-3.5 h-3.5" />
                                            {customer.contactPersons.map(cp => cp.name).join(', ')}
                                        </span>
                                    )}
                                    {customer.phone && (
                                        <span className="flex items-center gap-1">
                                            <Phone className="w-3.5 h-3.5" />
                                            {customer.phone}
                                        </span>
                                    )}
                                </div>
                                <LastUpdatedLabel updatedAt={customer.updatedAt} updatedBy={customer.updatedBy} />
                                {/* モバイル: アクションボタン行 */}
                                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
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
                                        title="削除"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden md:flex md:flex-col flex-1 min-h-0 bg-white rounded-xl shadow-lg border border-slate-200">
            <div className="flex-1 overflow-auto">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                顧客名
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                略称
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                締め日
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                担当者
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                メール
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                電話
                            </th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-800 uppercase tracking-wider">
                                住所
                            </th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-800 uppercase tracking-wider">
                                操作
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {!isInitialized || isLoading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i} className="animate-pulse">
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-36"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-28"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-40"></div></td>
                                    <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
                                </tr>
                            ))
                        ) : filteredCustomers.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                                    {searchQuery ? '該当する顧客が見つかりません' : '顧客が登録されていません'}
                                </td>
                            </tr>
                        ) : (
                            paginatedCustomers.map((customer) => (
                                <tr
                                    key={customer.id}
                                    className="hover:bg-slate-50 transition-all duration-200"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-[12px] font-semibold text-slate-900">
                                            {customer.name}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                        {customer.shortName || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                        {closingDayLabel(customer.closingDay)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                        {customer.contactPersons && customer.contactPersons.length > 0
                                            ? customer.contactPersons.map(cp => cp.name).join(', ')
                                            : '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                        {customer.email || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-[12px] text-slate-700">
                                        {customer.phone || '-'}
                                    </td>
                                    <td className="px-6 py-4 text-[12px] text-slate-700 max-w-xs truncate">
                                        {customer.address || '-'}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-[12px] font-medium">
                                        <button
                                            onClick={() => handleEditClick(customer)}
                                            className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 mr-2 transition-colors"
                                        >
                                            編集
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCustomer(customer.id, customer.name)}
                                            className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                        >
                                            削除
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

                {/* ページネーション */}
                {totalPages > 1 && (
                    <div className="flex-shrink-0 flex justify-center items-center gap-2 py-3 border-t border-slate-200">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            前へ
                        </button>
                        <span className="text-sm font-medium text-slate-600 px-4">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                        >
                            次へ
                        </button>
                    </div>
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
