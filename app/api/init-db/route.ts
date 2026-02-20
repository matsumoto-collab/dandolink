import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validationErrorResponse, serverErrorResponse, applyRateLimit } from '@/lib/api/utils';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
    // 本番環境では無効化
    if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'このエンドポイントは本番環境では利用できません' }, { status: 403 });
    }

    const rateLimitError = applyRateLimit(req, { limit: 3, windowMs: 60000 });
    if (rateLimitError) return rateLimitError;

    try {
        const userCount = await prisma.user.count();
        if (userCount > 0) return validationErrorResponse('データベースは既に初期化されています');

        // ランダムなパスワードを生成
        const generatedPassword = crypto.randomBytes(16).toString('hex');
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);
        const adminUser = await prisma.user.create({
            data: { username: 'admin', email: 'admin@dandolink.local', displayName: '管理者', passwordHash: hashedPassword, role: 'ADMIN', isActive: true },
        });

        // パスワードはサーバーログにのみ出力（レスポンスには含めない）
        console.log(`[init-db] 初期管理者パスワード: ${generatedPassword} ※必ず控えてください`);

        return NextResponse.json({
            message: '初期管理者アカウントを作成しました。パスワードはサーバーログを確認してください。',
            user: { username: adminUser.username, email: adminUser.email, displayName: adminUser.displayName, role: adminUser.role },
        });
    } catch (error) {
        return serverErrorResponse('データベース初期化', error);
    }
}
