import { renderHook, act, waitFor } from '@testing-library/react';
import { useCustomerSearch } from '@/hooks/useCustomerSearch';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('useCustomerSearch', () => {
    const mockCustomers = [
        { id: '1', name: 'Customer One', shortName: 'C1' },
        { id: '2', name: 'Customer Two', shortName: 'C2' },
        { id: '3', name: 'Another Customer', shortName: null },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => mockCustomers,
        });
    });

    it('should initialize with empty state and loading true', () => {
        const { result } = renderHook(() => useCustomerSearch());

        expect(result.current.customers).toEqual([]);
        expect(result.current.searchTerm).toBe('');
        expect(result.current.showDropdown).toBe(false);
        expect(result.current.isLoading).toBe(true);
    });

    it('should fetch customers on mount', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(mockFetch).toHaveBeenCalledWith('/api/customers');
        expect(result.current.customers).toEqual(mockCustomers);
    });

    it('should handle fetch error gracefully', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        mockFetch.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.customers).toEqual([]);
        expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch customers:', expect.any(Error));

        consoleSpy.mockRestore();
    });

    it('should handle non-ok response', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            json: async () => ({ error: 'Server error' }),
        });

        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.customers).toEqual([]);
    });

    it('should filter customers by name', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.setSearchTerm('one');
        });

        expect(result.current.filteredCustomers).toHaveLength(1);
        expect(result.current.filteredCustomers[0].name).toBe('Customer One');
    });

    it('should filter customers by shortName', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.setSearchTerm('C2');
        });

        expect(result.current.filteredCustomers).toHaveLength(1);
        expect(result.current.filteredCustomers[0].name).toBe('Customer Two');
    });

    it('should be case insensitive', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.setSearchTerm('CUSTOMER');
        });

        expect(result.current.filteredCustomers).toHaveLength(3);
    });

    it('should return all customers when search term is empty', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.filteredCustomers).toHaveLength(3);
    });

    it('should update showDropdown state', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.setShowDropdown(true);
        });

        expect(result.current.showDropdown).toBe(true);

        act(() => {
            result.current.setShowDropdown(false);
        });

        expect(result.current.showDropdown).toBe(false);
    });

    it('should handle null shortName in filtering', async () => {
        const { result } = renderHook(() => useCustomerSearch());

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        act(() => {
            result.current.setSearchTerm('Another');
        });

        expect(result.current.filteredCustomers).toHaveLength(1);
        expect(result.current.filteredCustomers[0].name).toBe('Another Customer');
    });
});
