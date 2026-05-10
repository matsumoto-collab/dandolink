import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { UserRole } from '@/types/user';
import { logger } from '@/lib/logger';

// NEXTAUTH_SECRET検証 - 本番環境では必須
if (!process.env.NEXTAUTH_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'NEXTAUTH_SECRET環境変数が設定されていません。本番環境では必須です。'
        );
    } else {
        logger.warn('NEXTAUTH_SECRET環境変数が設定されていません。開発環境のみ許容されます。');
    }
}

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: 'Credentials',
            credentials: {
                username: { label: 'ユーザー名', type: 'text' },
                password: { label: 'パスワード', type: 'password' },
            },
            async authorize(credentials) {
                if (!credentials?.username || !credentials?.password) {
                    throw new Error('ユーザー名とパスワードを入力してください');
                }

                try {
                    // Find user by username
                    const user = await prisma.user.findUnique({
                        where: { username: credentials.username },
                    });

                    if (!user) {
                        throw new Error('ユーザー名またはパスワードが正しくありません');
                    }

                    // Brute-force ロック判定: lockedUntil が未来ならエラー
                    // Why: matsumoto のような推測可能なユーザー名への総当たり対策
                    if (user.lockedUntil && user.lockedUntil > new Date()) {
                        const remainMs = user.lockedUntil.getTime() - Date.now();
                        const remainMin = Math.ceil(remainMs / 60000);
                        throw new Error(
                            `ログイン試行回数が上限を超えました。約${remainMin}分後に再度お試しください。`
                        );
                    }

                    if (!user.isActive) {
                        throw new Error('このアカウントは無効化されています');
                    }

                    if (!user.isLoginEnabled) {
                        throw new Error('このアカウントはログインが許可されていません');
                    }

                    // Verify password
                    const isPasswordValid = await bcrypt.compare(
                        credentials.password,
                        user.passwordHash
                    );

                    if (!isPasswordValid) {
                        // 失敗カウント加算、5回で5分、10回で30分ロック
                        const nextCount = user.failedLoginCount + 1;
                        let lockedUntil: Date | null = null;
                        if (nextCount >= 10) {
                            lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
                        } else if (nextCount >= 5) {
                            lockedUntil = new Date(Date.now() + 5 * 60 * 1000);
                        }
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { failedLoginCount: nextCount, lockedUntil },
                        });
                        throw new Error('ユーザー名またはパスワードが正しくありません');
                    }

                    // 成功時はカウントとロックをリセット
                    if (user.failedLoginCount > 0 || user.lockedUntil) {
                        await prisma.user.update({
                            where: { id: user.id },
                            data: { failedLoginCount: 0, lockedUntil: null },
                        });
                    }

                    // Parse assigned projects
                    let assignedProjects: string[] | undefined;
                    if (user.assignedProjects) {
                        try {
                            assignedProjects = JSON.parse(user.assignedProjects);
                        } catch {
                            assignedProjects = undefined;
                        }
                    }

                    return {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        displayName: user.displayName,
                        role: user.role.toLowerCase() as UserRole,
                        assignedProjects,
                        isActive: user.isActive,
                        companyId: user.companyId ?? null,
                    };
                } catch (error) {
                    if (error instanceof Error) {
                        throw error;
                    }
                    throw new Error('認証に失敗しました');
                }
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                // 初回ログイン時
                token.id = user.id;
                token.username = user.username;
                token.role = user.role;
                token.assignedProjects = user.assignedProjects;
                token.isActive = user.isActive;
                token.companyId = user.companyId ?? null;
                token.name = user.displayName; // session.user.name に displayName を流す
                token.lastDbCheck = Date.now();
            } else if (token?.id) {
                // 以降のリクエスト時のDB再検証 (5分 = 300,000ms ごと)
                const lastCheck = (token.lastDbCheck as number) || 0;
                const now = Date.now();
                const needsDisplayName = !token.name; // 旧トークンに displayName が無い場合は即時更新

                if (needsDisplayName || now - lastCheck > 300000) {
                    try {
                        const dbUser = await prisma.user.findUnique({
                            where: { id: token.id as string },
                            select: { isActive: true, isLoginEnabled: true, role: true, displayName: true, companyId: true }
                        });

                        if (!dbUser || !dbUser.isActive || !dbUser.isLoginEnabled) {
                            // ユーザー削除済み、または無効化された場合
                            token.isActive = false;
                        } else {
                            // 状態が有効であれば更新
                            token.isActive = dbUser.isActive;
                            token.role = dbUser.role.toLowerCase() as UserRole;
                            token.name = dbUser.displayName;
                            token.companyId = dbUser.companyId ?? null;
                            token.lastDbCheck = now;
                        }
                    } catch (error) {
                        logger.error('JWT DB検証エラー:', (error instanceof Error) ? error.message : 'Unknown error');
                        // DB接続エラー時等は既存のトークン状態を維持
                    }
                }
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id;
                session.user.username = token.username;
                session.user.role = token.role;
                session.user.assignedProjects = token.assignedProjects;
                session.user.isActive = token.isActive;
                session.user.companyId = token.companyId ?? null;
                session.user.name = token.name ?? session.user.name ?? null;
            }
            return session;
        },
    },
    pages: {
        signIn: '/login',
        error: '/login',
    },
    session: {
        strategy: 'jwt',
        maxAge: 24 * 60 * 60, // 24 hours
    },
    secret: process.env.NEXTAUTH_SECRET,
};
