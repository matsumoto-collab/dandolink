'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/hooks/useCompany';
import { BankAccount } from '@/types/company';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CompanyInfoSettings() {
    const { companyInfo, updateCompanyInfo, isLoading } = useCompany();
    const [formData, setFormData] = useState({
        name: '',
        postalCode: '',
        address: '',
        tel: '',
        fax: '',
        email: '',
        representativeTitle: '',
        representative: '',
        sealImage: '',
        licenseNumber: '',
        registrationNumber: '',
        bankAccounts: [] as BankAccount[],
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (companyInfo) {
            setFormData({
                name: companyInfo.name || '',
                postalCode: companyInfo.postalCode || '',
                address: companyInfo.address || '',
                tel: companyInfo.tel || '',
                fax: companyInfo.fax || '',
                email: companyInfo.email || '',
                representativeTitle: companyInfo.representativeTitle || '',
                representative: companyInfo.representative || '',
                sealImage: companyInfo.sealImage || '',
                licenseNumber: companyInfo.licenseNumber || '',
                registrationNumber: companyInfo.registrationNumber || '',
                bankAccounts: companyInfo.bankAccounts || [],
            });
        }
    }, [companyInfo]);

    const handleChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleBankAccountChange = (index: number, field: keyof BankAccount, value: string) => {
        setFormData(prev => {
            const newAccounts = [...prev.bankAccounts];
            newAccounts[index] = { ...newAccounts[index], [field]: value };
            return { ...prev, bankAccounts: newAccounts };
        });
    };

    const addBankAccount = () => {
        setFormData(prev => ({
            ...prev,
            bankAccounts: [...prev.bankAccounts, { bankName: '', branchName: '', accountType: '普', accountNumber: '' }],
        }));
    };

    const removeBankAccount = (index: number) => {
        setFormData(prev => ({
            ...prev,
            bankAccounts: prev.bankAccounts.filter((_, i) => i !== index),
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateCompanyInfo(formData);
            toast.success('会社情報を保存しました');
        } catch (error) {
            console.error('Save error:', error);
            toast.error('保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <h3 className="text-lg font-semibold text-slate-900">会社情報設定</h3>

            {/* 基本情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">会社名</label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleChange('name', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">代表者肩書</label>
                    <input
                        type="text"
                        value={formData.representativeTitle}
                        onChange={(e) => handleChange('representativeTitle', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例：代表取締役"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">代表者氏名</label>
                    <input
                        type="text"
                        value={formData.representative}
                        onChange={(e) => handleChange('representative', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">郵便番号</label>
                    <input
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) => handleChange('postalCode', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="000-0000"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">住所</label>
                    <input
                        type="text"
                        value={formData.address}
                        onChange={(e) => handleChange('address', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
                    <input
                        type="text"
                        value={formData.tel}
                        onChange={(e) => handleChange('tel', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">FAX番号</label>
                    <input
                        type="text"
                        value={formData.fax}
                        onChange={(e) => handleChange('fax', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                    <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleChange('email', e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                </div>
            </div>

            {/* 許可番号・登録番号 */}
            <div className="border-t pt-4">
                <h4 className="text-md font-medium text-slate-800 mb-3">許可・登録情報</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">建設業許可番号</label>
                        <input
                            type="text"
                            value={formData.licenseNumber}
                            onChange={(e) => handleChange('licenseNumber', e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            placeholder="例：愛媛県知事 許可（般-6） 第17335号"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">インボイス登録番号</label>
                        <input
                            type="text"
                            value={formData.registrationNumber}
                            onChange={(e) => handleChange('registrationNumber', e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            placeholder="例：T8500001018289"
                        />
                    </div>
                </div>
            </div>

            {/* 会社印 */}
            <div className="border-t pt-4">
                <h4 className="text-md font-medium text-slate-800 mb-3">会社印</h4>
                <div className="flex items-start gap-4">
                    {formData.sealImage && (
                        <div className="border border-slate-300 rounded-md p-2 bg-white">
                            <img src={formData.sealImage} alt="会社印" className="w-16 h-16 object-contain" />
                        </div>
                    )}
                    <div className="flex-1">
                        <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                        handleChange('sealImage', reader.result as string);
                                    };
                                    reader.readAsDataURL(file);
                                }
                            }}
                            className="text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">PNG/JPG推奨、背景透過PNG推奨</p>
                        {formData.sealImage && (
                            <button
                                type="button"
                                onClick={() => handleChange('sealImage', '')}
                                className="text-xs text-red-500 mt-1 hover:underline"
                            >
                                削除
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* 銀行口座 */}
            <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-md font-medium text-slate-800">振込先口座</h4>
                    <button
                        onClick={addBankAccount}
                        className="flex items-center gap-1 px-3 py-1 text-sm bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        口座追加
                    </button>
                </div>
                <div className="space-y-3">
                    {formData.bankAccounts.map((account, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                            <input
                                type="text"
                                value={account.bankName}
                                onChange={(e) => handleBankAccountChange(index, 'bankName', e.target.value)}
                                className="w-28 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                placeholder="銀行名"
                            />
                            <input
                                type="text"
                                value={account.branchName}
                                onChange={(e) => handleBankAccountChange(index, 'branchName', e.target.value)}
                                className="w-24 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                placeholder="支店名"
                            />
                            <select
                                value={account.accountType}
                                onChange={(e) => handleBankAccountChange(index, 'accountType', e.target.value)}
                                className="w-16 px-2 py-1 border border-slate-300 rounded-md text-sm"
                            >
                                <option value="普">普通</option>
                                <option value="当">当座</option>
                            </select>
                            <input
                                type="text"
                                value={account.accountNumber}
                                onChange={(e) => handleBankAccountChange(index, 'accountNumber', e.target.value)}
                                className="w-28 px-2 py-1 border border-slate-300 rounded-md text-sm"
                                placeholder="口座番号"
                            />
                            <button
                                onClick={() => removeBankAccount(index)}
                                className="p-1 text-red-500 hover:bg-red-50 rounded-md"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                    {formData.bankAccounts.length === 0 && (
                        <p className="text-sm text-gray-500 py-2">口座が登録されていません</p>
                    )}
                </div>
            </div>

            {/* 保存ボタン */}
            <div className="border-t pt-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-slate-700 to-slate-600 text-white rounded-md hover:from-slate-800 hover:to-slate-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存
                </button>
            </div>
        </div>
    );
}
