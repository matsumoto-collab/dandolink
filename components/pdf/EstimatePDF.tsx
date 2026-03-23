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

// ===== Styles =====
const styles = StyleSheet.create({
    // Page
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 9,
        paddingTop: 30,
        paddingBottom: 30,
        paddingHorizontal: 35,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // ===== Cover Page =====
    // Top accent bar
    accentBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: COLORS.navy,
    },

    // Top row: estimateNo (left), title (center), date (right)
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginTop: 10,
        marginBottom: 12,
    },
    estimateNoText: {
        fontSize: 9,
        color: COLORS.textSecondary,
    },
    titleCenter: {
        width: '50%',
        alignItems: 'center',
    },
    dateRight: {
        width: '25%',
        alignItems: 'flex-end',
    },

    // Header row: customer left, company right
    coverHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 15,
    },

    // Left: Customer info
    customerArea: {
        width: '48%',
    },
    postalCode: {
        fontSize: 9,
        color: COLORS.textSecondary,
        marginBottom: 2,
    },
    addressText: {
        fontSize: 9,
        color: COLORS.textSecondary,
        marginBottom: 6,
    },
    customerName: {
        fontSize: 16,
        fontWeight: 'bold',
        paddingBottom: 4,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },

    greetingText: {
        fontSize: 9,
        marginTop: 10,
        color: COLORS.textSecondary,
    },

    // Right: Company
    rightArea: {
        width: '45%',
        alignItems: 'flex-end',
    },
    titleText: {
        fontSize: 22,
        letterSpacing: 10,
        fontWeight: 'bold',
        color: COLORS.navy,
        paddingBottom: 4,
        borderBottomWidth: 2,
        borderBottomColor: COLORS.navy,
    },
    companyRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    companyInfoBlock: {
        alignItems: 'flex-end',
    },
    companyName: {
        fontSize: 12,
        fontWeight: 'bold',
        marginBottom: 3,
        letterSpacing: 1,
    },
    companyText: {
        fontSize: 8,
        color: COLORS.textSecondary,
        marginBottom: 1,
        textAlign: 'right',
    },
    stampBox: {
        width: 50,
        height: 50,
    },

    // ===== Amount Section =====
    amountSection: {
        marginBottom: 12,
        width: '60%',
    },
    amountMainRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.textPrimary,
        paddingBottom: 4,
        marginBottom: 2,
    },
    amountLabel: {
        fontSize: 12,
        fontWeight: 'bold',
        width: '30%',
    },
    amountValue: {
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        width: '45%',
    },
    amountTaxNote: {
        fontSize: 9,
        color: COLORS.textSecondary,
        width: '25%',
    },
    amountSubRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        borderBottomStyle: 'dashed',
        paddingVertical: 2,
    },
    amountSubLabel: {
        fontSize: 9,
        color: COLORS.textSecondary,
        width: '30%',
        textAlign: 'center',
    },
    amountSubValue: {
        fontSize: 9,
        width: '45%',
        textAlign: 'center',
    },

    // ===== Info Table =====
    infoTable: {
        flexDirection: 'row',
        marginBottom: 12,
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
        minHeight: 20,
    },
    infoRowLast: {
        flexDirection: 'row',
        minHeight: 20,
    },
    infoLabelCell: {
        width: 70,
        backgroundColor: COLORS.infoBg,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderLight,
        justifyContent: 'center',
    },
    infoLabelText: {
        fontSize: 9,
        color: COLORS.textSecondary,
    },
    infoValueCell: {
        flex: 1,
        padding: 4,
        justifyContent: 'center',
    },
    infoValueText: {
        fontSize: 9,
    },
    remarksArea: {
        width: '38%',
        marginLeft: '2%',
        borderWidth: 0.5,
        borderColor: COLORS.borderMedium,
    },
    remarksHeader: {
        backgroundColor: COLORS.infoBg,
        padding: 4,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
    },
    remarksHeaderText: {
        fontSize: 9,
        color: COLORS.textSecondary,
        textAlign: 'center',
    },
    remarksBody: {
        flex: 1,
        padding: 5,
    },
    remarksText: {
        fontSize: 8,
        color: COLORS.textSecondary,
        lineHeight: 1.5,
    },

    // ===== Details Table =====
    table: {
        width: '100%',
        borderWidth: 0.5,
        borderColor: COLORS.borderDark,
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: COLORS.headerBg,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderDark,
        minHeight: 22,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.3,
        borderBottomColor: COLORS.borderLight,
        minHeight: 17,
    },
    tableRowZebra: {
        flexDirection: 'row',
        borderBottomWidth: 0.3,
        borderBottomColor: COLORS.borderLight,
        minHeight: 17,
        backgroundColor: COLORS.zebraStripe,
    },
    tableRowLast: {
        flexDirection: 'row',
        minHeight: 17,
    },

    // Column styles (portrait A4 = ~525pt usable width)
    // No.(25) + Name(170) + Spec(150) + Qty(45) + Unit(35) + Price(60) + Amount(70) = 555 ≈ usable
    cellNo: {
        width: 25,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellName: {
        width: 170,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellSpec: {
        width: 150,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellQty: {
        width: 45,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellUnit: {
        width: 35,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellPrice: {
        width: 60,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellAmount: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },

    // Header cell text
    headerCellText: {
        fontSize: 8,
        color: COLORS.headerText,
        textAlign: 'center',
        fontWeight: 'bold',
    },
    cellText: {
        fontSize: 8,
    },
    cellTextCenter: {
        fontSize: 8,
        textAlign: 'center',
    },
    cellTextRed: {
        fontSize: 8,
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
        // No(25) + Name(170) + Spec(150) + Qty(45) + Unit(35) + Price(60) = 485 → 少し縮めて金額に余裕
        width: 455,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalAmountCell: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
        alignItems: 'flex-end',
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
        marginBottom: 10,
        marginTop: 5,
    },
    detailsTitle: {
        fontSize: 16,
        letterSpacing: 8,
        color: COLORS.navy,
        fontWeight: 'bold',
        paddingBottom: 3,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },
    detailsSubInfo: {
        fontSize: 9,
        color: COLORS.textSecondary,
    },

    // Footer
    footer: {
        position: 'absolute',
        bottom: 15,
        left: 35,
        right: 35,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    footerText: {
        fontSize: 7,
        color: COLORS.borderMedium,
    },
});

interface EstimatePDFProps {
    estimate: Estimate;
    project: Project;
    companyInfo: CompanyInfo;
    includeCoverPage?: boolean;
}

// ===== Cover Page Component =====
function CoverPage({ estimate, project, companyInfo }: Omit<EstimatePDFProps, 'includeCoverPage'>) {
    const createdDate = new Date(estimate.createdAt);
    const validUntilDate = new Date(estimate.validUntil);
    const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            {/* Top accent bar */}
            <View style={styles.accentBar} fixed />

            {/* Top row: Title (center), Date + No (right) */}
            <View style={styles.topRow}>
                <View style={{ width: '25%' }} />
                <View style={styles.titleCenter}>
                    <Text style={styles.titleText}>御 見 積 書</Text>
                </View>
                <View style={styles.dateRight}>
                    <Text style={{ fontSize: 10, color: COLORS.textSecondary }}>見積日　{toReiwa(createdDate)}</Text>
                    <Text style={[styles.estimateNoText, { marginTop: 2 }]}>見積No. {estimate.estimateNumber}</Text>
                </View>
            </View>

            {/* Header: Customer (left) + Company (right) */}
            <View style={styles.coverHeader}>
                {/* Left: Customer */}
                <View style={styles.customerArea}>
                    {project.location && (
                        <>
                            <Text style={styles.postalCode}>
                                {project.location.match(/〒[\d-]+/) ? project.location.match(/〒[\d-]+/)?.[0] : ''}
                            </Text>
                            <Text style={styles.addressText}>
                                {project.location.replace(/〒[\d-]+\s*/, '')}
                            </Text>
                        </>
                    )}
                    {(() => {
                        const fullName = `${project.customer || ''}\u3000${project.customerHonorific || '御中'}`;
                        const len = fullName.length;
                        const fontSize = len <= 12 ? 16 : len <= 16 ? 14 : len <= 20 ? 12 : 11;
                        return <Text style={{ ...styles.customerName, fontSize }}>{fullName}</Text>;
                    })()}
                    <Text style={styles.greetingText}>下記の通り御見積り申し上げます。</Text>
                </View>

                {/* Right: Company Info + Seal */}
                <View style={styles.rightArea}>
                    <View style={styles.companyRow}>
                        <View style={styles.companyInfoBlock}>
                            {companyInfo.licenseNumber && (
                                <Text style={styles.companyText}>{companyInfo.licenseNumber}</Text>
                            )}
                            <Text style={styles.companyName}>{companyInfo.name}</Text>
                            <Text style={styles.companyText}>
                                〒{companyInfo.postalCode}
                            </Text>
                            <Text style={styles.companyText}>
                                {companyInfo.address}
                            </Text>
                            <Text style={styles.companyText}>
                                TEL：{companyInfo.tel}　FAX：{companyInfo.fax || ''}
                            </Text>
                            {companyInfo.email && (
                                <Text style={styles.companyText}>{companyInfo.email}</Text>
                            )}
                        </View>
                        {companyInfo.sealImage && (
                            <Image src={companyInfo.sealImage} style={styles.stampBox} />
                        )}
                    </View>
                </View>
            </View>

            {/* Amount Section */}
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
                            <Text style={styles.infoValueText}>{project.location || ''}</Text>
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
                            <Text style={styles.infoValueText}></Text>
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

                {/* Remarks */}
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

            {/* Inline Details Table on Cover Page — トップレベル項目のみ表示 */}
            <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.headerCellText}>No.</Text></View>
                    <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.headerCellText}>規格</Text></View>
                    <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
                </View>

                {/* Body Rows — トップレベル項目のみ（カテゴリはamount集計で1行表示） */}
                {(() => {
                    const topItems = estimate.items; // トップレベルのみ（childrenは展開しない）
                    const maxRows = 15;
                    const rows = [];

                    for (let i = 0; i < maxRows; i++) {
                        const item = i < topItems.length ? topItems[i] : null;
                        const isZebra = i % 2 === 1;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;
                        const isCat = item?.isCategory;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : (isZebra ? styles.tableRowZebra : styles.tableRow)}>
                                <View style={styles.cellNo}>
                                    <Text style={styles.cellTextCenter}>{item ? i + 1 : ''}</Text>
                                </View>
                                <View style={styles.cellName}>
                                    <Text style={isNegative ? styles.cellTextRed : (isCat ? { fontSize: 8, fontWeight: 'bold' } : styles.cellText)}>
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
                                    <Text style={isNegative ? styles.cellTextRed : styles.cellText}>
                                        {item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}
                                    </Text>
                                </View>
                            </View>
                        );
                    }
                    return rows;
                })()}

                {/* Subtotal */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>¥{estimate.subtotal.toLocaleString()}</Text>
                    </View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}>{companyInfo.name}</Text>
                <Text style={styles.footerText}>No. 1</Text>
            </View>
        </Page>
    );
}

// ===== 内訳テーブル共通ヘッダー =====
function TableHeader() {
    return (
        <View style={styles.tableHeader}>
            <View style={styles.cellNo}><Text style={styles.headerCellText}>No.</Text></View>
            <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
            <View style={styles.cellSpec}><Text style={styles.headerCellText}>規格</Text></View>
            <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
            <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
            <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
            <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
        </View>
    );
}

// ===== 内訳テーブル行 =====
function TableItemRow({ idx, item, isLast }: { idx: number; item: Estimate['items'][0] | null; isLast: boolean }) {
    const isZebra = idx % 2 === 1;
    const isNegative = item ? item.amount < 0 : false;
    const isCat = item?.isCategory;

    return (
        <View style={isLast ? styles.tableRowLast : (isZebra ? styles.tableRowZebra : styles.tableRow)}>
            <View style={styles.cellNo}>
                <Text style={styles.cellTextCenter}>{item ? idx + 1 : ''}</Text>
            </View>
            <View style={styles.cellName}>
                <Text style={isNegative ? styles.cellTextRed : (isCat ? { fontSize: 8, fontWeight: 'bold' } : styles.cellText)}>
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
                <Text style={isNegative ? styles.cellTextRed : styles.cellText}>
                    {item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}
                </Text>
            </View>
        </View>
    );
}

// ===== カテゴリ内訳明細ページ =====
function CategoryDetailsPage({
    category, estimate, companyInfo, pageNo, title: estimateTitle,
}: {
    category: Estimate['items'][0];
    estimate: Estimate;
    companyInfo: CompanyInfo;
    pageNo: number;
    title: string;
}) {
    const children = category.children || [];
    const maxRows = 25;

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            <View style={styles.accentBar} fixed />

            {/* Header */}
            <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>内 訳 明 細 書</Text>
                <Text style={styles.detailsSubInfo}>
                    見積番号：{estimate.estimateNumber}
                </Text>
            </View>

            {/* 工事名称 */}
            <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 9, color: COLORS.textSecondary }}>
                    工事名称: {sanitizePdfText(estimateTitle)}
                </Text>
            </View>

            {/* Table */}
            <View style={styles.table}>
                <TableHeader />

                {/* カテゴリ名行（1行目） */}
                <View style={{ ...styles.tableRow, backgroundColor: COLORS.infoBg }}>
                    <View style={styles.cellNo}>
                        <Text style={styles.cellTextCenter}>1</Text>
                    </View>
                    <View style={{ ...styles.cellName, width: 170 }}>
                        <Text style={{ fontSize: 8, fontWeight: 'bold' }}>{sanitizePdfText(category.description)}</Text>
                    </View>
                    <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellQty}><Text style={styles.cellText}>{category.quantity && category.quantity > 0 ? category.quantity.toLocaleString() : ''}</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.cellText}>{sanitizePdfText(category.unit || '')}</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellAmount}><Text style={styles.cellText}>{category.amount > 0 ? category.amount.toLocaleString() : ''}</Text></View>
                </View>

                {/* 子項目行 */}
                {(() => {
                    const rows = [];
                    const totalRows = Math.max(children.length, maxRows - 1);
                    for (let i = 0; i < totalRows && i < maxRows - 1; i++) {
                        const child = i < children.length ? children[i] : null;
                        rows.push(
                            <TableItemRow key={i} idx={i + 1} item={child} isLast={i === totalRows - 1} />
                        );
                    }
                    return rows;
                })()}

                {/* Subtotal */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>¥{category.amount.toLocaleString()}</Text>
                    </View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}>{companyInfo.name}</Text>
                <Text style={styles.footerText}>No. {pageNo}</Text>
            </View>
        </Page>
    );
}

// ===== フラット項目用のDetailsPage（カテゴリなしの場合、または表紙なしの場合） =====
function FlatDetailsPage({
    estimate, companyInfo, pageNo,
}: {
    estimate: Estimate;
    companyInfo: CompanyInfo;
    pageNo: number;
}) {
    const maxRows = 25;

    // フラット化: カテゴリはそのまま1行 + 子項目も展開
    const flatItems: Estimate['items'] = [];
    for (const item of estimate.items) {
        flatItems.push(item);
        if (item.isCategory && item.children) {
            for (const child of item.children) {
                flatItems.push(child);
            }
        }
    }

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            <View style={styles.accentBar} fixed />

            <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>見積内訳明細書</Text>
                <Text style={styles.detailsSubInfo}>
                    見積番号：{estimate.estimateNumber}
                </Text>
            </View>

            <View style={styles.table}>
                <TableHeader />

                {(() => {
                    const rows = [];
                    for (let i = 0; i < maxRows; i++) {
                        const item = i < flatItems.length ? flatItems[i] : null;
                        rows.push(
                            <TableItemRow key={i} idx={i} item={item} isLast={i === maxRows - 1} />
                        );
                    }
                    return rows;
                })()}

                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{estimate.subtotal.toLocaleString()}</Text>
                    </View>
                </View>
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>消費税</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{estimate.tax.toLocaleString()}</Text>
                    </View>
                </View>
                <View style={styles.totalRowFinal}>
                    <View style={styles.totalLabelCell}>
                        <Text style={{ ...styles.totalLabelText, fontSize: 10, color: COLORS.navy }}>合計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={{ ...styles.totalAmountText, fontSize: 10, color: COLORS.navy }}>
                            {estimate.total.toLocaleString()}
                        </Text>
                    </View>
                </View>
            </View>

            <View style={styles.footer} fixed>
                <Text style={styles.footerText}>{companyInfo.name}</Text>
                <Text style={styles.footerText}>No. {pageNo}</Text>
            </View>
        </Page>
    );
}

// ===== Main Estimate PDF Document =====
export function EstimatePDF({ estimate, project, companyInfo, includeCoverPage = true }: EstimatePDFProps) {
    const categories = estimate.items.filter(item => item.isCategory && (item.children || []).length > 0);
    const hasCategories = categories.length > 0;
    const estimateTitle = project.title || estimate.title;

    return (
        <Document
            title={`見積書 ${estimate.estimateNumber}`}
            author={companyInfo.name}
            subject={`${estimateTitle}の見積書`}
            keywords="見積書, estimate"
            creator="DandoLink"
        >
            {includeCoverPage && (
                <CoverPage estimate={estimate} project={project} companyInfo={companyInfo} />
            )}

            {hasCategories ? (
                /* カテゴリごとに内訳明細ページを生成 */
                categories.map((cat, idx) => (
                    <CategoryDetailsPage
                        key={cat.id}
                        category={cat}
                        estimate={estimate}
                        companyInfo={companyInfo}
                        pageNo={includeCoverPage ? idx + 2 : idx + 1}
                        title={estimateTitle}
                    />
                ))
            ) : (
                /* カテゴリなし: 従来通りフラットな明細ページ */
                <FlatDetailsPage
                    estimate={estimate}
                    companyInfo={companyInfo}
                    pageNo={includeCoverPage ? 2 : 1}
                />
            )}
        </Document>
    );
}

export default EstimatePDF;
