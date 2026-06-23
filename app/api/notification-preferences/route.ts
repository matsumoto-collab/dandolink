import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse } from '@/lib/api/utils';

// scope を持つ通知種別（4種）
const SCOPED_TYPES = [
    'work-started',
    'work-ended',
    'project-master-created',
    'road_permit_expiry',
] as const;
// ON/OFF のみの通知種別（4種）
// UI 側 components/Settings/NotificationSettings.tsx の ONOFF_ONLY_TYPES と同期すること。
const ONOFF_ONLY_TYPES = ['dispatch-confirmed', 'schedule-changed', 'chat-message', 'vehicle-handover', 'work-report-reply'] as const;

const ALL_TYPES = [...SCOPED_TYPES, ...ONOFF_ONLY_TYPES] as const;
type NotificationType = (typeof ALL_TYPES)[number];

const updateSchema = z.object({
    preferences: z.array(
        z.object({
            type: z.enum(ALL_TYPES),
            enabled: z.boolean(),
            scope: z.enum(['all', 'mine']).default('all'),
        })
    ),
});

interface PreferenceRow {
    type: NotificationType;
    enabled: boolean;
    scope: 'all' | 'mine';
}

/**
 * 現在ログイン中ユーザーの通知種別ごとの設定を返す。
 * 未設定の type は default (enabled=true, scope='all') で埋める。
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const rows = await prisma.userNotificationPreference.findMany({
            where: { userId: session!.user.id },
            select: { type: true, enabled: true, scope: true },
        });
        const byType = new Map(rows.map((r) => [r.type, r]));

        const preferences: PreferenceRow[] = ALL_TYPES.map((type) => {
            const existing = byType.get(type);
            return {
                type,
                enabled: existing ? existing.enabled : true,
                scope: (existing?.scope === 'mine' ? 'mine' : 'all'),
            };
        });

        return NextResponse.json(
            { preferences },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        return serverErrorResponse('通知設定の取得', error);
    }
}

/**
 * 通知種別ごとの設定を upsert で一括更新。
 * ON/OFF のみの種別で scope='mine' が来ても 'all' に正規化して保存する。
 */
export async function PUT(request: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await request.json();
        const parsed = updateSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const userId = session!.user.id;
        const scopedSet = new Set<string>(SCOPED_TYPES);

        await prisma.$transaction(
            parsed.data.preferences.map((p) => {
                // scope を持たない種別では強制的に 'all' にする
                const normalizedScope = scopedSet.has(p.type) ? p.scope : 'all';
                return prisma.userNotificationPreference.upsert({
                    where: { userId_type: { userId, type: p.type } },
                    update: { enabled: p.enabled, scope: normalizedScope },
                    create: {
                        userId,
                        type: p.type,
                        enabled: p.enabled,
                        scope: normalizedScope,
                    },
                });
            })
        );

        return NextResponse.json({ ok: true });
    } catch (error) {
        return serverErrorResponse('通知設定の更新', error);
    }
}
