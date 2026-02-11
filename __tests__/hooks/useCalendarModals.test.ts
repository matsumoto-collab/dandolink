/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useCalendarModals } from '@/hooks/useCalendarModals';
import { Project, CalendarEvent, ProjectMaster } from '@/types/calendar';

describe('useCalendarModals', () => {
    const mockProjects: Project[] = [
        {
            id: 'p1',
            title: 'Project 1',
            startDate: new Date('2023-01-01'),
            endDate: new Date('2023-01-01'),
            assignedEmployeeId: 'emp1',
            constructionType: 'assembly',
            status: 'pending',
            category: 'construction',
            projectMasterId: 'pm1',
            customer: 'Customer 1',
            location: 'Location 1',
            createdAt: new Date(),
            updatedAt: new Date(),
            color: '#000000',
        } as Project
    ];

    const mockEvents: CalendarEvent[] = [
        {
            id: 'p1-assembly',
            title: 'Project 1',
            startDate: new Date('2023-01-01'),
            endDate: new Date('2023-01-01'),
            assignedEmployeeId: 'emp1',
            color: '#000000',
            sortOrder: 0,
        } as CalendarEvent
    ];

    const mockAddProject = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize with all modals closed', () => {
        const { result } = renderHook(() =>
            useCalendarModals(mockProjects, mockEvents, mockAddProject)
        );

        expect(result.current.isModalOpen).toBe(false);
        expect(result.current.isSearchModalOpen).toBe(false);
        expect(result.current.isDispatchModalOpen).toBe(false);
        expect(result.current.isCopyModalOpen).toBe(false);
        expect(result.current.isSelectionModalOpen).toBe(false);
        expect(result.current.modalInitialData).toEqual({});
    });

    describe('Project Modal', () => {
        it('should open modal with project data on event click', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleEventClick('p1-assembly');
            });

            expect(result.current.isModalOpen).toBe(true);
            expect(result.current.modalInitialData).toEqual(mockProjects[0]);
        });

        it('should close modal and reset data', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.setIsModalOpen(true);
                result.current.setModalInitialData({ title: 'Test' });
            });

            act(() => {
                result.current.handleCloseModal();
            });

            expect(result.current.isModalOpen).toBe(false);
            expect(result.current.modalInitialData).toEqual({});
        });
    });

    describe('Selection Modal & Search Modal', () => {
        it('should open selection modal on cell click', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );
            const date = new Date('2023-01-01');

            act(() => {
                result.current.handleCellClick('user1', date);
            });

            expect(result.current.isSelectionModalOpen).toBe(true);
            expect(result.current.cellContext).toEqual({ employeeId: 'user1', date });
        });

        it('should switch to search modal when selecting existing', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleSelectExisting();
            });

            expect(result.current.isSelectionModalOpen).toBe(false);
            expect(result.current.isSearchModalOpen).toBe(true);
        });

        it('should open create modal directly when selecting new', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );
            const date = new Date('2023-01-01');

            act(() => {
                result.current.handleCellClick('user1', date);
            });

            act(() => {
                result.current.handleCreateNew();
            });

            expect(result.current.isSelectionModalOpen).toBe(false);
            expect(result.current.isModalOpen).toBe(true);
            expect(result.current.modalInitialData.startDate).toEqual(date);
            expect(result.current.modalInitialData.assignedEmployeeId).toBe('user1');
        });

        it('should populate modal with project master data on selection', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );
            const date = new Date('2023-01-01');
            const mockMaster: ProjectMaster = {
                id: 'pm1',
                title: 'Master Project',
                customerName: 'Customer A',
                location: 'Location A',
                constructionType: 'assembly',
                constructionContent: 'other' as const,
                remarks: 'Remarks A',
                createdBy: 'User A',
                status: 'active',
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            act(() => {
                result.current.handleCellClick('user1', date);
            });

            act(() => {
                result.current.handleSelectProjectMaster(mockMaster);
            });

            expect(result.current.isSearchModalOpen).toBe(false);
            expect(result.current.isModalOpen).toBe(true);
            expect(result.current.modalInitialData).toMatchObject({
                title: 'Master Project',
                customer: 'Customer A',
                projectMasterId: 'pm1',
                startDate: date,
                assignedEmployeeId: 'user1'
            });
        });
    });

    describe('Dispatch Modal', () => {
        it('should open dispatch modal with project data', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleOpenDispatchModal('p1');
            });

            expect(result.current.isDispatchModalOpen).toBe(true);
            expect(result.current.dispatchProject).toEqual(mockProjects[0]);
        });

        it('should close dispatch modal and reset data', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleOpenDispatchModal('p1');
            });

            act(() => {
                result.current.handleCloseDispatchModal();
            });

            expect(result.current.isDispatchModalOpen).toBe(false);
            expect(result.current.dispatchProject).toBeNull();
        });
    });

    describe('Copy Modal', () => {
        it('should open copy modal with event data', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCopyEvent('p1-assembly');
            });

            expect(result.current.isCopyModalOpen).toBe(true);
            expect(result.current.copyEvent).toEqual(mockEvents[0]);
        });

        it('should execute copy assignment logic', async () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCopyEvent('p1-assembly');
            });

            const startDate = new Date('2023-01-02');
            const endDate = new Date('2023-01-03');

            await act(async () => {
                await result.current.handleCopyAssignment(startDate, endDate, 'user2');
            });

            expect(mockAddProject).toHaveBeenCalledTimes(2);
            // Verify first call
            expect(mockAddProject).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Project 1',
                startDate: new Date('2023-01-02'),
                assignedEmployeeId: 'user2',
                sortOrder: 0
            }));
            // Verify second call
            expect(mockAddProject).toHaveBeenCalledWith(expect.objectContaining({
                title: 'Project 1',
                startDate: new Date('2023-01-03'),
                assignedEmployeeId: 'user2',
                sortOrder: 0
            }));
        });
    });

    describe('Edge Cases (Branch Coverage)', () => {
        it('handleEventClick: 存在しないイベントIDでモーダルが開かない', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleEventClick('nonexistent-id');
            });

            expect(result.current.isModalOpen).toBe(false);
        });

        it('handleOpenDispatchModal: 存在しないIDで手配モーダルが開かない', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleOpenDispatchModal('nonexistent-id');
            });

            expect(result.current.isDispatchModalOpen).toBe(false);
        });

        it('handleCopyEvent: 存在しないIDでコピーモーダルが開かない', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCopyEvent('nonexistent-id');
            });

            expect(result.current.isCopyModalOpen).toBe(false);
        });

        it('handleCreateNew: cellContext が null の場合は何もしない', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCreateNew();
            });

            expect(result.current.isModalOpen).toBe(false);
        });

        it('handleSelectProjectMaster: cellContext が null の場合は何もしない', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            const mockMaster = {
                id: 'pm1',
                title: 'Master',
                customerName: 'Customer',
                location: 'Location',
                constructionType: 'assembly',
                constructionContent: undefined,
                remarks: '',
                createdBy: 'User',
                createdAt: new Date(),
                updatedAt: new Date(),
            } as ProjectMaster;

            act(() => {
                result.current.handleSelectProjectMaster(mockMaster);
            });

            expect(result.current.isModalOpen).toBe(false);
        });

        it('handleCopyAssignment: copyEvent が null の場合は何もしない', async () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            await act(async () => {
                await result.current.handleCopyAssignment(
                    new Date('2023-01-02'),
                    new Date('2023-01-03'),
                    'user2'
                );
            });

            expect(mockAddProject).not.toHaveBeenCalled();
        });

        it('handleCloseSearchModal: 検索モーダルを閉じて cellContext をリセット', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCellClick('user1', new Date('2023-01-01'));
            });
            act(() => {
                result.current.handleSelectExisting();
            });
            expect(result.current.isSearchModalOpen).toBe(true);

            act(() => {
                result.current.handleCloseSearchModal();
            });

            expect(result.current.isSearchModalOpen).toBe(false);
            expect(result.current.cellContext).toBeNull();
        });

        it('handleSelectionCancel: 選択モーダルを閉じて cellContext をリセット', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCellClick('user1', new Date('2023-01-01'));
            });
            expect(result.current.isSelectionModalOpen).toBe(true);

            act(() => {
                result.current.handleSelectionCancel();
            });

            expect(result.current.isSelectionModalOpen).toBe(false);
            expect(result.current.cellContext).toBeNull();
        });

        it('handleCloseCopyModal: コピーモーダルを閉じて copyEvent をリセット', () => {
            const { result } = renderHook(() =>
                useCalendarModals(mockProjects, mockEvents, mockAddProject)
            );

            act(() => {
                result.current.handleCopyEvent('p1-assembly');
            });
            expect(result.current.isCopyModalOpen).toBe(true);

            act(() => {
                result.current.handleCloseCopyModal();
            });

            expect(result.current.isCopyModalOpen).toBe(false);
            expect(result.current.copyEvent).toBeNull();
        });
    });
});
