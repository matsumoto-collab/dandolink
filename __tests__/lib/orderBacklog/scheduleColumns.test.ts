/**
 * @jest-environment node
 */
import {
    columnIndexForKey,
    foldScheduleToColumns,
    scheduleTotal,
    setScheduleColumn,
} from '@/components/OrderBacklog/scheduleColumns';
import { monthColumns } from '@/lib/orderBacklog/render';

const columns = monthColumns('2026-06-01'); // 6月〜1月 + 「2月以降」

describe('columnIndexForKey（9列のどこに入るか）', () => {
    it('基準月より前は第1列、基準月+8以降と later は最終列', () => {
        expect(columnIndexForKey('2026-03', '2026-06')).toBe(0);
        expect(columnIndexForKey('2026-06', '2026-06')).toBe(0);
        expect(columnIndexForKey('2026-07', '2026-06')).toBe(1);
        expect(columnIndexForKey('2027-01', '2026-06')).toBe(7);
        expect(columnIndexForKey('2027-02', '2026-06')).toBe(8);
        expect(columnIndexForKey('2027-12', '2026-06')).toBe(8);
        expect(columnIndexForKey('later', '2026-06')).toBe(8);
    });
});

describe('foldScheduleToColumns（表示）', () => {
    it('列に寄せて合算する（表に出ない月を落とさない）', () => {
        const folded = foldScheduleToColumns(
            { '2026-04': 100, '2026-06': 200, '2026-08': 300, '2027-05': 400, later: 500 },
            '2026-06',
        );
        expect(folded[0]).toBe(300); // 4月分は基準月へ寄せる
        expect(folded[2]).toBe(300); // 8月
        expect(folded[8]).toBe(900); // 範囲外 + later
        expect(folded.reduce((a, b) => a + b, 0)).toBe(1500);
    });

    it('空・null は全列 0', () => {
        expect(foldScheduleToColumns(null, '2026-06')).toEqual(new Array(9).fill(0));
    });
});

describe('setScheduleColumn（編集）', () => {
    it('その列に寄せられていた元キーを消してから列のキーで入れ直す（二重計上しない）', () => {
        const next = setScheduleColumn({ '2026-04': 100, '2026-06': 200, '2026-08': 300 }, columns, 0, 999);
        expect(next).toEqual({ '2026-06': 999, '2026-08': 300 });
        expect(foldScheduleToColumns(next, '2026-06')[0]).toBe(999);
    });

    it('最終列の編集は later にまとめる', () => {
        const next = setScheduleColumn({ '2027-02': 100, later: 200, '2026-06': 50 }, columns, 8, 700);
        expect(next).toEqual({ '2026-06': 50, later: 700 });
    });

    it('0 を入れるとその列のキーごと消える', () => {
        expect(setScheduleColumn({ '2026-07': 100, '2026-08': 200 }, columns, 1, 0)).toEqual({ '2026-08': 200 });
    });

    it('元の ScheduleMap は変更しない', () => {
        const original = { '2026-06': 100 };
        setScheduleColumn(original, columns, 0, 500);
        expect(original).toEqual({ '2026-06': 100 });
    });
});

describe('scheduleTotal', () => {
    it('全キーの合計（表に出ない月も含む）', () => {
        expect(scheduleTotal({ '2026-06': 100, '2027-09': 200, later: 300 })).toBe(600);
        expect(scheduleTotal(undefined)).toBe(0);
    });
});
