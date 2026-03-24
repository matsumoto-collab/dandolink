'use client';

import React, { useState } from 'react';
import { CustomerInput, ContactPerson } from '@/types/customer';
import { Plus, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';

interface CustomerFormProps {
    initialData?: Partial<CustomerInput>;
    onSubmit: (data: CustomerInput) => void;
    onCancel: () => void;
}

export default function CustomerForm({ initialData, onSubmit, onCancel }: CustomerFormProps) {
    const [formData, setFormData] = useState<CustomerInput>({
        name: initialData?.name || '',
        shortName: initialData?.shortName || '',
        honorific: initialData?.honorific || '御中',
        contactPersons: initialData?.contactPersons || [],
        email: initialData?.email || '',
        phone: initialData?.phone || '',
        fax: initialData?.fax || '',
        postalCode: initialData?.postalCode || '',
        address: initialData?.address || '',
        notes: initialData?.notes || '',
    });
    const { fetchAddress } = usePostalCodeAutofill();
    const [isSearchingAddress, setIsSearchingAddress] = useState(false);

    const handlePostalCodeSearch = async () => {
        if (!formData.postalCode) return;
        setIsSearchingAddress(true);
        try {
            const result = await fetchAddress(formData.postalCode);
            if (result) {
                setFormData(prev => ({
                    ...prev,
                    address: result.prefecture + result.city,
                }));
            } else {
                toast.error('該当する住所が見つかりません');
            }
        } finally {
            setIsSearchingAddress(false);
        }
    };

    const handlePostalCodeChange = (value: string) => {
        // ハイフン自動挿入: 3桁入力後に自動で-を付ける
        const digits = value.replace(/[^0-9]/g, '');
        let formatted = digits;
        if (digits.length > 3) {
            formatted = digits.slice(0, 3) + '-' + digits.slice(3, 7);
        }
        setFormData({ ...formData, postalCode: formatted });

        // 7桁揃ったら自動検索
        if (digits.length === 7) {
            setIsSearchingAddress(true);
            fetchAddress(digits).then(result => {
                if (result) {
                    setFormData(prev => ({
                        ...prev,
                        address: result.prefecture + result.city,
                    }));
                }
            }).finally(() => setIsSearchingAddress(false));
        }
    };

    // 担当者を追加
    const addContactPerson = () => {
        const newContact: ContactPerson = {
            id: `contact-${Date.now()}`,
            name: '',
            email: '',
            phone: '',
        };
        setFormData({
            ...formData,
            contactPersons: [...formData.contactPersons, newContact],
        });
    };

    // 担当者を削除
    const removeContactPerson = (id: string) => {
        setFormData({
            ...formData,
            contactPersons: formData.contactPersons.filter(c => c.id !== id),
        });
    };

    // 担当者を更新
    const updateContactPerson = (id: string, field: keyof ContactPerson, value: string) => {
        setFormData({
            ...formData,
            contactPersons: formData.contactPersons.map(c =>
                c.id === id ? { ...c, [field]: value } : c
            ),
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name) {
            toast.error('会社名は必須です');
            return;
        }

        onSubmit(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* 会社名 */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    会社名 <span className="text-slate-500">*</span>
                </label>
                <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="例: ○○建設株式会社"
                    required
                />
            </div>

            {/* 略称・敬称 */}
            <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        略称
                    </label>
                    <input
                        type="text"
                        value={formData.shortName}
                        onChange={(e) => setFormData({ ...formData, shortName: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: ○○建設"
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        敬称
                    </label>
                    <select
                        value={formData.honorific}
                        onChange={(e) => setFormData({ ...formData, honorific: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                    >
                        <option value="御中">御中</option>
                        <option value="様">様</option>
                    </select>
                </div>
            </div>

            {/* 担当者 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-semibold text-slate-700">
                        担当者
                    </label>
                    <button
                        type="button"
                        onClick={addContactPerson}
                        className="flex items-center gap-1 px-3 py-1 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        担当者追加
                    </button>
                </div>

                {formData.contactPersons.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4 border border-slate-200 rounded-lg">
                        担当者が登録されていません
                    </p>
                ) : (
                    <div className="space-y-3">
                        {formData.contactPersons.map((contact, index) => (
                            <div key={contact.id} className="p-4 border border-slate-200 rounded-lg bg-slate-50">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-sm font-semibold text-slate-700">
                                        担当者 {index + 1}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => removeContactPerson(contact.id)}
                                        className="text-slate-600 hover:text-slate-700"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 gap-3">
                                    <input
                                        type="text"
                                        value={contact.name}
                                        onChange={(e) => updateContactPerson(contact.id, 'name', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="氏名"
                                    />
                                    <input
                                        type="email"
                                        value={contact.email}
                                        onChange={(e) => updateContactPerson(contact.id, 'email', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="メールアドレス"
                                    />
                                    <input
                                        type="tel"
                                        value={contact.phone}
                                        onChange={(e) => updateContactPerson(contact.id, 'phone', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                                        placeholder="電話番号"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 代表連絡先 */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        代表メールアドレス
                    </label>
                    <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: info@example.com"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        代表電話番号
                    </label>
                    <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 03-1234-5678"
                    />
                </div>

                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        FAX番号
                    </label>
                    <input
                        type="tel"
                        value={formData.fax}
                        onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 03-1234-5679"
                    />
                </div>
            </div>

            {/* 郵便番号 */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    郵便番号
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) => handlePostalCodeChange(e.target.value)}
                        className="w-40 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 123-4567"
                        maxLength={8}
                        inputMode="numeric"
                    />
                    <button
                        type="button"
                        onClick={handlePostalCodeSearch}
                        disabled={isSearchingAddress || !formData.postalCode}
                        className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 flex items-center gap-1 text-sm"
                    >
                        <Search className="w-4 h-4" />
                        {isSearchingAddress ? '検索中...' : '住所検索'}
                    </button>
                </div>
            </div>

            {/* 住所 */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    住所
                </label>
                <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="例: 東京都○○区○○1-2-3"
                />

                {/* 地図プレビュー */}
                {formData.address && (
                    <div className="mt-3 border border-slate-300 rounded-lg overflow-hidden">
                        <iframe
                            width="100%"
                            height="300"
                            frameBorder="0"
                            style={{ border: 0 }}
                            src={`https://maps.google.com/maps?q=${encodeURIComponent(formData.address)}&output=embed`}
                            title="地図プレビュー"
                            allowFullScreen
                        />
                    </div>
                )}
            </div>

            {/* 備考 */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    備考
                </label>
                <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="備考を入力..."
                />
            </div>

            {/* ボタン */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-6 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                >
                    キャンセル
                </button>
                <button
                    type="submit"
                    className="px-6 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-all shadow-md hover:shadow-lg"
                >
                    保存
                </button>
            </div>
        </form>
    );
}
