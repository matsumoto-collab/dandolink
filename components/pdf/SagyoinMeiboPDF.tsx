'use client';

import React from 'react';
import { Document, Page, View, StyleSheet } from '@react-pdf/renderer';
import { Text } from './SafeText';
import { fitCellFontSize, sanitizePdfText } from './styles';
import {
    calcAgeAt,
    chunkMeiboWorkers,
    isoDateToReiwa,
    MEIBO_WORKERS_PER_PAGE,
    WORKER_ATTRIBUTES,
    type MeiboWorkerSnapshot,
    type SagyoinMeiboData,
} from '@/lib/safetyDocuments';

/**
 * 作業員名簿 PDF（全建統一様式第5号 準拠・A4横・押印欄なし）。
 * - スナップショット（SafetyDocument.data）のみを入力にとり、マスターの現在値は参照しない（FR-4-2）
 * - 年齢はヘッダーの提出日基準で算出（FR-3-7）
 * - 1ページ10名で自動改ページ・ヘッダーは各ページに再掲（FR-3-3）
 * - 保険は区分名のみ・番号は雇用保険の下4桁だけを出力（FR-3-4）
 */

export interface SagyoinMeiboPDFProps {
    data: SagyoinMeiboData;
}

// A4 横: 841.89 x 595.28pt。左右 padding 20 → 利用幅 ~800pt。
const COL = {
    no: 24,
    name: 112,      // ふりがな / 氏名(性別) / 生年月日・年齢
    jobType: 56,    // 職種 / 属性記号
    hire: 64,       // 雇入年月日 / 経験年数
    address: 146,   // 現住所・TEL / 家族連絡先
    health: 100,    // 健康診断日・血圧・血液型 / 特殊健診
    insurance: 104, // 健康保険 / 年金保険 / 雇用保険(下4桁) / 労災特別加入
    kentaikyo: 42,  // 建退共・中退共・手帳
    quals: 92,      // 教育・資格
    entry: 30,      // 入場年月日（現場で手書き）
    education: 30,  // 受入教育実施年月日（現場で手書き）
} as const;

const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 7,
        paddingTop: 18,
        paddingBottom: 16,
        paddingHorizontal: 20,
        backgroundColor: '#ffffff',
    },
    // ── ヘッダー（各ページ再掲） ──
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 4,
    },
    titleSpacer: { width: 180 },
    title: {
        flex: 1,
        textAlign: 'center',
        fontSize: 15,
        fontWeight: 'bold',
        letterSpacing: 6,
    },
    submitDate: {
        width: 180,
        textAlign: 'right',
        fontSize: 7.5,
    },
    infoBand: {
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: '#000000',
        marginBottom: 4,
    },
    infoCellLeft: {
        flex: 1.2,
        borderRightWidth: 0.75,
        borderRightColor: '#000000',
        padding: 3,
    },
    infoCellRight: {
        flex: 1,
        padding: 3,
    },
    infoLine: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        minHeight: 12,
    },
    infoLabel: {
        fontSize: 6,
        color: '#374151',
        width: 64,
    },
    infoValue: {
        flex: 1,
        fontSize: 8,
    },
    // ── テーブル ──
    headerRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: '#e5e7eb',
        borderTopWidth: 1,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderColor: '#000000',
        minHeight: 22,
    },
    dataRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 0.75,
        borderColor: '#000000',
        minHeight: 42,
    },
    cell: {
        borderRightWidth: 0.5,
        borderRightColor: '#6b7280',
        paddingHorizontal: 2,
        paddingVertical: 1,
        justifyContent: 'center',
    },
    cellLast: {
        borderRightWidth: 0,
    },
    headerText: {
        fontSize: 6,
        fontWeight: 'bold',
        textAlign: 'center',
        width: '100%',
    },
    tierText: {
        fontSize: 5.5,
        color: '#111111',
    },
    tierTextMuted: {
        fontSize: 5.5,
        color: '#6b7280',
    },
    legend: {
        marginTop: 4,
        fontSize: 5,
        color: '#374151',
    },
    pageNumber: {
        position: 'absolute',
        bottom: 6,
        right: 20,
        fontSize: 6.5,
        color: '#374151',
    },
});

/** セル内寸（幅 − 左右 padding − 右罫線） */
const contentWidth = (w: number) => w - 5;

const fit = (text: string, w: number, base: number, min = 4.5) =>
    fitCellFontSize(sanitizePdfText(text || ''), contentWidth(w), base, min);

/** 単一行テキスト（収まらなければ縮小） */
function Line({ text, width, base, min, bold, muted }: {
    text: string;
    width: number;
    base: number;
    min?: number;
    bold?: boolean;
    muted?: boolean;
}) {
    return (
        <Text
            style={{
                fontSize: fit(text, width, base, min),
                fontWeight: bold ? 'bold' : 'normal',
                color: muted ? '#6b7280' : '#111111',
            }}
        >
            {text}
        </Text>
    );
}

function HeaderCells() {
    const labels: { label: string; width: number; last?: boolean }[] = [
        { label: '№', width: COL.no },
        { label: 'ふりがな・氏名\n生年月日・年齢', width: COL.name },
        { label: '職種\n（属性）', width: COL.jobType },
        { label: '雇入年月日\n経験年数', width: COL.hire },
        { label: '現住所・連絡先\n家族連絡先', width: COL.address },
        { label: '健康診断日・血圧・血液型\n特殊健康診断', width: COL.health },
        { label: '健康保険／年金保険\n雇用保険', width: COL.insurance },
        { label: '建退共\n中退共', width: COL.kentaikyo },
        { label: '教育・資格・免許', width: COL.quals },
        { label: '入場\n年月日', width: COL.entry },
        { label: '受入教育\n実施日', width: COL.education, last: true },
    ];
    return (
        <View style={styles.headerRow}>
            {labels.map(({ label, width, last }) => (
                <View
                    key={label}
                    style={[styles.cell, ...(last ? [styles.cellLast] : []), { width, justifyContent: 'center' }]}
                >
                    <Text style={styles.headerText}>{label}</Text>
                </View>
            ))}
        </View>
    );
}

function boolLabel(value: boolean | null | undefined): string {
    if (value === true) return '有';
    if (value === false) return '無';
    return '';
}

function WorkerRow({ worker, index, submitDate }: {
    worker: MeiboWorkerSnapshot;
    index: number;
    submitDate: string;
}) {
    const p = worker.profile;
    const age = calcAgeAt(p?.birthDate ?? null, submitDate);
    const birthLine = p?.birthDate
        ? `${isoDateToReiwa(p.birthDate)}${age != null ? `（${age}歳）` : ''}`
        : '';
    const nameWithGender = p?.gender ? `${worker.name}（${p.gender}）` : worker.name;
    const attrs = (p?.attributes ?? []).join('・');
    const jobLine2 = [attrs ? `(${attrs})` : '', p?.workerCategory && p.workerCategory !== '労働者' ? p.workerCategory : '']
        .filter(Boolean)
        .join(' ');
    const addressLine = [p?.address ?? '', p?.tel ? `TEL ${p.tel}` : ''].filter(Boolean).join('  ');
    const familyLine = [p?.familyContact ?? '', p?.familyTel ? `TEL ${p.familyTel}` : ''].filter(Boolean).join('  ');
    const healthLine = [
        p?.healthCheckDate ? isoDateToReiwa(p.healthCheckDate) : '',
        p?.bloodPressure ?? '',
        p?.bloodType ? `${p.bloodType}型` : '',
    ]
        .filter(Boolean)
        .join(' ');
    const specialLine = [
        p?.specialHealthCheckDate ? isoDateToReiwa(p.specialHealthCheckDate) : '',
        p?.specialHealthCheckType ?? '',
    ]
        .filter(Boolean)
        .join(' ');
    const employmentLine = [
        p?.employmentInsurance ?? '',
        p?.employmentInsuranceLast4 ? `(下4桁 ${p.employmentInsuranceLast4})` : '',
    ]
        .filter(Boolean)
        .join(' ');
    // 番号の前置記号は No. を使う（№ U+2116 はフォントサブセットにグリフが無く空白化するため）
    const qualNames = (p?.qualifications ?? [])
        .map((q) => (q.licenseNumber ? `${q.name}（No.${q.licenseNumber}）` : q.name))
        .join('、');
    const qualText = [qualNames, p?.ccusId ? `CCUS ${p.ccusId}` : ''].filter(Boolean).join('\n');

    return (
        <View style={styles.dataRow} wrap={false}>
            <View style={[styles.cell, { width: COL.no, justifyContent: 'center' }]}>
                <Text style={{ fontSize: 8, textAlign: 'center', width: '100%' }}>{index + 1}</Text>
            </View>
            <View style={[styles.cell, { width: COL.name }]}>
                {p?.furigana ? <Line text={p.furigana} width={COL.name} base={5} muted /> : null}
                <Line text={nameWithGender} width={COL.name} base={9} min={6} bold />
                {birthLine ? <Line text={birthLine} width={COL.name} base={6} /> : null}
            </View>
            <View style={[styles.cell, { width: COL.jobType }]}>
                <Line text={p?.jobType ?? ''} width={COL.jobType} base={7} />
                {jobLine2 ? <Line text={jobLine2} width={COL.jobType} base={5.5} /> : null}
            </View>
            <View style={[styles.cell, { width: COL.hire }]}>
                <Line text={p?.hireDate ? isoDateToReiwa(p.hireDate) : ''} width={COL.hire} base={6} />
                {p?.experienceYears != null ? (
                    <Line text={`経験 ${p.experienceYears}年`} width={COL.hire} base={6} />
                ) : null}
            </View>
            <View style={[styles.cell, { width: COL.address }]}>
                <Line text={addressLine} width={COL.address} base={6} />
                {familyLine ? <Line text={`家族: ${familyLine}`} width={COL.address} base={5.5} /> : null}
            </View>
            <View style={[styles.cell, { width: COL.health }]}>
                <Line text={healthLine} width={COL.health} base={6} />
                {specialLine ? <Line text={`特殊: ${specialLine}`} width={COL.health} base={5.5} /> : null}
            </View>
            <View style={[styles.cell, { width: COL.insurance }]}>
                <Line text={p?.healthInsurance ? `健: ${p.healthInsurance}` : ''} width={COL.insurance} base={6} />
                <Line text={p?.pensionInsurance ? `年: ${p.pensionInsurance}` : ''} width={COL.insurance} base={6} />
                {employmentLine ? <Line text={`雇: ${employmentLine}`} width={COL.insurance} base={6} /> : null}
                {p?.rosaiSpecialInsurance ? (
                    <Line text="労災特別加入: 有" width={COL.insurance} base={5.5} />
                ) : null}
            </View>
            <View style={[styles.cell, { width: COL.kentaikyo }]}>
                <Text style={styles.tierText}>建退共: {boolLabel(p?.kentaikyo)}</Text>
                <Text style={styles.tierText}>中退共: {boolLabel(p?.chutaikyo)}</Text>
                {p?.kentaikyoTechou != null ? (
                    <Text style={styles.tierText}>手帳: {boolLabel(p.kentaikyoTechou)}</Text>
                ) : null}
            </View>
            <View style={[styles.cell, { width: COL.quals }]}>
                <Text style={{ fontSize: 5.5 }}>{sanitizePdfText(qualText)}</Text>
            </View>
            <View style={[styles.cell, { width: COL.entry }]} />
            <View style={[styles.cell, styles.cellLast, { width: COL.education }]} />
        </View>
    );
}

export function SagyoinMeiboPDF({ data }: SagyoinMeiboPDFProps) {
    const { header, workers } = data;
    const pages = chunkMeiboWorkers(workers);
    const legend = `（属性）${WORKER_ATTRIBUTES.map((a) => `${a.value}=${a.label}`).join(' ')}`;

    return (
        <Document>
            {pages.map((pageWorkers, pageIndex) => (
                <Page key={pageIndex} size="A4" orientation="landscape" style={styles.page}>
                    {/* タイトル + 提出日（各ページ再掲） */}
                    <View style={styles.titleRow}>
                        <View style={styles.titleSpacer} />
                        <Text style={styles.title}>作　業　員　名　簿</Text>
                        <Text style={styles.submitDate}>
                            {header.submitDate ? `提出日: ${isoDateToReiwa(header.submitDate)}` : ''}
                        </Text>
                    </View>

                    {/* 元請・自社情報 */}
                    <View style={styles.infoBand}>
                        <View style={styles.infoCellLeft}>
                            <View style={styles.infoLine}>
                                <Text style={styles.infoLabel}>事業所の名称</Text>
                                <Line text={header.siteName} width={300} base={8} bold />
                            </View>
                            <View style={styles.infoLine}>
                                <Text style={styles.infoLabel}>元請会社名</Text>
                                <Line text={header.primeContractor} width={300} base={8} />
                            </View>
                            <View style={styles.infoLine}>
                                <Text style={styles.infoLabel}>所長名</Text>
                                <Line text={header.primeSiteManager} width={300} base={8} />
                            </View>
                        </View>
                        <View style={styles.infoCellRight}>
                            <View style={styles.infoLine}>
                                <Text style={styles.infoLabel}>会社名</Text>
                                <Line
                                    text={`${header.companyName}${header.tier ? `（${header.tier}）` : ''}`}
                                    width={250}
                                    base={8}
                                    bold
                                />
                            </View>
                            <View style={styles.infoLine}>
                                <Text style={styles.infoLabel}>代表者名</Text>
                                <Line text={header.companyRepresentative} width={250} base={8} />
                            </View>
                            <View style={styles.infoLine}>
                                <Text style={styles.infoLabel}>所在地</Text>
                                <Line text={header.companyAddress} width={250} base={7} />
                            </View>
                        </View>
                    </View>

                    {/* 列見出し + 作業員行 */}
                    <HeaderCells />
                    {pageWorkers.map((worker, i) => (
                        <WorkerRow
                            key={worker.key}
                            worker={worker}
                            index={pageIndex * MEIBO_WORKERS_PER_PAGE + i}
                            submitDate={header.submitDate}
                        />
                    ))}

                    {/* 属性記号の凡例 */}
                    <Text style={styles.legend}>{legend}</Text>

                    <Text style={styles.pageNumber}>
                        {pageIndex + 1} / {pages.length}
                    </Text>
                </Page>
            ))}
        </Document>
    );
}
