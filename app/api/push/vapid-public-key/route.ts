import { NextResponse } from 'next/server';

export async function GET() {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) {
        return NextResponse.json(
            { error: 'プッシュ通知は未設定です' },
            { status: 503 }
        );
    }
    return NextResponse.json(
        { publicKey: key },
        { headers: { 'Cache-Control': 'public, max-age=3600' } }
    );
}
