import { NextResponse } from 'next/server';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { sendPushToUsers } from '@/lib/push';

/**
 * 通知の動作確認用エンドポイント（ログインユーザー自身にテスト通知を送る）
 */
export async function POST() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const result = await sendPushToUsers([session!.user.id], {
            title: 'DandoLink 通知テスト',
            body: 'プッシュ通知は正常に動作しています。',
            url: '/',
            tag: 'push-test',
        });

        return NextResponse.json(result);
    } catch (error) {
        return serverErrorResponse('テスト通知の送信', error);
    }
}
