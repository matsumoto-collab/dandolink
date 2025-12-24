import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * Initialize database with default admin user
 * POST /api/init-db
 */
export async function POST(req: NextRequest) {
    try {
        // Check if any users exist
        const userCount = await prisma.user.count();

        if (userCount > 0) {
            return NextResponse.json(
                { error: 'データベースは既に初期化されています' },
                { status: 400 }
            );
        }

        // Create default admin user
        const hashedPassword = await bcrypt.hash('ChangeMe123!', 10);

        const adminUser = await prisma.user.create({
            data: {
                username: 'admin',
                email: 'admin@yusystem.local',
                displayName: '管理者',
                passwordHash: hashedPassword,
                role: 'ADMIN',
                isActive: true,
            },
        });

        return NextResponse.json({
            message: '初期管理者アカウントを作成しました',
            user: {
                username: adminUser.username,
                email: adminUser.email,
                displayName: adminUser.displayName,
                role: adminUser.role,
            },
            credentials: {
                username: 'admin',
                password: 'ChangeMe123!',
                note: 'ログイン後、必ずパスワードを変更してください',
            },
        });
    } catch (error) {
        console.error('Database initialization error:', error);
        return NextResponse.json(
            {
                error: 'データベースの初期化に失敗しました',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500 }
        );
    }
}
