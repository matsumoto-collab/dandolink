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

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 締め日 closingDay（0=末締め）で、reference 月（year, month0=0-11）に締まる期間 [from, to]（YYYY-MM-DD）。
 * - 末締め（0）＝暦月そのもの（例: 6月分＝6/1〜6/30）
 * - N日締め＝前月(N+1)日 〜 当月N日（例: 15日締め・6月分＝5/16〜6/15）
 */
export function closingPeriod(year: number, month0: number, closingDay?: number | null): { from: string; to: string } {
    const d = !closingDay || closingDay <= 0 ? 0 : closingDay;
    if (d === 0) {
        const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
        return { from: `${year}-${pad2(month0 + 1)}-01`, to: `${year}-${pad2(month0 + 1)}-${pad2(last)}` };
    }
    const to = `${year}-${pad2(month0 + 1)}-${pad2(d)}`;
    const prev = new Date(Date.UTC(year, month0 - 1, 1));
    const from = `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}-${pad2(d + 1)}`;
    return { from, to };
}
