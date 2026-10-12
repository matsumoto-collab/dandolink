/**
 * ② 道路占用 許可申請書／協議書（松山市・提出用）の 1 ページ。
 *
 * 原本: docs/road-permit/forms/【松山市役所】道路占用許可表紙　提出.pdf（コミットしない）
 * 座標は原本 PDF の文字・罫線の位置（pt・左上原点・文字はベースライン）をそのまま使う。
 * 値の対応は docs/指示書_道路申請_Phase1.md §8.2。
 * ○ 囲み（許可申請／協議・新規／変更・第32条／第35条・許可を申請／協議・車道／歩道／その他・舗装道／砂利道）は
 * 選んだ方だけ楕円を描く。未選択は何も囲まない。
 */
import React from 'react';
import { Page } from '@react-pdf/renderer';
import type { RoadPermitValues } from '@/types/roadPermit';
import { effectiveApproxArea, formatReiwaRange, reiwaParts } from '@/lib/roadPermit/format';
import {
    Box,
    Chars,
    CircledText,
    HLine,
    Oval,
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
const R = 527.5;

export function MatsuyamaOccupancyApplyPage({ values }: { values: RoadPermitValues }) {
    const { matsuyama, applicant, contact, period, road, occupancy } = values;
    const approx = effectiveApproxArea(occupancy.quantity, occupancy.areaApprox);
    const isPermit = matsuyama.kind === 'permit';
    const isConsult = matsuyama.kind === 'consult';
    const isChange = matsuyama.newOrChange === 'change';
    const prev = reiwaParts(isChange ? matsuyama.previousPermitDate : '');

    return (
        <Page size="A4" style={pageStyle}>
            {/* ===== 表題「道路占用 許可申請／協議 書」 ===== */}
            <Chars xs={[189.1, 212.7, 236.3, 260.0]} y={107.0} fs={11} text="許可申請" />
            <Chars xs={[94.4, 118.0, 141.7, 165.4]} y={121.3} fs={11} text="道路占用" />
            <Chars xs={[189.1, 260.0]} y={121.3} fs={11} text="協議" />
            <T x={283.7} y={121.3} fs={11}>書</T>
            {isPermit && <Oval x1={189.1} x2={271.1} cy={103.0} ry={8.5} padX={7} />}
            {isConsult && <Oval x1={189.1} x2={271.1} cy={117.3} ry={8.5} padX={7} />}

            {/* ===== 右上: 新規／変更・許可番号・年月日 ===== */}
            <Box x1={359} y1={89} x2={527.5} y2={131} />
            <VLine x={377} y1={89} y2={131} />
            <VLine x={395} y1={89} y2={131} />
            <HLine x1={395} x2={527.5} y={103} />
            <T x={364.0} y={107.0}>新</T>
            <T x={364.0} y={120.7}>規</T>
            <T x={382.0} y={107.0}>変</T>
            <T x={382.0} y={120.7}>更</T>
            {matsuyama.newOrChange === 'new' && <Oval x1={364.0} x2={374.5} cy={109.6} ry={16} padX={2.6} />}
            {isChange && <Oval x1={382.0} x2={392.5} cy={109.6} ry={16} padX={2.6} />}
            <Chars xs={[404.6, 421.6, 438.7, 455.6, 466.2, 472.4, 489.7, 506.6]} y={100.0} text="許可番号･年月日" />
            <T x={454.6} y={114.1}>第</T>
            <T x={511.3} y={114.1}>号</T>
            <T x={443.2} y={127.7}>年</T>
            <T x={477.2} y={127.7}>月</T>
            <T x={511.3} y={127.7}>日</T>
            {/* 従前の許可番号・年月日は「変更」のときだけ */}
            {isChange && (
                <>
                    <T x={466.6} y={114.1} w={43} align="center" fit>{matsuyama.previousPermitNo}</T>
                    {prev.year != null && (
                        <>
                            <T x={397} y={127.7} w={44.5} align="right">{`令和${prev.year === 1 ? '元' : prev.year}`}</T>
                            <T x={454.5} y={127.7} w={21} align="right">{prev.month}</T>
                            <T x={488.5} y={127.7} w={21} align="right">{prev.day}</T>
                        </>
                    )}
                </>
            )}

            {/* 申請日 */}
            <T x={386.5} y={141.9}>令和</T>
            <T x={431.9} y={141.9}>年</T>
            <T x={465.9} y={141.9}>月</T>
            <T x={511.3} y={141.9}>日</T>
            <ReiwaNumbers ymd={matsuyama.applicationDate} y={141.9} yearRight={431.9} monthRight={465.9} dayRight={511.3} />

            {/* ===== 宛先（道路管理者） ===== */}
            <T x={70.9} y={172.0}>（あて先）</T>
            <T x={82.3} y={185.6}>道路管理者</T>
            <T x={82.3} y={199.3} w={230} fit>{matsuyama.mayorName}</T>

            {/* ===== 申請者（住所・氏名・担当者・連絡先） ===== */}
            <Chars xs={[320.4, 343.1]} y={185.6} text="住所" />
            <T x={365.8} y={185.6} w={R - 365.8} fit>{applicant.address}</T>
            <Chars xs={[320.4, 343.1]} y={199.3} text="氏名" />
            <T x={365.8} y={199.3} w={R - 365.8} fit>{applicant.companyName}</T>
            <T x={320.4} y={212.9}>担当者</T>
            <T x={365.8} y={212.9} w={R - 365.8} fit>{contact.name}</T>
            <T x={320.3} y={226.6}>連絡先</T>
            <T x={365.6} y={226.6} w={R - 365.6} fit>{contact.phone}</T>

            {/* ===== 「道路法 第32条／第35条 の規定により 許可を申請／協議 します。」 ===== */}
            <CircledText x={116.3} y={247.1} text="第32条" selected={matsuyama.article === '32'} padX={5} />
            <CircledText x={241.0} y={247.1} text="許可を申請" selected={isPermit} padX={5} />
            <T x={70.9} y={260.8}>道路法</T>
            <CircledText x={116.3} y={260.8} text="第35条" selected={matsuyama.article === '35'} padX={5} />
            <T x={161.6} y={260.8}>の規定により</T>
            <CircledText x={241.0} y={260.8} text="協議" xs={[241.0, 286.4]} selected={isConsult} padX={5} />
            <T x={309.1} y={260.8}>します。</T>

            {/* ===== 表（占用の目的〜工事者） ===== */}
            {/* 外枠の左右・欄名の列 */}
            <VLine x={L} y1={264} y2={660.5} />
            <VLine x={133.5} y1={264} y2={660.5} />
            <VLine x={R} y1={264} y2={660.5} />
            {/* 欄の横線 */}
            <HLine x1={L} x2={R} y={264} />
            <HLine x1={L} x2={R} y={293.5} />
            <HLine x1={133.5} x2={R} y={313.5} />
            <HLine x1={385.5} x2={R} y={331} />
            <HLine x1={L} x2={R} y={349} />
            <HLine x1={L} x2={R} y={390} />
            <HLine x1={L} x2={R} y={415} />
            <HLine x1={L} x2={R} y={452} />
            <HLine x1={L} x2={R} y={488.5} />
            <HLine x1={L} x2={R} y={516.5} />
            <HLine x1={L} x2={R} y={558} />
            <HLine x1={133.5} x2={R} y={586} />
            <HLine x1={L} x2={R} y={613.5} />
            <HLine x1={L} x2={R} y={660.5} />

            {/* 占用の目的 */}
            <T x={71.5} y={282.6}>占用の目的</T>
            <T x={138.8} y={275.0} w={R - 138.8 - 3} fit maxLines={2} cellTop={264} cellBottom={293.5}>{occupancy.purpose}</T>

            {/* 占用の場所（路線名・場所・車道／歩道／その他・舗装道／砂利道・P.） */}
            <VLine x={181} y1={293.5} y2={313.5} />
            <VLine x={160} y1={313.5} y2={349} />
            <VLine x={385.5} y1={293.5} y2={349} />
            <T x={71.5} y={325.0}>占用の場所</T>
            <T x={138.8} y={307.3}>路線名</T>
            <T x={186.1} y={307.3} w={385.5 - 186.1 - 3} fit>{road.routeName}</T>
            <RoadPartMarks x={390.8} y={307.3} part={road.part} />
            <RoadSurfaceMarks x={408.5} y={326.2} surface={road.surface} />
            <T x={139.4} y={329.0}>場</T>
            <T x={139.4} y={340.3}>所</T>
            <T x={165.1} y={335.0} w={385.5 - 165.1 - 3} fit maxLines={2} cellTop={313.5} cellBottom={349}>{values.site.location}</T>
            <T x={390.8} y={343.9}>P．</T>
            <T x={430.5} y={343.9}>（</T>
            <T x={442} y={343.9} w={66} align="center" fit>{mapPageText(road.mapPage)}</T>
            <T x={509.9} y={343.9}>）</T>

            {/* 占用物件（名称・規模・数量・面積） */}
            <VLine x={202} y1={349} y2={390} />
            <VLine x={413.8} y1={349} y2={390} />
            <Spaced x={74.2} y={373.4} step={13.5} text="占用物件" />
            <T x={138.8} y={359.8}>名称</T>
            <T x={138.8} y={373.4} w={202 - 138.8 - 3} fit>{occupancy.name}</T>
            <T x={207.1} y={359.8}>規模</T>
            <T x={207} y={373.4} w={180} align="center" fit>{occupancy.scaleNote}</T>
            <T x={218.5} y={387.1}>長さ</T>
            <T x={242.5} y={387.1} w={42} align="center" fit>{occupancy.length}</T>
            <T x={286.5} y={387.1}>幅</T>
            <T x={298.5} y={387.1} w={60} align="left" fit>{occupancy.width}</T>
            <T x={418.9} y={359.8} w={R - 418.9 - 2} fit>{`数量${occupancy.quantity}㎡基・本`}</T>
            <T x={418.9} y={387.1}>面積</T>
            <T x={452.9} y={387.1}>約</T>
            <T x={464} y={387.1} w={28} align="center" fit>{approx}</T>
            <T x={492.6} y={387.1}>㎡</T>

            {/* 掘削面積（通常は空） */}
            <VLine x={265} y1={390} y2={415} />
            <VLine x={396} y1={390} y2={415} />
            <Spaced x={70.6} y={406.6} step={15.67} text="掘削面積" />
            <T x={138.8} y={406.6}>長さ</T>
            <T x={162} y={406.6} w={76} align="right" fit>{occupancy.excavationLength}</T>
            <T x={240.9} y={406.6}>ｍ</T>
            <T x={270.1} y={406.6}>幅</T>
            <T x={283} y={406.6} w={87} align="right" fit>{occupancy.excavationWidth}</T>
            <T x={372.1} y={406.6}>ｍ</T>
            <T x={401.2} y={406.6}>面積</T>
            <T x={425} y={406.6} w={76} align="right" fit>{occupancy.excavationArea}</T>
            <T x={503.3} y={406.6}>㎡</T>

            {/* 工事の期間・占用物件の構造 */}
            <VLine x={389.5} y1={415} y2={488.5} />
            <VLine x={446.5} y1={415} y2={488.5} />
            <T x={70.6} y={437.4}>工事の期間</T>
            <T x={138.8} y={437.4} w={389.5 - 138.8 - 3} fit>{formatReiwaRange(period.workFrom, period.workTo)}</T>
            <T x={394.8} y={430.6}>占用物件</T>
            <T x={394.8} y={444.2}>の構造</T>
            <T x={451.5} y={437.4} w={R - 451.5 - 3} fit maxLines={2} cellTop={415} cellBottom={452}>{occupancy.structure}</T>

            {/* ※占用の期間・工事実施の方法 */}
            <T x={70.6} y={467.5}>※</T>
            <T x={71.5} y={481.1}>占用の期間</T>
            <T x={138.8} y={474.3} w={389.5 - 138.8 - 3} fit>{formatReiwaRange(period.useFrom, period.useTo)}</T>
            <T x={394.8} y={467.5}>工事実施</T>
            <T x={394.8} y={481.1}>の方法</T>
            <T x={451.5} y={474.3} w={R - 451.5 - 3} fit maxLines={2} cellTop={452} cellBottom={488.5}>{occupancy.constructionMethod}</T>

            {/* ※占用料（市が書く欄） */}
            <T x={70.6} y={499.8}>※</T>
            <Spaced x={79.9} y={513.5} step={14.6} text="占用料" />

            {/* ※道路の復旧方法 */}
            <T x={70.6} y={527.6}>※</T>
            <Chars xs={[77.1, 94.6, 112.1]} y={541.3} text="道路の" />
            <Spaced x={77.1} y={554.9} step={12.7} text="復旧方法" />
            <T x={138.8} y={541.3} w={R - 138.8 - 3} fit maxLines={2} cellTop={516.5} cellBottom={558}>{occupancy.restorationMethod}</T>

            {/* 工事者（申請者の住所・会社名・電話） */}
            <VLine x={182} y1={558} y2={660.5} />
            <VLine x={391} y1={586} y2={613.5} />
            <Chars xs={[71.5, 94.1, 116.8]} y={589.6} text="工事者" />
            <Chars xs={[141.0, 163.7]} y={576.1} text="住所" />
            <T x={187.1} y={576.1} w={R - 187.1 - 3} fit>{applicant.address}</T>
            <Chars xs={[141.0, 163.7]} y={603.7} text="氏名" />
            <T x={187.1} y={603.7} w={391 - 187.1 - 3} fit>{applicant.companyName}</T>
            <T x={396.1} y={603.7} w={R - 396.1 - 3} fit>{applicant.tel}</T>

            {/* ===== 検認（下水道サービス課・河川水路課・公営企業局。枠だけ） ===== */}
            {[222, 253.5, 267.5, 296.8, 339.5, 382, 411, 427.5, 455.5, 498.5].map((x) => (
                <VLine key={x} x={x} y1={613.5} y2={660.5} />
            ))}
            <T x={77.1} y={640.9}>検</T>
            <T x={111.1} y={640.9}>認</T>
            <T x={141.8} y={634.2} fs={10}>下水道</T>
            <T x={139.1} y={647.2} fs={10}>ｻｰﾋﾞｽ課</T>
            <Chars xs={[181.3, 194.7, 208.1]} y={628.0} fs={10} text="主副主" />
            <T x={194.7} y={638.8} fs={10}>主</T>
            <Chars xs={[181.3, 194.7, 208.1]} y={649.7} fs={10} text="幹幹査" />
            <T x={253.1} y={628.0} fs={10}>担</T>
            <T x={253.1} y={649.7} fs={10}>当</T>
            <Chars xs={[302.0, 323.7]} y={634.2} fs={10} text="河川" />
            <T x={302.0} y={647.2} fs={10}>水路課</T>
            <Chars xs={[340.1, 353.6, 367.0]} y={628.0} fs={10} text="主副主" />
            <T x={353.6} y={638.8} fs={10}>主</T>
            <Chars xs={[340.1, 353.6, 367.0]} y={649.7} fs={10} text="幹幹査" />
            <T x={412.0} y={628.0} fs={10}>担</T>
            <T x={412.0} y={649.7} fs={10}>当</T>
            <Chars xs={[460.8, 482.5]} y={634.2} fs={10} text="公営" />
            <T x={460.8} y={647.2} fs={10}>企業局</T>

            {/* ===== 添付書類 ===== */}
            <HLine x1={L} x2={R} y={690} />
            <VLine x={L} y1={660.5} y2={690} />
            <VLine x={133.5} y1={660.5} y2={690} />
            <VLine x={R} y1={660.5} y2={690} />
            <Spaced x={77.1} y={679.2} step={12.7} text="添付書類" />
            <T x={138.8} y={678.3} fs={8} w={R - 138.8 - 3} fit minFs={5} maxLines={2} cellTop={660.5} cellBottom={690}>
                {matsuyama.attachments}
            </T>

            <T x={70.9} y={706.1}>※印の欄は，記入しないでください。</T>
        </Page>
    );
}
