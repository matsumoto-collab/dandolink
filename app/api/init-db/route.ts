import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function POST() {
    try {
        const userCount = await prisma.user.count();
        if (userCount > 0) return validationErrorResponse('データベースは既に初期化されています');

        const hashedPassword = await bcrypt.hash('ChangeMe123!', 10);
        const adminUser = await prisma.user.create({
            data: { username: 'admin', email: 'admin@yusystem.local', displayName: '管理者', passwordHash: hashedPassword, role: 'ADMIN', isActive: true },
        });

        return NextResponse.json({
            message: '初期管理者アカウントを作成しました',
            user: { username: adminUser.username, email: adminUser.email, displayName: adminUser.displayName, role: adminUser.role },
            credentials: { username: 'admin', password: 'ChangeMe123!', note: 'ログイン後、必ずパスワードを変更してください' },
        });
    } catch (error) {
        return serverErrorResponse('データベース初期化', error);
    }
}
