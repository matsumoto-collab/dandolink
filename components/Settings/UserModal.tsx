'use client';

import { useState, useEffect, FormEvent } from 'react';
import { X } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import { User, UserRole, PartnerTaxMode } from '@/types/user';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (user: Partial<User> & { password?: string; dailyRate?: number | null }) => Promise<void>;
    user?: User | null;
    mode: 'create' | 'edit';
    isAdminOrManager?: boolean;
}

export default function UserModal({ isOpen, onClose, onSave, user, mode, isAdminOrManager }: UserModalProps) {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        displayName: '',
        password: '',
        role: 'worker' as UserRole,
        isActive: true,
        assignedProjects: [] as string[],
        dailyRate: '' as string | number,
        partnerTaxMode: 'exclusive' as PartnerTaxMode,
        canAccessCashbook: false,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    useEffect(() => {
        if (user && mode === 'edit') {
            setFormData({
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                password: '',
                role: user.role,
                isActive: user.isActive,
                assignedProjects: user.assignedProjects || [],
                dailyRate: user.dailyRate != null ? user.dailyRate : '',
                partnerTaxMode: user.partnerTaxMode ?? 'exclusive',
                canAccessCashbook: user.canAccessCashbook ?? false,
            });
        } else {
            setFormData({
                username: '',
                email: '',
                displayName: '',
                password: '',
                role: 'worker',
                isActive: true,
                assignedProjects: [],
                dailyRate: '',
                partnerTaxMode: 'exclusive',
                canAccessCashbook: false,
            });
        }
        setError('');
    }, [user, mode, isOpen]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const dataToSave: Partial<User> & { password?: string; username?: string; dailyRate?: number | null } = {
                email: formData.email,
                displayName: formData.displayName,
                role: formData.role,
                isActive: formData.isActive,
                assignedProjects: formData.assignedProjects,
                canAccessCashbook: formData.canAccessCashbook,
            };

            if (isAdminOrManager) {
                dataToSave.dailyRate = formData.dailyRate !== '' ? Number(formData.dailyRate) : undefined;
            }

            // 協力会社のときだけ請求税区分を送る
            if (formData.role === 'partner') {
                dataToSave.partnerTaxMode = formData.partnerTaxMode;
            }

            if (formData.role === 'support') {
                // 応援は名前・日給・ロールのみ
            } else if (mode === 'create') {
                dataToSave.username = formData.username;
                dataToSave.password = formData.password;
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
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200">
                    <h2 className="text-xl font-semibold text-slate-800">
                        {mode === 'create' ? 'ユーザー追加' : 'ユーザー編集'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mx-6 mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-sm text-slate-600">{error}</p>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Role - moved to top so support hides fields below */}
                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-slate-700 mb-2">
                                ロール <span className="text-slate-500">*</span>
                            </label>
                            <select
                                id="role"
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                required
                                disabled={mode === 'edit' && user?.role === 'support'}
                            >
                                <option value="admin">管理者</option>
                                <option value="manager">マネージャー</option>
                                <option value="foreman1">職長1（全般操作可）</option>
                                <option value="foreman2">職長2（自班のみ操作可）</option>
                                <option value="worker">職方（自班のみ表示）</option>
                                <option value="partner">協力会社（閲覧のみ）</option>
                                <option value="support">応援（ログイン不可）</option>
                            </select>
                        </div>

                        {/* Display Name */}
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

                        {/* Username - hidden for support */}
                        {formData.role !== 'support' && (
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
                        )}

                        {/* Email - hidden for support */}
                        {formData.role !== 'support' && (
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
                        )}

                        {/* Password - hidden for support */}
                        {formData.role !== 'support' && (
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
                                パスワード {mode === 'create' && <span className="text-slate-500">*</span>}
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                required={mode === 'create'}
                                placeholder={mode === 'edit' ? '変更する場合のみ入力' : ''}
                            />
                        </div>
                        )}

                        {formData.role === 'support' && (
                            <div className="md:col-span-2">
                                <p className="text-sm text-slate-500 bg-slate-50 p-3 rounded-lg">
                                    応援メンバーはログインできません。手配確定時のメンバー選択に表示されます。
                                </p>
                            </div>
                        )}

                        {/* Role is now at the top of the form */}

                        {/* Active Status */}
                        <div className="flex items-center">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    id="isActive"
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="w-5 h-5 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                />
                                <span className="ml-2 text-sm font-medium text-slate-700">アクティブ</span>
                            </label>
                        </div>

                        {/* 現金出納帳アクセス許可（ロールではなく個別ユーザー許可制） */}
                        {formData.role !== 'support' && (
                            <div className="md:col-span-2">
                                <label className="flex items-start cursor-pointer">
                                    <input
                                        id="canAccessCashbook"
                                        type="checkbox"
                                        checked={formData.canAccessCashbook}
                                        onChange={(e) => setFormData({ ...formData, canAccessCashbook: e.target.checked })}
                                        className="w-5 h-5 mt-0.5 text-slate-600 border-slate-300 rounded focus:ring-slate-500"
                                    />
                                    <span className="ml-2">
                                        <span className="block text-sm font-medium text-slate-700">現金出納帳へのアクセスを許可</span>
                                        <span className="block mt-0.5 text-xs text-slate-500">許可したユーザーにのみ「現金出納帳」メニューが表示されます（管理者でも許可が必要です）。</span>
                                    </span>
                                </label>
                            </div>
                        )}

                        {/* Daily Rate - admin/manager only */}
                        {isAdminOrManager && (
                            <div>
                                <label htmlFor="dailyRate" className="block text-sm font-medium text-slate-700 mb-2">
                                    日給（円/日）
                                </label>
                                <input
                                    id="dailyRate"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={formData.dailyRate}
                                    onChange={(e) => setFormData({ ...formData, dailyRate: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                    placeholder="例: 18000"
                                />
                            </div>
                        )}

                        {/* Partner tax mode - role=partner のときのみ */}
                        {formData.role === 'partner' && (
                            <div>
                                <label htmlFor="partnerTaxMode" className="block text-sm font-medium text-slate-700 mb-2">
                                    出来高税区分
                                </label>
                                <select
                                    id="partnerTaxMode"
                                    value={formData.partnerTaxMode}
                                    onChange={(e) => setFormData({ ...formData, partnerTaxMode: e.target.value as PartnerTaxMode })}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                                >
                                    <option value="exclusive">税別（消費税は別途加算）</option>
                                    <option value="inclusive">税込（消費税 10% を含めて表示）</option>
                                </select>
                                <p className="mt-1 text-xs text-slate-500">
                                    出来高表のフッターと PDF で「小計／消費税／合計」の表示が切り替わります。
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
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
                            className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
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
