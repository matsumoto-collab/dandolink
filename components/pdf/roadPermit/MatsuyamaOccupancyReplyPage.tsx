/**
 * ③ 道路占用 許可書／回答書（松山市・受け取り用）の 1 ページ。
 *
 * 原本: docs/road-permit/forms/【松山市役所】道路占用許可表紙　受け取り.pdf（コミットしない）
 * 座標は原本 PDF の文字・罫線の位置（pt・左上原点・文字はベースライン）をそのまま使う。
 * ② 提出用と同じ値を、この様式の配置で入れる（docs/指示書_道路申請_Phase1.md §8.3）。
 *
 * 下の「第　号／令和　年　月　日／上記について次の条件により 許可／回答 する／道路管理者 松山市長」は
 * **市が書く欄**なので、番号・日付は空けて印刷し、「許可／回答」も囲まない。
 * 番号の頭（原本の「4松（都生）第占」）は部署名・年が変わるため印字せず「第　号」だけにする（§14-1 で kei に確認中）。
 */
import React from 'react';
import { Page } from '@react-pdf/renderer';
import type { RoadPermitValues } from '@/types/roadPermit';
import { effectiveApproxArea, formatReiwaRange } from '@/lib/roadPermit/format';
import {
    Chars,
    DashedBox,
    HLine,
    ReiwaNumbers,
    RoadPartMarks,
    RoadSurfaceMarks,
    Spaced,
    T,
    VLine,
    mapPageText,
    pageStyle,
} from './roadPermitPdfShared';

/** 表の左端・右端 */
const L = 65.5;
const R = 527;

export function MatsuyamaOccupancyReplyPage({ values }: { values: RoadPermitValues }) {
    const { matsuyama, applicant, contact, period, road, occupancy } = values;
    const approx = effectiveApproxArea(occupancy.quantity, occupancy.areaApprox);

    return (
        <Page size="A4" style={pageStyle}>
            {/* ===== 表題「道路占用 許可／回答 書」。市が許可／回答を決めて書く用紙なので、原本どおり ○ は付けない ===== */}
            <Chars xs={[320.3, 343.9]} y={106.7} fs={11} text="許可" />
            <Chars xs={[202.0, 225.7, 249.3, 273.0]} y={121.0} fs={11} text="道路占用" />
            <Chars xs={[320.3, 344.0]} y={121.0} fs={11} text="回答" />
            <T x={379.5} y={121.0} fs={11}>書</T>

            {/* 申請日 */}
            <T x={380.8} y={155.0}>令和</T>
            <T x={431.8} y={155.0}>年</T>
            <T x={465.8} y={155.0}>月</T>
            <T x={511.1} y={155.0}>日</T>
            <ReiwaNumbers ymd={matsuyama.applicationDate} y={155.0} yearRight={431.8} monthRight={465.8} dayRight={511.1} />

            {/* ===== 申請者（住所・氏名・担当者・連絡先） ===== */}
            <Chars xs={[297.7, 320.4]} y={185.0} text="住所" />
            <T x={343.1} y={185.0} w={R - 343.1} fit>{applicant.address}</T>
            <Chars xs={[297.7, 320.4]} y={198.7} text="氏名" />
            <T x={343.1} y={198.7} w={R - 343.1} fit>{applicant.companyName}</T>
            <T x={297.7} y={212.3}>担当者</T>
            <T x={343.1} y={212.3} w={R - 343.1} fit>{contact.name}</T>
            <T x={297.7} y={226.0}>連絡先</T>
            <T x={343.0} y={226.0} w={R - 343.0} fit>{contact.phone}</T>

            {/* ===== 表（占用の目的〜工事者） ===== */}
            <VLine x={L} y1={270} y2={626} />
            <VLine x={133.5} y1={270} y2={626} />
            <VLine x={R} y1={270} y2={626} />
            <HLine x1={L} x2={R} y={270} />
            <HLine x1={L} x2={R} y={302} />
            <HLine x1={133.5} x2={R} y={316} />
            <HLine x1={385.5} x2={R} y={338} />
            <HLine x1={L} x2={R} y={361.5} />
            <HLine x1={L} x2={R} y={403} />
            <HLine x1={L} x2={R} y={428} />
            <HLine x1={L} x2={R} y={464.5} />
            <HLine x1={L} x2={R} y={501.5} />
            <HLine x1={L} x2={R} y={529.5} />
            <HLine x1={L} x2={R} y={571} />
            <HLine x1={133.5} x2={R} y={599} />
            <HLine x1={L} x2={R} y={626} />

            {/* 占用の目的 */}
            <T x={71.5} y={289.8}>占用の目的</T>
            <T x={138.8} y={280.9} w={R - 138.8 - 3} fit maxLines={2} cellTop={270} cellBottom={302}>{occupancy.purpose}</T>

            {/* 占用の場所 */}
            <VLine x={181} y1={302} y2={316} />
            <VLine x={160} y1={316} y2={361.5} />
            <VLine x={385.5} y1={302} y2={361.5} />
            <T x={71.5} y={335.7}>占用の場所</T>
            <T x={138.8} y={312.8}>路線名</T>
            <T x={186.1} y={312.8} w={385.5 - 186.1 - 3} fit>{road.routeName}</T>
            <RoadPartMarks x={405.6} y={312.8} part={road.part} />
            <RoadSurfaceMarks x={408.4} y={331.0} surface={road.surface} />
            <T x={139.4} y={336.7}>場</T>
            <T x={139.4} y={348.0}>所</T>
            <T x={165.1} y={342.8} w={385.5 - 165.1 - 3} fit maxLines={2} cellTop={316} cellBottom={361.5}>{values.site.location}</T>
            <T x={390.8} y={353.8}>P、</T>
            <T x={430.5} y={353.8}>（</T>
            <T x={442} y={353.8} w={66} align="center" fit>{mapPageText(road.mapPage)}</T>
            <T x={509.9} y={353.8}>）</T>

            {/* 占用物件（名称・規模・数量・面積） */}
            <VLine x={202} y1={361.5} y2={403} />
            <VLine x={413.8} y1={361.5} y2={403} />
            <Spaced x={74.2} y={386.3} step={13.5} text="占用物件" />
            <T x={138.8} y={372.7}>名称</T>
            <T x={138.8} y={400.0} w={202 - 138.8 - 3} fit>{occupancy.name}</T>
            <T x={207.1} y={372.7}>規模</T>
            <T x={207} y={386.3} w={204} align="center" fit>{occupancy.scaleNote}</T>
            <T x={218.5} y={400.0}>長さ</T>
            <T x={241.5} y={400.0} w={33} align="center" fit>{occupancy.length}</T>
            <T x={275.2} y={400.0}>ｍ・幅</T>
            <T x={309} y={400.0} w={33.5} align="center" fit>{occupancy.width}</T>
            <T x={343.2} y={400.0}>ｍ</T>
            <T x={418.9} y={372.7} w={R - 418.9 - 2} fit>{`数量.${occupancy.quantity}㎡基・本`}</T>
            <T x={418.9} y={386.3}>面積</T>
            <T x={452.9} y={386.3}>約</T>
            <T x={464} y={386.3} w={28} align="center" fit>{approx}</T>
            <T x={492.6} y={386.3}>㎡</T>

            {/* 掘削面積（通常は空） */}
            <VLine x={265} y1={403} y2={428} />
            <VLine x={396} y1={403} y2={428} />
            <Spaced x={70.6} y={419.5} step={15.67} text="掘削面積" />
            <T x={138.8} y={419.5}>長さ</T>
            <T x={162} y={419.5} w={76} align="right" fit>{occupancy.excavationLength}</T>
            <T x={240.9} y={419.5}>ｍ</T>
            <T x={270.0} y={419.5}>幅</T>
            <T x={283} y={419.5} w={87} align="right" fit>{occupancy.excavationWidth}</T>
            <T x={372.1} y={419.5}>ｍ</T>
            <T x={401.2} y={419.5}>面積</T>
            <T x={425} y={419.5} w={76} align="right" fit>{occupancy.excavationArea}</T>
            <T x={503.2} y={419.5}>㎡</T>

            {/* 工事の期間・占用物件の構造 */}
            <VLine x={396.5} y1={428} y2={501.5} />
            <VLine x={453.5} y1={428} y2={501.5} />
            <T x={70.6} y={450.2}>工事の期間</T>
            <T x={138.8} y={450.1} fs={10} w={396.5 - 138.8 - 3} fit>{formatReiwaRange(period.workFrom, period.workTo)}</T>
            <T x={401.9} y={443.5}>占用物件</T>
            <Spaced x={401.9} y={457.1} step={14.6} text="の構造" />
            <T x={458.6} y={450.2} w={R - 458.6 - 3} fit maxLines={2} cellTop={428} cellBottom={464.5}>{occupancy.structure}</T>

            {/* ※占用の期間・工事実施の方法 */}
            <T x={70.6} y={480.3}>※</T>
            <T x={71.5} y={494.0}>占用の期間</T>
            <T x={138.8} y={487.0} fs={10} w={396.5 - 138.8 - 3} fit>{formatReiwaRange(period.useFrom, period.useTo)}</T>
            <T x={401.9} y={480.3}>工事実施</T>
            <Spaced x={401.9} y={494.0} step={14.6} text="の方法" />
            <T x={458.6} y={487.1} w={R - 458.6 - 3} fit maxLines={2} cellTop={464.5} cellBottom={501.5}>{occupancy.constructionMethod}</T>

            {/* ※占用料（市が書く欄） */}
            <T x={70.6} y={512.6}>※</T>
            <Spaced x={79.9} y={526.3} step={14.6} text="占用料" />

            {/* ※道路の復旧方法 */}
            <T x={70.6} y={540.5}>※</T>
            <Spaced x={79.9} y={554.1} step={14.6} text="道路の" />
            <T x={77.1} y={567.8}>復旧方法</T>
            <T x={138.8} y={554.1} w={R - 138.8 - 3} fit maxLines={2} cellTop={529.5} cellBottom={571}>{occupancy.restorationMethod}</T>

            {/* 工事者 */}
            <VLine x={181} y1={571} y2={626} />
            <VLine x={391} y1={599} y2={626} />
            <Spaced x={79.9} y={602.5} step={14.6} text="工事者" />
            <Chars xs={[140.5, 163.2]} y={588.9} text="住所" />
            <T x={186.1} y={588.9} w={R - 186.1 - 3} fit>{applicant.address}</T>
            <Chars xs={[140.5, 163.2]} y={616.5} text="氏名" />
            <T x={186.1} y={616.5} w={391 - 186.1 - 3} fit>{applicant.companyName}</T>
            <T x={396.1} y={616.5} w={R - 396.1 - 3} fit>{applicant.tel}</T>

            {/* ===== 市が書く欄（番号・日付は空けて印刷） ===== */}
            <T x={423.0} y={642.2}>第</T>
            <T x={513.1} y={642.2}>号</T>
            <T x={365.6} y={665.9}>令和</T>
            <T x={422.3} y={665.9}>年</T>
            <T x={467.7} y={665.9}>月</T>
            <T x={513.1} y={665.9}>日</T>
            <T x={70.9} y={689.6}>上記について次の条件により</T>
            <Chars xs={[241.1, 263.8]} y={689.8} text="許可" />
            <T x={297.7} y={689.6}>する</T>
            <Chars xs={[241.1, 263.8]} y={713.5} text="回答" />
            <T x={320.4} y={737.0}>道路管理者</T>
            <T x={320.4} y={760.9} w={498.5 - 320.4 - 4} fit>{matsuyama.mayorName}</T>
            <DashedBox x1={498.5} y1={722} x2={538} y2={770} dash="1 1" />
            <T x={516.1} y={763.4}>印</T>
        </Page>
    );
}
