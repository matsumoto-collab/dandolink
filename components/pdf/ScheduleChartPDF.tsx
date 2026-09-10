'use client';

/**
 * 工程表（A3横）の PDF。手書き様式の工程表に合わせたレイアウト。
 *
 * ・上段: タイトル「工 程 表」＋ 工事名/工程名/工期（左）・責任者/作成者/作成日（右）の記入欄
 * ・表本体: 1案件＝「組立 / その他 / 解体」の3行。左に現場名（3行ぶち抜き）と工程名の列、
 *           横軸は日付（134日以内なら1日1目盛、超えたら月ごとの5日刻み）、右端に備考列
 * ・最下段: 備考欄
 *
 * 罫線・バーはセルを並べるのではなく、表本体を基準にした絶対配置で描いている。
 * 目盛が最大134列まで伸びるため、セルを View で並べると1ページ数千要素になり
 * 生成が重くなる。絶対配置なら「行＋縦線＋バー」の数（数百）で済む。
 */
import React from 'react';
import { Document, Page, View } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { fitCellFontSize, wrapTextToWidth } from '@/components/pdf/styles';
import { WORK_CATEGORIES, type ScheduleChart, type ScheduleChartRow } from '@/lib/scheduleChart';

// フォント登録（NotoSansJP）の副作用を取り込む
import '@/components/pdf/styles';

// ---------------------------------------------------------------- 寸法

/** A3 横（pt）。react-pdf の size="A3" orientation="landscape" と同じ値 */
const PAGE_WIDTH = 1190.55;
const PAGE_HEIGHT = 841.89;
const PADDING_X = 24;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 18;
const CONTENT_WIDTH = PAGE_WIDTH - PADDING_X * 2;

const TITLE_HEIGHT = 26;
const INFO_ROW_HEIGHT = 20;
const INFO_HEIGHT = INFO_ROW_HEIGHT * 3;
const LEGEND_HEIGHT = 14;
const HEADER_MONTH_HEIGHT = 15;
const HEADER_CELL_HEIGHT = 14;
const HEADER_HEIGHT = HEADER_MONTH_HEIGHT + HEADER_CELL_HEIGHT;
const REMARKS_BOX_HEIGHT = 46;
const FOOTER_HEIGHT = 12;

/** 現場名の列。長い現場名も2行で収まる幅 */
const NAME_COL_WIDTH = 118;
/** 工程名（組立/その他/解体）の列 */
const TYPE_COL_WIDTH = 44;
const REMARK_COL_WIDTH = 66;
const GRID_WIDTH = CONTENT_WIDTH - NAME_COL_WIDTH - TYPE_COL_WIDTH - REMARK_COL_WIDTH;

/** 1案件あたりの工程行数（組立・その他・解体） */
const LINES_PER_PROJECT = WORK_CATEGORIES.length;

const MIN_ROW_HEIGHT = 14;
const MAX_ROW_HEIGHT = 24;

const AVAILABLE_BODY_HEIGHT =
    PAGE_HEIGHT - PADDING_TOP - PADDING_BOTTOM - TITLE_HEIGHT - INFO_HEIGHT -
    LEGEND_HEIGHT - HEADER_HEIGHT - REMARKS_BOX_HEIGHT - FOOTER_HEIGHT;

/** 1ページに入る案件数 */
export const PROJECTS_PER_PAGE = Math.max(
    1,
    Math.floor(AVAILABLE_BODY_HEIGHT / (MIN_ROW_HEIGHT * LINES_PER_PROJECT)),
);

// ---------------------------------------------------------------- 配色

const LINE = '#b9d7e4';
/** 5日ごとの区切り（1日単位の目盛で日付を追いやすくする） */
const LINE_MID = '#8fb9cc';
const LINE_STRONG = '#4c7f99';
const HEAD_BG = '#eaf4f9';
const NAME_BG = '#dceef6';
const TYPE_BG = '#f2f9fc';
const TEXT = '#1f2937';

// ---------------------------------------------------------------- 型

export interface ScheduleChartMeta {
    /** 工事名（複数案件をまとめる用途では空欄のまま＝手書き用） */
    projectName?: string;
    processName?: string;
    /** 工期（buildScheduleChart の termLabel をそのまま渡す想定） */
    term?: string;
    supervisor?: string;
    author?: string;
    /** 作成日（例: 2026/9/10） */
    createdAt?: string;
}

interface ScheduleChartPDFProps {
    chart: ScheduleChart;
    meta: ScheduleChartMeta;
}

// ---------------------------------------------------------------- 部品

function InfoField({ label, value, boxWidth }: { label: string; value: string; boxWidth: number }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', height: INFO_ROW_HEIGHT }}>
            <Text style={{ fontSize: 8, color: TEXT, width: 44 }}>{label}</Text>
            <View
                style={{
                    width: boxWidth,
                    height: 16,
                    borderWidth: 0.5,
                    borderColor: LINE_STRONG,
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                }}
            >
                <Text style={{ fontSize: 8, color: TEXT }}>{value}</Text>
            </View>
        </View>
    );
}

/** 各目盛の左端（列インデックス）→ 表示ラベルと月の切れ目 */
interface GridColumn {
    label: string;
    /** 1日1目盛のときの日付（5日刻みのときは null） */
    day: number | null;
    /** その月の最初の目盛か */
    monthStart: boolean;
}

function buildGridColumns(chart: ScheduleChart): GridColumn[] {
    const columns: GridColumn[] = [];
    for (const month of chart.months) {
        month.cellLabels.forEach((label, i) => {
            columns.push({
                label,
                day: chart.scale === 'day' ? Number(label) : null,
                monthStart: i === 0,
            });
        });
    }
    return columns;
}

/**
 * 目盛が細いときに日付を間引く。
 * 幅に余裕があれば毎日、無ければ 1日・5日・10日… だけを出す（縦罫線は毎日引いたまま）。
 */
function makeLabelFilter(chart: ScheduleChart, cellWidth: number): (column: GridColumn) => boolean {
    if (chart.scale !== 'day' || cellWidth >= 12) return () => true;
    return column => column.day !== null && (column.day === 1 || column.day % 5 === 0);
}

/** 縦罫線の濃さ: 月の切れ目＞5日ごと＞1日ごと */
function gridLineColor(column: GridColumn): string {
    if (column.monthStart) return LINE_STRONG;
    if (column.day !== null && (column.day - 1) % 5 === 0) return LINE_MID;
    return LINE;
}

const GRID_LEFT = NAME_COL_WIDTH + TYPE_COL_WIDTH;

/** 表ヘッダー（月の見出し＋日付の目盛） */
function ChartHeader({
    chart,
    columns,
    cellWidth,
}: {
    chart: ScheduleChart;
    columns: GridColumn[];
    cellWidth: number;
}) {
    const showLabel = makeLabelFilter(chart, cellWidth);
    const labelFontSize = cellWidth < 11 ? 5.5 : cellWidth < 15 ? 5.8 : 6.5;

    let monthLeft = 0;
    const monthBlocks = chart.months.map(month => {
        const left = monthLeft;
        monthLeft += month.cellCount;
        return { month, left };
    });

    return (
        <View style={{ height: HEADER_HEIGHT, position: 'relative', backgroundColor: HEAD_BG }}>
            {/* 現場名・工程名（2段ぶち抜き） */}
            <View
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: NAME_COL_WIDTH,
                    height: HEADER_HEIGHT,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <Text style={{ fontSize: 8, color: TEXT }}>現場名</Text>
            </View>
            <View
                style={{
                    position: 'absolute',
                    left: NAME_COL_WIDTH,
                    top: 0,
                    width: TYPE_COL_WIDTH,
                    height: HEADER_HEIGHT,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <Text style={{ fontSize: 8, color: TEXT }}>工程</Text>
            </View>

            {/* 月の見出し */}
            {monthBlocks.map(({ month, left }) => (
                <View
                    key={month.key}
                    style={{
                        position: 'absolute',
                        left: GRID_LEFT + left * cellWidth,
                        top: 0,
                        width: month.cellCount * cellWidth,
                        height: HEADER_MONTH_HEIGHT,
                        justifyContent: 'center',
                        alignItems: 'center',
                    }}
                >
                    <Text style={{ fontSize: 7.5, color: TEXT }}>{month.label}</Text>
                </View>
            ))}

            {/* 日付の目盛（幅が足りないときは 1日・5日・10日… だけ出す） */}
            {columns.map((column, i) =>
                showLabel(column) ? (
                    <View
                        key={`c${i}`}
                        style={{
                            position: 'absolute',
                            // 間引いたラベルは目盛の中央ではなく、その日の位置に左右へ広げて置く
                            left: GRID_LEFT + i * cellWidth - (cellWidth < 12 ? 5 : 0),
                            top: HEADER_MONTH_HEIGHT,
                            width: cellWidth + (cellWidth < 12 ? 10 : 0),
                            height: HEADER_CELL_HEIGHT,
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        <Text style={{ fontSize: labelFontSize, color: TEXT }}>{column.label}</Text>
                    </View>
                ) : null,
            )}

            {/* 備考（2段ぶち抜き） */}
            <View
                style={{
                    position: 'absolute',
                    left: GRID_LEFT + GRID_WIDTH,
                    top: 0,
                    width: REMARK_COL_WIDTH,
                    height: HEADER_HEIGHT,
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <Text style={{ fontSize: 8, color: TEXT }}>備考</Text>
            </View>

            {/* 縦罫線: 月の切れ目は濃く、日の切れ目は薄く */}
            {columns.map((column, i) => (
                <View
                    key={`hv${i}`}
                    style={{
                        position: 'absolute',
                        left: GRID_LEFT + i * cellWidth - 0.25,
                        top: column.monthStart ? 0 : HEADER_MONTH_HEIGHT,
                        width: 0.5,
                        height: column.monthStart ? HEADER_HEIGHT : HEADER_CELL_HEIGHT,
                        backgroundColor: gridLineColor(column),
                    }}
                />
            ))}
            {/* 月見出しと目盛の間 */}
            <View
                style={{
                    position: 'absolute',
                    left: GRID_LEFT,
                    top: HEADER_MONTH_HEIGHT - 0.25,
                    width: GRID_WIDTH,
                    height: 0.5,
                    backgroundColor: LINE,
                }}
            />
            {/* 現場名／工程／備考の境界 */}
            {[NAME_COL_WIDTH, GRID_LEFT, GRID_LEFT + GRID_WIDTH].map(left => (
                <View
                    key={`hb${left}`}
                    style={{
                        position: 'absolute',
                        left: left - 0.25,
                        top: 0,
                        width: 0.5,
                        height: HEADER_HEIGHT,
                        backgroundColor: LINE_STRONG,
                    }}
                />
            ))}
        </View>
    );
}

/** 表本体（現場名・工程名・罫線・工程バー） */
function ChartBody({
    rows,
    columns,
    cellWidth,
    rowHeight,
    bodyHeight,
}: {
    rows: ScheduleChartRow[];
    columns: GridColumn[];
    cellWidth: number;
    rowHeight: number;
    bodyHeight: number;
}) {
    const barHeight = Math.max(6, rowHeight - 5);
    const typeFontSize = Math.min(7.5, rowHeight * 0.45);

    return (
        <View style={{ height: bodyHeight, position: 'relative', backgroundColor: '#ffffff' }}>
            {/* 左2列の地色 */}
            <View
                style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: NAME_COL_WIDTH,
                    height: bodyHeight,
                    backgroundColor: NAME_BG,
                }}
            />
            <View
                style={{
                    position: 'absolute',
                    left: NAME_COL_WIDTH,
                    top: 0,
                    width: TYPE_COL_WIDTH,
                    height: bodyHeight,
                    backgroundColor: TYPE_BG,
                }}
            />

            {/* 工程行の横罫線（案件の区切りは濃く） */}
            {rows.map((row, projectIndex) =>
                row.lines.map((line, lineIndex) => {
                    const index = projectIndex * LINES_PER_PROJECT + lineIndex;
                    const isProjectEnd = lineIndex === LINES_PER_PROJECT - 1;
                    if (index === rows.length * LINES_PER_PROJECT - 1) return null;
                    return (
                        <View
                            key={`h${row.projectMasterId}-${line.category}`}
                            style={{
                                position: 'absolute',
                                // 案件の区切り線は現場名の列もまたぐ／工程どうしの線は現場名の列を空けて結合セルに見せる
                                left: isProjectEnd ? 0 : NAME_COL_WIDTH,
                                top: (index + 1) * rowHeight - 0.25,
                                width: isProjectEnd ? CONTENT_WIDTH : CONTENT_WIDTH - NAME_COL_WIDTH,
                                height: 0.5,
                                backgroundColor: isProjectEnd ? LINE_STRONG : LINE,
                            }}
                        />
                    );
                }),
            )}

            {/* 縦罫線 */}
            {columns.map((column, i) => (
                <View
                    key={`v${i}`}
                    style={{
                        position: 'absolute',
                        left: GRID_LEFT + i * cellWidth - 0.25,
                        top: 0,
                        width: 0.5,
                        height: bodyHeight,
                        backgroundColor: gridLineColor(column),
                    }}
                />
            ))}
            {[NAME_COL_WIDTH, GRID_LEFT, GRID_LEFT + GRID_WIDTH].map(left => (
                <View
                    key={`b${left}`}
                    style={{
                        position: 'absolute',
                        left: left - 0.25,
                        top: 0,
                        width: 0.5,
                        height: bodyHeight,
                        backgroundColor: LINE_STRONG,
                    }}
                />
            ))}

            {/* 現場名（3行ぶち抜き） */}
            {rows.map((row, projectIndex) => {
                const innerWidth = NAME_COL_WIDTH - 6;
                const fontSize = fitCellFontSize(row.label, innerWidth * 2, 8, 5.5);
                return (
                    <View
                        key={`n${row.projectMasterId}`}
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: projectIndex * LINES_PER_PROJECT * rowHeight,
                            width: NAME_COL_WIDTH,
                            height: LINES_PER_PROJECT * rowHeight,
                            justifyContent: 'center',
                            paddingHorizontal: 3,
                        }}
                    >
                        <Text style={{ fontSize, lineHeight: 1.15, color: TEXT, textAlign: 'center' }}>
                            {wrapTextToWidth(row.label, innerWidth, fontSize)}
                        </Text>
                    </View>
                );
            })}

            {/* 工程名（組立/その他/解体） */}
            {rows.map((row, projectIndex) =>
                row.lines.map((line, lineIndex) => (
                    <View
                        key={`t${row.projectMasterId}-${line.category}`}
                        style={{
                            position: 'absolute',
                            left: NAME_COL_WIDTH,
                            top: (projectIndex * LINES_PER_PROJECT + lineIndex) * rowHeight,
                            width: TYPE_COL_WIDTH,
                            height: rowHeight,
                            justifyContent: 'center',
                            paddingHorizontal: 3,
                        }}
                    >
                        <Text style={{ fontSize: typeFontSize, color: TEXT }}>{line.label}</Text>
                    </View>
                )),
            )}

            {/* 工程バー */}
            {rows.map((row, projectIndex) =>
                row.lines.map((line, lineIndex) =>
                    line.bars.map((bar, barIndex) => {
                        const index = projectIndex * LINES_PER_PROJECT + lineIndex;
                        return (
                            <View
                                key={`bar${row.projectMasterId}-${line.category}-${barIndex}`}
                                style={{
                                    position: 'absolute',
                                    left: GRID_LEFT + bar.start * cellWidth,
                                    top: index * rowHeight + (rowHeight - barHeight) / 2,
                                    // 1日だけの配置でも見えるように最低幅を持たせる
                                    width: Math.max(2.5, (bar.end - bar.start) * cellWidth),
                                    height: barHeight,
                                    backgroundColor: bar.color,
                                }}
                            />
                        );
                    }),
                ),
            )}
        </View>
    );
}

// ---------------------------------------------------------------- 本体

export function ScheduleChartPDF({ chart, meta }: ScheduleChartPDFProps) {
    const columns = buildGridColumns(chart);
    const cellWidth = columns.length > 0 ? GRID_WIDTH / columns.length : GRID_WIDTH;

    const pages: ScheduleChartRow[][] = [];
    for (let i = 0; i < chart.rows.length; i += PROJECTS_PER_PAGE) {
        pages.push(chart.rows.slice(i, i + PROJECTS_PER_PAGE));
    }
    if (pages.length === 0) pages.push([]);

    // 案件が少ないときは行を高くして表の間延びを抑える（全ページ共通の高さにする）
    const linesOnFirstPage = Math.max(1, pages[0].length * LINES_PER_PROJECT);
    const rowHeight = Math.min(
        MAX_ROW_HEIGHT,
        Math.max(MIN_ROW_HEIGHT, AVAILABLE_BODY_HEIGHT / linesOnFirstPage),
    );

    return (
        <Document>
            {pages.map((rows, pageIndex) => {
                const bodyHeight = Math.max(rowHeight, rows.length * LINES_PER_PROJECT * rowHeight);
                return (
                    <Page
                        key={pageIndex}
                        size="A3"
                        orientation="landscape"
                        style={{
                            fontFamily: 'NotoSansJP',
                            paddingTop: PADDING_TOP,
                            paddingBottom: PADDING_BOTTOM,
                            paddingHorizontal: PADDING_X,
                            backgroundColor: '#ffffff',
                        }}
                    >
                        {/* タイトル */}
                        <View style={{ height: TITLE_HEIGHT, justifyContent: 'center' }}>
                            <Text style={{ fontSize: 14, textAlign: 'center', color: TEXT }}>工 程 表</Text>
                        </View>

                        {/* 記入欄 */}
                        <View style={{ height: INFO_HEIGHT, flexDirection: 'row', justifyContent: 'space-between' }}>
                            <View>
                                <InfoField label="工事名" value={meta.projectName ?? ''} boxWidth={260} />
                                <InfoField label="工程名" value={meta.processName ?? ''} boxWidth={260} />
                                <InfoField label="工期" value={meta.term ?? ''} boxWidth={260} />
                            </View>
                            <View>
                                <InfoField label="責任者" value={meta.supervisor ?? ''} boxWidth={130} />
                                <InfoField label="作成者" value={meta.author ?? ''} boxWidth={130} />
                                <InfoField label="作成日" value={meta.createdAt ?? ''} boxWidth={130} />
                            </View>
                        </View>

                        {/* 工事種別の凡例（「その他」に何が入っているか分かるように実際の種別名で出す） */}
                        <View
                            style={{
                                height: LEGEND_HEIGHT,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                            }}
                        >
                            {chart.usedTypes.map(type => (
                                <View
                                    key={type.id ?? type.name}
                                    style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 10 }}
                                >
                                    <View
                                        style={{
                                            width: 14,
                                            height: 6,
                                            backgroundColor: type.color,
                                            marginRight: 3,
                                        }}
                                    />
                                    <Text style={{ fontSize: 7, color: TEXT }}>{type.name}</Text>
                                </View>
                            ))}
                        </View>

                        {/* 表（ヘッダー＋本体＋備考） */}
                        <View style={{ borderWidth: 0.5, borderColor: LINE_STRONG }}>
                            <ChartHeader chart={chart} columns={columns} cellWidth={cellWidth} />
                            <View style={{ height: 0.5, backgroundColor: LINE_STRONG }} />
                            <ChartBody
                                rows={rows}
                                columns={columns}
                                cellWidth={cellWidth}
                                rowHeight={rowHeight}
                                bodyHeight={bodyHeight}
                            />
                            <View style={{ height: 0.5, backgroundColor: LINE_STRONG }} />
                            <View style={{ height: REMARKS_BOX_HEIGHT, flexDirection: 'row' }}>
                                <View
                                    style={{
                                        width: NAME_COL_WIDTH,
                                        backgroundColor: NAME_BG,
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        borderRightWidth: 0.5,
                                        borderRightColor: LINE_STRONG,
                                    }}
                                >
                                    <Text style={{ fontSize: 8, color: TEXT }}>備考</Text>
                                </View>
                                <View style={{ flex: 1 }} />
                            </View>
                        </View>

                        {/* ページ番号 */}
                        <View style={{ height: FOOTER_HEIGHT, justifyContent: 'flex-end' }}>
                            <Text style={{ fontSize: 7, textAlign: 'right', color: '#6b7280' }}>
                                {pages.length > 1 ? `${pageIndex + 1} / ${pages.length}` : ''}
                            </Text>
                        </View>
                    </Page>
                );
            })}
        </Document>
    );
}

export default ScheduleChartPDF;
