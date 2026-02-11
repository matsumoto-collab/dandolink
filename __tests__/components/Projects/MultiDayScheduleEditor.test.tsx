/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MultiDayScheduleEditor from '@/components/Projects/MultiDayScheduleEditor';
import toast from 'react-hot-toast';
import { DailySchedule } from '@/types/calendar';

// Mock toast
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        error: jest.fn(),
    },
}));

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    X: () => <span data-testid="icon-x" />,
}));

describe('MultiDayScheduleEditor', () => {
    const mockOnChange = jest.fn();
    const mockForemen = [
        { id: 'f1', displayName: '職長A' },
        { id: 'f2', displayName: '職長B' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should render mode toggle buttons', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        expect(screen.getByText('期間指定')).toBeInTheDocument();
        expect(screen.getByText('個別選択')).toBeInTheDocument();
    });

    it('should show range fields in range mode', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
                foremen={mockForemen}
            />
        );
        expect(screen.getByText('開始日')).toBeInTheDocument();
        expect(screen.getByText('終了日')).toBeInTheDocument();
        expect(screen.getByText('期間を生成')).toBeInTheDocument();
        expect(screen.getByText('平日のみ生成')).toBeInTheDocument();
    });

    it('should switch to individual mode', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        fireEvent.click(screen.getByText('個別選択'));
        expect(screen.getByText('日程を追加')).toBeInTheDocument();
        // Range fields should not be visible
        expect(screen.queryByText('期間を生成')).not.toBeInTheDocument();
    });

    it('should show error when generating without dates', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        fireEvent.click(screen.getByText('期間を生成'));
        expect(toast.error).toHaveBeenCalledWith('開始日と終了日を入力してください');
    });

    it('should show error when start > end date', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        const inputs = screen.getAllByDisplayValue('');
        // First date input = start, second = end
        const dateInputs = inputs.filter(i => (i as HTMLInputElement).type === 'date');
        fireEvent.change(dateInputs[0], { target: { value: '2024-01-10' } });
        fireEvent.change(dateInputs[1], { target: { value: '2024-01-05' } });

        fireEvent.click(screen.getByText('期間を生成'));
        expect(toast.error).toHaveBeenCalledWith('開始日は終了日より前にしてください');
    });

    it('should generate schedules from range', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        const dateInputs = screen.getAllByDisplayValue('').filter(
            i => (i as HTMLInputElement).type === 'date'
        );
        fireEvent.change(dateInputs[0], { target: { value: '2024-01-08' } });
        fireEvent.change(dateInputs[1], { target: { value: '2024-01-10' } });

        fireEvent.click(screen.getByText('期間を生成'));

        expect(mockOnChange).toHaveBeenCalledTimes(1);
        const schedules = mockOnChange.mock.calls[0][0];
        expect(schedules).toHaveLength(3); // Jan 8, 9, 10
    });

    it('should generate weekdays only', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        const dateInputs = screen.getAllByDisplayValue('').filter(
            i => (i as HTMLInputElement).type === 'date'
        );
        // Mon Jan 8 - Sun Jan 14 2024 (7 days, 5 weekdays)
        fireEvent.change(dateInputs[0], { target: { value: '2024-01-08' } });
        fireEvent.change(dateInputs[1], { target: { value: '2024-01-14' } });

        fireEvent.click(screen.getByText('平日のみ生成'));

        expect(mockOnChange).toHaveBeenCalledTimes(1);
        const schedules = mockOnChange.mock.calls[0][0];
        expect(schedules).toHaveLength(5); // Mon-Fri
    });

    it('should add individual day', () => {
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={[]}
                onChange={mockOnChange}
            />
        );
        fireEvent.click(screen.getByText('個別選択'));
        fireEvent.click(screen.getByText('日程を追加'));

        expect(mockOnChange).toHaveBeenCalledTimes(1);
        const schedules = mockOnChange.mock.calls[0][0];
        expect(schedules).toHaveLength(1);
    });

    it('should display existing schedules', () => {
        const existingSchedules: DailySchedule[] = [
            { date: new Date('2024-01-08'), memberCount: 3, workers: [], trucks: [], remarks: '', sortOrder: 0 },
            { date: new Date('2024-01-09'), memberCount: 5, workers: [], trucks: [], remarks: '', sortOrder: 0 },
        ];
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={existingSchedules}
                onChange={mockOnChange}
                foremen={mockForemen}
            />
        );
        expect(screen.getByText('登録済みの日程 (2日間)')).toBeInTheDocument();
    });

    it('should remove a schedule', () => {
        const existingSchedules: DailySchedule[] = [
            { date: new Date('2024-01-08'), memberCount: 3, workers: [], trucks: [], remarks: '', sortOrder: 0 },
        ];
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={existingSchedules}
                onChange={mockOnChange}
                foremen={mockForemen}
            />
        );

        // Click delete button (title="削除")
        fireEvent.click(screen.getByTitle('削除'));
        expect(mockOnChange).toHaveBeenCalledWith([]);
    });

    it('should update schedule member count', () => {
        const existingSchedules: DailySchedule[] = [
            { date: new Date('2024-01-08'), memberCount: 3, workers: [], trucks: [], remarks: '', sortOrder: 0 },
        ];
        render(
            <MultiDayScheduleEditor
                type="assembly"
                dailySchedules={existingSchedules}
                onChange={mockOnChange}
                foremen={mockForemen}
            />
        );

        const numberInput = screen.getByDisplayValue('3');
        fireEvent.change(numberInput, { target: { value: '5' } });

        expect(mockOnChange).toHaveBeenCalledWith([
            expect.objectContaining({ memberCount: 5 }),
        ]);
    });
});
