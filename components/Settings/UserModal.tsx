'use client';

import { useState, useEffect, FormEvent } from 'react';
import { X } from 'lucide-react';
import { ButtonLoading } from '@/components/ui/Loading';
import { User, UserRole } from '@/types/user';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (user: Partial<User> & { password?: string }) => Promise<void>;
    user?: User | null;
    mode: 'create' | 'edit';
}

export default function UserModal({ isOpen, onClose, onSave, user, mode }: UserModalProps) {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        displayName: '',
        password: '',
        role: 'worker' as UserRole,
        isActive: true,
        assignedProjects: [] as string[],
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

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
            });
        }
        setError('');
    }, [user, mode, isOpen]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const dataToSave: Partial<User> & { password?: string; username?: string } = {
                email: formData.email,
                displayName: formData.displayName,
                role: formData.role,
                isActive: formData.isActive,
                assignedProjects: formData.assignedProjects,
            };

            if (mode === 'create') {
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
        <div className="fixed inset-0 lg:left-64 bg-black/50 flex items-center justify-center z-[60] p-4">
            <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-800">
                        {mode === 'create' ? 'ユーザー追加' : 'ユーザー編集'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-600">{error}</p>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Username */}
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                                ユーザー名 <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={formData.username}
                                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                                required
                                disabled={mode === 'edit'}
                            />
                            {mode === 'edit' && (
                                <p className="mt-1 text-xs text-gray-500">ユーザー名は変更できません</p>
                            )}
                        </div>

                        {/* Email */}
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                                メールアドレス <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                required
                            />
                        </div>

                        {/* Display Name */}
                        <div>
                            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                                表示名 <span className="text-red-500">*</span>
                            </label>
                            <input
                                id="displayName"
                                type="text"
                                value={formData.displayName}
                                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                required
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                                パスワード {mode === 'create' && <span className="text-red-500">*</span>}
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                required={mode === 'create'}
                                placeholder={mode === 'edit' ? '変更する場合のみ入力' : ''}
                            />
                        </div>

                        {/* Role */}
                        <div>
                            <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-2">
                                ロール <span className="text-red-500">*</span>
                            </label>
                            <select
                                id="role"
                                value={formData.role}
                                onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                required
                            >
                                <option value="admin">管理者</option>
                                <option value="manager">マネージャー</option>
                                <option value="foreman1">職長1（全般操作可）</option>
                                <option value="foreman2">職長2（自班のみ操作可）</option>
                                <option value="worker">職方（自班のみ表示）</option>
                                <option value="partner">協力会社（閲覧のみ）</option>
                            </select>
                        </div>

                        {/* Active Status */}
                        <div className="flex items-center">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    id="isActive"
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span className="ml-2 text-sm font-medium text-gray-700">アクティブ</span>
                            </label>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
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
