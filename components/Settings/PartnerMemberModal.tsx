'use client';

import { useState, useEffect, FormEvent } from 'react';
import { X } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import { User } from '@/types/user';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface PartnerMemberModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: Partial<User> & { password?: string; companyId: string }) => Promise<void>;
    partner: User;
    member?: User | null;
    mode: 'create' | 'edit';
}

export default function PartnerMemberModal({ isOpen, onClose, onSave, partner, member, mode }: PartnerMemberModalProps) {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        displayName: '',
        password: '',
        isActive: true,
        isLoginEnabled: true,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    useEffect(() => {
        if (member && mode === 'edit') {
            setFormData({
                username: member.username,
                email: member.email,
                displayName: member.displayName,
                password: '',
                isActive: member.isActive,
                isLoginEnabled: member.isLoginEnabled ?? true,
            });
        } else {
            setFormData({
                username: '',
                email: '',
                displayName: '',
                password: '',
                isActive: true,
                isLoginEnabled: true,
            });
        }
        setError('');
    }, [member, mode, isOpen]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const dataToSave: Partial<User> & { password?: string; username?: string; companyId: string } = {
                email: formData.email,
                displayName: formData.displayName,
                role: 'partner_member',
                isActive: formData.isActive,
                isLoginEnabled: formData.isLoginEnabled,
                companyId: partner.id,
            };

            if (mode === 'create') {
                dataToSave.username = formData.username;
                if (formData.isLoginEnabled) {
                    dataToSave.password = formData.password;
                } else {
                    // ログイン不可の場合は zod の passwordSchema 通過用ダミー（API 側で passwordHash='!nologin' に置換される）
                    dataToSave.password = 'NoLogin12345!';
                }
            } else if (formData.password) {
                dataToSave.password = formData.password;
            }

            await onSave(dataToSave);
            onClose();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'エラーが発生しました';
            setError(message);
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
                        {mode === 'create' ? 'メンバー追加' : 'メンバー編集'}
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
                        {/* 所属会社 (read-only) */}
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">所属会社</label>
                            <div className="px-4 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700">
                                {partner.displayName}
                            </div>
                        </div>

                        <div>
                            <label htmlFor="displayName" className="block text-sm font-medium text-slate-700 mb-2">
                                表示名 <span className="text-slate-500">*</span>
                            </label>
                            <input
                                id="displayName"
                                type="text"
                                value={formData.displayName}
                                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                required
                            />
                        </div>

                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-2">
                                ユーザー名 <span className="text-slate-500">*</span>
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent disabled:bg-slate-100"
                                required
                                disabled={mode === 'edit'}
                            />
                            {mode === 'edit' && (
                                <p className="mt-1 text-xs text-slate-500">ユーザー名は変更できません</p>
                            )}
                        </div>

                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                                メールアドレス <span className="text-slate-500">*</span>
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                required
                            />
                        </div>

                        {formData.isLoginEnabled && (() => {
                            const isReEnable = mode === 'edit' && member?.isLoginEnabled === false;
                            const passwordRequired = (mode === 'create') || isReEnable;
                            return (
                                <div>
                                    <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                                        パスワード {passwordRequired && <span className="text-slate-500">*</span>}
                                    </label>
                                    <input
                                        id="password"
                                        type="password"
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                        required={passwordRequired}
                                        placeholder={mode === 'edit' && !isReEnable ? '変更する場合のみ入力' : ''}
                                    />
                                    {isReEnable && (
                                        <p className="mt-1 text-xs text-amber-600">再有効化のため新しいパスワードを設定してください</p>
                                    )}
                                </div>
                            );
                        })()}

                        <div className="flex items-center">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isLoginEnabled}
                                    onChange={(e) => setFormData({ ...formData, isLoginEnabled: e.target.checked })}
                                    className="w-5 h-5 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                />
                                <span className="ml-2 text-sm font-medium text-slate-700">ログイン許可</span>
                            </label>
                        </div>

                        <div className="flex items-center">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="w-5 h-5 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                />
                                <span className="ml-2 text-sm font-medium text-slate-700">アクティブ</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-6 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
                            disabled={isLoading}
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <span className="flex items-center gap-2">
                                    <ButtonLoading />
                                    保存中...
                                </span>
                            ) : mode === 'create' ? '追加' : '更新'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
