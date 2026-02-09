import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { UserRole } from '@/types/user';

// NEXTAUTH_SECRET検証 - 本番環境では必須
if (!process.env.NEXTAUTH_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'NEXTAUTH_SECRET環境変数が設定されていません。本番環境では必須です。'
        );
    } else {
        console.warn(
            '⚠️ NEXTAUTH_SECRET環境変数が設定されていません。開発環境のみ許容されます。'
        );
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

                    if (!user.isActive) {
                        throw new Error('このアカウントは無効化されています');
                    }

                    // Verify password
                    const isPasswordValid = await bcrypt.compare(
                        credentials.password,
                        user.passwordHash
                    );

                    if (!isPasswordValid) {
                        throw new Error('ユーザー名またはパスワードが正しくありません');
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
                token.id = user.id;
                token.username = user.username;
                token.role = user.role;
                token.assignedProjects = user.assignedProjects;
                token.isActive = user.isActive;
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
        maxAge: 7 * 24 * 60 * 60, // 7 days
    },
    secret: process.env.NEXTAUTH_SECRET,
};
