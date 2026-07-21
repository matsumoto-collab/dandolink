/**
 * 浮きレーンの位置を職長並び順に相乗りさせる計算（lib/floatingLaneOrder.ts）。
 * ここが壊れると「予約ID 'unassigned' が班として他画面へ漏れる」事故になるため、
 * 分解と再構成が必ず往復することを重点的に確認する。
 */
import {
    FLOATING_LANE_ID,
    splitForemanOrder,
    mergeForemanOrder,
    clampFloatingLaneIndex,
    nextFloatingLaneIndex,
} from '@/lib/floatingLaneOrder';

describe('splitForemanOrder', () => {
    it('予約IDが無ければ位置は未設定（null）で職長IDはそのまま', () => {
        expect(splitForemanOrder(['a', 'b', 'c'])).toEqual({ foremanIds: ['a', 'b', 'c'], floatingLaneIndex: null });
    });

    it('予約IDを取り除き、その手前に並ぶ職長の数を位置として返す', () => {
        expect(splitForemanOrder(['a', FLOATING_LANE_ID, 'b'])).toEqual({ foremanIds: ['a', 'b'], floatingLaneIndex: 1 });
        expect(splitForemanOrder([FLOATING_LANE_ID, 'a', 'b'])).toEqual({ foremanIds: ['a', 'b'], floatingLaneIndex: 0 });
        expect(splitForemanOrder(['a', 'b', FLOATING_LANE_ID])).toEqual({ foremanIds: ['a', 'b'], floatingLaneIndex: 2 });
    });

    it('職長IDに予約IDを残さない（他画面へ漏らさない）', () => {
        const { foremanIds } = splitForemanOrder([FLOATING_LANE_ID]);
        expect(foremanIds).toEqual([]);
    });
});

describe('mergeForemanOrder', () => {
    it('位置が未設定なら予約IDを混ぜない（動かしていない環境のデータを変えない）', () => {
        expect(mergeForemanOrder(['a', 'b'], null)).toEqual(['a', 'b']);
    });

    it('指定位置に予約IDを1つだけ差し込む', () => {
        expect(mergeForemanOrder(['a', 'b'], 0)).toEqual([FLOATING_LANE_ID, 'a', 'b']);
        expect(mergeForemanOrder(['a', 'b'], 1)).toEqual(['a', FLOATING_LANE_ID, 'b']);
        expect(mergeForemanOrder(['a', 'b'], 2)).toEqual(['a', 'b', FLOATING_LANE_ID]);
    });

    it('範囲外の位置は端に丸める', () => {
        expect(mergeForemanOrder(['a', 'b'], 99)).toEqual(['a', 'b', FLOATING_LANE_ID]);
        expect(mergeForemanOrder(['a', 'b'], -5)).toEqual([FLOATING_LANE_ID, 'a', 'b']);
    });

    it('split → merge で元に戻る', () => {
        const saved = ['a', FLOATING_LANE_ID, 'b', 'c'];
        const { foremanIds, floatingLaneIndex } = splitForemanOrder(saved);
        expect(mergeForemanOrder(foremanIds, floatingLaneIndex)).toEqual(saved);
    });

    it('予約IDが二重に入っていても1つに正規化される', () => {
        expect(mergeForemanOrder(['a', FLOATING_LANE_ID, 'b'], 2)).toEqual(['a', 'b', FLOATING_LANE_ID]);
    });
});

describe('clampFloatingLaneIndex', () => {
    it('null や不正値は一番下（職長数）にする', () => {
        expect(clampFloatingLaneIndex(null, 3)).toBe(3);
        expect(clampFloatingLaneIndex(NaN, 3)).toBe(3);
    });

    it('0〜職長数に収める', () => {
        expect(clampFloatingLaneIndex(-1, 3)).toBe(0);
        expect(clampFloatingLaneIndex(9, 3)).toBe(3);
        expect(clampFloatingLaneIndex(2, 3)).toBe(2);
    });
});

describe('nextFloatingLaneIndex', () => {
    const foremen = ['a', 'b', 'c'];
    const allVisible = new Set(foremen);

    it('未設定（一番下）から上へ押すと1段上がる', () => {
        expect(nextFloatingLaneIndex(null, 'up', foremen, allVisible)).toBe(2);
    });

    it('下へ押すと1段下がる', () => {
        expect(nextFloatingLaneIndex(0, 'down', foremen, allVisible)).toBe(1);
    });

    it('端では動かない', () => {
        expect(nextFloatingLaneIndex(0, 'up', foremen, allVisible)).toBe(0);
        expect(nextFloatingLaneIndex(3, 'down', foremen, allVisible)).toBe(3);
    });

    it('画面に出ていない職長（退職者など）はまたいで、必ず見た目が1段変わる', () => {
        // 'b' が画面に無い並び: 一番下から上へ押したら 'b' を飛ばして 'c' の上まで行く
        const visible = new Set(['a', 'c']);
        expect(nextFloatingLaneIndex(3, 'up', foremen, visible)).toBe(2); // 'c' の前
        expect(nextFloatingLaneIndex(2, 'up', foremen, visible)).toBe(0); // 'b' を飛ばして 'a' の前
    });

    it('職長一覧が未取得のときは素直に1段だけ動かす', () => {
        expect(nextFloatingLaneIndex(3, 'up', foremen, new Set())).toBe(2);
    });
});
