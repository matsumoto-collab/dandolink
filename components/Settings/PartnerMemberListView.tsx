'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Plus, Edit, Trash2, KeyRound, Copy, Users } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { User } from '@/types/user';
import PartnerMemberModal from './PartnerMemberModal';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

interface PartnerMemberListViewProps {
    partner: User;
    onBack: () => void;
}

const generateRandomPassword = () => {
    const length = 12;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    password += '0123456789'.charAt(Math.floor(Math.random() * 10));
    password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.charAt(Math.floor(Math.random() * 26));
    password += 'abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(Math.random() * 26));
    for (let i = 3; i < length; ++i) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password.split('').sort(() => 0.5 - Math.random()).join('');
};

export default function PartnerMemberListView({ partner, onBack }: PartnerMemberListViewProps) {
    const [members, setMembers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [editingMember, setEditingMember] = useState<User | null>(null);
    const [resetPasswordMember, setResetPasswordMember] = useState<User | null>(null);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [showResetResult, setShowResetResult] = useState(false);

    const fetchMembers = useCallback(async () => {
        try {
            const response = await fetch(`/api/users?role=partner_member&companyId=${partner.id}`);
            if (response.ok) {
                const data = await response.json();
                setMembers(data);
            }
        } catch (error) {
            logger.error('Failed to fetch partner members:', error);
        } finally {
            setIsLoading(false);
        }
    }, [partner.id]);

    useEffect(() => {
        fetchMembers();
    }, [fetchMembers]);

    const handleCreate = () => {
        setModalMode('create');
        setEditingMember(null);
        setIsModalOpen(true);
    };

    const handleEdit = (member: User) => {
        setModalMode('edit');
        setEditingMember(member);
        setIsModalOpen(true);
    };

    const handleDelete = async (memberId: string) => {
        if (!confirm('このメンバーを削除してもよろしいですか？')) return;
        try {
            const response = await fetch(`/api/users/${memberId}`, { method: 'DELETE' });
            if (response.ok) {
                fetchMembers();
                toast.success('メンバーを削除しました');
            } else {
                const data = await response.json();
                toast.error(data.error || 'メンバーの削除に失敗しました');
            }
        } catch (error) {
            logger.error('Failed to delete member:', error);
            toast.error('メンバーの削除に失敗しました');
        }
    };

    const handleSave = async (data: Partial<User> & { password?: string; companyId: string }) => {
        const url = modalMode === 'create' ? '/api/users' : `/api/users/${editingMember?.id}`;
        const method = modalMode === 'create' ? 'POST' : 'PATCH';
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '保存に失敗しました');
        }
        fetchMembers();
    };

    const handleToggleLogin = async (member: User) => {
        const next = !(member.isLoginEnabled ?? true);
        // 楽観的UI更新
        setMembers(prev => prev.map(m => m.id === member.id ? { ...m, isLoginEnabled: next } : m));
        try {
            const response = await fetch(`/api/users/${member.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isLoginEnabled: next }),
            });
            if (!response.ok) throw new Error('ログイン許可の切替に失敗しました');
            toast.success(next ? 'ログインを許可しました' : 'ログインを禁止しました');
        } catch (error) {
            // ロールバック
            setMembers(prev => prev.map(m => m.id === member.id ? { ...m, isLoginEnabled: !next } : m));
            logger.error('Failed to toggle login:', error);
            toast.error('ログイン許可の切替に失敗しました');
        }
    };

    const handleResetPassword = (member: User) => {
        const password = generateRandomPassword();
        setGeneratedPassword(password);
        setResetPasswordMember(member);
        setShowResetResult(false);
    };

    const confirmResetPassword = async () => {
        if (!resetPasswordMember || !generatedPassword) return;
        try {
            setIsResetting(true);
            const response = await fetch(`/api/users/${resetPasswordMember.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: generatedPassword }),
            });
            if (response.ok) {
                setShowResetResult(true);
                toast.success('パスワードをリセットしました');
            } else {
                const data = await response.json();
                toast.error(data.error || 'パスワードリセットに失敗しました');
            }
        } catch (error) {
            logger.error('Failed to reset password:', error);
            toast.error('パスワードリセットに失敗しました');
        } finally {
            setIsResetting(false);
        }
    };

    const copyPassword = () => {
        navigator.clipboard.writeText(generatedPassword);
        toast.success('パスワードをコピーしました');
    };

    const closeResetDialog = () => {
        setResetPasswordMember(null);
        setGeneratedPassword('');
        setShowResetResult(false);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loading text="読み込み中..." />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        onClick={onBack}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
                        title="戻る"
                        aria-label="戻る"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-slate-900 truncate">{partner.displayName} のメンバー</h3>
                        <p className="text-sm text-slate-500">{members.length}名</p>
                    </div>
                </div>
                <button
                    onClick={handleCreate}
                    className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg flex-shrink-0"
                >
                    <Plus className="w-4 h-4 md:w-5 md:h-5" />
                    <span className="hidden sm:inline">メンバー追加</span>
                    <span className="sm:hidden">追加</span>
                </button>
            </div>

            {/* PC Table */}
            <div className="hidden md:block bg-white rounded-xl shadow-lg overflow-hidden border border-slate-200">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">メンバー</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">メール</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">ログイン許可</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">ステータス</th>
                                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {members.map((member) => (
                                <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-slate-900">{member.displayName}</div>
                                        <div className="text-sm text-slate-500">@{member.username}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{member.email}</td>
                                    <td className="px-6 py-4">
                                        <button
                                            type="button"
                                            onClick={() => handleToggleLogin(member)}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${(member.isLoginEnabled ?? true) ? 'bg-slate-700' : 'bg-slate-300'}`}
                                            aria-label="ログイン許可切替"
                                        >
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(member.isLoginEnabled ?? true) ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700`}>
                                            {member.isActive ? 'アクティブ' : '無効'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => handleResetPassword(member)} className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" title="パスワードリセット" aria-label="パスワードリセット">
                                                <KeyRound className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleEdit(member)} className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" title="編集" aria-label="編集">
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDelete(member.id)} className="p-2 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" title="削除" aria-label="削除">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {members.length === 0 && (
                    <div className="text-center py-12">
                        <Users className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-500">メンバーが登録されていません</p>
                    </div>
                )}
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
                {members.map((member) => (
                    <div key={member.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-3">
                        <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-900">{member.displayName}</div>
                                <div className="text-sm text-slate-500">@{member.username}</div>
                                <div className="text-sm text-slate-500 truncate">{member.email}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleToggleLogin(member)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ml-2 ${(member.isLoginEnabled ?? true) ? 'bg-slate-700' : 'bg-slate-300'}`}
                                aria-label="ログイン許可切替"
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(member.isLoginEnabled ?? true) ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100">
                            <button onClick={() => handleResetPassword(member)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" aria-label="パスワードリセット">
                                <KeyRound className="w-4 h-4" />
                                PW
                            </button>
                            <button onClick={() => handleEdit(member)} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" aria-label="編集">
                                <Edit className="w-4 h-4" />
                                編集
                            </button>
                            <button onClick={() => handleDelete(member.id)} className="flex items-center justify-center gap-1.5 py-2 px-3 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" aria-label="削除">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
                {members.length === 0 && (
                    <div className="text-center py-12">
                        <Users className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                        <p className="text-slate-500">メンバーが登録されていません</p>
                    </div>
                )}
            </div>

            <PartnerMemberModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSave}
                partner={partner}
                member={editingMember}
                mode={modalMode}
            />

            {resetPasswordMember && (
                <div className="fixed inset-0 lg:left-48 z-[70] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black bg-opacity-50" onClick={isResetting ? undefined : closeResetDialog} />
                    <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 z-10">
                        <h3 className="text-xl font-bold text-slate-900 mb-4">パスワードリセット</h3>
                        {!showResetResult ? (
                            <>
                                <p className="text-slate-600 mb-6">
                                    <span className="font-semibold">{resetPasswordMember.displayName}</span> さんのパスワードをリセットしますか？<br />
                                    新しいランダムなパスワードが生成されます。
                                </p>
                                <div className="flex justify-end gap-3">
                                    <button onClick={closeResetDialog} disabled={isResetting} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                                        キャンセル
                                    </button>
                                    <button onClick={confirmResetPassword} disabled={isResetting} className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2">
                                        {isResetting && <Loading size="sm" />}
                                        リセット
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-slate-600 mb-4">
                                    パスワードをリセットしました。<br />
                                    以下の仮パスワードをユーザーにお伝えください。
                                </p>
                                <div className="bg-slate-100 p-4 rounded-lg mb-6 flex items-center justify-between border border-slate-300">
                                    <code className="text-lg font-mono font-bold text-slate-800 tracking-wider">{generatedPassword}</code>
                                    <button onClick={copyPassword} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded transition-colors" title="コピー" aria-label="コピー">
                                        <Copy className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="flex justify-end">
                                    <button onClick={closeResetDialog} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800">
                                        閉じる
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
