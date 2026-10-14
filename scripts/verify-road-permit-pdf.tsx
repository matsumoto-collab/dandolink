/**
 * 道路申請 PDF（① 警察 ② 松山市 提出用 ③ 松山市 受け取り用）を、入力値の JSON から作って破綻がないか検証する。
 *
 * scripts/verify-joyo-statement-pdf.tsx と同じ作り。ただし **DB は使わない**（値は JSON から読むだけ）。
 * 検証用の値は原本の値をそのまま書いた docs/road-permit/forms/sample-values.json（.gitignore 済み。
 * 原本は担当者の携帯番号入りなので、リポジトリにコミットされるファイルには値を書かない）。
 *
 * チェック項目:
 *   - ページ数 = formIds の数
 *   - 各ページに主要な文言（表題・宛先・目的・場所・路線名・数量・期間など）が入っていること
 *   - 文字が右端（595 − 余白）を越えないこと
 *
 *   - 図面（--drawing か --sample-drawing）があるとき: ページ数が 1 増えること・最後のページの大きさが用紙どおりなこと・
 *     表題欄の文言（図面名・縮尺など）が入ること・文字が用紙の外に出ないこと（枠＝10mm 内側を越えたものは注意として出す）
 *
 *   - 記号（--symbols）があるとき: 図面のページに「記号が見つかりません」が出ないこと（置いた記号がすべて一覧にあること）
 *
 * 実行: npx tsx scripts/verify-road-permit-pdf.tsx --values <json> [--out <pdf>] [--drawing <json> | --sample-drawing] [--symbols <json>]
 *   例: npx tsx scripts/verify-road-permit-pdf.tsx --values docs/road-permit/forms/sample-values.json --out tmp/road.pdf
 *   図面つき: ... --values docs/road-permit/forms/sample-values.json --sample-drawing --out tmp/road-drawing.pdf
 *   --drawing の JSON は RoadPermitDrawing（normalizeRoadPermitDrawing を通す）。--sample-drawing は画面イメージの
 *   西条市の例（道路 2線・官民境界・既存建物・足場の帯・寸法・文字・引出線）をこのスクリプトの中で組み立てる。
 *   --symbols の JSON は RoadPermitSymbolDto[]（または { symbols: [...] }＝GET /api/road-permits/symbols の応答）。
 *   kei のデータ（JWW から取り込んだ形）はリポジトリに入れないので、ファイルはリポジトリの外に置いてパスで渡す。
 *   --two-occupancies を --sample-drawing と一緒に渡すと、占用範囲を 2 つ（帯＋直角三角形 508×756.8）にして ①② の印と「申請物件」のまとまりを出す。
 *   --sample-drawing と一緒に渡すと、最初の記号を 1 つ置き、コーン（分類 cone）とコーンバー（barPitchMm あり）が
 *   あれば足場の前にコーン列（11,100mm）を置く。
 * JSON は RoadPermitValues（＋ formIds。無ければ 3 様式すべて）。normalizeRoadPermitValues を通すので欠けた欄は空になる。
 */
import React from 'react';
import fs from 'fs';
import { renderToBuffer } from '@react-pdf/renderer';
import { RoadPermitDocument } from '../components/pdf/roadPermit/RoadPermitDocument';
import { normalizeRoadPermitValues } from '../lib/roadPermit/defaults';
import { isRoadPermitFormId, sortFormIds } from '../lib/roadPermit/forms';
import {
    effectiveApproxArea,
    formatHourLabel,
    formatReiwaRange,
    formatReiwaYmdOrBlank,
} from '../lib/roadPermit/format';
import { ROAD_PERMIT_FORM_IDS, type RoadPermitFormId, type RoadPermitValues } from '../types/roadPermit';
import { sanitizePdfText } from '../components/pdf/styles';
import type { DrawingEntity, DrawingLayerId, DrawingStyle, RoadPermitDrawing } from '../types/roadPermitDrawing';
import { emptyRoadPermitDrawing, isDrawingEmpty, normalizeRoadPermitDrawing } from '../lib/roadPermit/drawing/defaults';
import { drawingPaperMm, PAPER_MARGIN_MM, PT_PER_MM, scaleLabel } from '../lib/roadPermit/drawing/paper';
import { titleBlockRows } from '../components/pdf/roadPermit/DrawingPage';
import type { RoadPermitSymbolDto } from '../types/roadPermitSymbol';
import { isConeBarSymbol, normalizeRoadPermitSymbolCategory, normalizeRoadPermitSymbolGeometry, toSymbolMap } from '../lib/roadPermit/symbols/normalize';
import { coneRowLayout } from '../lib/roadPermit/symbols/place';
import { countSymbols, legendRows, legendVisibleRows, symbolMethodText } from '../lib/roadPermit/symbols/counting';
import { occupancyLabel, occupancyMark, occupancyMeasure, occupancyNoteLines } from '../lib/roadPermit/drawing/occupancy';
// styles.ts（CDNフォント）の後に評価させるため import は最後に置く
import '../lib/pdf/registerServerFonts';

const PAGE_WIDTH = 595;
/** 右の余白。原本の外枠の右端は 534pt（警察）・527.5pt（松山市）なので、それより外に文字が出たらはみ出し */
const RIGHT_MARGIN = 36;
const MAX_X = PAGE_WIDTH - RIGHT_MARGIN + 1;

interface PageInfo {
    /** 文字をつないだもの（空白は落とす。字間を空けた見出しも 1 語になる） */
    text: string;
    maxX: number;
    /** 右端を越えた文字（調べる用） */
    overflow: string[];
    /** ページの大きさ（pt） */
    width: number;
    height: number;
    /** 文字ごとの始点と終点（pt・PDF の座標＝左下原点）。回転した文字も向きに沿って終点を出す */
    items: { str: string; x1: number; y1: number; x2: number; y2: number; size: number }[];
}

async function analyze(buf: Buffer): Promise<PageInfo[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: PageInfo[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const [, , width, height] = page.view;
        let text = '';
        let maxX = 0;
        const overflow: string[] = [];
        const items: PageInfo['items'] = [];
        for (const it of content.items as { str?: string; transform: number[]; width?: number }[]) {
            if (!it.str) continue;
            text += it.str;
            {
                // 文字の始点（transform の e,f）と、文字の向き（a,b）に沿って幅だけ進んだ終点
                const [a, b, , , e, f] = it.transform;
                const size = Math.hypot(a, b);
                const w = it.width ?? 0;
                const ux = size > 0 ? a / size : 1;
                const uy = size > 0 ? b / size : 0;
                items.push({ str: it.str, x1: e, y1: f, x2: e + ux * w, y2: f + uy * w, size });
            }
            if (it.str.trim()) {
                const right = Math.round(it.transform[4] + (it.width ?? 0));
                maxX = Math.max(maxX, right);
                if (right > MAX_X) overflow.push(`${it.str}(右端 ${right})`);
            }
        }
        pages.push({ text: text.replace(/\s/g, ''), maxX, overflow, width, height, items });
    }
    return pages;
}

/** PDF の文字と比べるため、SafeText と同じ置き換え（㎡→m² など）をして空白を落とす */
function norm(s: string): string {
    return sanitizePdfText(s).replace(/\s/g, '');
}

/** 様式ごとに「入っているはずの文言」 */
function expectedTexts(id: RoadPermitFormId, v: RoadPermitValues): string[] {
    const approx = effectiveApproxArea(v.occupancy.quantity, v.occupancy.areaApprox);
    if (id === 'police-road-use') {
        const period =
            `${formatReiwaYmdOrBlank(v.period.useFrom)}${formatHourLabel(v.period.timeFrom)}から` +
            `${formatReiwaYmdOrBlank(v.period.useTo)}${formatHourLabel(v.period.timeTo)}まで`;
        return [
            '道路使用許可申請書',
            '道路使用許可証',
            `${v.police.stationName}殿`,
            v.applicant.address,
            v.applicant.companyName,
            v.applicant.representativeName,
            v.police.purpose,
            v.police.section,
            period,
            v.police.method,
            v.police.attachments,
            v.siteManager.name,
            v.siteManager.phone,
            v.police.conditionText,
            '上記のとおり許可する。ただし、次の条件に従うこと。',
            '用紙の大きさは、日本工業規格Ａ列４番とする。',
        ];
    }
    const common = [
        v.applicant.address,
        v.applicant.companyName,
        v.contact.name,
        v.contact.phone,
        v.applicant.tel,
        v.occupancy.purpose,
        `路線名${v.road.routeName}`,
        v.site.location,
        v.occupancy.name,
        v.occupancy.scaleNote,
        `${v.occupancy.quantity}㎡`,
        `約${approx}㎡`,
        formatReiwaRange(v.period.workFrom, v.period.workTo),
        formatReiwaRange(v.period.useFrom, v.period.useTo),
        v.occupancy.structure,
        v.occupancy.constructionMethod,
        '車道・歩道・その他',
    ];
    if (id === 'matsuyama-occupancy-apply') {
        return ['許可申請', '道路占用', '協議書', '新規', '変更', '道路管理者', v.matsuyama.mayorName, '第32条', '第35条', ...common, v.matsuyama.attachments, '※印の欄は，記入しないでください。'];
    }
    return ['許可', '道路占用', '回答書', ...common, '上記について次の条件により', '道路管理者', v.matsuyama.mayorName];
}

// ---------------------------------------------------------------------------
// 図面のページ
// ---------------------------------------------------------------------------

/** 図面のページを確かめる: 用紙の大きさ・表題欄の文言・文字が用紙の外に出ないこと */
function checkDrawingPage(
    pageNo: number,
    page: PageInfo,
    drawing: RoadPermitDrawing,
    values: RoadPermitValues,
    isSample: boolean,
    symbols: RoadPermitSymbolDto[] | null,
): string[] {
    const problems: string[] = [];
    if (symbols && symbols.length > 0 && page.text.includes(norm('記号が見つかりません'))) {
        problems.push(`${pageNo}ページ目（図面）に「記号が見つかりません」が出ている（置いた記号が --symbols に無い）`);
    }
    const paper = drawingPaperMm(drawing);
    const W = paper.w * PT_PER_MM;
    const H = paper.h * PT_PER_MM;
    if (Math.abs(page.width - W) > 1 || Math.abs(page.height - H) > 1) {
        problems.push(`図面のページの大きさ ${page.width.toFixed(1)}×${page.height.toFixed(1)}pt（期待 ${W.toFixed(1)}×${H.toFixed(1)}）`);
    }
    const expected: string[] = [];
    if (drawing.showTitleBlock) {
        for (const r of titleBlockRows(drawing, values)) expected.push(r.label, r.value);
    }
    if (drawing.showScaleBar || drawing.showTitleBlock) expected.push(scaleLabel(drawing.scale));
    if (drawing.showNorthArrow) expected.push('N');
    if (isSample) expected.push('市道　新屋敷線', 'くさび緊結式足場', '既存建物（改修）', '11,100', '810', '6,000');
    // 占用範囲の文字（1 つなら「路線名　式　約○㎡」・2 つ以上なら ①② の印と「申請物件」のまとまり）
    const occupancies = drawing.entities.filter((e): e is Extract<DrawingEntity, { kind: 'occupancy' }> => e.kind === 'occupancy');
    if (occupancies.length === 1) expected.push(occupancyLabel(occupancies[0]));
    else if (occupancies.length >= 2) expected.push(...occupancies.map((_, i) => occupancyMark(i)), ...occupancyNoteLines(occupancies));
    // 凡例（記号があるとき）: 見出しと、置いた記号の名前
    if (drawing.showLegend && symbols && symbols.length > 0) {
        const rows = legendRows(drawing.entities, toSymbolMap(symbols), drawing.layers);
        if (rows.length > 0) {
            expected.push('凡　例', ...legendVisibleRows(rows).rows.map((r) => r.name));
            const methodText = symbolMethodText(countSymbols(drawing.entities, toSymbolMap(symbols), drawing.layers));
            console.log(`凡例 ${rows.length} 行／方法又は形態の文: ${methodText || '（数える記号なし）'}`);
        }
    }
    for (const t of expected) {
        const n = norm(t);
        if (n !== '' && !page.text.includes(n)) problems.push(`${pageNo}ページ目（図面）に「${t}」が見つからない`);
    }
    // 印刷しないレイヤ（見本では 下敷き）の文字が出ていないこと
    if (isSample && page.text.includes(norm('下敷き（印刷しない）'))) problems.push(`${pageNo}ページ目（図面）に印刷しないレイヤの文字が出ている`);

    // 文字が用紙の外に出ないこと（書体の読み込み用に置いた 1pt の見えない文字は除く）
    const m = PAPER_MARGIN_MM * PT_PER_MM;
    const outside = (it: PageInfo['items'][number], inset: number) =>
        [it.x1, it.x2].some((x) => x < inset || x > W - inset) || [it.y1, it.y2].some((y) => y < inset || y > H - inset);
    const warnings: string[] = [];
    for (const it of page.items) {
        if (!it.str.trim() || it.size < 2) continue;
        if (outside(it, 0)) {
            problems.push(`${pageNo}ページ目（図面）の文字が用紙の外: 「${it.str}」 (${it.x1.toFixed(0)},${it.y1.toFixed(0)})〜(${it.x2.toFixed(0)},${it.y2.toFixed(0)})`);
        } else if (outside(it, m - 1)) {
            warnings.push(`「${it.str}」`);
        }
    }
    if (warnings.length > 0) console.log(`注意: 用紙の枠（10mm 内側）を越えた文字 ${warnings.length} 個: ${warnings.slice(0, 10).join(' ')}`);
    console.log(
        `${pageNo}ページ目 図面: 文字数 ${page.text.length} / ${drawing.paper.size} ${drawing.paper.orientation === 'landscape' ? '横' : '縦'} ${scaleLabel(drawing.scale)} / 図形 ${drawing.entities.length} 個`,
    );
    return problems;
}

/**
 * 見本の図面（画面イメージ docs/道路申請_作図画面イメージ.html の西条市の例）。A3 横・S=1/100。
 * 座標は実寸 mm・Y 上向き。道路は x 方向に走り、上側（y=0）が官民境界。
 *   y=0 官民境界（一点鎖線）／y=-300 側溝の内側／y=-3300 中心線（破線）／y=-6300 側溝の内側／y=-6600 官民境界
 *   既存建物 x 6,000〜20,000・y 1,500〜12,000（ハッチ）／足場の帯 x 9,000〜20,100・y -810〜0（11,100×810）
 * 寸法・占用面積などの値は西条市の過去の申請書の値（番地は省略）。
 */
function sampleDrawing(symbols: RoadPermitSymbolDto[] | null, twoOccupancies = false): RoadPermitDrawing {
    const d = emptyRoadPermitDrawing();
    let n = 0;
    const id = () => `s${++n}`;
    const st = (lineType: DrawingStyle['lineType'] = 'solid', width: DrawingStyle['width'] = 'normal'): DrawingStyle => ({
        lineType,
        width,
        color: '#000000',
    });
    const L = (layer: DrawingLayerId, ax: number, ay: number, bx: number, by: number, style = st()): DrawingEntity => ({
        id: id(),
        layer,
        style,
        kind: 'line',
        a: { x: ax, y: ay },
        b: { x: bx, y: by },
    });
    const rect = (x1: number, y1: number, x2: number, y2: number) => [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
    ];
    const text = (
        layer: DrawingLayerId,
        x: number,
        y: number,
        t: string,
        h: number,
        align: 'left' | 'center' | 'right' = 'left',
        rot = 0,
    ): DrawingEntity => ({
        id: id(),
        layer,
        style: st(),
        kind: 'text',
        at: { x, y },
        text: t,
        heightPaperMm: h,
        rotationDeg: rot,
        align,
    });
    const dim = (ax: number, ay: number, bx: number, by: number, offsetMm: number, mode: 'horizontal' | 'vertical'): DrawingEntity => ({
        id: id(),
        layer: 5,
        style: st('solid', 'thin'),
        kind: 'dimension',
        a: { x: ax, y: ay },
        b: { x: bx, y: by },
        offsetMm,
        mode,
        textOverride: null,
        heightPaperMm: 2.5,
    });
    const X1 = -2000;
    const X2 = 37000;
    const building = rect(6000, 1500, 20000, 12000);
    const scaffold = rect(9000, -810, 20100, 0);
    d.entities = [
        // 道路・境界（レイヤ 0）
        L(0, X1, 0, X2, 0, st('dashdot', 'normal')),
        L(0, X1, -300, X2, -300),
        L(0, X1, -3300, X2, -3300, st('dashed', 'thin')),
        L(0, X1, -6300, X2, -6300),
        L(0, X1, -6600, X2, -6600, st('dashdot', 'normal')),
        text(5, X1 + 200, 150, '官民境界', 2),
        text(5, X1 + 200, -250, '側溝 W300', 2),
        text(5, X1 + 200, -6550, '側溝 W300', 2),
        // 既存建物（レイヤ 1）
        { id: id(), layer: 1, style: st('solid', 'thick'), kind: 'polyline', points: building, closed: true },
        { id: id(), layer: 1, style: st('solid', 'thin'), kind: 'hatch', points: building, pattern: 'diagonal', spacingPaperMm: 3 },
        text(1, 13000, 6500, '既存建物（改修）', 4, 'center'),
        // 足場の帯（レイヤ 2）
        { id: id(), layer: 2, style: st('solid', 'thick'), kind: 'polyline', points: scaffold, closed: true },
        { id: id(), layer: 2, style: st('solid', 'thin'), kind: 'hatch', points: scaffold, pattern: 'cross', spacingPaperMm: 1.5 },
        // 寸法（レイヤ 5）: 足場の長さ・足場の幅・道路の幅
        dim(9000, -810, 20100, -810, -1500, 'horizontal'),
        dim(9000, 0, 9000, -810, -1000, 'vertical'),
        dim(2500, -300, 2500, -6300, -500, 'vertical'),
        // 文字・引出線（レイヤ 5）
        text(5, 16000, -4600, '市道　新屋敷線', 5, 'center'),
        text(5, 16000, -5400, '（幅員 6,600　車道 6,000）', 2.5, 'center'),
        text(5, 14000, -8600, '（向かい側　民地）', 2.5, 'center'),
        {
            id: id(),
            layer: 5,
            style: st('solid', 'thin'),
            kind: 'leader',
            points: [
                { x: 10500, y: -400 },
                { x: 7500, y: 2600 },
                { x: 3500, y: 2600 },
            ],
            text: 'くさび緊結式足場',
            heightPaperMm: 3,
        },
        // 占用範囲（レイヤ 2）: 足場の帯と同じ 11,100×810 → 「市道 新屋敷線　0.81×11.1＝8.991㎡　約9㎡」
        { id: id(), layer: 2, style: st('solid', 'normal'), kind: 'occupancy', points: scaffold, routeName: '市道 新屋敷線', labelAt: null },
        // 占用範囲 2 つ目（--two-occupancies のとき）: 直角三角形 508×756.8（許可が出た図面の数）→ ①② の印と「申請物件」のまとまり
        ...(twoOccupancies
            ? [
                  {
                      id: id(),
                      layer: 2 as DrawingLayerId,
                      style: st('solid', 'normal'),
                      kind: 'occupancy' as const,
                      points: [
                          { x: 20100, y: -810 },
                          { x: 20856.8, y: -810 },
                          { x: 20100, y: -302 },
                      ],
                      routeName: '',
                      labelAt: null,
                  },
              ]
            : []),
        // 下敷き（レイヤ 6・印刷しない）: PDF に出ないことを確かめるための文字
        text(6, 30000, 9000, '下敷き（印刷しない）', 3),
    ];
    // 記号（--symbols があるときだけ）: 最初の記号を 1 つ（30 度回して反転）と、足場の前のコーン列
    if (symbols && symbols.length > 0) {
        const sym = (symbolId: string, x: number, y: number, rotationDeg: number, mirrored: boolean): DrawingEntity => ({
            id: id(),
            layer: 3,
            style: st('solid', 'thin'),
            kind: 'symbol',
            symbolId,
            at: { x, y },
            rotationDeg,
            mirrored,
        });
        d.entities.push(sym(symbols[0].id, 27000, -1800, 30, true));
        const cone = symbols.find((s) => s.category === 'cone' && !isConeBarSymbol(s));
        const bar = symbols.find((s) => isConeBarSymbol(s));
        if (cone && bar) {
            const layout = coneRowLayout([{ x: 9000, y: -1300 }, { x: 20100, y: -1300 }], bar.barPitchMm ?? 0);
            for (const b of layout.bars) d.entities.push(sym(bar.id, b.at.x, b.at.y, b.rotationDeg, false));
            for (const c of layout.cones) d.entities.push(sym(cone.id, c.x, c.y, 0, false));
            console.log(`見本の図面: コーン列 コーン ${layout.cones.length} 個・コーンバー ${layout.bars.length} 本（${cone.name}・${bar.name}）`);
        }
    }
    const occ = occupancyMeasure(scaffold);
    console.log(`見本の図面: 占用範囲 ${occ.expression}`);
    // 用紙の左下隅に来る図面座標: x=-2,000 が枠の左（10mm）・道路が用紙の下 1/3 に来る位置
    d.origin = { x: -3000, y: -15000 };
    return d;
}

function usage(): never {
    console.error('使い方: npx tsx scripts/verify-road-permit-pdf.tsx --values <json> [--out <pdf>] [--drawing <json> | --sample-drawing] [--symbols <json>]');
    process.exit(1);
}

async function main() {
    const args = process.argv.slice(2);
    const arg = (name: string): string | null => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] ?? null : null;
    };
    const valuesPath = arg('--values');
    const outPath = arg('--out');
    if (!valuesPath) usage();

    const raw = JSON.parse(fs.readFileSync(valuesPath, 'utf8')) as Record<string, unknown>;
    const values = normalizeRoadPermitValues(raw);
    const rawIds = Array.isArray(raw.formIds) ? raw.formIds.filter(isRoadPermitFormId) : [...ROAD_PERMIT_FORM_IDS];
    const formIds = sortFormIds(rawIds);
    if (formIds.length === 0) {
        console.error('formIds に様式が 1 つもありません');
        process.exit(1);
    }

    // 記号の一覧（--symbols <json>）。API の応答と同じ形にそろえる（形は normalize を通す）
    const symbolsPath = arg('--symbols');
    let symbols: RoadPermitSymbolDto[] | null = null;
    if (symbolsPath) {
        const rawSymbols = JSON.parse(fs.readFileSync(symbolsPath, 'utf8')) as unknown;
        const list = Array.isArray(rawSymbols) ? rawSymbols : ((rawSymbols as { symbols?: unknown }).symbols ?? []);
        if (!Array.isArray(list)) usage();
        symbols = (list as Record<string, unknown>[]).map((o, i) => ({
            id: String(o.id ?? `symbol-${i}`),
            name: String(o.name ?? ''),
            category: normalizeRoadPermitSymbolCategory(o.category),
            countLabel: String(o.countLabel ?? ''),
            countUnit: String(o.countUnit ?? ''),
            countNote: String(o.countNote ?? ''),
            geometry: normalizeRoadPermitSymbolGeometry(o.geometry),
            lengthMm: Number(o.lengthMm ?? 0),
            widthMm: Number(o.widthMm ?? 0),
            barPitchMm: typeof o.barPitchMm === 'number' ? o.barPitchMm : null,
            sourceFile: String(o.sourceFile ?? ''),
            sourceBlock: String(o.sourceBlock ?? ''),
            sourceNote: String(o.sourceNote ?? ''),
            sortOrder: Number(o.sortOrder ?? i),
            isActive: o.isActive !== false,
            createdAt: String(o.createdAt ?? ''),
            updatedAt: String(o.updatedAt ?? ''),
        }));
        console.log(`記号 ${symbols.length} 個を読みました: ${symbols.map((x) => x.name).join('・')}`);
    }

    // 図面（--drawing <json> か --sample-drawing）。DB から読むときと同じく normalizeRoadPermitDrawing を通す
    const drawingPath = arg('--drawing');
    const useSample = !drawingPath && args.includes('--sample-drawing');
    let drawing: RoadPermitDrawing | null = null;
    if (drawingPath) drawing = normalizeRoadPermitDrawing(JSON.parse(fs.readFileSync(drawingPath, 'utf8')));
    else if (useSample) drawing = normalizeRoadPermitDrawing(JSON.parse(JSON.stringify(sampleDrawing(symbols, args.includes('--two-occupancies')))));
    const hasDrawing = drawing != null && !isDrawingEmpty(drawing);
    if (drawing && !hasDrawing) console.log('図面に図形が 1 つも無いので、図面のページは入りません');

    const buf = await renderToBuffer(
        <RoadPermitDocument values={values} formIds={formIds} drawing={drawing} includeDrawing={hasDrawing} symbols={symbols} />,
    );
    if (outPath) {
        fs.writeFileSync(outPath, buf);
        console.log(`PDF を書き出しました: ${outPath}`);
    }

    const pages = await analyze(buf);
    const problems: string[] = [];
    const expectedPages = formIds.length + (hasDrawing ? 1 : 0);
    if (pages.length !== expectedPages) problems.push(`ページ数=${pages.length}（期待 ${expectedPages}）`);
    formIds.forEach((id, i) => {
        const page = pages[i];
        if (!page) return;
        for (const t of expectedTexts(id, values)) {
            const n = norm(t);
            if (n === '') continue;
            if (!page.text.includes(n)) problems.push(`${i + 1}ページ目（${id}）に「${t}」が見つからない`);
        }
        if (page.maxX > MAX_X) problems.push(`${i + 1}ページ目 右端はみ出し maxX=${page.maxX}: ${page.overflow.join(' / ')}`);
        console.log(`${i + 1}ページ目 ${id}: 文字数 ${page.text.length} / 右端 maxX=${page.maxX}`);
    });

    if (hasDrawing && drawing) {
        const page = pages[formIds.length];
        if (page) problems.push(...checkDrawingPage(formIds.length + 1, page, drawing, values, useSample, symbols));
    }

    console.log(`期間（警察）: ${formatReiwaYmdOrBlank(values.period.useFrom)}${formatHourLabel(values.period.timeFrom)}から${formatReiwaYmdOrBlank(values.period.useTo)}${formatHourLabel(values.period.timeTo)}まで`);
    console.log(`工事の期間（松山市）: ${formatReiwaRange(values.period.workFrom, values.period.workTo)}`);
    console.log(`数量: ${values.occupancy.quantity}㎡ / 面積: 約${effectiveApproxArea(values.occupancy.quantity, values.occupancy.areaApprox)}㎡`);

    if (problems.length === 0) {
        console.log('OK');
    } else {
        console.log('問題あり:');
        for (const p of problems) console.log(`  - ${p}`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
