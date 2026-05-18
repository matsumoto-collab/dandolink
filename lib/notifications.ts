import { prisma } from '@/lib/prisma';
import { sendPushToUsers, type PushPayload } from '@/lib/push';
import { logger } from '@/lib/logger';
import { parseJsonField } from '@/lib/json-utils';

export interface NotifyInput {
    userIds: string[];
    type?: string;
    title: string;
    body: string;
    url?: string;
    data?: Record<string, unknown>;
    /**
     * プッシュ通知のtag（同一tagは端末上で上書き表示される）。
     * 省略時はtypeをフォールバック値として使う。
     */
    pushTag?: string;
    /** pushのrequireInteraction */
    requireInteraction?: boolean;
    /**
     * 通知に紐づく案件マスター ID。scope='mine' の受信者を
     * ProjectMaster.managerIds で絞り込むために使う。
     * 省略時は scope='mine' でも絞り込みを行わない（全員に届く）。
     */
    projectMasterId?: string;
}

export interface NotifyResult {
    notificationIds: string[];
    push: { sent: number; removed: number; failed: number };
}

/**
 * ユーザー群へ通知を送る統一ヘルパー。
 * - DB（Notification）に履歴を残す（ヘッダーの🔔で参照）
 * - Web Push を送る（端末OSの通知領域に表示）
 * どちらかが失敗してももう片方は可能な限り継続する。
 */
export async function notifyUsers(input: NotifyInput): Promise<NotifyResult> {
    const uniqueUserIds = Array.from(new Set(input.userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) {
        return { notificationIds: [], push: { sent: 0, removed: 0, failed: 0 } };
    }

    const type = input.type || 'general';
    const now = new Date();

    // 個人通知設定によるフィルタリング
    //   - 設定が無いユーザー: enabled=true, scope='all' とみなす（既存挙動互換）
    //   - enabled=false: 除外
    //   - scope='mine' & projectMasterId 指定あり: ProjectMaster.managerIds に含まれる場合のみ通す
    //   - scope='mine' & projectMasterId 指定なし: 絞り込みできないので通す（chat-message 等）
    let filteredUserIds = uniqueUserIds;
    try {
        const prefs = await prisma.userNotificationPreference.findMany({
            where: { userId: { in: uniqueUserIds }, type },
            select: { userId: true, enabled: true, scope: true },
        });
        const prefByUser = new Map(prefs.map((p) => [p.userId, p]));

        filteredUserIds = uniqueUserIds.filter((uid) => {
            const p = prefByUser.get(uid);
            if (!p) return true; // 未設定 = 有効
            return p.enabled;
        });

        if (input.projectMasterId && filteredUserIds.length > 0) {
            const needsScopeCheck = filteredUserIds.some(
                (uid) => prefByUser.get(uid)?.scope === 'mine'
            );
            if (needsScopeCheck) {
                const pm = await prisma.projectMaster.findUnique({
                    where: { id: input.projectMasterId },
                    select: { managerIds: true, createdBy: true },
                });
                // 案件担当者は createdBy (JSON配列文字列) と managerIds の両方に保存され得るため両方を合算する
                const managerSet = new Set<string>(pm?.managerIds ?? []);
                const parsedCreatedBy = parseJsonField<unknown>(pm?.createdBy ?? null, null);
                const createdByIds = Array.isArray(parsedCreatedBy) ? parsedCreatedBy : [];
                for (const id of createdByIds) {
                    if (typeof id === 'string' && id) managerSet.add(id);
                }
                // createdBy が単一ID文字列で保存されている古いデータにも対応（JSON配列でない素のID）
                if (
                    pm?.createdBy &&
                    !Array.isArray(parsedCreatedBy) &&
                    !pm.createdBy.trim().startsWith('[')
                ) {
                    managerSet.add(pm.createdBy);
                }
                filteredUserIds = filteredUserIds.filter((uid) => {
                    const scope = prefByUser.get(uid)?.scope;
                    if (scope !== 'mine') return true;
                    return managerSet.has(uid);
                });
            }
        }
    } catch (e) {
        logger.error('[Notify] preference filter failed (fallback: send to all)', e);
    }

    if (filteredUserIds.length === 0) {
        return { notificationIds: [], push: { sent: 0, removed: 0, failed: 0 } };
    }

    // DBレコード作成（同一payloadで各ユーザー分）
    let notificationIds: string[] = [];
    try {
        const created = await prisma.$transaction(
            filteredUserIds.map((userId) =>
                prisma.notification.create({
                    data: {
                        userId,
                        type,
                        title: input.title,
                        body: input.body,
                        url: input.url,
                        data: (input.data as object | undefined) ?? undefined,
                        createdAt: now,
                    },
                    select: { id: true },
                })
            )
        );
        notificationIds = created.map((n) => n.id);
    } catch (e) {
        logger.error('[Notify] DB insert failed', e);
    }

    // Web Push送信
    const pushPayload: PushPayload = {
        title: input.title,
        body: input.body,
        url: input.url || '/',
        tag: input.pushTag || type,
        requireInteraction: input.requireInteraction,
        data: { type, ...(input.data || {}) },
    };
    const push = await sendPushToUsers(filteredUserIds, pushPayload);

    return { notificationIds, push };
}
