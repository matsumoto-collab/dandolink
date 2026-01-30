import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import EventCard from '@/components/Calendar/EventCard';
import { CalendarEvent } from '@/types/calendar';

describe('EventCard', () => {
    const baseEvent: CalendarEvent = {
        id: 'event-1',
        title: 'テスト現場',
        date: new Date('2026-01-15'),
        color: '#3B82F6',
    };

    describe('通常表示モード', () => {
        it('タイトルを表示する', () => {
            render(<EventCard event={baseEvent} />);
            expect(screen.getByText('テスト現場')).toBeInTheDocument();
        });

        it('顧客名を表示する', () => {
            const event = { ...baseEvent, customer: '株式会社テスト' };
            render(<EventCard event={event} />);
            expect(screen.getByText('株式会社テスト')).toBeInTheDocument();
        });

        it('作業員数を表示する', () => {
            const event = { ...baseEvent, workers: ['田中', '山田', '佐藤'] };
            render(<EventCard event={event} />);
            expect(screen.getByText('3名')).toBeInTheDocument();
        });

        it('備考を表示する', () => {
            const event = { ...baseEvent, remarks: '午前中に完了予定' };
            render(<EventCard event={event} />);
            expect(screen.getByText('午前中に完了予定')).toBeInTheDocument();
        });

        it('背景色が適用される', () => {
            const { container } = render(<EventCard event={baseEvent} />);
            const card = container.firstChild as HTMLElement;
            expect(card).toHaveStyle({ backgroundColor: '#3B82F6' });
        });

        it('クリックでonClickが呼ばれる', () => {
            const handleClick = jest.fn();
            render(<EventCard event={baseEvent} onClick={handleClick} />);
            fireEvent.click(screen.getByText('テスト現場'));
            expect(handleClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('コンパクト表示モード', () => {
        it('compact=trueでコンパクト表示になる', () => {
            const event = { ...baseEvent, workers: ['田中', '山田'] };
            render(<EventCard event={event} compact={true} />);
            // コンパクト表示では「人」、通常は「名」
            expect(screen.getByText('2人')).toBeInTheDocument();
        });

        it('コンパクトでも顧客名を表示する', () => {
            const event = { ...baseEvent, customer: 'テスト顧客' };
            render(<EventCard event={event} compact={true} />);
            expect(screen.getByText('テスト顧客')).toBeInTheDocument();
        });
    });

    describe('オプション項目の非表示', () => {
        it('顧客名がない時は表示しない', () => {
            render(<EventCard event={baseEvent} />);
            expect(screen.queryByText('株式会社')).not.toBeInTheDocument();
        });

        it('作業員がいない時は人数を表示しない', () => {
            render(<EventCard event={baseEvent} />);
            expect(screen.queryByText('名')).not.toBeInTheDocument();
        });

        it('備考がない時は表示しない', () => {
            render(<EventCard event={baseEvent} />);
            // 備考アイコンのパスを検索しない
            const remarks = screen.queryByText('午前');
            expect(remarks).not.toBeInTheDocument();
        });
    });
});
