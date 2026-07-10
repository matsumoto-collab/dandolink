/**
 * @jest-environment node
 */
import { GET } from '@/app/api/profit-dashboard/route';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { fetchMonthlySales } from '@/lib/profitDashboard';
import { NextResponse } from 'next/server';

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: String(error) }, { status: 500 })),
}));

// ルートは薄いラッパ。集計ロジックは lib 側で単体検証済みなのでモックする。
// 旧: 案件一覧/summary/集計/?options=1 はダッシュボード再編（月次中心化）で廃止。
jest.mock('@/lib/profitDashboard', () => ({
    fetchMonthlySales: jest.fn(),
}));

describe('/api/profit-dashboard GET', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'manager' } }, error: null });
    });

    it('権限が無ければそのエラーを返し、集計は呼ばない', async () => {
        const err = NextResponse.json({ error: '権限がありません' }, { status: 403 });
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

        const res = await GET();
        expect(res.status).toBe(403);
        expect(fetchMonthlySales).not.toHaveBeenCalled();
    });

    it('月次売上（monthlySales）のみを no-store で返す', async () => {
        (fetchMonthlySales as jest.Mock).mockResolvedValue({
            current: { year: 2026, month: 6, sales: 100000, invoiceCount: 2 },
            previous: { year: 2026, month: 5, sales: 50000, invoiceCount: 1 },
            momDelta: 50000, momPercent: 100, trend: [],
        });

        const res = await GET();
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.monthlySales.current.sales).toBe(100000);
        expect(Object.keys(json)).toEqual(['monthlySales']);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        expect(fetchMonthlySales).toHaveBeenCalled();
    });
});
