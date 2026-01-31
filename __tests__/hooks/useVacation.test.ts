import { renderHook, act } from '@testing-library/react';
import { useVacation } from '@/hooks/useVacation';
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

describe('useVacation', () => {
    // Store mock functions
    const mockFetchVacations = jest.fn();
    const mockGetVacationEmployees = jest.fn();
    const mockSetVacationEmployees = jest.fn();
    const mockAddVacationEmployee = jest.fn();
    const mockRemoveVacationEmployee = jest.fn();
    const mockGetVacationRemarks = jest.fn();
    const mockSetVacationRemarks = jest.fn();

    // Default store state
    const defaultStoreState = {
        vacations: [],
        vacationsLoading: false,
        vacationsInitialized: false,
        fetchVacations: mockFetchVacations,
        getVacationEmployees: mockGetVacationEmployees,
        setVacationEmployees: mockSetVacationEmployees,
        addVacationEmployee: mockAddVacationEmployee,
        removeVacationEmployee: mockRemoveVacationEmployee,
        getVacationRemarks: mockGetVacationRemarks,
        setVacationRemarks: mockSetVacationRemarks,
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
        const { result } = renderHook(() => useVacation());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.vacations).toEqual([]);
    });

    it('should auto-fetch vacations when authenticated and not initialized', () => {
        renderHook(() => useVacation());

        expect(mockFetchVacations).toHaveBeenCalled();
    });

    it('should not auto-fetch when not authenticated', () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

        renderHook(() => useVacation());

        expect(mockFetchVacations).not.toHaveBeenCalled();
    });

    it('should not auto-fetch when already initialized', () => {
        (useCalendarStore as unknown as jest.Mock).mockImplementation((selector: any) => {
            return selector({ ...defaultStoreState, vacationsInitialized: true });
        });

        renderHook(() => useVacation());

        expect(mockFetchVacations).not.toHaveBeenCalled();
    });

    it('should call getVacationEmployees with correct dateKey', () => {
        const mockEmployees = ['emp-1', 'emp-2'];
        mockGetVacationEmployees.mockReturnValue(mockEmployees);

        const { result } = renderHook(() => useVacation());
        const employees = result.current.getVacationEmployees('2024-01-15');

        expect(mockGetVacationEmployees).toHaveBeenCalledWith('2024-01-15');
        expect(employees).toEqual(mockEmployees);
    });

    it('should call setVacationEmployees with correct dateKey and employeeIds', async () => {
        const { result } = renderHook(() => useVacation());

        await act(async () => {
            await result.current.setVacationEmployees('2024-01-15', ['emp-1', 'emp-2']);
        });

        expect(mockSetVacationEmployees).toHaveBeenCalledWith('2024-01-15', ['emp-1', 'emp-2']);
    });

    it('should call addVacationEmployee with correct dateKey and employeeId', async () => {
        const { result } = renderHook(() => useVacation());

        await act(async () => {
            await result.current.addVacationEmployee('2024-01-15', 'emp-1');
        });

        expect(mockAddVacationEmployee).toHaveBeenCalledWith('2024-01-15', 'emp-1');
    });

    it('should call removeVacationEmployee with correct dateKey and employeeId', async () => {
        const { result } = renderHook(() => useVacation());

        await act(async () => {
            await result.current.removeVacationEmployee('2024-01-15', 'emp-1');
        });

        expect(mockRemoveVacationEmployee).toHaveBeenCalledWith('2024-01-15', 'emp-1');
    });

    it('should call getRemarks with correct dateKey', () => {
        const mockRemarks = 'Test remarks';
        mockGetVacationRemarks.mockReturnValue(mockRemarks);

        const { result } = renderHook(() => useVacation());
        const remarks = result.current.getRemarks('2024-01-15');

        expect(mockGetVacationRemarks).toHaveBeenCalledWith('2024-01-15');
        expect(remarks).toBe(mockRemarks);
    });

    it('should call setRemarks with correct dateKey and remarks', async () => {
        const { result } = renderHook(() => useVacation());

        await act(async () => {
            await result.current.setRemarks('2024-01-15', 'New remarks');
        });

        expect(mockSetVacationRemarks).toHaveBeenCalledWith('2024-01-15', 'New remarks');
    });

    it('should call refreshVacations and trigger fetch', async () => {
        const { result } = renderHook(() => useVacation());

        await act(async () => {
            await result.current.refreshVacations();
        });

        expect(mockFetchVacations).toHaveBeenCalled();
    });
});
