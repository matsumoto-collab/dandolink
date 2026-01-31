import { renderHook, act } from '@testing-library/react';
import { useDailyReports } from '@/hooks/useDailyReports';
import { useCalendarStore } from '@/stores/calendarStore';
import { useSession } from 'next-auth/react';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/stores/calendarStore');
jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
            unsubscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
    },
}));

describe('useDailyReports', () => {
    // Store mock functions
    const mockFetchDailyReports = jest.fn();
    const mockGetDailyReportByForemanAndDate = jest.fn();
    const mockSaveDailyReport = jest.fn();
    const mockDeleteDailyReport = jest.fn();

    // Default store state
    const defaultStoreState = {
        dailyReports: [],
        dailyReportsLoading: false,
        dailyReportsInitialized: false,
        fetchDailyReports: mockFetchDailyReports,
        getDailyReportByForemanAndDate: mockGetDailyReportByForemanAndDate,
        saveDailyReport: mockSaveDailyReport,
        deleteDailyReport: mockDeleteDailyReport,
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup useSession mock
        (useSession as jest.Mock).mockReturnValue({ status: 'authenticated', data: { user: { id: 'test-user' } } });

        // Setup useCalendarStore mock
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector(defaultStoreState);
        });
    });

    it('should initialize and return state from store', () => {
        const { result } = renderHook(() => useDailyReports());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialLoaded).toBe(false);
        expect(result.current.dailyReports).toEqual([]);
    });

    it('should auto-fetch daily reports when authenticated and not initialized', () => {
        renderHook(() => useDailyReports());

        // Should fetch past 30 days automatically
        expect(mockFetchDailyReports).toHaveBeenCalledWith(
            expect.objectContaining({
                startDate: expect.any(String),
                endDate: expect.any(String),
            })
        );
    });

    it('should not auto-fetch when not authenticated', () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        renderHook(() => useDailyReports());

        expect(mockFetchDailyReports).not.toHaveBeenCalled();
    });

    it('should not auto-fetch when already initialized', () => {
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, dailyReportsInitialized: true });
        });

        renderHook(() => useDailyReports());

        expect(mockFetchDailyReports).not.toHaveBeenCalled();
    });

    it('should call fetchDailyReports with custom params', async () => {
        const { result } = renderHook(() => useDailyReports());

        await act(async () => {
            await result.current.fetchDailyReports({
                foremanId: 'foreman-1',
                date: '2024-01-15',
            });
        });

        expect(mockFetchDailyReports).toHaveBeenCalledWith({
            foremanId: 'foreman-1',
            date: '2024-01-15',
        });
    });

    it('should call getDailyReportByForemanAndDate correctly', () => {
        const mockReport = { id: '1', foremanId: 'f1', date: '2024-01-15' };
        mockGetDailyReportByForemanAndDate.mockReturnValue(mockReport);

        const { result } = renderHook(() => useDailyReports());
        const report = result.current.getDailyReportByForemanAndDate('f1', '2024-01-15');

        expect(mockGetDailyReportByForemanAndDate).toHaveBeenCalledWith('f1', '2024-01-15');
        expect(report).toEqual(mockReport);
    });

    it('should call saveDailyReport with correct data and return result', async () => {
        const savedReport = { id: '1', foremanId: 'f1' };
        mockSaveDailyReport.mockResolvedValue(savedReport);

        const { result } = renderHook(() => useDailyReports());
        const reportInput = { foremanId: 'f1', date: '2024-01-15', workItems: [] };

        let returnedReport;
        await act(async () => {
            returnedReport = await result.current.saveDailyReport(reportInput as any);
        });

        expect(mockSaveDailyReport).toHaveBeenCalledWith(reportInput);
        expect(returnedReport).toEqual(savedReport);
    });

    it('should call deleteDailyReport with correct id', async () => {
        const { result } = renderHook(() => useDailyReports());

        await act(async () => {
            await result.current.deleteDailyReport('report-1');
        });

        expect(mockDeleteDailyReport).toHaveBeenCalledWith('report-1');
    });

    it('should return daily reports from store', () => {
        const mockReports = [
            { id: '1', foremanId: 'f1', date: '2024-01-15' },
            { id: '2', foremanId: 'f2', date: '2024-01-16' },
        ];

        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, dailyReports: mockReports });
        });

        const { result } = renderHook(() => useDailyReports());
        expect(result.current.dailyReports).toEqual(mockReports);
    });
});
