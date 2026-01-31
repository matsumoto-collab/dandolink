import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AssignmentProvider, useAssignments } from '@/contexts/AssignmentContext';
import { useSession } from 'next-auth/react';

// Mock dependencies
jest.mock('next-auth/react');
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

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Wrapper component
const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AssignmentProvider>{children}</AssignmentProvider>
);

describe('AssignmentContext', () => {
    const mockAssignments = [
        {
            id: 'a1',
            projectMasterId: 'pm1',
            date: '2024-01-15T00:00:00.000Z',
            assignedEmployeeId: 'e1',
            workers: ['w1', 'w2'],
            vehicles: ['v1'],
            remarks: 'Test remarks',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            sortOrder: 0,
            projectMaster: {
                id: 'pm1',
                title: 'Project 1',
                constructionType: 'assembly',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
            },
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup useSession mock
        (useSession as jest.Mock).mockReturnValue({
            status: 'authenticated',
            data: { user: { id: 'test-user' } },
        });

        // Default fetch mock
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => mockAssignments,
        });
    });

    describe('useAssignments hook', () => {
        it('should throw error when used outside provider', () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            expect(() => {
                renderHook(() => useAssignments());
            }).toThrow('useAssignments must be used within an AssignmentProvider');

            consoleSpy.mockRestore();
        });

        it('should initialize with loading state', () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            expect(result.current.isLoading).toBe(true);
            expect(result.current.error).toBeNull();
            expect(result.current.assignments).toEqual([]);
        });

        it('should fetch assignments on mount when authenticated', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/assignments');
            expect(result.current.assignments).toHaveLength(1);
        });

        it('should not fetch when not authenticated', async () => {
            (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated' });

            renderHook(() => useAssignments(), { wrapper });

            // Wait a bit to ensure no fetch happens
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should convert date strings to Date objects', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.assignments[0].date).toBeInstanceOf(Date);
            expect(result.current.assignments[0].createdAt).toBeInstanceOf(Date);
            expect(result.current.assignments[0].updatedAt).toBeInstanceOf(Date);
        });

        it('should handle fetch error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'Server error' }),
            });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.error).toBe('配置の取得に失敗しました');
        });
    });

    describe('fetchAssignments', () => {
        it('should fetch with date range parameters', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            mockFetch.mockClear();

            await act(async () => {
                await result.current.fetchAssignments('2024-01-01', '2024-01-31');
            });

            expect(mockFetch).toHaveBeenCalledWith(
                '/api/assignments?startDate=2024-01-01&endDate=2024-01-31'
            );
        });

        it('should fetch with employee filter', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            mockFetch.mockClear();

            await act(async () => {
                await result.current.fetchAssignments(undefined, undefined, 'emp-1');
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/assignments?assignedEmployeeId=emp-1');
        });
    });

    describe('createAssignment', () => {
        it('should create new assignment and add to list', async () => {
            const newAssignment = {
                id: 'a2',
                projectMasterId: 'pm2',
                date: '2024-01-20T00:00:00.000Z',
                assignedEmployeeId: 'e2',
                workers: [],
                vehicles: [],
                createdAt: '2024-01-15T00:00:00.000Z',
                updatedAt: '2024-01-15T00:00:00.000Z',
            };

            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({ ok: true, json: async () => newAssignment });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            let createdAssignment;
            await act(async () => {
                createdAssignment = await result.current.createAssignment({
                    projectMasterId: 'pm2',
                    date: new Date('2024-01-20'),
                    assignedEmployeeId: 'e2',
                    workers: [],
                    vehicles: [],
                } as any);
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/assignments', expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }));
            expect(result.current.assignments).toHaveLength(2);
        });

        it('should throw error when create fails', async () => {
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({
                    ok: false,
                    json: async () => ({ error: 'Creation failed' }),
                });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await expect(
                act(async () => {
                    await result.current.createAssignment({
                        projectMasterId: 'pm2',
                        date: new Date('2024-01-20'),
                    } as any);
                })
            ).rejects.toThrow('Creation failed');
        });
    });

    describe('updateAssignment', () => {
        it('should update assignment with optimistic update', async () => {
            const updatedAssignment = {
                ...mockAssignments[0],
                remarks: 'Updated remarks',
            };

            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({ ok: true, json: async () => updatedAssignment });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                await result.current.updateAssignment('a1', { remarks: 'Updated remarks' });
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/assignments/a1', expect.objectContaining({
                method: 'PATCH',
            }));
        });

        it('should rollback on update failure', async () => {
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({
                    ok: false,
                    json: async () => ({ error: 'Update failed' }),
                });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            const originalRemarks = result.current.assignments[0].remarks;

            await expect(
                act(async () => {
                    await result.current.updateAssignment('a1', { remarks: 'New remarks' });
                })
            ).rejects.toThrow('Update failed');

            // Should rollback to original
            expect(result.current.assignments[0].remarks).toBe(originalRemarks);
        });
    });

    describe('deleteAssignment', () => {
        it('should delete assignment and remove from list', async () => {
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.assignments).toHaveLength(1);

            await act(async () => {
                await result.current.deleteAssignment('a1');
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/assignments/a1', { method: 'DELETE' });
            expect(result.current.assignments).toHaveLength(0);
        });

        it('should throw error when delete fails', async () => {
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({
                    ok: false,
                    json: async () => ({ error: 'Delete failed' }),
                });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await expect(
                act(async () => {
                    await result.current.deleteAssignment('a1');
                })
            ).rejects.toThrow('Delete failed');
        });
    });

    describe('getAssignmentById', () => {
        it('should return assignment by id', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            const assignment = result.current.getAssignmentById('a1');
            expect(assignment).toBeDefined();
            expect(assignment?.id).toBe('a1');
        });

        it('should return undefined for non-existent id', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            const assignment = result.current.getAssignmentById('non-existent');
            expect(assignment).toBeUndefined();
        });
    });

    describe('getCalendarEvents', () => {
        it('should convert assignments to calendar events', async () => {
            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            const events = result.current.getCalendarEvents();

            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({
                id: 'a1',
                title: 'Project 1',
                category: 'construction',
                constructionType: 'assembly',
                workers: ['w1', 'w2'],
                trucks: ['v1'],
            });
        });

        it('should handle missing projectMaster', async () => {
            const assignmentWithoutMaster = [{
                ...mockAssignments[0],
                projectMaster: undefined,
            }];

            mockFetch.mockResolvedValue({
                ok: true,
                json: async () => assignmentWithoutMaster,
            });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            const events = result.current.getCalendarEvents();
            expect(events[0].title).toBe('不明な案件');
        });
    });

    describe('updateAssignments (batch)', () => {
        it('should batch update multiple assignments', async () => {
            mockFetch
                .mockResolvedValueOnce({ ok: true, json: async () => mockAssignments })
                .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

            const { result } = renderHook(() => useAssignments(), { wrapper });

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            await act(async () => {
                await result.current.updateAssignments([
                    { id: 'a1', data: { sortOrder: 1 } },
                ]);
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/assignments/batch', expect.objectContaining({
                method: 'POST',
            }));
        });
    });
});
