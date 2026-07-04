/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

// Notify ヘルパーは route 内で副作用を持つので、テスト前に jest.mock しておく
jest.mock('@/lib/notifications', () => ({
    notifyUsers: jest.fn().mockResolvedValue({
        notificationIds: [],
        push: { sent: 0, removed: 0, failed: 0 },
    }),
}));

// Prisma は jest.setup.ts でグローバルモック済みだが vehicleHandoverNotice / vehicle が含まれていないので上書き
jest.mock('@/lib/prisma', () => ({
    prisma: {
        projectAssignment: {
            findMany: jest.fn(),
        },
        vehicleHandoverNotice: {
            findMany: jest.fn(),
            create: jest.fn(),
            updateMany: jest.fn(),
        },
        vehicle: {
            findMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
        },
        $transaction: jest.fn((callbackOrArray: unknown) => {
            if (Array.isArray(callbackOrArray)) return Promise.all(callbackOrArray);
            if (typeof callbackOrArray === 'function') return (callbackOrArray as (p: unknown) => unknown)(undefined);
            return Promise.resolve();
        }),
    },
}));

import { POST } from '@/app/api/push/notify-vehicle-handover/route';
import { prisma } from '@/lib/prisma';
import { notifyUsers } from '@/lib/notifications';

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/push/notify-vehicle-handover', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

// JST 0時の Date を作る。JST 0時 = UTC 前日 15:00
function jstDate(yyyy: number, mm: number, dd: number): Date {
    return new Date(Date.UTC(yyyy, mm - 1, dd) - 9 * 60 * 60 * 1000);
}

// 「今日」を固定する（route は to側日付が今日より前のペアを通知しない）。
// Date だけを fake する。タイマー系まで fake すると NextRequest の body 読み取りが
// 固まる恐れがあるため doNotFake で除外する。
function setToday(date: Date) {
    jest.useFakeTimers({
        now: date,
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask',
            'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback',
            'setImmediate', 'clearImmediate',
            'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
        ],
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    // 既存ケースは 2026-05-18〜20 の手配を使うため「今日」を 5/18 JST に固定する
    setToday(new Date(Date.UTC(2026, 4, 18, 3, 0, 0)));
});

afterEach(() => {
    jest.useRealTimers();
});

describe('POST /api/push/notify-vehicle-handover', () => {
    it('入力 assignmentIds が空 → 400', async () => {
        const res = await POST(makeRequest({ assignmentIds: [], mode: 'confirm' }));
        expect(res.status).toBe(400);
    });

    it('該当 assignment が無い → no-assignment で 200', async () => {
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([]);
        const res = await POST(makeRequest({ assignmentIds: ['missing-id'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.reason).toBe('no-assignment');
        expect(notifyUsers).not.toHaveBeenCalled();
    });

    it('隣接日・別班 (A→B) で B を確定 → A 班に新規通知＆VehicleHandoverNotice INSERT', async () => {
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-alice', 'u-bob']), isDispatchConfirmed: true };
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-carol']), isDispatchConfirmed: true };

        // step 1: inputAssignments
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        // step 2: noticesByInput
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        // step 3: candidates (前後30日)
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        // step 6: existing pairs
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        // step 8: involved assignments
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        // step 8: vehicles
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        // step 8: foremen
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
        ]);
        (prisma.vehicleHandoverNotice.create as jest.Mock).mockResolvedValue({ id: 'notice-1' });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(1);
        expect(json.removed).toBe(0);

        // 通知が A 班メンバーに飛ぶ
        expect(notifyUsers).toHaveBeenCalledTimes(1);
        const call = (notifyUsers as jest.Mock).mock.calls[0][0];
        expect(call.type).toBe('vehicle-handover');
        expect(call.title).toBe('【車両引き継ぎ】');
        expect(call.body).toContain('軽トラ①');
        expect(call.body).toContain('佐藤班');
        expect(new Set(call.userIds)).toEqual(new Set(['u-alice', 'u-bob']));
        // pushTag は vehicleId + dateKey
        expect(call.pushTag).toBe('vehicle-handover-v1-2026-05-19');

        // VehicleHandoverNotice INSERT
        expect(prisma.vehicleHandoverNotice.create).toHaveBeenCalled();
    });

    it('差分なし（desired == existing）→ 通知も INSERT も起きない', async () => {
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-alice']), isDispatchConfirmed: true };
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-carol']), isDispatchConfirmed: true };
        const existingRow = {
            id: 'notice-1', vehicleId: 'v1', fromAssignmentId: 'a1', toAssignmentId: 'a2',
            notifiedUserIds: JSON.stringify(['u-alice']),
        };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([existingRow]);

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(0);
        expect(json.removed).toBe(0);
        expect(notifyUsers).not.toHaveBeenCalled();
        expect(prisma.vehicleHandoverNotice.create).not.toHaveBeenCalled();
    });

    it('中間挿入 (既存 A→C / 新規 B 確定) → A→C を取消、A→B/B→C を新規送信', async () => {
        const aA = { id: 'a-A', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-a']), isDispatchConfirmed: true };
        const aB = { id: 'a-B', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-b']), isDispatchConfirmed: true };
        const aC = { id: 'a-C', assignedEmployeeId: 'foreman-C', date: jstDate(2026, 5, 20), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-c']), isDispatchConfirmed: true };
        const oldNotice = {
            id: 'notice-old', vehicleId: 'v1', fromAssignmentId: 'a-A', toAssignmentId: 'a-C',
            notifiedUserIds: JSON.stringify(['u-a']),
        };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([aB]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([aA, aB, aC]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([oldNotice]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([aA, aB, aC]);
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
            { id: 'foreman-C', displayName: '鈴木' },
        ]);
        (prisma.vehicleHandoverNotice.create as jest.Mock).mockResolvedValue({ id: 'new-notice' });
        (prisma.vehicleHandoverNotice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await POST(makeRequest({ assignmentIds: ['a-B'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(2);   // A→B, B→C
        expect(json.removed).toBe(1); // A→C

        // 取り消し通知 + 新規通知 = 通知 3 件以上（受信者班単位で集約）
        expect(notifyUsers).toHaveBeenCalled();
        const bodies = (notifyUsers as jest.Mock).mock.calls.map(c => c[0].body);
        // 取り消し本文
        expect(bodies.some(b => b.includes('取り消されました'))).toBe(true);

        // canceledAt がセットされる
        expect(prisma.vehicleHandoverNotice.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: { in: expect.arrayContaining(['notice-old']) } }),
                data: expect.objectContaining({ canceledAt: expect.any(Date) }),
            }),
        );
    });

    it('mode=cancel: 既存通知が消える → 取消通知を送信し canceledAt セット', async () => {
        // 入力 assignment は confirmedVehicleIds が空 (解除後)
        const a2Empty = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: null, confirmedWorkerIds: null, isDispatchConfirmed: false };
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-a']), isDispatchConfirmed: true };
        const existingRow = {
            id: 'notice-1', vehicleId: 'v1', fromAssignmentId: 'a1', toAssignmentId: 'a2',
            notifiedUserIds: JSON.stringify(['u-a']),
        };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2Empty]);
        // noticesByInput で逆引き
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([{ vehicleId: 'v1' }]);
        // candidates: a1 のみ（a2 は解除済み）
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1]);
        // existing pairs
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([existingRow]);
        // 参照先 a2 は候補外（解除済み）なので日付解決の追加フェッチが走る
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'a2', date: jstDate(2026, 5, 19) }]);
        // involved
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2Empty]);
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
        ]);
        (prisma.vehicleHandoverNotice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'cancel' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.removed).toBe(1);
        expect(json.added).toBe(0);

        // 取り消し通知が A 班メンバー (u-a) に飛ぶ
        expect(notifyUsers).toHaveBeenCalledTimes(1);
        const call = (notifyUsers as jest.Mock).mock.calls[0][0];
        expect(call.body).toContain('取り消されました');
        expect(call.userIds).toEqual(['u-a']);
        // pushTag は added と同じ形（先頭車両 + to側日付）＝ OS 通知を上書きする
        expect(call.pushTag).toBe('vehicle-handover-v1-2026-05-19');

        // canceledAt セット
        expect(prisma.vehicleHandoverNotice.updateMany).toHaveBeenCalled();
    });

    it('JST 22:00 (= UTC 13:00) で確定された日付でも JST 日付キーが正しく出る', async () => {
        // 2026-05-19 22:00 JST = 2026-05-19 13:00 UTC
        const at22 = new Date(Date.UTC(2026, 4, 19, 13, 0, 0));
        // dateKeyJst は 2026-05-19 を返すべき（UTC で見ると同じ日だが、サーバ TZ が違うと前後する可能性をテスト）
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-a']), isDispatchConfirmed: true };
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: at22, confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-b']), isDispatchConfirmed: true };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
        ]);
        (prisma.vehicleHandoverNotice.create as jest.Mock).mockResolvedValue({ id: 'n1' });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(1);

        // pushTag に 2026-05-19 が含まれる
        const call = (notifyUsers as jest.Mock).mock.calls[0][0];
        expect(call.pushTag).toBe('vehicle-handover-v1-2026-05-19');
    });

    it('引き継ぎ日（to側）が過去 → 記録のみで通知しない', async () => {
        // 「今日」を 5/25 に進める＝ 5/18 → 5/19 の引き継ぎは済んだ話
        setToday(new Date(Date.UTC(2026, 4, 25, 3, 0, 0)));
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-alice']), isDispatchConfirmed: true };
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-carol']), isDispatchConfirmed: true };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
        ]);
        (prisma.vehicleHandoverNotice.create as jest.Mock).mockResolvedValue({ id: 'n1' });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(1);
        expect(json.suppressedAddedPairs).toBe(1);
        expect(notifyUsers).not.toHaveBeenCalled();

        // 記録は残す（受信者ゼロ＝backfill と同じ「送ったことにする」扱い）
        expect(prisma.vehicleHandoverNotice.create).toHaveBeenCalledTimes(1);
        const createArg = (prisma.vehicleHandoverNotice.create as jest.Mock).mock.calls[0][0];
        expect(createArg.data.notifiedUserIds).toBe('[]');
    });

    it('±30日窓の外にある古い有効行は removed 扱いしない（過去分の誤取消防止）', async () => {
        setToday(new Date(Date.UTC(2026, 6, 10, 3, 0, 0))); // 今日 = 7/10
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 7, 10), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-b']), isDispatchConfirmed: true };
        // 4月の引き継ぎ行（有効なまま残っている）＝窓 [6/10, 8/10) の外
        const oldRow = { id: 'notice-old', vehicleId: 'v1', fromAssignmentId: 'b1', toAssignmentId: 'b2', notifiedUserIds: JSON.stringify(['u-old']) };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([oldRow]);
        // b1/b2 は候補外なので日付解決の追加フェッチが走る
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'b1', date: jstDate(2026, 4, 1) },
            { id: 'b2', date: jstDate(2026, 4, 3) },
        ]);

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(0);
        expect(json.removed).toBe(0);
        expect(notifyUsers).not.toHaveBeenCalled();
        expect(prisma.vehicleHandoverNotice.updateMany).not.toHaveBeenCalled();
    });

    it('参照先の手配が削除済みの行 → 通知なしで無効化（canceledAt のみ）', async () => {
        setToday(new Date(Date.UTC(2026, 6, 10, 3, 0, 0)));
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 7, 10), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-b']), isDispatchConfirmed: true };
        const ghostRow = { id: 'notice-ghost', vehicleId: 'v1', fromAssignmentId: 'gone-1', toAssignmentId: 'gone-2', notifiedUserIds: JSON.stringify(['u-old']) };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([ghostRow]);
        // 参照先の手配が削除済み → 日付を解決できない
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([]);
        (prisma.vehicleHandoverNotice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.added).toBe(0);
        expect(json.removed).toBe(0);
        expect(json.orphanedRows).toBe(1);
        expect(notifyUsers).not.toHaveBeenCalled();
        expect(prisma.vehicleHandoverNotice.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: { in: ['notice-ghost'] } }),
                data: expect.objectContaining({ canceledAt: expect.any(Date) }),
            }),
        );
    });

    it('取消も引き継ぎ日（to側）が過去なら通知しない（canceledAt のみ）', async () => {
        setToday(new Date(Date.UTC(2026, 4, 25, 3, 0, 0))); // 今日 = 5/25
        // a2 の車両を v1 → v2 に入れ替えて再確定 → 5/19 の v1 引き継ぎ (a1→a2) が removed になるが過去
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-a']), isDispatchConfirmed: true };
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: JSON.stringify(['v2']), confirmedWorkerIds: JSON.stringify(['u-b']), isDispatchConfirmed: true };
        const row = { id: 'notice-1', vehicleId: 'v1', fromAssignmentId: 'a1', toAssignmentId: 'a2', notifiedUserIds: JSON.stringify(['u-a']) };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([{ vehicleId: 'v1' }]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([row]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
        ]);
        (prisma.vehicleHandoverNotice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.removed).toBe(1);
        expect(json.suppressedRemovedPairs).toBe(1);
        expect(notifyUsers).not.toHaveBeenCalled();
        expect(prisma.vehicleHandoverNotice.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: { in: ['notice-1'] } }),
                data: expect.objectContaining({ canceledAt: expect.any(Date) }),
            }),
        );
    });

    it('取消通知（引き継ぎ日が未来）は送信され pushTag が to側日付になる', async () => {
        // 今日 = 5/18（beforeEach 既定）。5/19 の引き継ぎを車両入れ替えで取消 → 通知あり
        const a1 = { id: 'a1', assignedEmployeeId: 'foreman-A', date: jstDate(2026, 5, 18), confirmedVehicleIds: JSON.stringify(['v1']), confirmedWorkerIds: JSON.stringify(['u-a']), isDispatchConfirmed: true };
        const a2 = { id: 'a2', assignedEmployeeId: 'foreman-B', date: jstDate(2026, 5, 19), confirmedVehicleIds: JSON.stringify(['v2']), confirmedWorkerIds: JSON.stringify(['u-b']), isDispatchConfirmed: true };
        const row = { id: 'notice-1', vehicleId: 'v1', fromAssignmentId: 'a1', toAssignmentId: 'a2', notifiedUserIds: JSON.stringify(['u-a']) };

        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([{ vehicleId: 'v1' }]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicleHandoverNotice.findMany as jest.Mock).mockResolvedValueOnce([row]);
        (prisma.projectAssignment.findMany as jest.Mock).mockResolvedValueOnce([a1, a2]);
        (prisma.vehicle.findMany as jest.Mock).mockResolvedValueOnce([{ id: 'v1', name: '軽トラ①' }]);
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
            { id: 'foreman-A', displayName: '山田' },
            { id: 'foreman-B', displayName: '佐藤' },
        ]);
        (prisma.vehicleHandoverNotice.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await POST(makeRequest({ assignmentIds: ['a2'], mode: 'confirm' }));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.removed).toBe(1);
        expect(json.suppressedRemovedPairs).toBe(0);

        expect(notifyUsers).toHaveBeenCalledTimes(1);
        const call = (notifyUsers as jest.Mock).mock.calls[0][0];
        expect(call.body).toContain('取り消されました');
        expect(call.userIds).toEqual(['u-a']);
        expect(call.pushTag).toBe('vehicle-handover-v1-2026-05-19');
    });
});
