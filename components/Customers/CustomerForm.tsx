'use client';

import React, { useRef, useState } from 'react';
import { CustomerInput, ContactPerson } from '@/types/customer';
import { Plus, Trash2, Search, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';
import { Button } from '@/components/ui/Button';
import { CLOSING_DAY_OPTIONS, closingDayLabel } from '@/lib/closingDay';
import LineLinkModal from '@/components/Customers/LineLinkModal';

interface CustomerFormProps {
    initialData?: Partial<CustomerInput>;
    /** 編集中の顧客ID（保存済みの場合のみ）。担当者のLINE連携に使用する。 */
    customerId?: string;
    onSubmit: (data: CustomerInput) => void;
    onCancel: () => void;
}

export default function CustomerForm({ initialData, customerId, onSubmit, onCancel }: CustomerFormProps) {
    const [formData, setFormData] = useState<CustomerInput>({
        name: initialData?.name || '',
        shortName: initialData?.shortName || '',
        honorific: initialData?.honorific || '御中',
        closingDay: initialData?.closingDay ?? 0,
        // 担当者IDが無い旧データにも安定IDを付与（連携にはID必須・Reactキーの安定化も兼ねる）
        contactPersons: (initialData?.contactPersons || []).map((c, i) =>
            c.id ? c : { ...c, id: `contact-${Date.now()}-${i}` }
        ),
        email: initialData?.email || '',
        phone: initialData?.phone || '',
        fax: initialData?.fax || '',
        postalCode: initialData?.postalCode || '',
        address: initialData?.address || '',
        notes: initialData?.notes || '',
    });
    const { fetchAddress } = usePostalCodeAutofill();
    const [isSearchingAddress, setIsSearchingAddress] = useState(false);

    // LINE連携: コード発行には永続IDが必要なため、発行時点で保存済みの担当者IDのみ対象にする
    const savedContactIdsRef = useRef<Set<string>>(
        new Set((initialData?.contactPersons ?? []).map((c) => c.id).filter(Boolean) as string[])
    );
    const [linkTarget, setLinkTarget] = useState<{ contactId: string; contactName: string } | null>(null);

    const handleUnlink = async (contact: ContactPerson) => {
        if (!customerId) return;
        if (!confirm(`${contact.name || 'この担当者'} のLINE連携を解除しますか？`)) return;
        try {
            const res = await fetch('/api/line/link-token', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId, contactId: contact.id }),
            });
            if (!res.ok) throw new Error();
            updateContactPerson(contact.id, 'lineUserId', '');
            toast.success('LINE連携を解除しました');
        } catch {
            toast.error('解除に失敗しました');
        }
    };

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
        <>
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

            {/* 請求の締め日 */}
            <div className="grid grid-cols-3 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        請求の締め日
                    </label>
                    <select
                        value={formData.closingDay ?? 0}
                        onChange={(e) => setFormData({ ...formData, closingDay: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
                    >
                        {CLOSING_DAY_OPTIONS.map((d) => (
                            <option key={d} value={d}>
                                {closingDayLabel(d)}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="col-span-2 flex items-end">
                    <p className="text-xs text-slate-500 pb-2">
                        請求書をまとめる締め日です。請求待ちボードがこの締め日で期間（前月＋1日〜当月締め日）を区切ります。
                    </p>
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
                        className="flex items-center gap-1 px-3 py-1 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
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
                                {/* LINE連携（保存済みの担当者のみ） */}
                                <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                        <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                                        LINE連携
                                    </span>
                                    {!(customerId && savedContactIdsRef.current.has(contact.id)) ? (
                                        <span className="text-xs text-slate-400">保存後に連携できます</span>
                                    ) : contact.lineUserId ? (
                                        <span className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-50 text-green-700">
                                                連携済み
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleUnlink(contact)}
                                                className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                                            >
                                                解除
                                            </button>
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setLinkTarget({ contactId: contact.id, contactName: contact.name || '担当者' })}
                                            className="px-3 py-1 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                                        >
                                            連携コードを発行
                                        </button>
                                    )}
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
                <Button type="button" variant="outline" size="lg" onClick={onCancel}>
                    キャンセル
                </Button>
                <Button type="submit" variant="primary" size="lg">
                    保存
                </Button>
            </div>
        </form>
        {customerId && linkTarget && (
            <LineLinkModal
                isOpen
                onClose={() => setLinkTarget(null)}
                customerId={customerId}
                contactId={linkTarget.contactId}
                contactName={linkTarget.contactName}
                onLinked={(lineUserId) => updateContactPerson(linkTarget.contactId, 'lineUserId', lineUserId)}
            />
        )}
        </>
    );
}
