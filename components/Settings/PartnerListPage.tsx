'use client';

import { useState, useEffect, FormEvent } from 'react';
import { Building2, Plus, Edit, Trash2, ChevronRight, X, Users } from 'lucide-react';
import Loading, { ButtonLoading } from '@/components/ui/Loading';
import { User } from '@/types/user';
import PartnerMemberListView from './PartnerMemberListView';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface PartnerFormData {
    username: string;
    email: string;
    displayName: string;
    password: string;
    isActive: boolean;
}

interface PartnerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: PartnerFormData) => Promise<void>;
    partner?: User | null;
    mode: 'create' | 'edit';
}

function PartnerModal({ isOpen, onClose, onSave, partner, mode }: PartnerModalProps) {
    const [formData, setFormData] = useState<PartnerFormData>({
        username: '',
        email: '',
        displayName: '',
        password: '',
        isActive: true,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    useEffect(() => {
        if (partner && mode === 'edit') {
            setFormData({
                username: partner.username,
                email: partner.email,
                displayName: partner.displayName,
                password: '',
                isActive: partner.isActive,
            });
        } else {
            setFormData({ username: '', email: '', displayName: '', password: '', isActive: true });
        }
        setError('');
    }, [partner, mode, isOpen]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            await onSave(formData);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'エラーが発生しました');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black/50 hidden lg:block" onClick={onClose} />
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-2xl lg:mx-4 lg:max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-6 border-b border-slate-200">
                    <h2 className="text-xl font-semibold text-slate-800">
                        {mode === 'create' ? '協力会社追加' : '協力会社編集'}
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                {error && (
                    <div className="mx-6 mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-sm text-slate-600">{error}</p>
                    </div>
                )}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">会社名（表示名） <span className="text-slate-500">*</span></label>
                            <input type="text" value={formData.displayName} onChange={(e) => setFormData({ ...formData, displayName: e.target.value })} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">ユーザー名 <span className="text-slate-500">*</span></label>
                            <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 disabled:bg-slate-100" required disabled={mode === 'edit'} />
                            {mode === 'edit' && <p className="mt-1 text-xs text-slate-500">ユーザー名は変更できません</p>}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">メールアドレス <span className="text-slate-500">*</span></label>
                            <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">パスワード {mode === 'create' && <span className="text-slate-500">*</span>}</label>
                            <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500" required={mode === 'create'} placeholder={mode === 'edit' ? '変更する場合のみ入力' : ''} />
                        </div>
                        <div className="flex items-center">
                            <label className="flex items-center cursor-pointer">
                                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="w-5 h-5 text-slate-600 border-slate-300 rounded focus:ring-slate-500" />
                                <span className="ml-2 text-sm font-medium text-slate-700">アクティブ</span>
                            </label>
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
                        <button type="button" onClick={onClose} className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50" disabled={isLoading}>キャンセル</button>
                        <button type="submit" className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50" disabled={isLoading}>
                            {isLoading ? <span className="flex items-center gap-2"><ButtonLoading />保存中...</span> : mode === 'create' ? '追加' : '更新'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function PartnerListPage() {
    const [partners, setPartners] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedPartner, setSelectedPartner] = useState<User | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [editingPartner, setEditingPartner] = useState<User | null>(null);

    const fetchPartners = async () => {
        try {
            const response = await fetch('/api/users?role=partner');
            if (response.ok) {
                const data = await response.json();
                setPartners(data);
            }
        } catch (error) {
            logger.error('Failed to fetch partners:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchPartners();
    }, []);

    const handleCreate = () => {
        setModalMode('create');
        setEditingPartner(null);
        setIsModalOpen(true);
    };

    const handleEdit = (partner: User) => {
        setModalMode('edit');
        setEditingPartner(partner);
        setIsModalOpen(true);
    };

    const handleDelete = async (partnerId: string) => {
        if (!confirm('この協力会社を削除してもよろしいですか？')) return;
        try {
            const response = await fetch(`/api/users/${partnerId}`, { method: 'DELETE' });
            if (response.ok) {
                fetchPartners();
                toast.success('協力会社を削除しました');
            } else {
                const data = await response.json();
                toast.error(data.error || '協力会社の削除に失敗しました');
            }
        } catch (error) {
            logger.error('Failed to delete partner:', error);
            toast.error('協力会社の削除に失敗しました');
        }
    };

    const handleSave = async (data: PartnerFormData) => {
        const url = modalMode === 'create' ? '/api/users' : `/api/users/${editingPartner?.id}`;
        const method = modalMode === 'create' ? 'POST' : 'PATCH';
        const payload: Record<string, unknown> = {
            email: data.email,
            displayName: data.displayName,
            isActive: data.isActive,
            role: 'partner',
        };
        if (modalMode === 'create') {
            payload.username = data.username;
            payload.password = data.password;
        } else if (data.password) {
            payload.password = data.password;
        }
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '保存に失敗しました');
        }
        fetchPartners();
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-64"><Loading text="読み込み中..." /></div>;
    }

    if (selectedPartner) {
        return <PartnerMemberListView partner={selectedPartner} onBack={() => { setSelectedPartner(null); fetchPartners(); }} />;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">協力会社管理</h3>
                    <p className="text-sm text-slate-500">協力会社とその所属メンバーを管理します</p>
                </div>
                <button onClick={handleCreate} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 font-medium shadow-md hover:shadow-lg">
                    <Plus className="w-4 h-4 md:w-5 md:h-5" />
                    <span className="hidden sm:inline">協力会社追加</span>
                    <span className="sm:hidden">追加</span>
                </button>
            </div>

            {/* PC Table */}
            <div className="hidden md:block bg-white rounded-xl shadow-lg overflow-hidden border border-slate-200">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">会社</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">メール</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">ステータス</th>
                                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {partners.map((partner) => (
                                <tr key={partner.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-slate-900">{partner.displayName}</div>
                                        <div className="text-sm text-slate-500">@{partner.username}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{partner.email}</td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                                            {partner.isActive ? 'アクティブ' : '無効'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => setSelectedPartner(partner)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="メンバーを見る">
                                                <Users className="w-4 h-4" />
                                                メンバー
                                                <ChevronRight className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleEdit(partner)} className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg" title="編集" aria-label="編集">
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDelete(partner.id)} className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg" title="削除" aria-label="削除">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {partners.length === 0 && (
                    <div className="text-center py-12">
                        <Building2 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-500">協力会社が登録されていません</p>
                    </div>
                )}
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
                {partners.map((partner) => (
                    <div key={partner.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
                        <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-900">{partner.displayName}</div>
                                <div className="text-sm text-slate-500">@{partner.username}</div>
                                <div className="text-sm text-slate-500 truncate">{partner.email}</div>
                            </div>
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 ml-2 flex-shrink-0">
                                {partner.isActive ? 'アクティブ' : '無効'}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                            <button onClick={() => setSelectedPartner(partner)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg">
                                <Users className="w-4 h-4" />
                                メンバー
                            </button>
                            <button onClick={() => handleEdit(partner)} className="flex items-center justify-center gap-1.5 py-2 px-3 text-sm text-slate-600 hover:bg-slate-50 rounded-lg" aria-label="編集">
                                <Edit className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(partner.id)} className="flex items-center justify-center gap-1.5 py-2 px-3 text-sm text-slate-600 hover:bg-slate-50 rounded-lg" aria-label="削除">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
                {partners.length === 0 && (
                    <div className="text-center py-12">
                        <Building2 className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-500">協力会社が登録されていません</p>
                    </div>
                )}
            </div>

            <PartnerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                partner={editingPartner}
                mode={modalMode}
            />
        </div>
    );
}
