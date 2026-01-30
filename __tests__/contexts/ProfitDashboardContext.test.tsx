import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ProfitDashboardProvider, useProfitDashboard } from '@/contexts/ProfitDashboardContext';

// Mock next-auth
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({ status: 'authenticated' })),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockProjects = [
    {
        id: '1',
        title: 'Project A',
        customerName: 'Customer A',
        status: 'active',
        assignmentCount: 5,
        estimateAmount: 100000,
        revenue: 100000,
        laborCost: 30000,
        loadingCost: 5000,
        vehicleCost: 10000,
        materialCost: 20000,
        subcontractorCost: 10000,
        otherExpenses: 5000,
        totalCost: 80000,
        grossProfit: 20000,
        profitMargin: 20,
        updatedAt: '2026-01-15',
    },
    {
        id: '2',
        title: 'Project B',
        customerName: 'Customer B',
        status: 'completed',
        assignmentCount: 3,
        estimateAmount: 50000,
        revenue: 50000,
        laborCost: 15000,
        loadingCost: 2500,
        vehicleCost: 5000,
        materialCost: 10000,
        subcontractorCost: 5000,
        otherExpenses: 2500,
        totalCost: 40000,
        grossProfit: 10000,
        profitMargin: 20,
        updatedAt: '2026-01-10',
    },
];

// Test component to access context
function TestComponent({ onData }: { onData?: (data: ReturnType<typeof useProfitDashboard>) => void }) {
    const contextData = useProfitDashboard();

    React.useEffect(() => {
        if (onData) {
            onData(contextData);
        }
    }, [contextData, onData]);

    return (
        <div>
            <span data-testid="loading">{contextData.isLoading.toString()}</span>
            <span data-testid="initialized">{contextData.isInitialLoaded.toString()}</span>
            <span data-testid="project-count">{contextData.projects.length}</span>
            <button onClick={contextData.refreshData}>Refresh</button>
        </div>
    );
}

describe('ProfitDashboardContext', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ projects: mockProjects }),
        });
    });

    describe('ProfitDashboardProvider', () => {
        it('should fetch data on mount when authenticated', async () => {
            render(
                <ProfitDashboardProvider>
                    <TestComponent />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledWith('/api/profit-dashboard?mode=full');
            });
        });

        it('should set projects after successful fetch', async () => {
            render(
                <ProfitDashboardProvider>
                    <TestComponent />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('project-count')).toHaveTextContent('2');
            });
        });

        it('should handle fetch error gracefully', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            render(
                <ProfitDashboardProvider>
                    <TestComponent />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalled();
            });

            consoleSpy.mockRestore();
        });

        it('should handle non-ok response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
            });

            render(
                <ProfitDashboardProvider>
                    <TestComponent />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(screen.getByTestId('project-count')).toHaveTextContent('0');
            });
        });
    });

    describe('getFilteredData', () => {
        it('should return all projects when status is "all"', async () => {
            let capturedData: ReturnType<typeof useProfitDashboard> | null = null;

            render(
                <ProfitDashboardProvider>
                    <TestComponent onData={(data) => { capturedData = data; }} />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(capturedData?.projects.length).toBe(2);
            });

            const result = capturedData!.getFilteredData('all');
            expect(result.projects.length).toBe(2);
            expect(result.summary.totalProjects).toBe(2);
        });

        it('should filter projects by status', async () => {
            let capturedData: ReturnType<typeof useProfitDashboard> | null = null;

            render(
                <ProfitDashboardProvider>
                    <TestComponent onData={(data) => { capturedData = data; }} />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(capturedData?.projects.length).toBe(2);
            });

            const result = capturedData!.getFilteredData('active');
            expect(result.projects.length).toBe(1);
            expect(result.projects[0].title).toBe('Project A');
        });

        it('should calculate summary correctly', async () => {
            let capturedData: ReturnType<typeof useProfitDashboard> | null = null;

            render(
                <ProfitDashboardProvider>
                    <TestComponent onData={(data) => { capturedData = data; }} />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(capturedData?.projects.length).toBe(2);
            });

            const result = capturedData!.getFilteredData('all');
            expect(result.summary.totalRevenue).toBe(150000);
            expect(result.summary.totalCost).toBe(120000);
            expect(result.summary.totalGrossProfit).toBe(30000);
        });

        it('should return zero averageProfitMargin for empty filtered list', async () => {
            let capturedData: ReturnType<typeof useProfitDashboard> | null = null;

            render(
                <ProfitDashboardProvider>
                    <TestComponent onData={(data) => { capturedData = data; }} />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(capturedData?.projects.length).toBe(2);
            });

            const result = capturedData!.getFilteredData('cancelled');
            expect(result.summary.averageProfitMargin).toBe(0);
        });
    });

    describe('useProfitDashboard', () => {
        it('should throw error when used outside provider', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            expect(() => {
                render(<TestComponent />);
            }).toThrow('useProfitDashboard must be used within ProfitDashboardProvider');

            consoleSpy.mockRestore();
        });
    });

    describe('refreshData', () => {
        it('should refetch data when called', async () => {
            render(
                <ProfitDashboardProvider>
                    <TestComponent />
                </ProfitDashboardProvider>
            );

            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledTimes(1);
            });

            act(() => {
                screen.getByText('Refresh').click();
            });

            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledTimes(2);
            });
        });
    });
});
