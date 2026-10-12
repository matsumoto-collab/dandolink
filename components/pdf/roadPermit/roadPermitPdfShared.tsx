/**
 * 道路申請 PDF の共通部品（3 様式で使う）。
 *
 * 作りの決まり
 * - 様式は役所の原本（Word を PDF にしたもの）の見た目に合わせるため、文字も罫線も
 *   **絶対配置（pt・左上原点）** で置く。座標は原本 PDF から拾った値をそのまま使う。
 * - 原本の文字の y は「ベースライン」の位置。react-pdf の Text は top が箱の上端なので、
 *   `T` の中で fontSize ぶん上にずらしてベースラインを合わせる（BASELINE_RATIO）。
 * - 文字は必ず SafeText の Text（㎡→m² などの置き換えを他の帳票とそろえるため）。
 * - 原本に無い飾り（色・太い罫線・影）は足さない。罫線は黒 0.5pt。
 */
import React from 'react';
import { Ellipse, Rect, Svg, View } from '@react-pdf/renderer';
import { Text } from '../SafeText';
import { fitCellFontSize, sanitizePdfText, wrapTextToWidth } from '../styles';
import { reiwaParts } from '@/lib/roadPermit/format';

/** A4 縦（pt） */
export const PAGE_W = 595;
export const PAGE_H = 842;

/** 罫線の太さ（原本は 0.5pt） */
export const RULE = 0.5;

/** 文字の色・罫線の色（原本は黒だけ） */
const INK = '#000000';

/**
 * ベースライン → 箱の上端 のずらし幅（fontSize に対する比）。
 * NotoSansJP の ascent（1.16em）。lineHeight: 1 でも react-pdf はベースラインを箱の上端から ascent の位置に置く
 * （実際に描いた PDF の文字の位置を pdfjs で測って合わせた）。
 */
export const BASELINE_RATIO = 1.16;

/** ページ（A4 縦・NotoSansJP・余白なし。中身はすべて絶対配置） */
export const pageStyle = {
    fontFamily: 'NotoSansJP',
    fontSize: 10.5,
    color: INK,
    position: 'relative' as const,
    padding: 0,
};

/** 文字の見積もり幅（全角 = 1em・半角 = 0.6em。styles.ts の fitCellFontSize と同じ換算） */
export function estimateTextWidth(text: string, fontSize: number): number {
    let units = 0;
    for (const ch of sanitizePdfText(text)) units += /[\x00-\xff｡-ﾟ²³]/.test(ch) ? 0.6 : 1;
    return units * fontSize;
}

// ---------------------------------------------------------------------------
// 文字
// ---------------------------------------------------------------------------

export interface TProps {
    /** 左端（align が center / right のときは箱の左端） */
    x: number;
    /** ベースラインの y */
    y: number;
    fs?: number;
    /** 箱の幅。fit のとき・中央／右寄せのときに使う */
    w?: number;
    align?: 'left' | 'center' | 'right';
    /** 箱の幅に収まらないときは文字を小さくする（最小 minFs） */
    fit?: boolean;
    minFs?: number;
    /**
     * 小さくしても 1 行に収まらないときに折り返してよい行数（既定 1）。
     * 折り返しは wrapTextToWidth で改行を入れる（react-pdf に任せると「守-」のようにハイフンが入るため）。
     */
    maxLines?: number;
    /** 欄の上端・下端（複数行のとき、罫線にかからないよう行のまとまりをこの中に収める） */
    cellTop?: number;
    cellBottom?: number;
    children?: string | number | null;
}

/** 行の間隔（fontSize に対する比。複数行のとき） */
const MULTI_LINE_HEIGHT = 1.2;
/** 1 行のままでよい最小の縮み（これより小さくなるなら、折り返してよい欄は折り返す） */
const SINGLE_LINE_MIN_RATIO = 0.8;

/** 文字の大きさと行の並びを決める（1 行で縮める → 足りなければ折り返す） */
function layoutText(
    text: string,
    w: number | undefined,
    fs: number,
    fit: boolean,
    minFs: number,
    maxLines: number,
): { size: number; lines: string[] } {
    const clean = sanitizePdfText(text).replace(/\n/g, ' ');
    if (!fit || w == null) return { size: fs, lines: [clean] };
    const single = fitCellFontSize(clean, w, fs, minFs);
    const singleFits = estimateTextWidth(clean, single) <= w * 0.98 + 0.01;
    if (maxLines <= 1 || (singleFits && single >= fs * SINGLE_LINE_MIN_RATIO)) return { size: single, lines: [clean] };
    for (let size = fs; size >= minFs; size -= 0.5) {
        const lines = wrapTextToWidth(clean, w, size).split('\n');
        if (lines.length <= maxLines) return { size, lines };
    }
    return { size: minFs, lines: wrapTextToWidth(clean, w, minFs).split('\n') };
}

/** 絶対配置の文字 1 つ。y はベースライン */
export function T({ x, y, fs = 10.5, w, align = 'left', fit = false, minFs = 6, maxLines = 1, cellTop, cellBottom, children }: TProps) {
    const text = children == null ? '' : String(children);
    if (text === '') return null;
    const { size, lines } = layoutText(text, w, fs, fit, minFs, maxLines);
    const lineHeight = lines.length <= 1 ? 1 : MULTI_LINE_HEIGHT;
    let top: number;
    if (lines.length <= 1) {
        // 1 行: 小さくしたときもベースラインの位置は変えない（上端を下げる）
        top = y - size * BASELINE_RATIO;
    } else {
        // 複数行: 1 行のときの文字の中心（ベースラインの 0.38em 上）に、行のまとまりの中心を合わせる
        const step = size * lineHeight;
        const center = y - fs * 0.38;
        top = center - size * (BASELINE_RATIO - 0.38) - ((lines.length - 1) * step) / 2;
        // 文字の見た目の上端 ≈ top + 0.28em・下端 ≈ 最後の行のベースライン + 0.12em
        if (cellBottom != null) {
            const bottom = top + (lines.length - 1) * step + size * (BASELINE_RATIO + 0.12);
            if (bottom > cellBottom - 1.5) top -= bottom - (cellBottom - 1.5);
        }
        if (cellTop != null && top + size * 0.28 < cellTop + 1.5) top = cellTop + 1.5 - size * 0.28;
    }
    return (
        <View
            style={{
                position: 'absolute',
                left: x,
                top,
                // 幅を決めないと右端で勝手に折り返すことがあるので、無指定でもページの右端までにする
                width: w ?? PAGE_W - x,
            }}
        >
            {lines.map((line, i) => (
                <Text
                    key={i}
                    style={{
                        fontSize: size,
                        // 2 行目以降は行の間隔ぶん下げる（各行の箱の高さは fontSize ちょうど）
                        marginTop: i === 0 ? 0 : size * (lineHeight - 1),
                        lineHeight: 1,
                        textAlign: align,
                    }}
                >
                    {line}
                </Text>
            ))}
        </View>
    );
}

/**
 * 字間を空けた見出し（「道 路 使 用 許 可 申 請 書」）。
 * 1 文字ずつ x0 + step × i に置く。原本の文字の位置どおりに並べるため。
 */
export function Spaced({ x, y, fs = 10.5, step, text }: { x: number; y: number; fs?: number; step: number; text: string }) {
    return (
        <>
            {Array.from(text).map((ch, i) => (
                <T key={i} x={x + step * i} y={y} fs={fs}>
                    {ch}
                </T>
            ))}
        </>
    );
}

/** 原本の位置に 1 文字ずつ置く（字間がまちまちな欄名用）。xs[i] が i 文字目の左端 */
export function Chars({ xs, y, fs = 10.5, text }: { xs: number[]; y: number; fs?: number; text: string }) {
    const chars = Array.from(text);
    return (
        <>
            {chars.map((ch, i) => (
                <T key={i} x={xs[i] ?? xs[xs.length - 1]} y={y} fs={fs}>
                    {ch}
                </T>
            ))}
        </>
    );
}

// ---------------------------------------------------------------------------
// 罫線・枠
// ---------------------------------------------------------------------------

/** 横線（x1〜x2・y は線の中心） */
export function HLine({ x1, x2, y, t = RULE }: { x1: number; x2: number; y: number; t?: number }) {
    return <View style={{ position: 'absolute', left: x1, top: y - t / 2, width: x2 - x1, height: t, backgroundColor: INK }} />;
}

/** 縦線（y1〜y2・x は線の中心） */
export function VLine({ x, y1, y2, t = RULE }: { x: number; y1: number; y2: number; t?: number }) {
    return <View style={{ position: 'absolute', left: x - t / 2, top: y1, width: t, height: y2 - y1, backgroundColor: INK }} />;
}

/** 四角の枠（罫線つき。x1,y1 = 左上・x2,y2 = 右下。線の中心で指定） */
export function Box({ x1, y1, x2, y2, t = RULE }: { x1: number; y1: number; x2: number; y2: number; t?: number }) {
    return (
        <>
            <HLine x1={x1 - t / 2} x2={x2 + t / 2} y={y1} t={t} />
            <HLine x1={x1 - t / 2} x2={x2 + t / 2} y={y2} t={t} />
            <VLine x={x1} y1={y1} y2={y2} t={t} />
            <VLine x={x2} y1={y1} y2={y2} t={t} />
        </>
    );
}

/** 点線の四角（警察の「県収入証紙」・松山市の「印」の枠） */
export function DashedBox({ x1, y1, x2, y2, dash = '2 1.5' }: { x1: number; y1: number; x2: number; y2: number; dash?: string }) {
    const w = x2 - x1;
    const h = y2 - y1;
    return (
        <Svg style={{ position: 'absolute', left: x1 - 1, top: y1 - 1, width: w + 2, height: h + 2 }} viewBox={`0 0 ${w + 2} ${h + 2}`}>
            <Rect x={1} y={1} width={w} height={h} stroke={INK} strokeWidth={RULE} strokeDasharray={dash} fill="none" />
        </Svg>
    );
}

// ---------------------------------------------------------------------------
// ○ 囲み
// ---------------------------------------------------------------------------

/** 楕円（x1〜x2 の文字を囲む）。cy = 楕円の中心の y、ry = 縦の半径 */
export function Oval({ x1, x2, cy, ry, padX = 3 }: { x1: number; x2: number; cy: number; ry: number; padX?: number }) {
    const rx = (x2 - x1) / 2 + padX;
    const cx = (x1 + x2) / 2;
    const W = rx * 2 + 2;
    const H = ry * 2 + 2;
    return (
        <Svg style={{ position: 'absolute', left: cx - rx - 1, top: cy - ry - 1, width: W, height: H }} viewBox={`0 0 ${W} ${H}`}>
            <Ellipse cx={W / 2} cy={H / 2} rx={rx} ry={ry} stroke={INK} strokeWidth={0.6} fill="none" />
        </Svg>
    );
}

/**
 * ○ で囲める文字。selected のときだけ文字の周りに楕円を描く（選んでいない方は文字だけ）。
 * - text … 1 つの文字列として x から置く
 * - xs   … 字間を空けて 1 文字ずつ置くとき、各文字の左端（原本の位置）
 * 楕円の幅は、最後の文字の右端（見積もり）までを囲む。
 */
export function CircledText({
    x,
    y,
    fs = 10.5,
    text,
    xs,
    selected,
    padX,
}: {
    x: number;
    y: number;
    fs?: number;
    text: string;
    xs?: number[];
    selected: boolean;
    padX?: number;
}) {
    const chars = Array.from(text);
    const right = xs
        ? (xs[chars.length - 1] ?? x) + estimateTextWidth(chars[chars.length - 1] ?? '', fs)
        : x + estimateTextWidth(text, fs);
    return (
        <>
            {xs ? <Chars xs={xs} y={y} fs={fs} text={text} /> : <T x={x} y={y} fs={fs}>{text}</T>}
            {selected && <Oval x1={xs ? xs[0] : x} x2={right} cy={y - fs * 0.36} ry={fs * 0.78} padX={padX ?? fs * 0.4} />}
        </>
    );
}

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/**
 * 「令和　年　月　日」の枠に年・月・日の数を入れる。
 * 文言（令和・年・月・日）は呼び出し側で原本の位置に置き、ここでは数だけを
 * 「年」「月」「日」の字の左に右寄せで置く。未入力（空・不正）なら何も置かない＝空白で印刷。
 */
export function ReiwaNumbers({
    ymd,
    y,
    fs = 10.5,
    yearRight,
    monthRight,
    dayRight,
    width = 24,
}: {
    ymd: string;
    y: number;
    fs?: number;
    /** 「年」「月」「日」の字の左端（数はここで終わるよう右寄せ） */
    yearRight: number;
    monthRight: number;
    dayRight: number;
    width?: number;
}) {
    const p = reiwaParts(ymd);
    if (p.year == null) return null;
    const gap = 1.5;
    return (
        <>
            <T x={yearRight - gap - width} y={y} fs={fs} w={width} align="right">
                {p.year === 1 ? '元' : p.year}
            </T>
            <T x={monthRight - gap - width} y={y} fs={fs} w={width} align="right">
                {p.month}
            </T>
            <T x={dayRight - gap - width} y={y} fs={fs} w={width} align="right">
                {p.day}
            </T>
        </>
    );
}

// ---------------------------------------------------------------------------
// 松山市の様式（提出用・受け取り用）で共通の欄
// ---------------------------------------------------------------------------

/** 「車道・歩道・その他」の 1 文字ずつの位置（左端からのずれ。原本は 1 文字 11.24pt 刻み） */
const ROAD_PART_STEP = 11.24;

/**
 * 「車道・歩道・その他」。road.part で選んだ語だけ楕円で囲む（'' は囲まない）。
 * x = 「車」の左端、y = ベースライン。
 */
export function RoadPartMarks({ x, y, part }: { x: number; y: number; part: '' | 'roadway' | 'sidewalk' | 'other' }) {
    const xs = Array.from({ length: 9 }, (_, i) => x + ROAD_PART_STEP * i);
    const cy = y - 10.5 * 0.36;
    // 囲む範囲（文字の左端〜右端）
    const ranges: Record<'roadway' | 'sidewalk' | 'other', [number, number]> = {
        roadway: [xs[0], xs[1] + 10.5],
        sidewalk: [xs[3], xs[4] + 10.5],
        other: [xs[6], xs[8] + 10.5],
    };
    return (
        <>
            <Chars xs={xs} y={y} text="車道・歩道・その他" />
            {part !== '' && <Oval x1={ranges[part][0]} x2={ranges[part][1]} cy={cy} ry={8} padX={4} />}
        </>
    );
}

/**
 * 「舗 装 道 ･ 砂 利 道」。road.surface で選んだ方だけ楕円で囲む（'' は囲まない）。
 * x = 「舗」の左端、y = ベースライン。原本は 1 文字 14.32pt 刻み。
 */
export function RoadSurfaceMarks({ x, y, surface }: { x: number; y: number; surface: '' | 'paved' | 'gravel' }) {
    const step = 14.32;
    const xs = Array.from({ length: 7 }, (_, i) => x + step * i);
    const cy = y - 10.5 * 0.36;
    return (
        <>
            <Chars xs={xs} y={y} text="舗装道･砂利道" />
            {surface === 'paved' && <Oval x1={xs[0]} x2={xs[2] + 10.5} cy={cy} ry={8} padX={4} />}
            {surface === 'gravel' && <Oval x1={xs[4]} x2={xs[6] + 10.5} cy={cy} ry={8} padX={4} />}
        </>
    );
}

/** 「P.（ － ）」の中身。住宅地図のページが空なら原本どおり「－」 */
export function mapPageText(mapPage: string): string {
    const t = mapPage.trim();
    return t === '' ? '－' : t;
}
