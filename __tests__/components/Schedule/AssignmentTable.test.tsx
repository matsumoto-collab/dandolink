/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssignmentTable from '@/components/Schedule/AssignmentTable';
import { useProjects } from '@/hooks/useProjects';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';

// Mock hooks
jest.mock('@/hooks/useProjects');
jest.mock('@/hooks/useCalendarDisplay');

// Mock icons
jest.mock('lucide-react', () => ({
    ChevronLeft: () => <span data-testid="icon-left" />,
    ChevronRight: () => <span data-testid="icon-right" />,
    Clock: () => <span data-testid="icon-clock" />,
    MapPin: () => <span data-testid="icon-mappin" />,
    Users: () => <span data-testid="icon-users" />,
    Truck: () => <span data-testid="icon-truck" />,
    CheckCircle: () => <span data-testid="icon-check" />,
}));

// Mock employeeUtils
jest.mock('@/utils/employeeUtils', () => ({
    formatDateKey: (date: Date) => {
        const d = new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },
}));

describe('AssignmentTable', () => {
    // Calculate tomorrow's date for consistent testing
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    void `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const mockProjects = [
        {
            id: 'p1',
            title: '現場A',
            customer: '顧客X',
            startDate: tomorrow,
            endDate: tomorrow,
            assignedEmployeeId: 'f1',
            workers: ['w1', 'w2'],
            trucks: ['t1'],
            sortOrder: 0,
            remarks: 'テスト備考',
            meetingTime: '08:00',
            location: '東京都新宿区',
        },
        {
            id: 'p2',
            title: '現場B',
            customer: '顧客Y',
            startDate: tomorrow,
            endDate: tomorrow,
            assignedEmployeeId: 'f2',
            workers: [],
            trucks: [],
            sortOrder: 0,
        },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        (useProjects as jest.Mock).mockReturnValue({
            projects: mockProjects,
        });

        (useCalendarDisplay as jest.Mock).mockReturnValue({
            displayedForemanIds: ['f1', 'f2'],
            allForemen: [
                { id: 'f1', displayName: '職長A' },
                { id: 'f2', displayName: '職長B' },
            ],
        });

        // Mock fetch for worker/vehicle names
        global.fetch = jest.fn((url: string) => {
            if (url.includes('/api/dispatch/workers')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([
                        { id: 'w1', displayName: 'ワーカー1' },
                        { id: 'w2', displayName: 'ワーカー2' },
                    ]),
                });
            }
            if (url.includes('/api/master-data')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        vehicles: [{ id: 't1', name: '2tトラック' }],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }) as jest.Mock;
    });

    it('should render date header', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            // Should show formatted tomorrow date
            const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
            const expectedWeekDay = weekDays[tomorrow.getDay()];
            expect(screen.getByText(new RegExp(expectedWeekDay))).toBeInTheDocument();
        });
    });

    it('should render foreman groups', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('職長A 班')).toBeInTheDocument();
            expect(screen.getByText('職長B 班')).toBeInTheDocument();
        });
    });

    it('should render project titles in foreman groups', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('現場A')).toBeInTheDocument();
            expect(screen.getByText('現場B')).toBeInTheDocument();
        });
    });

    it('should render customer names', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('顧客X')).toBeInTheDocument();
        });
    });

    it('should render meeting time and location', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('08:00')).toBeInTheDocument();
            expect(screen.getByText('東京都新宿区')).toBeInTheDocument();
        });
    });

    it('should show member and truck count', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('2名')).toBeInTheDocument();
            expect(screen.getByText('1台')).toBeInTheDocument();
        });
    });

    it('should render remarks', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('テスト備考')).toBeInTheDocument();
        });
    });

    it('should navigate to previous day', async () => {
        render(<AssignmentTable />);

        await waitFor(() => {
            expect(screen.getByText('職長A 班')).toBeInTheDocument();
        });

        // Click previous day button (ChevronLeft)
        const prevButtons = screen.getAllByTestId('icon-left');
        fireEvent.click(prevButtons[0].closest('button')!);

        // Date should change (projects may not match the new date)
    });

    it('should show "明日に戻る" button', () => {
        render(<AssignmentTable />);
        expect(screen.getByText('明日に戻る')).toBeInTheDocument();
    });

    it('should show edit button for admin role', async () => {
        render(<AssignmentTable userRole="admin" />);

        await waitFor(() => {
            expect(screen.getAllByText('編集').length).toBeGreaterThan(0);
        });
    });

    it('should show worker view for worker role', async () => {
        // Worker needs userTeamId and matching confirmedWorkerIds
        const workerProjects = [{
            ...mockProjects[0],
            confirmedWorkerIds: ['worker1'],
        }];
        (useProjects as jest.Mock).mockReturnValue({ projects: workerProjects });

        render(<AssignmentTable userRole="worker" userTeamId="worker1" />);

        await waitFor(() => {
            expect(screen.getByText('あなたの担当現場')).toBeInTheDocument();
        });
    });

    it('should show empty state for worker with no assignments', async () => {
        (useProjects as jest.Mock).mockReturnValue({ projects: [] });

        render(<AssignmentTable userRole="worker" userTeamId="worker1" />);

        await waitFor(() => {
            expect(screen.getByText('担当現場なし')).toBeInTheDocument();
        });
    });

    it('should show empty state for foreman with no projects', async () => {
        (useProjects as jest.Mock).mockReturnValue({ projects: [] });

        render(<AssignmentTable />);

        await waitFor(() => {
            const emptyMessages = screen.getAllByText('予定なし');
            expect(emptyMessages.length).toBeGreaterThan(0);
        });
    });
});
