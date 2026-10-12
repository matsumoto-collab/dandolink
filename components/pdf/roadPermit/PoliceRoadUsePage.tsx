/**
 * ① 道路使用許可申請書（警察・別記様式第六（第十条関係））の 1 ページ。
 *
 * 原本: docs/road-permit/forms/【松山警察署】道路使用許可警察署.pdf（コミットしない）
 * 座標は原本 PDF の文字・罫線の位置（pt・左上原点・文字はベースライン）をそのまま使う。
 * 上半分 = 申請（値を入れる）／下半分 = 警察が書く許可証（文言と枠だけ。条件欄だけ conditionText を印字）。
 * 値の対応は docs/指示書_道路申請_Phase1.md §8.1。
 */
import React from 'react';
import { Page } from '@react-pdf/renderer';
import type { RoadPermitValues } from '@/types/roadPermit';
import { BLANK, formatHourLabel, formatReiwaYmdOrBlank } from '@/lib/roadPermit/format';
import { Box, Chars, DashedBox, HLine, ReiwaNumbers, Spaced, T, VLine, estimateTextWidth, pageStyle } from './roadPermitPdfShared';

// 外枠（左・右・上・下）
const L = 70.5;
const R = 534;
const TOP = 87;
const BOTTOM = 705;
/** 欄名の列と値の列の境 */
const COL = 187;
/** 値の書き出し位置 */
const VX = 192.1;
/** 値の欄の幅（右の罫線の手前まで） */
const VW = R - VX - 3;

/** 「場所又は区間」「方法又は形態」の 6 文字の位置（原本どおり） */
const SIX_XS = [75.8, 95.0, 114.1, 133.3, 152.5, 171.6];

/** 備考 1〜5（原本の文言どおり。改行の位置も原本に合わせる） */
const NOTES: { num?: string; numX?: number; x: number; y: number; text: string }[] = [
    { num: '１', numX: 123.8, x: 144.0, y: 715.0, text: '申請者が法人であるときは、申請者の欄には、その名称、主たる事務所の所在地及' },
    { x: 133.9, y: 727.0, text: 'び代表者の氏名を記載すること。' },
    { num: '２', numX: 124.3, x: 144.4, y: 739.0, text: '申請者は、氏名を記載し及び押印することに代えて、署名することができる。' },
    { num: '３', numX: 124.4, x: 144.5, y: 751.0, text: '方法又は形態の欄には、工事又は作業の方法、使用面積、行事等の参加人員、通行' },
    { x: 133.9, y: 763.0, text: 'の形態又は方法等使用について必要な事項を記載すること。' },
    { num: '４', numX: 124.4, x: 144.5, y: 775.0, text: '添付書類の欄には、道路使用の場所、方法等を明らかにした図面その他必要な書類' },
    { x: 133.9, y: 787.0, text: 'を添付した場合に、その書類名を記載すること。' },
    { num: '５', numX: 124.3, x: 144.4, y: 799.0, text: '用紙の大きさは、日本工業規格Ａ列４番とする。' },
];

export function PoliceRoadUsePage({ values }: { values: RoadPermitValues }) {
    const { applicant, siteManager, period, police } = values;

    // 「○○警察署長　殿」: 署名が長いときは「殿」を後ろへずらす
    const stationName = police.stationName.trim();
    const stationEnd = 75.8 + estimateTextWidth(stationName, 12);
    const tonoX = Math.max(173.8, stationEnd + 12);

    // 期間: 「令和8年9月5日9時から令和8年10月4日17時まで」（未入力は空けて印刷）
    const periodText =
        `${formatReiwaYmdOrBlank(period.useFrom)}${formatHourLabel(period.timeFrom)}から` +
        `${formatReiwaYmdOrBlank(period.useTo)}${formatHourLabel(period.timeTo)}まで`;

    const representative = [applicant.representativeTitle.trim(), applicant.representativeName.trim()].filter(Boolean).join(BLANK);

    return (
        <Page size="A4" style={pageStyle}>
            {/* 左上の様式名・右上の「県収入証紙」の枠（枠だけ） */}
            <T x={75.8} y={75.7}>別記様式第六（第十条関係）</T>
            <DashedBox x1={448.5} y1={51.5} x2={506} y2={83} />
            <Chars xs={[454.4, 472.6, 490.7]} y={64.7} text="県収入" />
            <Chars xs={[454.4, 490.8]} y={78.4} text="証紙" />

            {/* 外枠 */}
            <Box x1={L} y1={TOP} x2={R} y2={BOTTOM} />

            {/* ===== 申請 ===== */}
            <Spaced x={198.6} y={116.4} fs={16} step={24} text="道路使用許可申請書" />

            {/* 申請日（未入力なら「令和　年　月　日」） */}
            <T x={369.8} y={144.2}>令和</T>
            <T x={420.3} y={144.2}>年</T>
            <T x={462.3} y={144.2}>月</T>
            <T x={504.3} y={144.2}>日</T>
            <ReiwaNumbers ymd={police.applicationDate} y={144.2} yearRight={420.3} monthRight={462.3} dayRight={504.3} />

            {/* 宛先 */}
            <T x={75.8} y={161.5} fs={12} w={Math.max(98, tonoX - 75.8 - 4)} fit>
                {stationName}
            </T>
            <T x={tonoX} y={161.5} fs={14}>殿</T>

            {/* 申請者 */}
            <Chars xs={[264.8, 285.8]} y={188.7} text="住所" />
            <T x={306.8} y={188.7} w={R - 306.8 - 4} fit>{applicant.address}</T>
            <T x={264.8} y={208.4}>申請者</T>
            <T x={306.8} y={208.4} w={R - 306.8 - 4} fit>{applicant.companyName}</T>
            <Chars xs={[264.8, 285.8]} y={228.1} text="氏名" />
            <T x={306.8} y={228.1} w={R - 306.8 - 4} fit>{representative}</T>

            {/* 欄の罫線 */}
            <HLine x1={L} x2={R} y={249.8} />
            <HLine x1={L} x2={R} y={283} />
            <HLine x1={L} x2={R} y={316.5} />
            <HLine x1={L} x2={R} y={350.3} />
            <HLine x1={L} x2={R} y={383.5} />
            <HLine x1={L} x2={R} y={417} />
            <HLine x1={127} x2={R} y={442} />
            <HLine x1={L} x2={R} y={466} />
            <HLine x1={L} x2={R} y={469.5} />
            <VLine x={COL} y1={249.8} y2={466} />
            <VLine x={127} y1={417} y2={466} />
            <VLine x={319.3} y1={442} y2={466} />
            <VLine x={376} y1={442} y2={466} />

            {/* 道路使用の目的 */}
            <Spaced x={75.8} y={270.4} step={15.97} text="道路使用の目的" />
            <T x={VX} y={270.3} fs={10} w={VW} fit maxLines={2} cellTop={249.8} cellBottom={283}>{police.purpose}</T>

            {/* 場所又は区間 */}
            <Chars xs={SIX_XS} y={304.0} text="場所又は区間" />
            <T x={VX} y={304.0} w={VW} fit maxLines={2} cellTop={283} cellBottom={316.5}>{police.section}</T>

            {/* 期間 */}
            <T x={75.8} y={337.4}>期</T>
            <T x={171.7} y={337.4}>間</T>
            <T x={189.5} y={337.0} fs={10} w={R - 189.5 - 3} fit>{periodText}</T>

            {/* 方法又は形態 */}
            <Chars xs={SIX_XS} y={370.9} text="方法又は形態" />
            <T x={VX} y={370.9} w={VW} fit maxLines={2} cellTop={350.3} cellBottom={383.5}>{police.method}</T>

            {/* 添付書類 */}
            <Chars xs={[75.8, 107.8, 139.7, 171.7]} y={404.5} text="添付書類" />
            <T x={VX} y={404.5} w={VW} fit maxLines={2} cellTop={383.5} cellBottom={417}>{police.attachments}</T>

            {/* 現場責任者 */}
            <Chars xs={[75.8, 111.7]} y={438.8} text="現場" />
            <Chars xs={[75.8, 93.8, 111.7]} y={452.5} text="責任者" />
            <Chars xs={[136.1, 167.6]} y={433.4} text="住所" />
            <T x={VX} y={433.4} w={VW} fit>{siteManager.address}</T>
            <Chars xs={[136.1, 167.6]} y={457.9} text="氏名" />
            <T x={VX} y={457.9} w={319.3 - VX - 3} fit>{siteManager.name}</T>
            <Chars xs={[332.0, 353.0]} y={457.9} text="電話" />
            <T x={380.9} y={458.2} w={R - 380.9 - 3} fit>{siteManager.phone}</T>

            {/* ===== 許可証（警察が書く欄。文言と枠だけ） ===== */}
            <T x={117.8} y={486.8}>第</T>
            <T x={191.3} y={486.8}>号</T>
            <Spaced x={198.6} y={518.6} fs={16} step={32} text="道路使用許可証" />
            <T x={86.3} y={546.5}>上記のとおり許可する。ただし、次の条件に従うこと。</T>

            {/* 条件 */}
            <Box x1={85} y1={557.5} x2={514.5} y2={603.3} />
            <VLine x={179.5} y1={557.5} y2={603.3} />
            <T x={100.9} y={584.3}>条</T>
            <T x={153.4} y={584.3}>件</T>
            <T x={184.6} y={581.2} w={514.5 - 184.6 - 4} fit maxLines={3} cellTop={557.5} cellBottom={603.3}>
                {police.conditionText}
            </T>

            <T x={317.3} y={626.9}>年</T>
            <T x={369.8} y={626.9}>月</T>
            <T x={422.3} y={626.9}>日</T>

            <Chars xs={[338.3, 359.3, 380.3, 401.3]} y={669.4} fs={14} text="警察署長" />
            {/* 「印」は四角で囲む（原本の □＋印） */}
            <Box x1={447.6} y1={658.6} x2={459.6} y2={670.6} />
            <T x={448.8} y={668.6} fs={10.5}>印</T>

            {/* ===== 備考（外枠の下） ===== */}
            <T x={93.5} y={715.0} fs={10}>備考</T>
            {NOTES.map((n, i) => (
                <React.Fragment key={i}>
                    {n.num && n.numX != null && (
                        <T x={n.numX} y={n.y} fs={10}>
                            {n.num}
                        </T>
                    )}
                    <T x={n.x} y={n.y} fs={10}>
                        {n.text}
                    </T>
                </React.Fragment>
            ))}
        </Page>
    );
}
