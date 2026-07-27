/**
 * @jest-environment node
 */
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '@/app/api/tools/[id]/checkout/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        tool: { findUnique: jest.fn(), update: jest.fn() },
        toolCheckoutLog: { create: jest.fn() },
        $transaction: jest.fn((ops) => Promise.all(ops)),
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireAuth: jest.fn(),
    errorResponse: jest.fn().mockImplementation((msg, status) => NextResponse.json({ error: msg }, { status })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
}));

jest.mock('@/lib/tools/names', () => ({
    resolveProjectNames: jest.fn().mockResolvedValue(new Map([['pm-1', '山田様邸']])),
    resolveUserNames: jest.fn().mockResolvedValue(new Map([['user-1', '記録者'], ['user-2', '田中']])),
}));

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const context = { params: Promise.resolve({ id: 'tool-1' }) };

const baseTool = {
    id: 'tool-1',
    categoryId: 'cat-1',
    name: '#1',
    status: 'in_stock',
    projectMasterId: null,
    destinationNote: null,
    holderId: null,
    checkedOutAt: null,
    note: null,
    sortOrder: 0,
    isActive: true,
};

describe('POST /api/tools/[id]/checkout', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'user-1', role: 'foreman1' } }, error: null });
        (prisma.tool.findUnique as jest.Mock).mockResolvedValue(baseTool);
        (prisma.tool.update as jest.Mock).mockResolvedValue({ ...baseTool, category: { name: 'インパクトドライバー' } });
        (prisma.toolCheckoutLog.create as jest.Mock).mockResolvedValue({ id: 'log-1' });
    });

    it.each(['partner', 'partner_member', 'accountant'])('%s ロールは持出し・返却できない（閲覧のみ）', async (role) => {
        (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u-9', role } }, error: null });

        const res = await POST(makeRequest({ status: 'checked_out' }), context);

        expect(res.status).toBe(403);
        expect(prisma.tool.update).not.toHaveBeenCalled();
    });

    it('社員は持出しを記録でき、履歴に checkout が残る', async () => {
        const res = await POST(
            makeRequest({ status: 'checked_out', projectMasterId: 'pm-1', holderId: 'user-2', note: 'ケース付き' }),
            context
        );

        expect(res.status).toBe(200);

        const updateArg = (prisma.tool.update as jest.Mock).mock.calls[0][0];
        expect(updateArg.data.status).toBe('checked_out');
        expect(updateArg.data.projectMasterId).toBe('pm-1');
        expect(updateArg.data.holderId).toBe('user-2');
        expect(updateArg.data.checkedOutAt).toBeInstanceOf(Date);

        const logArg = (prisma.toolCheckoutLog.create as jest.Mock).mock.calls[0][0];
        expect(logArg.data.action).toBe('checkout');
        // 案件名・氏名は当時の記録としてスナップショットする
        expect(logArg.data.projectName).toBe('山田様邸');
        expect(logArg.data.holderName).toBe('田中');
        expect(logArg.data.createdBy).toBe('user-1');
    });

    it('持出し先が無ければ 400（案件も自由入力も未指定）', async () => {
        const res = await POST(makeRequest({ status: 'checked_out', holderId: 'user-2' }), context);

        expect(res.status).toBe(400);
        expect(prisma.tool.update).not.toHaveBeenCalled();
    });

    it('持出者が無ければ 400', async () => {
        const res = await POST(makeRequest({ status: 'checked_out', projectMasterId: 'pm-1' }), context);

        expect(res.status).toBe(400);
        expect(prisma.tool.update).not.toHaveBeenCalled();
    });

    it('自由入力の持出し先だけでも持出しできる', async () => {
        const res = await POST(
            makeRequest({ status: 'checked_out', destinationNote: '〇〇工機', holderId: 'user-2' }),
            context
        );

        expect(res.status).toBe(200);
        const updateArg = (prisma.tool.update as jest.Mock).mock.calls[0][0];
        expect(updateArg.data.destinationNote).toBe('〇〇工機');
        expect(updateArg.data.projectMasterId).toBeNull();
    });

    it('持出中→社内保管中は return として記録し、持出し情報を消す', async () => {
        (prisma.tool.findUnique as jest.Mock).mockResolvedValue({
            ...baseTool,
            status: 'checked_out',
            projectMasterId: 'pm-1',
            holderId: 'user-2',
            checkedOutAt: new Date('2026-07-20T00:00:00Z'),
        });

        const res = await POST(makeRequest({ status: 'in_stock' }), context);

        expect(res.status).toBe(200);
        const updateArg = (prisma.tool.update as jest.Mock).mock.calls[0][0];
        expect(updateArg.data.projectMasterId).toBeNull();
        expect(updateArg.data.destinationNote).toBeNull();
        expect(updateArg.data.holderId).toBeNull();
        expect(updateArg.data.checkedOutAt).toBeNull();

        const logArg = (prisma.toolCheckoutLog.create as jest.Mock).mock.calls[0][0];
        expect(logArg.data.action).toBe('return');
    });

    it('修理中への変更は status_change として記録し、持出し情報を消す', async () => {
        (prisma.tool.findUnique as jest.Mock).mockResolvedValue({
            ...baseTool,
            status: 'checked_out',
            projectMasterId: 'pm-1',
            holderId: 'user-2',
        });

        const res = await POST(makeRequest({ status: 'repairing', note: '〇〇工機へ入庫' }), context);

        expect(res.status).toBe(200);
        const updateArg = (prisma.tool.update as jest.Mock).mock.calls[0][0];
        expect(updateArg.data.status).toBe('repairing');
        expect(updateArg.data.holderId).toBeNull();
        expect(updateArg.data.note).toBe('〇〇工機へ入庫');

        const logArg = (prisma.toolCheckoutLog.create as jest.Mock).mock.calls[0][0];
        expect(logArg.data.action).toBe('status_change');
    });

    it('持出中のまま持出し先も持出者も変わらなければ持出日を打ち直さない', async () => {
        const originalDate = new Date('2026-07-20T00:00:00Z');
        (prisma.tool.findUnique as jest.Mock).mockResolvedValue({
            ...baseTool,
            status: 'checked_out',
            projectMasterId: 'pm-1',
            holderId: 'user-2',
            checkedOutAt: originalDate,
        });

        const res = await POST(
            makeRequest({ status: 'checked_out', projectMasterId: 'pm-1', holderId: 'user-2', note: 'メモだけ更新' }),
            context
        );

        expect(res.status).toBe(200);
        const updateArg = (prisma.tool.update as jest.Mock).mock.calls[0][0];
        expect(updateArg.data.checkedOutAt).toBe(originalDate);
    });

    it('不正な状態は 400', async () => {
        const res = await POST(makeRequest({ status: 'broken' }), context);

        expect(res.status).toBe(400);
        expect(prisma.tool.findUnique).not.toHaveBeenCalled();
    });

    it('削除済み（isActive=false）の工具は 404', async () => {
        (prisma.tool.findUnique as jest.Mock).mockResolvedValue({ ...baseTool, isActive: false });

        const res = await POST(makeRequest({ status: 'in_stock' }), context);

        expect(res.status).toBe(404);
    });
});
