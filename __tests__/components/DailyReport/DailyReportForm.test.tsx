/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DailyReportForm from '@/components/DailyReport/DailyReportForm';
import { useSession } from 'next-auth/react';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useProjects } from '@/hooks/useProjects';

// Mock hooks
jest.mock('next-auth/react');
jest.mock('@/hooks/useDailyReports');
jest.mock('@/hooks/useProjects');

// Mock icons
jest.mock('lucide-react', () => ({
    Clock: () => <span data-testid="icon-clock" />,
    Save: () => <span data-testid="icon-save" />,
    Loader2: () => <span data-testid="icon-loader" />,
    FileText: () => <span data-testid="icon-filetext" />,
    Truck: () => <span data-testid="icon-truck" />,
    AlertCircle: () => <span data-testid="icon-alert" />,
}));

describe('DailyReportForm', () => {
    const mockDate = new Date('2024-06-15');
    const mockOnSaved = jest.fn();
    const mockSaveDailyReport = jest.fn().mockResolvedValue({});
    const mockFetchDailyReports = jest.fn().mockResolvedValue(undefined);
    const mockGetDailyReportByForemanAndDate = jest.fn().mockReturnValue(null);

    const dateStr = '2024-06-15';
    const mockProjects = [
        {
            id: 'a1',
            title: '現場A',
            customer: '顧客X',
            startDate: new Date('2024-06-15'),
            assignedEmployeeId: 'user1',
        },
        {
            id: 'a2',
            title: '現場B',
            customer: '顧客Y',
            startDate: new Date('2024-06-15'),
            assignedEmployeeId: 'user1',
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        (useSession as jest.Mock).mockReturnValue({
            data: { user: { id: 'user1', name: 'テストユーザー' } },
        });

        (useDailyReports as jest.Mock).mockReturnValue({
            saveDailyReport: mockSaveDailyReport,
            getDailyReportByForemanAndDate: mockGetDailyReportByForemanAndDate,
            fetchDailyReports: mockFetchDailyReports,
        });

        (useProjects as jest.Mock).mockReturnValue({
            projects: mockProjects,
        });
    });

    it('should show login message when no session', () => {
        (useSession as jest.Mock).mockReturnValue({ data: null });

        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('ログインしてください')).toBeInTheDocument();
    });

    it('should render header with title and date', () => {
        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('日報入力')).toBeInTheDocument();
    });

    it('should render save button', () => {
        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('保存')).toBeInTheDocument();
    });

    it('should render work time section for assignments', () => {
        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('作業時間')).toBeInTheDocument();
        expect(screen.getByText('現場A')).toBeInTheDocument();
        expect(screen.getByText('現場B')).toBeInTheDocument();
    });

    it('should show no assignments message when empty', () => {
        (useProjects as jest.Mock).mockReturnValue({ projects: [] });

        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('この日の配置はありません')).toBeInTheDocument();
    });

    it('should render loading sections', () => {
        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('積込時間')).toBeInTheDocument();
        expect(screen.getByText('朝積込')).toBeInTheDocument();
        expect(screen.getByText('夕積込')).toBeInTheDocument();
    });

    it('should render overtime sections', () => {
        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('早出・残業')).toBeInTheDocument();
        expect(screen.getByText('早出')).toBeInTheDocument();
        expect(screen.getByText('残業')).toBeInTheDocument();
    });

    it('should render notes textarea', () => {
        render(<DailyReportForm date={mockDate} />);
        expect(screen.getByText('備考')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('備考があれば入力...')).toBeInTheDocument();
    });

    it('should call saveDailyReport on save button click', async () => {
        render(<DailyReportForm date={mockDate} onSaved={mockOnSaved} />);

        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => {
            expect(mockSaveDailyReport).toHaveBeenCalledWith(
                expect.objectContaining({
                    foremanId: 'user1',
                    date: dateStr,
                })
            );
        });
    });

    it('should show success message after save', async () => {
        render(<DailyReportForm date={mockDate} onSaved={mockOnSaved} />);

        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => {
            expect(screen.getByText('日報を保存しました')).toBeInTheDocument();
        });
        expect(mockOnSaved).toHaveBeenCalled();
    });

    it('should show error message on save failure', async () => {
        mockSaveDailyReport.mockRejectedValueOnce(new Error('save failed'));

        render(<DailyReportForm date={mockDate} />);

        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => {
            expect(screen.getByText('保存に失敗しました')).toBeInTheDocument();
        });
    });

    it('should use foremanId prop over session user id', () => {
        render(<DailyReportForm date={mockDate} foremanId="foreman1" />);

        // With foremanId='foreman1', projects with assignedEmployeeId='user1' won't match
        expect(screen.getByText('この日の配置はありません')).toBeInTheDocument();
    });
});
