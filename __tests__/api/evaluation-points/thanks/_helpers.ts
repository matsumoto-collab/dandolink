/**
 * 「ありがとう」の API のテストで使う共通の部品（テストのファイルではない）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

export const mock = (fn: unknown) => fn as jest.Mock;
export const utc0 = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

/** username（ログイン名）は、わざと id と違う値にする（id と username の取り違えを見つけるため） */
export const loginAs = (user: { id: string; role: string; name?: string }) =>
    mock(requireAuth).mockImplementation(async () => ({ session: { user: { isActive: true, username: `login-${user.id}`, ...user } }, error: null }));
export const logout = () =>
    // 応答は1回しか読めないので、呼ばれるたびに新しく作る
    mock(requireAuth).mockImplementation(async () => ({ session: null, error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }));

export const ADMIN = { id: 'admin1', role: 'admin', name: '管理者1' };
export const MANAGER = { id: 'manager1', role: 'manager', name: 'マネージャー1' };
export const FOREMAN = { id: 'foremanA', role: 'foreman1', name: '職長A' };
export const FOREMAN2 = { id: 'foremanB', role: 'FOREMAN2', name: '職長B' };
export const WORKER = { id: 'worker1', role: 'worker', name: '作業員1' };
export const PARTNER = { id: 'partner1', role: 'partner', name: '協力1' };
export const PARTNER_MEMBER = { id: 'pm1', role: 'partner_member', name: '協力メンバー1' };
export const SUPPORT = { id: 'support1', role: 'support', name: '応援1' };
export const ACCOUNTANT = { id: 'acc1', role: 'accountant', name: '経理1' };
/** 「ありがとう」の対象外のロール */
export const OUTSIDERS = [PARTNER, PARTNER_MEMBER, SUPPORT, ACCOUNTANT];

export const jsonRequest = (path: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

export const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

/** 「ありがとう」の2つの表と評価ポイントのログに、何も書いていないこと */
export const noThanksWrites = () => {
    for (const fn of [
        prisma.evaluationPointThanks.create,
        prisma.evaluationPointThanks.createMany,
        prisma.evaluationPointThanks.update,
        prisma.evaluationPointThanks.updateMany,
        prisma.evaluationPointThanks.upsert,
        prisma.evaluationPointThanks.delete,
        prisma.evaluationPointThanks.deleteMany,
        prisma.evaluationPointThanksSetting.create,
        prisma.evaluationPointThanksSetting.update,
        prisma.evaluationPointThanksSetting.upsert,
        prisma.evaluationPointLog.create,
        prisma.evaluationPointLog.createMany,
    ]) {
        expect(fn).not.toHaveBeenCalled();
    }
};

/** 「今」を固定する（Date だけを差し替える）。戻すのは jest.useRealTimers() */
export const freezeNow = (iso: string) =>
    jest.useFakeTimers({
        now: new Date(iso),
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout',
        ],
    });

/** 2026-10-05T16:00Z ＝ 日本時間 2026-10-06 01:00 */
export const NOW = '2026-10-05T16:00:00.000Z';
export const TODAY = '2026-10-06';
