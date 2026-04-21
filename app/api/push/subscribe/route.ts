import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

export async function POST(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const endpoint: string | undefined = body?.subscription?.endpoint;
        const p256dh: string | undefined = body?.subscription?.keys?.p256dh;
        const auth: string | undefined = body?.subscription?.keys?.auth;
        const userAgent: string | null = request.headers.get('user-agent');

        if (!endpoint || !p256dh || !auth) {
            return validationErrorResponse('購読情報が不正です（endpoint/keys が不足）');
        }

        const saved = await prisma.pushSubscription.upsert({
            where: { endpoint },
            update: {
                userId: session!.user.id,
                p256dh,
                auth,
                userAgent: userAgent || undefined,
            },
            create: {
                userId: session!.user.id,
                endpoint,
                p256dh,
                auth,
                userAgent: userAgent || undefined,
            },
        });

        return NextResponse.json({ id: saved.id, ok: true });
    } catch (error) {
        return serverErrorResponse('プッシュ購読の登録', error);
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await request.json().catch(() => ({}));
        const endpoint: string | undefined = body?.endpoint;

        if (!endpoint) {
            return validationErrorResponse('endpointが必要です');
        }

        await prisma.pushSubscription.deleteMany({
            where: { endpoint, userId: session!.user.id },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        return serverErrorResponse('プッシュ購読の解除', error);
    }
}
