/**
 * 支払明細書 API テストの共通部品（テストファイルではない＝testMatch に当たらない名前）。
 * ロールの差し替えと、DB の行の形をそろえた値を作る関数だけを置く。
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/api/utils';

/** 本番に大文字ロールが混在するので、大文字の 'ADMIN' でも admin と判定できることを見る */
export const asAdmin = () =>
    (requireAuth as jest.Mock).mockResolvedValue({
        session: { user: { id: 'admin-1', role: 'ADMIN', name: '管理者', isActive: true } },
        error: null,
    });

export const asManager = () =>
    (requireAuth as jest.Mock).mockResolvedValue({
        session: { user: { id: 'manager-1', role: 'manager', isActive: true } },
        error: null,
    });

export const jsonRequest = (url: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost:3000${url}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

const T0 = new Date('2026-09-01T00:00:00.000Z');

export function contractorRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'c-1',
        userId: 'u-1',
        code: 1,
        recipientName: '山田工業',
        honorific: '御中',
        postalCode: '7900001',
        address: '愛媛県松山市1-1',
        registrationNumber: null,
        unitPrice: 20000,
        payeeId: null,
        sortOrder: 1,
        isActive: true,
        notes: null,
        createdAt: T0,
        updatedAt: T0,
        updatedBy: null,
        ...overrides,
    };
}

export function statementRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 's-1',
        contractorId: 'c-1',
        year: 2026,
        month: 8,
        status: 'draft',
        statementNo: null,
        issueDate: new Date('2026-08-31T00:00:00.000Z'),
        paymentDate: new Date('2026-09-10T00:00:00.000Z'),
        subject: '令和8年8月分 常用代金',
        items: [
            { kind: 'full', name: '常用（全日）', quantity: 2, unit: '日', unitPrice: 20000, amount: 40000, note: '' },
        ],
        total: 40000,
        tax: 3636,
        includeAttendance: true,
        attendanceCounts: { present: 2, holidayWork: 0, nightShift: 0 },
        issuedSnapshot: null,
        issuedAt: null,
        issuedBy: null,
        paymentScheduleId: null,
        notes: null,
        createdAt: T0,
        updatedAt: T0,
        updatedBy: null,
        ...overrides,
    };
}

export function attendanceRow(userId: string, ymd: string, status = 'present') {
    return {
        userId,
        date: new Date(`${ymd}T00:00:00.000Z`),
        status,
        earlyStartMinutes: 0,
        morningLoadingMinutes: 0,
        overtimeMinutes: 0,
        eveningLoadingMinutes: 0,
        earlyEndTime: null,
        note: null,
    };
}

/** 下書き保存・発行の入力（2026年8月・出勤2日） */
export function saveBody(overrides: Record<string, unknown> = {}) {
    return {
        contractorId: 'c-1',
        year: 2026,
        month: 8,
        issueDate: '2026-08-31',
        paymentDate: '2026-09-10',
        subject: '令和8年8月分 常用代金',
        items: [{ kind: 'full', name: '常用（全日）', quantity: 2, unit: '日', unitPrice: 20000, note: '' }],
        includeAttendance: true,
        notes: null,
        seenCounts: { present: 2, holidayWork: 0, nightShift: 0 },
        ...overrides,
    };
}

export const companyInfoRow = {
    name: '株式会社テスト足場',
    postalCode: '7900002',
    address: '愛媛県松山市2-2',
    tel: '089-000-0000',
    fax: null,
    registrationNumber: 'T1234567890123',
};
