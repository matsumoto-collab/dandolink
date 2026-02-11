/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import WorkHistoryDisplay from '@/components/ProjectMaster/WorkHistoryDisplay';
import { useMasterData } from '@/hooks/useMasterData';

// Mock hooks
jest.mock('@/hooks/useMasterData');

// Mock lucide-react
jest.mock('lucide-react', () => ({
    Calendar: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-calendar" {...props} />,
    User: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-user" {...props} />,
    Users: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-users" {...props} />,
    Truck: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-truck" {...props} />,
    Wrench: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-wrench" {...props} />,
}));

const mockHistoryItems = [
    {
        id: 'h1',
        date: '2024-06-15',
        foremanId: 'f1',
        foremanName: '田中太郎',
        constructionType: 'assembly',
        workerIds: ['w1', 'w2'],
        workerNames: ['佐藤花子', '鈴木一郎'],
        vehicleIds: ['v1'],
        vehicleNames: ['2tトラック'],
        isConfirmed: true,
        remarks: 'テスト備考',
    },
    {
        id: 'h2',
        date: '2024-06-16',
        foremanId: 'f2',
        foremanName: '山田次郎',
        constructionType: 'demolition',
        workerIds: [],
        workerNames: [],
        vehicleIds: [],
        vehicleNames: [],
        isConfirmed: false,
    },
];

describe('WorkHistoryDisplay', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useMasterData as jest.Mock).mockReturnValue({
            constructionTypes: [
                { id: 'assembly', name: '組立', color: '#4CAF50' },
                { id: 'demolition', name: '解体', color: '#F44336' },
            ],
        });
    });

    it('should show loading state initially', () => {
        global.fetch = jest.fn(() => new Promise(() => { })) as jest.Mock;
        render(<WorkHistoryDisplay projectMasterId="pm1" />);
        expect(screen.getByText('作業履歴を読み込み中...')).toBeInTheDocument();
    });

    it('should show history items after successful fetch', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText(/作業履歴/)).toBeInTheDocument();
            expect(screen.getByText(/2件/)).toBeInTheDocument();
        });
    });

    it('should display foreman names', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('田中太郎')).toBeInTheDocument();
            expect(screen.getByText('山田次郎')).toBeInTheDocument();
        });
    });

    it('should display construction type labels from master data', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('組立')).toBeInTheDocument();
            expect(screen.getByText('解体')).toBeInTheDocument();
        });
    });

    it('should display worker names when present', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('佐藤花子, 鈴木一郎')).toBeInTheDocument();
        });
    });

    it('should display vehicle names when present', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('2tトラック')).toBeInTheDocument();
        });
    });

    it('should display remarks when present', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('テスト備考')).toBeInTheDocument();
        });
    });

    it('should show empty state when no history', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('作業履歴がありません')).toBeInTheDocument();
        });
    });

    it('should show error state when fetch fails', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: false,
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            expect(screen.getByText('作業履歴の取得に失敗しました')).toBeInTheDocument();
        });
    });

    it('should call fetch with correct API endpoint', () => {
        global.fetch = jest.fn(() => new Promise(() => { })) as jest.Mock;
        render(<WorkHistoryDisplay projectMasterId="pm123" />);
        expect(global.fetch).toHaveBeenCalledWith('/api/project-masters/pm123/history');
    });

    it('should format dates correctly', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockHistoryItems),
            })
        ) as jest.Mock;

        render(<WorkHistoryDisplay projectMasterId="pm1" />);

        await waitFor(() => {
            // 2024/6/15(土) format
            expect(screen.getByText(/2024\/6\/15/)).toBeInTheDocument();
        });
    });
});
