/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DateJumpButton from '@/components/Calendar/DateJumpPopover';

// 表示中の週の月曜（2026-08-31）。この週は 8/31〜9/6 で、過半が9月なので9月グリッドが出る
const CURRENT_DATE = new Date(2026, 7, 31);

function openPopover() {
    fireEvent.click(screen.getByRole('button', { name: '日付を指定して移動' }));
}

describe('DateJumpButton', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        // 2026-09-05（土）を「今日」とする
        jest.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('トリガー押下で月グリッドが開く', () => {
        render(<DateJumpButton currentDate={CURRENT_DATE} onSelect={jest.fn()} />);

        // 開く前はグリッドが無い
        expect(screen.queryByLabelText('年を選択')).not.toBeInTheDocument();

        openPopover();

        expect(screen.getByLabelText('年を選択')).toHaveValue('2026');
        // month select の value は 0 始まり（8 = 9月）
        expect(screen.getByLabelText('月を選択')).toHaveValue('8');
        expect(screen.getByLabelText('2026年9月15日')).toBeInTheDocument();
    });

    it('日付を押すと onSelect が呼ばれて閉じる', () => {
        const onSelect = jest.fn();
        render(<DateJumpButton currentDate={CURRENT_DATE} onSelect={onSelect} />);

        openPopover();
        fireEvent.click(screen.getByLabelText('2026年9月15日'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        const selected: Date = onSelect.mock.calls[0][0];
        expect(selected.getFullYear()).toBe(2026);
        expect(selected.getMonth()).toBe(8);
        expect(selected.getDate()).toBe(15);

        // 選択後は閉じる
        expect(screen.queryByLabelText('年を選択')).not.toBeInTheDocument();
    });

    it('「半年後」チップは今日から6ヶ月後を渡す', () => {
        const onSelect = jest.fn();
        render(<DateJumpButton currentDate={CURRENT_DATE} onSelect={onSelect} />);

        openPopover();
        fireEvent.click(screen.getByRole('button', { name: '半年後' }));

        const selected: Date = onSelect.mock.calls[0][0];
        // 2026-09-05 + 6ヶ月 = 2027-03-05
        expect(selected.getFullYear()).toBe(2027);
        expect(selected.getMonth()).toBe(2);
        expect(selected.getDate()).toBe(5);
    });

    it('「表示中の週から」の「1ヶ月後」は月末を丸めて渡す', () => {
        const onSelect = jest.fn();
        render(<DateJumpButton currentDate={CURRENT_DATE} onSelect={onSelect} />);

        openPopover();
        // 「今日から」「表示中の週から」に同名チップがあるので2つ目（=表示中の週から）
        const chips = screen.getAllByRole('button', { name: '1ヶ月後' });
        expect(chips).toHaveLength(2);
        fireEvent.click(chips[1]);

        const selected: Date = onSelect.mock.calls[0][0];
        // 2026-08-31 + 1ヶ月 = 9/31 は存在しないので 2026-09-30 に丸める
        expect(selected.getFullYear()).toBe(2026);
        expect(selected.getMonth()).toBe(8);
        expect(selected.getDate()).toBe(30);
    });

    it('Escape で閉じる', () => {
        render(<DateJumpButton currentDate={CURRENT_DATE} onSelect={jest.fn()} />);

        openPopover();
        expect(screen.getByLabelText('年を選択')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByLabelText('年を選択')).not.toBeInTheDocument();
    });

    it('maxDate より後の日は disabled', () => {
        render(
            <DateJumpButton
                currentDate={CURRENT_DATE}
                onSelect={jest.fn()}
                maxDate={new Date(2026, 8, 10)}
            />
        );

        openPopover();

        expect(screen.getByLabelText('2026年9月15日')).toBeDisabled();
        expect(screen.getByLabelText('2026年9月10日')).not.toBeDisabled();
    });
});
