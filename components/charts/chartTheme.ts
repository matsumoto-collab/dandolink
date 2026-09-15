/**
 * グラフの色と数字の書式（利益ダッシュボード・自社班の出来高・利益サマリーで共通）。
 *
 * 色は「何を表しているか」に固定する（人件費はどの画面でも青、外注は橙、利益・稼ぎはティール）。
 * 同じグラフの中で隣り合う組み合わせは、色覚の多様性（P型・D型のシミュレーション）でも
 * 見分けられることを検証スクリプトで確認した（白地・2026-09-15）。
 * 黄色と桃色は白地とのコントラストが低いので、使うグラフには必ず凡例に数字を並べる。
 */
export const CHART_COLORS = {
    /** 利益・稼ぎ・売上÷人工・最低ライン以上（アプリのアクセント teal-600） */
    teal: '#0d9488',
    /** 人件費 */
    blue: '#2a78d6',
    /** 外注費・外注換算・3か月移動平均 */
    orange: '#eb6834',
    /** 材料費・解体 */
    yellow: '#eda100',
    /** 積込費 */
    magenta: '#e87ba4',
    /** 車両費・組立 */
    violet: '#4a3aa7',
    /** 最低ライン未満 */
    red: '#e34948',
    /** 「その他」（slate-400） */
    other: '#94a3b8',
    /** 原価など、主役ではない量（slate-300） */
    muted: '#cbd5e1',
    /** 人工（人数）の棒（slate-500） */
    headcount: '#64748b',
    /** 目盛線（slate-200） */
    grid: '#e2e8f0',
    /** 軸の数字（slate-500） */
    axisText: '#64748b',
    /** 最低ラインなどの基準線（slate-700） */
    reference: '#334155',
} as const;

/**
 * 顧客・担当者など「名前ごとの割合」を塗る順番（この順なら隣り合っても見分けられる）。
 * 5 件を超える分は色を増やさず「その他」（CHART_COLORS.other）にまとめる。
 */
export const SHARE_COLORS: readonly string[] = [
    CHART_COLORS.blue,
    CHART_COLORS.orange,
    CHART_COLORS.violet,
    CHART_COLORS.yellow,
    CHART_COLORS.magenta,
];

/** 数字の軸の文字 */
export const AXIS_TICK = { fontSize: 11, fill: CHART_COLORS.axisText };
/** 名前の軸の文字（数字より少し濃く） */
export const CATEGORY_TICK = { fontSize: 11, fill: '#475569' };
/** 棒にカーソルを当てたときの帯 */
export const HOVER_CURSOR = { fill: 'rgba(148,163,184,0.12)' };

/** 円（四捨五入・桁区切り）。null / NaN は「—」 */
export function formatYen(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    const text = `¥${Math.abs(rounded).toLocaleString('ja-JP')}`;
    return rounded < 0 ? `−${text}` : text;
}

/**
 * 金額の軸目盛り。「千万」丸めだと 1,500万 が「2千万」になり 2,000万 と重なるので、
 * 億未満は万単位の桁区切りにする（MonthlySalesPanel から移設。10万未満の端数は小数1桁: 2.5万）。
 */
export function formatYenAxis(value: number): string {
    if (value === 0) return '0';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 100000000) {
        const oku = abs / 100000000;
        return `${sign}${Number.isInteger(oku) ? oku : oku.toFixed(1)}億`;
    }
    if (abs >= 10000) {
        const man = abs / 10000;
        const text = Number.isInteger(man) || man >= 100
            ? Math.round(man).toLocaleString()
            : String(Math.round(man * 10) / 10);
        return `${sign}${text}万`;
    }
    return `${sign}${abs}`;
}

/** ドーナツの真ん中などに置く短い金額（1.2億 / 1,235万 / 34.6万 / ¥8,000） */
export function formatYenCompact(value: number): string {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 100000000) return `${sign}${(Math.round(abs / 10000000) / 10).toLocaleString()}億`;
    if (abs >= 1000000) return `${sign}${Math.round(abs / 10000).toLocaleString()}万`;
    if (abs >= 10000) return `${sign}${Math.round(abs / 1000) / 10}万`;
    return `${sign}¥${Math.round(abs).toLocaleString()}`;
}

/** 軸に置く名前を max 文字で切る（全文は吹き出しに出す） */
export function truncateLabel(text: string, max: number): string {
    const chars = Array.from(text);
    return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

/**
 * min〜max を、きりのいい目盛り（1・2・2.5・5 × 10^n 刻み）で割る。
 * 最低ラインの線を必ず範囲に入れたいグラフで、目盛りを自前で決めるのに使う。
 */
export function niceScale(min: number, max: number, count = 5): { domain: [number, number]; ticks: number[] } {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / count;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
    const lo = Math.floor(min / step) * step;
    let hi = Math.ceil(max / step) * step;
    if (hi <= lo) hi = lo + step;
    const ticks: number[] = [];
    for (let i = 0; lo + i * step <= hi + step / 1000; i++) {
        ticks.push(Math.round((lo + i * step) * 1e6) / 1e6);
    }
    return { domain: [lo, hi], ticks };
}
