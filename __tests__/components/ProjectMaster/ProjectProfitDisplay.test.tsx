/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ProjectProfitDisplay from '@/components/ProjectMaster/ProjectProfitDisplay';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    TrendingUp: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-trending-up" {...props} />,
    TrendingDown: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-trending-down" {...props} />,
    DollarSign: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-dollar" {...props} />,
    Truck: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-truck" {...props} />,
    Users: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-users" {...props} />,
    Wrench: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-wrench" {...props} />,
    Package: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-package" {...props} />,
    MoreHorizontal: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-more" {...props} />,
}));

// Mock Loading component
jest.mock('@/components/ui/Loading', () => ({
    __esModule: true,
    default: ({ text }: { text?: string }) => <div data-testid="loading">{text}</div>,
}));

// Mock cost calculation utils
jest.mock('@/utils/costCalculation', () => ({
    formatCurrency: (amount: number) => `¥${amount.toLocaleString()}`,
    getProfitMarginColor: (margin: number) => margin >= 20 ? 'text-green-600' : 'text-red-600',
}));

const mockProfitData = {
    projectMasterId: 'pm1',
    projectTitle: 'テスト案件',
    revenue: 1000000,
    estimateAmount: 1200000,
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
        global.fetch = jest.fn(() => new Promise(() => { })) as jest.Mock; // Never resolves
        render(<ProjectProfitDisplay projectMasterId="pm1" />);
        expect(screen.getByTestId('loading')).toBeInTheDocument();
        expect(screen.getByText('利益情報を読み込み中...')).toBeInTheDocument();
    });

    it('should show profit data after successful fetch', async () => {
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

        // Revenue
        expect(screen.getByText('売上（請求済）')).toBeInTheDocument();
        expect(screen.getByText('¥1,000,000')).toBeInTheDocument();

        // Cost
        expect(screen.getByText('原価合計')).toBeInTheDocument();
        expect(screen.getByText('¥700,000')).toBeInTheDocument();

        // Gross profit
        expect(screen.getByText('粗利')).toBeInTheDocument();
        expect(screen.getByText('¥300,000')).toBeInTheDocument();
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
            expect(screen.getByText(/利益率: 30%/)).toBeInTheDocument();
        });
    });

    it('should show cost breakdown items', async () => {
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

    it('should show estimate amount', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockProfitData),
            })
        ) as jest.Mock;

        render(<ProjectProfitDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText(/見積: ¥1,200,000/)).toBeInTheDocument();
        });
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
            expect(screen.getByTestId('icon-trending-up')).toBeInTheDocument();
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
            expect(screen.getByTestId('icon-trending-down')).toBeInTheDocument();
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
        expect(global.fetch).toHaveBeenCalledWith('/api/project-masters/pm123/profit');
    });
});
