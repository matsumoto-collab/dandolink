/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProjectProfitDisplay from '@/components/ProjectMaster/ProjectProfitDisplay';

jest.mock('@/components/ui/Loading', () => ({
    __esModule: true,
    default: ({ text }: { text?: string }) => <div data-testid="loading">{text}</div>,
}));

jest.mock('@/utils/costCalculation', () => ({
    formatCurrency: (amount: number) => `¥${amount.toLocaleString()}`,
    getProfitMarginColor: (margin: number) => margin >= 20 ? 'text-green-600' : 'text-red-600',
}));

const mockProfitData = {
    projectMasterId: 'pm1',
    projectTitle: 'テスト案件',
    revenue: 1000000,
    revenueSource: 'invoice' as const,
    invoiceAmount: 1000000,
    estimateAmount: 1200000,
    estimateSubtotal: 1090909,
    estimateCostTotal: null,
    costBreakdown: {
        laborCost: 350000,
        loadingCost: 50000,
        vehicleCost: 80000,
        materialCost: 100000,
        subcontractorCost: 100000,
        otherExpenses: 20000,
        totalCost: 700000,
    },
    grossProfit: 300000,
    profitMargin: 30,
};

describe('ProjectProfitDisplay', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should show loading state initially', () => {
        global.fetch = jest.fn(() => new Promise(() => { })) as jest.Mock;
        render(<ProjectProfitDisplay projectMasterId="pm1" />);
        expect(screen.getByTestId('loading')).toBeInTheDocument();
        expect(screen.getByText('利益情報を読み込み中...')).toBeInTheDocument();
    });

    it('should show profit data with invoice source', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockProfitData),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('利益サマリー')).toBeInTheDocument();
        });

        expect(screen.getByText('請求済・税別')).toBeInTheDocument();
        expect(screen.getByText('利益')).toBeInTheDocument();
        expect(screen.getByText('¥300,000')).toBeInTheDocument();
        expect(screen.getByText('売上')).toBeInTheDocument();
        expect(screen.getByText('¥1,000,000')).toBeInTheDocument();
        // 「原価」「¥700,000(総原価)」は見込み/確定カードと原価行で複数箇所に出るため getAllByText
        expect(screen.getAllByText('原価').length).toBeGreaterThan(0);
        expect(screen.getAllByText('¥700,000').length).toBeGreaterThan(0);
    });

    it('should show estimate badge when revenue source is estimate', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ ...mockProfitData, revenueSource: 'estimate' }),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('見積・税別')).toBeInTheDocument();
        });
    });

    it('should show none badge when revenue source is none', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ ...mockProfitData, revenueSource: 'none', revenue: 0 }),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('未入力')).toBeInTheDocument();
        });
    });

    it('should show profit margin percentage', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockProfitData),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText(/利益率 30%/)).toBeInTheDocument();
        });
    });

    it('should show cost breakdown items sorted by amount', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockProfitData),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('原価内訳')).toBeInTheDocument();
        });

        expect(screen.getByText('人件費')).toBeInTheDocument();
        expect(screen.getByText('積込費')).toBeInTheDocument();
        expect(screen.getByText('車両費')).toBeInTheDocument();
        expect(screen.getByText('材料費')).toBeInTheDocument();
        expect(screen.getByText('外注費')).toBeInTheDocument();
        expect(screen.getByText('その他')).toBeInTheDocument();
    });

    it('should show trending up icon for positive profit', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockProfitData),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByTestId('icon-TrendingUp')).toBeInTheDocument();
        });
    });

    it('should show trending down icon for negative profit', async () => {
        const lossProfitData = {
            ...mockProfitData,
            grossProfit: -100000,
            profitMargin: -10,
        };
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(lossProfitData),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByTestId('icon-TrendingDown')).toBeInTheDocument();
        });
    });

    it('should show error message when fetch fails', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: false,
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('利益情報の取得に失敗しました')).toBeInTheDocument();
        });
    });

    it('should show error message when fetch throws', async () => {
        global.fetch = jest.fn(() =>
            Promise.reject(new Error('Network error'))
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('利益情報の取得に失敗しました')).toBeInTheDocument();
        });
    });

    it('should call fetch with correct API endpoint', () => {
        global.fetch = jest.fn(() => new Promise(() => { })) as jest.Mock;
        render(<ProjectProfitDisplay projectMasterId="pm123" />);
        expect(global.fetch).toHaveBeenCalledWith('/api/project-masters/pm123/profit', { cache: 'no-store' });
    });

    it('編集モードで車両費・外注費の明細が自動展開され、行ごとに編集できる', async () => {
        const dataWithDetail = {
            ...mockProfitData,
            breakdown: {
                labor: [],
                vehicle: [
                    { assignmentId: 'asg-veh', date: '2026-06-10', vehicleNames: ['軽トラ'], autoCost: 3000, override: null, effectiveCost: 3000 },
                ],
                subcontractor: [
                    { assignmentId: 'asg-sub', date: '2026-06-10', constructionTypeName: '組立', foremanName: '協力P', autoCost: 80000, override: null, effectiveCost: 80000 },
                ],
                materialCost: 100000,
                otherExpenses: 20000,
                loadingCost: 50000,
            },
        };
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: true, json: () => Promise.resolve(dataWithDetail) })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);
        await waitFor(() => expect(screen.getByText('利益サマリー')).toBeInTheDocument());

        // 編集前は明細が折りたたまれ、入力欄は出ていない
        expect(screen.queryByDisplayValue('3000')).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('編集'));

        // 編集に入ると車両費(3000)・外注費(80000)の明細が自動展開され、行ごとの入力欄が出る
        await waitFor(() => expect(screen.getByDisplayValue('3000')).toBeInTheDocument());
        expect(screen.getByDisplayValue('80000')).toBeInTheDocument();
        expect(screen.getByText(/軽トラ/)).toBeInTheDocument();
    });
});
