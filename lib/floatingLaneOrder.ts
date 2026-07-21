/**
 * 浮きレーン（班未定の置き場）の表示位置を、既存の職長並び順設定に相乗りさせる。
 *
 * 保存先は SystemSettings.displayedForemanIds（JSON配列）。そこへ予約ID 'unassigned' を
 * 1要素だけ混ぜて「職長行の何番目に挟むか」を表す。列を足さないのでマイグレ不要で、
 * 並び順のソースも1つのままにできる。
 *
 * 混ぜた 'unassigned' はストア境界（stores/calendarSlices/foremanSlice.ts）で必ず取り除くため、
 * displayedForemanIds を読む他の画面・手配表PDF・AI照会へは漏れない
 * （サーバー側で直読みする lib/crewAvailability.ts だけは自前で除外している）。
 *
 * floatingLaneIndex は「displayedForemanIds（'unassigned'除去後）の何番目の前に置くか」。
 * null は未設定＝従来どおり一番下。0 なら一番上、length なら一番下。
 */

/** 浮きレーンの位置を表す予約ID。配置の assignedEmployeeId='unassigned' と同じ語を使う */
export const FLOATING_LANE_ID = 'unassigned';

export interface ForemanOrder {
    /** 実際の職長ID（予約IDを除いたもの） */
    foremanIds: string[];
    /** 浮きレーンの位置。null = 未設定（一番下） */
    floatingLaneIndex: number | null;
}

/** 保存されている配列を「職長IDの並び」と「浮きレーンの位置」に分解する */
export function splitForemanOrder(ids: string[]): ForemanOrder {
    const foremanIds = ids.filter((id) => id !== FLOATING_LANE_ID);
    const at = ids.indexOf(FLOATING_LANE_ID);
    // 予約IDは1つだけの想定。前に並ぶ要素数がそのまま挿入位置になる
    return { foremanIds, floatingLaneIndex: at === -1 ? null : Math.min(at, foremanIds.length) };
}

/** 位置を 0〜職長数 の範囲に収める。null / 不正値は「一番下」 */
export function clampFloatingLaneIndex(index: number | null, foremanCount: number): number {
    if (index == null || !Number.isFinite(index)) return foremanCount;
    return Math.max(0, Math.min(Math.trunc(index), foremanCount));
}

/**
 * 保存用の配列に戻す。位置が未設定（null）のときは予約IDを混ぜない
 * ＝これまでどおりの配列のままにして、動かしていない環境のデータを汚さない。
 */
export function mergeForemanOrder(foremanIds: string[], floatingLaneIndex: number | null): string[] {
    const ids = foremanIds.filter((id) => id !== FLOATING_LANE_ID);
    if (floatingLaneIndex == null) return ids;
    ids.splice(clampFloatingLaneIndex(floatingLaneIndex, ids.length), 0, FLOATING_LANE_ID);
    return ids;
}

/**
 * ▲▼を1回押したときの移動先を返す。
 *
 * displayedForemanIds には退職などで画面に出ない職長IDが残っていることがあり、
 * 単純な ±1 では「押しても見た目が変わらない」ことがあるため、
 * 画面に出ている職長を1人ぶん追い越すまで進める。
 */
export function nextFloatingLaneIndex(
    current: number | null,
    direction: 'up' | 'down',
    foremanIds: string[],
    visibleForemanIds: ReadonlySet<string>
): number {
    const count = foremanIds.length;
    const step = direction === 'up' ? -1 : 1;
    let index = clampFloatingLaneIndex(current, count);

    // 表示中の職長が分からない場合（初期ロード中など）は素直に1段だけ動かす
    if (visibleForemanIds.size === 0) return clampFloatingLaneIndex(index + step, count);

    for (;;) {
        const next = index + step;
        if (next < 0 || next > count) return index; // 端に着いた
        // 追い越す職長: 上へなら移動先にいる職長、下へなら今いる位置の職長
        const passing = foremanIds[direction === 'up' ? next : index];
        index = next;
        if (passing === undefined || visibleForemanIds.has(passing)) return index;
        // 画面に出ていない職長は見た目が変わらないので、もう1段進む
    }
}
