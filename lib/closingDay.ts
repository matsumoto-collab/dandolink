/**
 * 請求締め日の共通ユーティリティ。
 * closingDay は 0=末締め、それ以外はその日（5/10/15/20/25 等）で締めることを表す。
 */

/** UI で選べる締め日（0=末締め）。顧客マスタ・請求ボードで共用。 */
export const CLOSING_DAY_OPTIONS = [0, 5, 10, 15, 20, 25] as const;

/** 締め日の表示ラベル（例: 0→「末締め」, 15→「15日締め」）。 */
export function closingDayLabel(day?: number | null): string {
    return !day || day <= 0 ? '末締め' : `${day}日締め`;
}
