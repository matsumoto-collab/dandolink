'use client';

import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Image,
} from '@react-pdf/renderer';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { toReiwa, sanitizePdfText } from './styles';

// ===== Color Palette =====
const COLORS = {
    navy: '#222222',
    navyLight: '#444444',
    headerBg: '#333333',
    headerText: '#ffffff',
    infoBg: '#f5f5f5',
    zebraStripe: '#fafafa',
    borderDark: '#333333',
    borderLight: '#d4d4d4',
    borderMedium: '#a3a3a3',
    textPrimary: '#1a1a1a',
    textSecondary: '#525252',
    red: '#dc2626',
    white: '#ffffff',
    totalBg: '#f0f0f0',
};

// ===== Styles (Landscape A4) =====
const styles = StyleSheet.create({
    // Page — landscape
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 7.5,
        paddingTop: 14,
        paddingBottom: 14,
        paddingHorizontal: 30,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // ===== Title =====
    titleCenter: {
        alignItems: 'center',
        marginTop: 2,
        marginBottom: 4,
    },
    titleText: {
        fontSize: 20,
        letterSpacing: 12,
        fontWeight: 'bold',
        color: COLORS.navy,
    },

    // ===== Header row: customer left, company right =====
    coverHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },

    // Left: Customer + amount
    customerArea: {
        width: 280,
    },
    customerName: {
        fontSize: 14,
        fontWeight: 'bold',
        paddingBottom: 3,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },
    greetingText: {
        fontSize: 8,
        marginTop: 3,
        color: COLORS.textSecondary,
        lineHeight: 1.4,
    },

    // Amount
    amountSection: {
        marginTop: 4,
        width: '100%',
    },
    amountMainRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.textPrimary,
        paddingBottom: 2,
        marginBottom: 1,
    },
    amountLabel: {
        fontSize: 10,
        fontWeight: 'bold',
        width: '30%',
    },
    amountValue: {
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'center',
        width: '40%',
    },
    amountTaxNote: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
        width: '30%',
    },
    amountSubRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        borderBottomStyle: 'dashed',
        paddingVertical: 1,
    },
    amountSubLabel: {
        fontSize: 9.5,
        color: COLORS.textSecondary,
        width: '30%',
        textAlign: 'center',
    },
    amountSubValue: {
        fontSize: 9.5,
        width: '40%',
        textAlign: 'center',
    },

    // Right: Date + Company
    rightArea: {
        flex: 1,
        alignItems: 'flex-end',
    },
    estimateNoText: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
    },
    companyRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    companyInfoBlock: {
        alignItems: 'flex-end',
    },
    companyName: {
        fontSize: 10,
        fontWeight: 'bold',
        marginBottom: 2,
        letterSpacing: 1,
    },
    companyText: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
        marginBottom: 1,
        textAlign: 'right',
    },
    stampBox: {
        width: 45,
        height: 45,
    },

    // ===== Info Table + Remarks =====
    infoTable: {
        flexDirection: 'row',
        marginBottom: 4,
    },
    infoLeft: {
        width: '60%',
        borderWidth: 0.5,
        borderColor: COLORS.borderMedium,
    },
    infoRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        minHeight: 14,
    },
    infoRowLast: {
        flexDirection: 'row',
        minHeight: 14,
    },
    infoLabelCell: {
        width: 55,
        backgroundColor: COLORS.infoBg,
        paddingHorizontal: 3,
        paddingVertical: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderLight,
        justifyContent: 'center',
    },
    infoLabelText: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
    },
    infoValueCell: {
        flex: 1,
        paddingHorizontal: 3,
        paddingVertical: 2,
        justifyContent: 'center',
    },
    infoValueText: {
        fontSize: 8.5,
    },

    remarksArea: {
        width: '38%',
        marginLeft: '2%',
        borderWidth: 0.5,
        borderColor: COLORS.borderMedium,
    },
    remarksHeader: {
        backgroundColor: COLORS.infoBg,
        paddingHorizontal: 3,
        paddingVertical: 2,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
    },
    remarksHeaderText: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
        textAlign: 'center',
    },
    remarksBody: {
        flex: 1,
        padding: 3,
    },
    remarksText: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
        lineHeight: 1.4,
    },

    // ===== Details Table =====
    table: {
        width: '100%',
        borderWidth: 1,
        borderColor: COLORS.borderDark,
    },
    tableHeader: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: COLORS.borderDark,
        minHeight: 18,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderMedium,
        minHeight: 18,
    },
    tableRowLast: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderMedium,
        minHeight: 18,
    },

    // Column styles for landscape — wider page
    // No(18) + Name(180) + Spec(180) + Qty(50) + Unit(35) + Price(65) + Amount(80) + Remarks(flex)
    cellNo: {
        width: 20,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellName: {
        width: 180,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellSpec: {
        width: 180,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellQty: {
        width: 50,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellUnit: {
        width: 35,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellPrice: {
        width: 65,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellAmount: {
        width: 80,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellRemarks: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
    },

    // Cell text
    headerCellText: {
        fontSize: 8.5,
        color: COLORS.textSecondary,
        textAlign: 'center',
        width: '100%',
    },
    cellText: {
        fontSize: 8.5,
    },
    cellTextCenter: {
        fontSize: 8.5,
        textAlign: 'center',
    },
    cellTextRed: {
        fontSize: 8.5,
        color: COLORS.red,
    },

    // Total section
    totalRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderDark,
        minHeight: 20,
    },
    totalRowFinal: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderDark,
        minHeight: 22,
        backgroundColor: COLORS.totalBg,
    },
    totalLabelCell: {
        // No(20)+Name(180)+Spec(180)+Qty(50) = 430
        width: 430,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalSubtotalLabel: {
        width: 100,
        padding: 3,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalAmountCell: {
        width: 80,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalRemarksCell: {
        flex: 1,
        padding: 3,
    },
    totalLabelText: {
        fontSize: 9,
        fontWeight: 'bold',
        color: COLORS.textSecondary,
    },
    totalAmountText: {
        fontSize: 9,
        fontWeight: 'bold',
    },

    // Details page header
    detailsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
        marginTop: 4,
    },
    detailsTitle: {
        fontSize: 14,
        letterSpacing: 8,
        color: COLORS.navy,
        fontWeight: 'bold',
        paddingBottom: 2,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },
    detailsSubInfo: {
        fontSize: 8,
        color: COLORS.textSecondary,
    },

    // Footer
    footer: {
        position: 'absolute',
        bottom: 10,
        left: 30,
        right: 30,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    footerText: {
        fontSize: 6,
        color: COLORS.borderMedium,
    },
});

interface EstimatePDFProps {
    estimate: Estimate;
    project: Project;
    companyInfo: CompanyInfo;
    includeDetails?: boolean;
    creatorName?: string;
}

// ===== Cover Page Component (Landscape) =====
/**
 * inlineカテゴリの子項目を表紙用にフラット展開する。
 * detailカテゴリはそのまま1行（従来通り）。
 * 注意: inlineカテゴリヘッダー行はisCategoryフラグを保持するが、
 *       金額は表示用に残す（小計計算時はsumFlatItemsで除外される）
 */
function flattenItemsForCover(items: Estimate['items']): Estimate['items'] {
    const result: Estimate['items'] = [];
    for (const item of items) {
        if (item.isCategory && item.categoryType === 'inline') {
            // カテゴリ名を太字ヘッダー行として追加（金額表示あり、childrenなし）
            result.push({ ...item, children: undefined });
            // 子項目を通常行として展開
            for (const child of (item.children || [])) {
                result.push(child);
            }
        } else {
            result.push(item);
        }
    }
    return result;
}

/**
 * フラット展開済みアイテムの小計を計算する。
 * inlineカテゴリヘッダー行（isCategory=true, children=undefined）は
 * 子項目と二重加算になるため除外する。
 */
function sumFlatItems(flatItems: Estimate['items']): number {
    return flatItems.reduce((sum, item) => {
        // inlineカテゴリヘッダー行はスキップ（子項目の金額で既に加算済み）
        if (item.isCategory && item.categoryType === 'inline' && !item.children) return sum;
        return sum + (item.amount || 0);
    }, 0);
}

function CoverPage({ estimate, project, companyInfo, creatorName }: Omit<EstimatePDFProps, 'includeDetails'>) {
    const createdDate = new Date(estimate.createdAt);
    const validUntilDate = new Date(estimate.validUntil);
    const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>

            {/* Title row: title center, date/No right */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 2, marginBottom: 4 }}>
                <View style={{ width: '25%' }} />
                <View style={{ alignItems: 'center' }}>
                    <Text style={styles.titleText}>御 見 積 書</Text>
                </View>
                <View style={{ width: '25%', alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 8.5, color: COLORS.textSecondary, textAlign: 'right' }}>見積日　{toReiwa(createdDate)}</Text>
                    <Text style={[styles.estimateNoText, { marginTop: 1, textAlign: 'right' }]}>見積No. {estimate.estimateNumber}</Text>
                </View>
            </View>

            {/* Header: Left (customer + amount) / Right (company) */}
            <View style={styles.coverHeader}>
                <View style={styles.customerArea}>
                    {(() => {
                        const fullName = `${project.customer || ''}\u3000${project.customerHonorific || '御中'}`;
                        const maxWidth = 280 * 0.8; // 下線幅の80%
                        const baseFontSize = 14;
                        const textWidth = fullName.length * baseFontSize;
                        const fontSize = textWidth <= maxWidth ? baseFontSize : Math.max(10, Math.floor(maxWidth / fullName.length));
                        return <Text style={{ ...styles.customerName, fontSize }}>{fullName}</Text>;
                    })()}
                    <Text style={styles.greetingText}>{'いつもお世話になっております。\n下記の通り御見積書をお送りいたしますので、\nご検討のほどよろしくお願いいたします。'}</Text>

                    <View style={styles.amountSection}>
                        <View style={styles.amountMainRow}>
                            <Text style={styles.amountLabel}>合計金額</Text>
                            <Text style={styles.amountValue}>¥{estimate.total.toLocaleString()}</Text>
                            <Text style={styles.amountTaxNote}>（税込）</Text>
                        </View>
                        <View style={styles.amountSubRow}>
                            <Text style={styles.amountSubLabel}>小計</Text>
                            <Text style={styles.amountSubValue}>¥{estimate.subtotal.toLocaleString()}</Text>
                        </View>
                        <View style={styles.amountSubRow}>
                            <Text style={styles.amountSubLabel}>消費税額(10%)</Text>
                            <Text style={styles.amountSubValue}>¥{estimate.tax.toLocaleString()}</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.rightArea}>
                    {/* Company info block with seal overlaid */}
                    <View style={{ position: 'relative' }}>
                        {/* Seal image overlaid on top-right */}
                        {companyInfo.sealImage && (
                            <Image src={companyInfo.sealImage} style={{ position: 'absolute', top: 36, right: 10, width: 50, height: 50 }} />
                        )}
                        {/* 全テキストを左揃えで統一し、ブロックごと右寄せ */}
                        <View style={{ alignSelf: 'flex-end' }}>
                            {/* Logo — 会社名の上、左端揃え */}
                            {companyInfo.logoImage && (
                                <Image src={companyInfo.logoImage} style={{ height: 35, marginBottom: 3, objectFit: 'contain', alignSelf: 'flex-start' }} />
                            )}
                            <Text style={styles.companyName}>{companyInfo.name}</Text>
                            {companyInfo.licenseNumber && (
                                <Text style={styles.companyText}>{companyInfo.licenseNumber}</Text>
                            )}
                            {(companyInfo.representativeTitle || companyInfo.representative) && (
                                <Text style={styles.companyText}>
                                    {companyInfo.representativeTitle ? `${companyInfo.representativeTitle}　` : ''}{companyInfo.representative}
                                </Text>
                            )}
                            {/* 住所以下 — 印鑑と被らないよう下げる */}
                            <Text style={[styles.companyText, { marginTop: 8 }]}>〒{companyInfo.postalCode}　{companyInfo.address}</Text>
                            <Text style={styles.companyText}>TEL　{companyInfo.tel}　　FAX　{companyInfo.fax || ''}</Text>
                            {companyInfo.email && (
                                <Text style={styles.companyText}>e-mail　{companyInfo.email}</Text>
                            )}
                            {creatorName && (
                                <Text style={{ fontSize: 7.5, marginTop: 2 }}>
                                    担当　{creatorName}
                                </Text>
                            )}
                        </View>
                    </View>
                </View>
            </View>

            {/* Info Table + Remarks */}
            <View style={styles.infoTable}>
                <View style={styles.infoLeft}>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>件名</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>{project.title || estimate.title}</Text>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>現場住所</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>{sanitizePdfText(estimate.location || project.location || '')}</Text>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>有効期限</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>発行日より{monthsDiff}ヶ月</Text>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>工期</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>{estimate.constructionPeriod ? sanitizePdfText(estimate.constructionPeriod) : ''}</Text>
                        </View>
                    </View>
                    <View style={styles.infoRowLast}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>支払条件</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>従来通り</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.remarksArea}>
                    <View style={styles.remarksHeader}>
                        <Text style={styles.remarksHeaderText}>備考</Text>
                    </View>
                    <View style={styles.remarksBody}>
                        <Text style={styles.remarksText}>
                            {estimate.notes ? sanitizePdfText(estimate.notes) : ''}
                        </Text>
                    </View>
                </View>
            </View>

            {/* Details Table */}
            <View style={styles.table} wrap={false}>
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.headerCellText}></Text></View>
                    <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.headerCellText}>規格</Text></View>
                    <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
                    <View style={styles.cellRemarks}><Text style={styles.headerCellText}>備考</Text></View>
                </View>

                {(() => {
                    const topItems = flattenItemsForCover(estimate.items);
                    const maxRows = 12;
                    const rows = [];

                    for (let i = 0; i < maxRows; i++) {
                        const item = i < topItems.length ? topItems[i] : null;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;
                        const isCat = item?.isCategory;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : styles.tableRow}>
                                <View style={styles.cellNo}>
                                    <Text style={styles.cellTextCenter}>{item ? i + 1 : ''}</Text>
                                </View>
                                <View style={styles.cellName}>
                                    <Text style={isNegative ? styles.cellTextRed : (isCat ? { fontSize: 8.5, fontWeight: 'bold' } : styles.cellText)}>
                                        {item ? sanitizePdfText(item.description || '') : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellSpec}>
                                    <Text style={styles.cellText}>
                                        {(!isCat && item?.specification) ? sanitizePdfText(item.specification) : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellQty}>
                                    <Text style={styles.cellText}>
                                        {item && item.quantity > 0 ? item.quantity.toLocaleString() : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellUnit}>
                                    <Text style={styles.cellText}>
                                        {item ? sanitizePdfText(item.unit || '') : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellPrice}>
                                    <Text style={styles.cellText}>
                                        {!isCat && item && item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellAmount}>
                                    <Text style={isNegative ? styles.cellTextRed : (isCat ? { ...styles.cellText, fontWeight: 'bold' } : styles.cellText)}>
                                        {item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellRemarks}><Text style={styles.cellText}>{item?.notes ? sanitizePdfText(item.notes) : ''}</Text></View>
                            </View>
                        );
                    }
                    return rows;
                })()}

                {/* Subtotal — 表紙1ページ目は最初の12行分の小計 */}
                {(() => {
                    const coverItems = flattenItemsForCover(estimate.items);
                    const pageItems = coverItems.slice(0, 12);
                    const pageSubtotal = sumFlatItems(pageItems);
                    return (
                        <View style={styles.totalRow}>
                            <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                            <View style={styles.totalSubtotalLabel}>
                                <Text style={styles.totalLabelText}>小計</Text>
                            </View>
                            <View style={styles.totalAmountCell}>
                                <Text style={styles.totalAmountText}>¥{pageSubtotal.toLocaleString()}</Text>
                            </View>
                            <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                        </View>
                    );
                })()}
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}></Text>
                <Text style={styles.footerText}>No. 1</Text>
            </View>
        </Page>
    );
}

// ===== 表紙続きページ（13行目以降の項目） =====
function CoverContinuationPages({
    estimate, project, startPageNo,
}: {
    estimate: Estimate;
    project: Project;
    startPageNo: number;
}) {
    const COVER_MAX_ROWS = 12;
    const ROWS_PER_PAGE = 20;
    const flatCoverItems = flattenItemsForCover(estimate.items);
    const overflowItems = flatCoverItems.slice(COVER_MAX_ROWS);
    if (overflowItems.length === 0) return null;

    const totalPages = Math.ceil(overflowItems.length / ROWS_PER_PAGE);
    const pages = [];

    // 表紙1ページ目(12行)の小計
    const coverFirstPageItems = flatCoverItems.slice(0, COVER_MAX_ROWS);
    const coverFirstPageSubtotal = sumFlatItems(coverFirstPageItems);

    for (let p = 0; p < totalPages; p++) {
        const pageItems = overflowItems.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
        // 累計小計: 1ページ目の小計 + 続きページのここまでの全項目
        const continuationItemsUpToHere = overflowItems.slice(0, (p + 1) * ROWS_PER_PAGE);
        const cumulativeSubtotal = coverFirstPageSubtotal + sumFlatItems(continuationItemsUpToHere);

        pages.push(
            <Page key={p} size="A4" orientation="landscape" style={styles.page}>
                <View style={styles.detailsHeader}>
                    <Text style={styles.detailsTitle}>御 見 積 書</Text>
                    <Text style={styles.detailsSubInfo}>
                        見積No. {estimate.estimateNumber}
                    </Text>
                </View>

                <View style={{ marginBottom: 4 }}>
                    <Text style={{ fontSize: 8, color: COLORS.textSecondary }}>
                        現場名: {sanitizePdfText(project.title || estimate.title)}
                    </Text>
                </View>

                <View style={styles.table} wrap={false}>
                    <TableHeader />

                    {(() => {
                        const rows = [];
                        for (let i = 0; i < ROWS_PER_PAGE; i++) {
                            const item = i < pageItems.length ? pageItems[i] : null;
                            const globalIdx = COVER_MAX_ROWS + p * ROWS_PER_PAGE + i;
                            rows.push(
                                <TableItemRow key={i} idx={globalIdx} item={item} isLast={i === ROWS_PER_PAGE - 1} />
                            );
                        }
                        return rows;
                    })()}

                    <View style={styles.totalRow}>
                        <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                        <View style={styles.totalSubtotalLabel}>
                            <Text style={styles.totalLabelText}>小計</Text>
                        </View>
                        <View style={styles.totalAmountCell}>
                            <Text style={styles.totalAmountText}>¥{cumulativeSubtotal.toLocaleString()}</Text>
                        </View>
                        <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                    </View>
                </View>

                <View style={styles.footer} fixed>
                    <Text style={styles.footerText}></Text>
                    <Text style={styles.footerText}>No. {startPageNo + p}</Text>
                </View>
            </Page>
        );
    }

    return <>{pages}</>;
}

// ===== 内訳テーブル共通ヘッダー =====
function TableHeader() {
    return (
        <View style={styles.tableHeader}>
            <View style={styles.cellNo}><Text style={styles.headerCellText}></Text></View>
            <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
            <View style={styles.cellSpec}><Text style={styles.headerCellText}>規格</Text></View>
            <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
            <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
            <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
            <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
            <View style={styles.cellRemarks}><Text style={styles.headerCellText}>備考</Text></View>
        </View>
    );
}

// ===== 内訳テーブル行 =====
function TableItemRow({ idx, item, isLast }: { idx: number; item: Estimate['items'][0] | null; isLast: boolean }) {
    const isNegative = item ? item.amount < 0 : false;
    const isCat = item?.isCategory;

    return (
        <View style={isLast ? styles.tableRowLast : styles.tableRow}>
            <View style={styles.cellNo}>
                <Text style={styles.cellTextCenter}>{item ? idx + 1 : ''}</Text>
            </View>
            <View style={styles.cellName}>
                <Text style={isNegative ? styles.cellTextRed : (isCat ? { fontSize: 8.5, fontWeight: 'bold' } : styles.cellText)}>
                    {item ? sanitizePdfText(item.description || '') : ''}
                </Text>
            </View>
            <View style={styles.cellSpec}>
                <Text style={styles.cellText}>
                    {(!isCat && item?.specification) ? sanitizePdfText(item.specification) : ''}
                </Text>
            </View>
            <View style={styles.cellQty}>
                <Text style={styles.cellText}>
                    {item && item.quantity > 0 ? item.quantity.toLocaleString() : ''}
                </Text>
            </View>
            <View style={styles.cellUnit}>
                <Text style={styles.cellText}>
                    {item ? sanitizePdfText(item.unit || '') : ''}
                </Text>
            </View>
            <View style={styles.cellPrice}>
                <Text style={styles.cellText}>
                    {!isCat && item && item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}
                </Text>
            </View>
            <View style={styles.cellAmount}>
                <Text style={isNegative ? styles.cellTextRed : (isCat ? { ...styles.cellText, fontWeight: 'bold' } : styles.cellText)}>
                    {item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}
                </Text>
            </View>
            <View style={styles.cellRemarks}><Text style={styles.cellText}>{item?.notes ? sanitizePdfText(item.notes) : ''}</Text></View>
        </View>
    );
}

// ===== カテゴリ内訳明細ページ =====
function CategoryDetailsPage({
    category, estimate, companyInfo: _companyInfo, pageNo, title: estimateTitle,
}: {
    category: Estimate['items'][0];
    estimate: Estimate;
    companyInfo: CompanyInfo;
    pageNo: number;
    title: string;
}) {
    const children = category.children || [];
    const maxRows = 18;

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>

            <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>内 訳 明 細 書</Text>
                <Text style={styles.detailsSubInfo}>
                    見積No. {estimate.estimateNumber}
                </Text>
            </View>

            <View style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 8, color: COLORS.textSecondary }}>
                    工事名称: {sanitizePdfText(estimateTitle)}
                </Text>
            </View>

            <View style={styles.table} wrap={false}>
                <TableHeader />

                <View style={styles.tableRow}>
                    <View style={styles.cellNo}>
                        <Text style={styles.cellTextCenter}></Text>
                    </View>
                    <View style={styles.cellName}>
                        <Text style={{ fontSize: 8.5, fontWeight: 'bold' }}>{sanitizePdfText(category.description)}</Text>
                    </View>
                    <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellQty}><Text style={styles.cellText}>{category.quantity && category.quantity > 0 ? category.quantity.toLocaleString() : ''}</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.cellText}>{sanitizePdfText(category.unit || '')}</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellAmount}><Text style={styles.cellText}>{category.amount > 0 ? category.amount.toLocaleString() : ''}</Text></View>
                    <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
                </View>

                {(() => {
                    const rows = [];
                    const totalRows = Math.max(children.length, maxRows - 1);
                    for (let i = 0; i < totalRows && i < maxRows - 1; i++) {
                        const child = i < children.length ? children[i] : null;
                        rows.push(
                            <TableItemRow key={i} idx={i} item={child} isLast={i === totalRows - 1} />
                        );
                    }
                    return rows;
                })()}

                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                    <View style={styles.totalSubtotalLabel}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>¥{category.amount.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>

            <View style={styles.footer} fixed>
                <Text style={styles.footerText}></Text>
                <Text style={styles.footerText}>No. {pageNo}</Text>
            </View>
        </Page>
    );
}

// ===== フラット項目用のDetailsPage =====
function FlatDetailsPages({
    estimate, companyInfo: _companyInfo, startPageNo,
}: {
    estimate: Estimate;
    companyInfo: CompanyInfo;
    startPageNo: number;
}) {
    const ROWS_PER_PAGE = 20;

    const flatItems: Estimate['items'] = [];
    for (const item of estimate.items) {
        flatItems.push(item);
        if (item.isCategory && item.children) {
            for (const child of item.children) {
                flatItems.push(child);
            }
        }
    }

    const totalPages = Math.max(1, Math.ceil(flatItems.length / ROWS_PER_PAGE));
    const pages = [];

    for (let p = 0; p < totalPages; p++) {
        const pageItems = flatItems.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
        const isLastPage = p === totalPages - 1;
        const rowCount = isLastPage ? Math.max(pageItems.length, ROWS_PER_PAGE) : ROWS_PER_PAGE;

        pages.push(
            <Page key={p} size="A4" orientation="landscape" style={styles.page}>
                <View style={styles.detailsHeader}>
                    <Text style={styles.detailsTitle}>見積内訳明細書</Text>
                    <Text style={styles.detailsSubInfo}>
                        見積No. {estimate.estimateNumber}
                    </Text>
                </View>

                <View style={styles.table} wrap={false}>
                    <TableHeader />

                    {(() => {
                        const rows = [];
                        for (let i = 0; i < rowCount; i++) {
                            const item = i < pageItems.length ? pageItems[i] : null;
                            rows.push(
                                <TableItemRow key={i} idx={p * ROWS_PER_PAGE + i} item={item} isLast={i === rowCount - 1} />
                            );
                        }
                        return rows;
                    })()}

                    {isLastPage && (
                        <>
                            <View style={styles.totalRow}>
                                <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                                <View style={styles.totalSubtotalLabel}>
                                    <Text style={styles.totalLabelText}>小計</Text>
                                </View>
                                <View style={styles.totalAmountCell}>
                                    <Text style={styles.totalAmountText}>{estimate.subtotal.toLocaleString()}</Text>
                                </View>
                                <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                            </View>
                            <View style={styles.totalRow}>
                                <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                                <View style={styles.totalSubtotalLabel}>
                                    <Text style={styles.totalLabelText}>消費税</Text>
                                </View>
                                <View style={styles.totalAmountCell}>
                                    <Text style={styles.totalAmountText}>{estimate.tax.toLocaleString()}</Text>
                                </View>
                                <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                            </View>
                            <View style={styles.totalRow}>
                                <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                                <View style={styles.totalSubtotalLabel}>
                                    <Text style={{ ...styles.totalLabelText, fontSize: 9 }}>合計</Text>
                                </View>
                                <View style={styles.totalAmountCell}>
                                    <Text style={{ ...styles.totalAmountText, fontSize: 9 }}>
                                        {estimate.total.toLocaleString()}
                                    </Text>
                                </View>
                                <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                            </View>
                        </>
                    )}
                </View>

                <View style={styles.footer} fixed>
                    <Text style={styles.footerText}></Text>
                    <Text style={styles.footerText}>No. {startPageNo + p}</Text>
                </View>
            </Page>
        );
    }

    return <>{pages}</>;
}

// ===== Main Estimate PDF Document =====
export function EstimatePDF({ estimate, project, companyInfo, includeDetails = true, creatorName }: EstimatePDFProps) {
    const COVER_MAX_ROWS = 12;
    const flatCoverItems = flattenItemsForCover(estimate.items);
    // detail カテゴリのみ内訳明細書を生成（inline は表紙に展開済み）
    const detailCategories = estimate.items.filter(item => item.isCategory && item.categoryType !== 'inline' && (item.children || []).length > 0);
    const hasCategories = detailCategories.length > 0;
    const estimateTitle = project.title || estimate.title;
    const hasOverflow = flatCoverItems.length > COVER_MAX_ROWS;
    const coverContinuationPages = hasOverflow ? Math.ceil((flatCoverItems.length - COVER_MAX_ROWS) / 20) : 0;
    const detailsStartPage = 2 + coverContinuationPages;

    return (
        <Document
            title={`見積書 ${estimate.estimateNumber}`}
            author={companyInfo.name}
            subject={`${estimateTitle}の見積書`}
            keywords="見積書, estimate"
            creator="DandoLink"
        >
            <CoverPage estimate={estimate} project={project} companyInfo={companyInfo} creatorName={creatorName} />

            {hasOverflow && (
                <CoverContinuationPages
                    estimate={estimate}
                    project={project}
                    startPageNo={2}
                />
            )}

            {includeDetails && (
                hasCategories ? (
                    detailCategories.map((cat, idx) => (
                        <CategoryDetailsPage
                            key={cat.id}
                            category={cat}
                            estimate={estimate}
                            companyInfo={companyInfo}
                            pageNo={detailsStartPage + idx}
                            title={estimateTitle}
                        />
                    ))
                ) : (
                    <FlatDetailsPages
                        estimate={estimate}
                        companyInfo={companyInfo}
                        startPageNo={detailsStartPage}
                    />
                )
            )}
        </Document>
    );
}

export default EstimatePDF;
