'use client';

import { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2, Shield, KeyRound, Copy } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { User } from '@/types/user';
import UserModal from './UserModal';
import toast from 'react-hot-toast';


// ランダムパスワード生成（英字[大文字・小文字]と数字を含む12文字）
const generateRandomPassword = () => {
    const length = 12;
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    // 必ず数字、大文字、小文字を1つずつ含める
    password += "0123456789".charAt(Math.floor(Math.random() * 10));
    password += "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(Math.floor(Math.random() * 26));
    password += "abcdefghijklmnopqrstuvwxyz".charAt(Math.floor(Math.random() * 26));

    // 残りの文字をランダムに生成
    for (let i = 3; i < length; ++i) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    // シャッフル
    return password.split('').sort(() => 0.5 - Math.random()).join('');
};

export default function UserManagement() {
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    // パスワードリセット用state
    const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
    const [generatedPassword, setGeneratedPassword] = useState('');
    const [isResetting, setIsResetting] = useState(false);
    const [showResetResult, setShowResetResult] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const response = await fetch('/api/users');
            if (response.ok) {
                const data = await response.json();
                setUsers(data);
            }
        } catch (error) {
            console.error('Failed to fetch users:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateUser = () => {
        setModalMode('create');
        setSelectedUser(null);
        setIsModalOpen(true);
    };

    const handleEditUser = (user: User) => {
        setModalMode('edit');
        setSelectedUser(user);
        setIsModalOpen(true);
    };

    const handleDeleteUser = async (userId: string) => {
        if (!confirm('このユーザーを削除してもよろしいですか？')) {
            return;
        }

        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                fetchUsers();
            } else {
                const data = await response.json();
                toast.error(data.error || 'ユーザーの削除に失敗しました');
            }
        } catch (error) {
            console.error('Failed to delete user:', error);
            toast.error('ユーザーの削除に失敗しました');
        }
    };

    const handleSaveUser = async (userData: Partial<User> & { password?: string }) => {
        try {
            const url = modalMode === 'create' ? '/api/users' : `/api/users/${selectedUser?.id}`;
            const method = modalMode === 'create' ? 'POST' : 'PATCH';

            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || '保存に失敗しました');
            }

            fetchUsers();
        } catch (error) {
            throw error;
        }
    };

    // パスワードリセット確認ダイアログを開く
    const handleResetPassword = (user: User) => {
        const password = generateRandomPassword();
        setGeneratedPassword(password);
        setResetPasswordUser(user);
        setShowResetResult(false);
    };

    // パスワードリセット実行
    const confirmResetPassword = async () => {
        if (!resetPasswordUser || !generatedPassword) return;

        try {
            setIsResetting(true);
            const response = await fetch(`/api/users/${resetPasswordUser.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
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
            console.error('Failed to reset password:', error);
            toast.error('パスワードリセットに失敗しました');
        } finally {
            setIsResetting(false);
        }
    };

    // パスワードをクリップボードにコピー
    const copyPassword = () => {
        navigator.clipboard.writeText(generatedPassword);
        toast.success('パスワードをコピーしました');
    };

    // リセットダイアログを閉じる
    const closeResetDialog = () => {
        setResetPasswordUser(null);
        setGeneratedPassword('');
        setShowResetResult(false);
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'admin':
                return 'bg-purple-100 text-purple-800';
            case 'manager':
                return 'bg-blue-100 text-blue-800';
            case 'foreman1':
                return 'bg-green-100 text-green-800';
            case 'foreman2':
                return 'bg-teal-100 text-teal-800';
            case 'worker':
                return 'bg-gray-100 text-gray-800';
            case 'partner':
                return 'bg-orange-100 text-orange-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'admin':
                return '管理者';
            case 'manager':
                return 'マネージャー';
            case 'foreman1':
                return '職長1';
            case 'foreman2':
                return '職長2';
            case 'worker':
                return '職方';
            case 'partner':
                return '協力会社';
            default:
                return role;
        }
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
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg">
                        <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">ユーザー管理</h2>
                        <p className="text-sm text-gray-600">システムユーザーの管理</p>
                    </div>
                </div>
                <button
                    onClick={handleCreateUser}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl"
                >
                    <Plus className="w-5 h-5" />
                    ユーザー追加
                </button>
            </div>

            {/* Users Table */}
            <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                    ユーザー
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                    メール
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                    ロール
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                    ステータス
                                </th>
                                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {users.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div>
                                            <div className="font-medium text-gray-900">{user.displayName}</div>
                                            <div className="text-sm text-gray-500">@{user.username}</div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                                    <td className="px-6 py-4">
                                        <span
                                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(
                                                user.role
                                            )}`}
                                        >
                                            <Shield className="w-3 h-3" />
                                            {getRoleLabel(user.role)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span
                                            className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${user.isActive
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-red-100 text-red-800'
                                                }`}
                                        >
                                            {user.isActive ? 'アクティブ' : '無効'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleResetPassword(user)}
                                                className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                                title="パスワードリセット"
                                                aria-label="パスワードリセット"
                                            >
                                                <KeyRound className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleEditUser(user)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="編集"
                                                aria-label="編集"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteUser(user.id)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="削除"
                                                aria-label="削除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {users.length === 0 && (
                    <div className="text-center py-12">
                        <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500">ユーザーが登録されていません</p>
                    </div>
                )}
            </div>

            {/* User Modal */}
            <UserModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveUser}
                user={selectedUser}
                mode={modalMode}
            />
            {/* パスワードリセット確認/結果ダイアログ */}
            {resetPasswordUser && (
                <div className="fixed inset-0 lg:left-64 z-[70] flex items-center justify-center">
                    <div className="absolute inset-0 bg-black bg-opacity-50" onClick={isResetting ? undefined : closeResetDialog} />
                    <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 z-10">
                        <h3 className="text-xl font-bold text-gray-900 mb-4">
                            パスワードリセット
                        </h3>

                        {!showResetResult ? (
                            <>
                                <p className="text-gray-600 mb-6">
                                    <span className="font-semibold">{resetPasswordUser.displayName}</span> さんのパスワードをリセットしますか？<br />
                                    新しいランダムなパスワードが生成されます。
                                </p>
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={closeResetDialog}
                                        disabled={isResetting}
                                        className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        onClick={confirmResetPassword}
                                        disabled={isResetting}
                                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {isResetting && <Loading size="sm" />}
                                        リセット
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-gray-600 mb-4">
                                    パスワードをリセットしました。<br />
                                    以下の仮パスワードをユーザーにお伝えください。
                                </p>
                                <div className="bg-gray-100 p-4 rounded-lg mb-6 flex items-center justify-between border border-gray-300">
                                    <code className="text-lg font-mono font-bold text-gray-800 tracking-wider">
                                        {generatedPassword}
                                    </code>
                                    <button
                                        onClick={copyPassword}
                                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                                        title="コピー"
                                        aria-label="コピー"
                                    >
                                        <Copy className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        onClick={closeResetDialog}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                    >
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
