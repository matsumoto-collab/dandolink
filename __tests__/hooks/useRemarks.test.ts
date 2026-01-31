import { renderHook, act } from '@testing-library/react';
import { useRemarks } from '@/hooks/useRemarks';
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

describe('useRemarks', () => {
    // Store mock functions
    const mockFetchRemarks = jest.fn();
    const mockGetRemark = jest.fn();
    const mockSetRemark = jest.fn();

    // Default store state
    const defaultStoreState = {
        remarks: {},
        remarksLoading: false,
        remarksInitialized: false,
        fetchRemarks: mockFetchRemarks,
        getRemark: mockGetRemark,
        setRemark: mockSetRemark,
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
        const { result } = renderHook(() => useRemarks());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.remarks).toEqual({});
    });

    it('should auto-fetch remarks when authenticated and not initialized', () => {
        renderHook(() => useRemarks());

        expect(mockFetchRemarks).toHaveBeenCalled();
    });

    it('should not auto-fetch when not authenticated', () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        renderHook(() => useRemarks());

        expect(mockFetchRemarks).not.toHaveBeenCalled();
    });

    it('should not auto-fetch when already initialized', () => {
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, remarksInitialized: true });
        });

        renderHook(() => useRemarks());

        expect(mockFetchRemarks).not.toHaveBeenCalled();
    });

    it('should call getRemark with correct dateKey', () => {
        const mockRemark = 'Test remark';
        mockGetRemark.mockReturnValue(mockRemark);

        const { result } = renderHook(() => useRemarks());
        const remark = result.current.getRemark('2024-01-15');

        expect(mockGetRemark).toHaveBeenCalledWith('2024-01-15');
        expect(remark).toBe(mockRemark);
    });

    it('should call setRemark with correct dateKey and text', async () => {
        const { result } = renderHook(() => useRemarks());

        await act(async () => {
            await result.current.setRemark('2024-01-15', 'New remark text');
        });

        expect(mockSetRemark).toHaveBeenCalledWith('2024-01-15', 'New remark text');
    });

    it('should call refreshRemarks and trigger fetch', async () => {
        const { result } = renderHook(() => useRemarks());

        await act(async () => {
            await result.current.refreshRemarks();
        });

        expect(mockFetchRemarks).toHaveBeenCalled();
    });

    it('should return remarks from store', () => {
        const mockRemarks = {
            '2024-01-15': 'Remark 1',
            '2024-01-16': 'Remark 2',
        };

        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, remarks: mockRemarks });
        });

        const { result } = renderHook(() => useRemarks());
        expect(result.current.remarks).toEqual(mockRemarks);
    });
});
