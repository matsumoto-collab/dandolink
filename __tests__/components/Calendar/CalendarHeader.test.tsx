import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CalendarHeader from '@/components/Calendar/CalendarHeader';

describe('CalendarHeader', () => {
    const mockOnPreviousWeek = jest.fn();
    const mockOnNextWeek = jest.fn();
    const mockOnPreviousDay = jest.fn();
    const mockOnNextDay = jest.fn();
    const mockOnToday = jest.fn();

    const defaultProps = {
        weekDays: [],
        onPreviousWeek: mockOnPreviousWeek,
        onNextWeek: mockOnNextWeek,
        onPreviousDay: mockOnPreviousDay,
        onNextDay: mockOnNextDay,
        onToday: mockOnToday,
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('ボタン表示', () => {
        it('今週ボタンを表示する', () => {
            render(<CalendarHeader {...defaultProps} />);
            expect(screen.getByText('今週')).toBeInTheDocument();
        });

        it('前の週ボタンを表示する', () => {
            render(<CalendarHeader {...defaultProps} />);
            expect(screen.getByRole('button', { name: '1週間前' })).toBeInTheDocument();
        });

        it('次の週ボタンを表示する', () => {
            render(<CalendarHeader {...defaultProps} />);
            expect(screen.getByRole('button', { name: '1週間後' })).toBeInTheDocument();
        });

        it('前の日ボタンを表示する', () => {
            render(<CalendarHeader {...defaultProps} />);
            expect(screen.getByRole('button', { name: '1日前' })).toBeInTheDocument();
        });

        it('次の日ボタンを表示する', () => {
            render(<CalendarHeader {...defaultProps} />);
            expect(screen.getByRole('button', { name: '1日後' })).toBeInTheDocument();
        });
    });

    describe('ボタンクリック', () => {
        it('今週ボタンクリックでonTodayが呼ばれる', () => {
            render(<CalendarHeader {...defaultProps} />);
            fireEvent.click(screen.getByText('今週'));
            expect(mockOnToday).toHaveBeenCalledTimes(1);
        });

        it('前の週ボタンクリックでonPreviousWeekが呼ばれる', () => {
            render(<CalendarHeader {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', { name: '1週間前' }));
            expect(mockOnPreviousWeek).toHaveBeenCalledTimes(1);
        });

        it('次の週ボタンクリックでonNextWeekが呼ばれる', () => {
            render(<CalendarHeader {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', { name: '1週間後' }));
            expect(mockOnNextWeek).toHaveBeenCalledTimes(1);
        });

        it('前の日ボタンクリックでonPreviousDayが呼ばれる', () => {
            render(<CalendarHeader {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', { name: '1日前' }));
            expect(mockOnPreviousDay).toHaveBeenCalledTimes(1);
        });

        it('次の日ボタンクリックでonNextDayが呼ばれる', () => {
            render(<CalendarHeader {...defaultProps} />);
            fireEvent.click(screen.getByRole('button', { name: '1日後' }));
            expect(mockOnNextDay).toHaveBeenCalledTimes(1);
        });
    });
});
