import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DraggableEventCard from '@/components/Calendar/DraggableEventCard';
import { CalendarEvent } from '@/types/calendar';

// dnd-kit モック
jest.mock('@dnd-kit/sortable', () => ({
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: jest.fn(),
        transform: null,
        transition: null,
        isDragging: false,
    }),
}));

jest.mock('@dnd-kit/utilities', () => ({
    CSS: {
        Transform: {
            toString: () => null,
        },
    },
}));

// lucide-react モック
jest.mock('lucide-react', () => ({
    ChevronUp: () => <svg data-testid="chevron-up" />,
    ChevronDown: () => <svg data-testid="chevron-down" />,
    ClipboardCheck: () => <svg data-testid="clipboard-check" />,
    CheckCircle: () => <svg data-testid="check-circle" />,
    Copy: () => <svg data-testid="copy-icon" />,
}));

describe('DraggableEventCard', () => {
    const baseEvent: CalendarEvent = {
        id: 'event-1',
        title: 'テスト現場',
        date: new Date('2026-01-15'),
        color: '#3B82F6',
    };

    describe('基本表示', () => {
        it('タイトルを表示する', () => {
            render(<DraggableEventCard event={baseEvent} />);
            expect(screen.getByText('テスト現場')).toBeInTheDocument();
        });

        it('顧客名を表示する', () => {
            const event = { ...baseEvent, customer: '株式会社テスト' };
            render(<DraggableEventCard event={event} />);
            expect(screen.getByText('株式会社テスト')).toBeInTheDocument();
        });

        it('作業員数を表示する', () => {
            const event = { ...baseEvent, workers: ['田中', '山田'] };
            render(<DraggableEventCard event={event} />);
            expect(screen.getByText('2人')).toBeInTheDocument();
        });

        it('備考を表示する', () => {
            const event = { ...baseEvent, remarks: 'メモ内容' };
            render(<DraggableEventCard event={event} />);
            expect(screen.getByText('メモ内容')).toBeInTheDocument();
        });
    });

    describe('クリックイベント', () => {
        it('カードクリックでonClickが呼ばれる', () => {
            const handleClick = jest.fn();
            render(<DraggableEventCard event={baseEvent} onClick={handleClick} />);
            fireEvent.click(screen.getByText('テスト現場'));
            expect(handleClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('移動ボタン', () => {
        it('canMoveUp=trueで上移動ボタンが有効', () => {
            const handleMoveUp = jest.fn();
            render(
                <DraggableEventCard
                    event={baseEvent}
                    canMoveUp={true}
                    onMoveUp={handleMoveUp}
                />
            );
            const upButton = screen.getByTestId('chevron-up').closest('button');
            expect(upButton).not.toBeDisabled();
        });

        it('canMoveDown=trueで下移動ボタンが有効', () => {
            const handleMoveDown = jest.fn();
            render(
                <DraggableEventCard
                    event={baseEvent}
                    canMoveDown={true}
                    onMoveDown={handleMoveDown}
                />
            );
            const downButton = screen.getByTestId('chevron-down').closest('button');
            expect(downButton).not.toBeDisabled();
        });

        it('上移動ボタンクリックでonMoveUpが呼ばれる', () => {
            const handleMoveUp = jest.fn();
            render(
                <DraggableEventCard
                    event={baseEvent}
                    canMoveUp={true}
                    onMoveUp={handleMoveUp}
                />
            );
            const upButton = screen.getByTestId('chevron-up').closest('button');
            fireEvent.click(upButton!);
            expect(handleMoveUp).toHaveBeenCalledTimes(1);
        });
    });

    describe('配車確認', () => {
        it('canDispatch=trueで配車ボタンが表示される', () => {
            render(
                <DraggableEventCard
                    event={baseEvent}
                    canDispatch={true}
                    onDispatch={jest.fn()}
                />
            );
            expect(screen.getByTestId('clipboard-check')).toBeInTheDocument();
        });

        it('isDispatchConfirmed=trueで確認済みアイコンが表示される', () => {
            render(
                <DraggableEventCard
                    event={baseEvent}
                    canDispatch={true}
                    isDispatchConfirmed={true}
                />
            );
            expect(screen.getByTestId('check-circle')).toBeInTheDocument();
        });
    });

    describe('コピー機能', () => {
        it('onCopyがある時コピーボタンが表示される', () => {
            render(
                <DraggableEventCard
                    event={baseEvent}
                    onCopy={jest.fn()}
                />
            );
            expect(screen.getByTestId('copy-icon')).toBeInTheDocument();
        });

        it('コピーボタンクリックでonCopyが呼ばれる', () => {
            const handleCopy = jest.fn();
            render(
                <DraggableEventCard
                    event={baseEvent}
                    onCopy={handleCopy}
                />
            );
            const copyButton = screen.getByTestId('copy-icon').closest('button');
            fireEvent.click(copyButton!);
            expect(handleCopy).toHaveBeenCalledTimes(1);
        });
    });

    describe('disabled状態', () => {
        it('disabled=trueでcursor-grabクラスがない', () => {
            const { container } = render(
                <DraggableEventCard event={baseEvent} disabled={true} />
            );
            const card = container.querySelector('[data-event-card="true"]');
            expect(card).not.toHaveClass('cursor-grab');
        });
    });
});
