/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MoveConfirmModal from '@/components/Calendar/MoveConfirmModal';

jest.mock('@/hooks/useModalKeyboard', () => ({
    useModalKeyboard: () => ({ current: null }),
}));

jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
    Truck: () => <span data-testid="icon-truck" />,
    Users: () => <span data-testid="icon-users" />,
    ArrowRight: () => <span data-testid="icon-arrow" />,
    Check: () => <span data-testid="icon-check" />,
    ChevronLeft: () => <span data-testid="icon-chevron-left" />,
    Minus: () => <span data-testid="icon-minus" />,
    Plus: () => <span data-testid="icon-plus" />,
}));

const pendingMove = {
    eventId: 'p1',
    fromEmployeeId: 'f1',
    fromDate: new Date('2024-01-01'),
    toEmployeeId: 'f2',
    toDate: new Date('2024-01-05'),
    currentTrucks: ['2t #1', '4t #2'],
    currentMemberCount: 3,
};

const availableVehicles = [
    { id: 'v1', name: '2t #1' },
    { id: 'v3', name: 'ユニック' },
];
const inUseVehicles = [{ id: 'v2', name: '4t #2', usedBy: '山田職長' }];

describe('MoveConfirmModal', () => {
    const onConfirmKeep = jest.fn();
    const onConfirmReassign = jest.fn();
    const onCancel = jest.fn();

    const renderModal = (overrides: Partial<React.ComponentProps<typeof MoveConfirmModal>> = {}) =>
        render(
            <MoveConfirmModal
                isOpen
                pendingMove={pendingMove}
                eventTitle="佐藤様邸 仮設工事"
                fromForemanName="田中"
                toForemanName="鈴木"
                availableVehicles={availableVehicles}
                inUseVehicles={inUseVehicles}
                onConfirmKeep={onConfirmKeep}
                onConfirmReassign={onConfirmReassign}
                onCancel={onCancel}
                {...overrides}
            />
        );

    beforeEach(() => jest.clearAllMocks());

    it('shows the confirm view with project info and three buttons', () => {
        renderModal();
        expect(screen.getByText('移動の確認')).toBeInTheDocument();
        expect(screen.getByText('佐藤様邸 仮設工事')).toBeInTheDocument();
        expect(screen.getByText(/現在の車両:/).closest('p')).toHaveTextContent('現在の車両: 2t #1、4t #2');
        expect(screen.getByText(/現在の人数:/).closest('p')).toHaveTextContent('現在の人数: 3名');
        expect(screen.getByText('そのまま引き継ぐ')).toBeInTheDocument();
        expect(screen.getByText('再選択する')).toBeInTheDocument();
        expect(screen.getByText('キャンセル（移動しない）')).toBeInTheDocument();
    });

    it('calls onConfirmKeep when "そのまま引き継ぐ" is clicked', () => {
        renderModal();
        fireEvent.click(screen.getByText('そのまま引き継ぐ'));
        expect(onConfirmKeep).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when "キャンセル（移動しない）" is clicked', () => {
        renderModal();
        fireEvent.click(screen.getByText('キャンセル（移動しない）'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('switches to reassign view, preselects available current trucks, grays out in-use', () => {
        renderModal();
        fireEvent.click(screen.getByText('再選択する'));

        // 使用中の車両は使用者付きでグレーアウト表示
        expect(screen.getByText('使用中（山田職長）')).toBeInTheDocument();

        const checkboxes = screen.getAllByRole('checkbox');
        // [0]=2t #1(available, 元々使用→チェック), [1]=ユニック(available, 未選択), [2]=4t #2(使用中, disabled)
        expect(checkboxes[0]).toBeChecked();        // currentTrucks ∩ available
        expect(checkboxes[1]).not.toBeChecked();
        expect(checkboxes[2]).toBeDisabled();
    });

    it('confirms reassign with selected trucks and adjusted member count', () => {
        renderModal();
        fireEvent.click(screen.getByText('再選択する'));

        // ユニックを追加選択
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[1]);

        // 人数 3 → 4
        fireEvent.click(screen.getByLabelText('人数を増やす'));

        fireEvent.click(screen.getByText('OK'));

        expect(onConfirmReassign).toHaveBeenCalledWith(['2t #1', 'ユニック'], 4);
    });

    it('shows loading and disables OK while available vehicles are not loaded', () => {
        renderModal({ availableVehicles: null });
        fireEvent.click(screen.getByText('再選択する'));
        expect(screen.getByText('空き車両を確認中...')).toBeInTheDocument();
        expect(screen.getByText('OK').closest('button')).toBeDisabled();
    });

    it('renders nothing when pendingMove is null', () => {
        const { container } = render(
            <MoveConfirmModal
                isOpen
                pendingMove={null}
                availableVehicles={availableVehicles}
                inUseVehicles={inUseVehicles}
                onConfirmKeep={onConfirmKeep}
                onConfirmReassign={onConfirmReassign}
                onCancel={onCancel}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });
});
