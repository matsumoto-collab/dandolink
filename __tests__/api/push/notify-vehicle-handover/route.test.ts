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

beforeEach(() => {
    jest.clearAllMocks();
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
});
