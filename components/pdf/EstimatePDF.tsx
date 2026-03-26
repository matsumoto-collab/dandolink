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
        paddingTop: 20,
        paddingBottom: 20,
        paddingHorizontal: 30,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // Top accent bar
    accentBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        backgroundColor: COLORS.navy,
    },

    // ===== Title =====
    titleCenter: {
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 8,
    },
    titleText: {
        fontSize: 16,
        letterSpacing: 10,
        fontWeight: 'bold',
        color: COLORS.navy,
        paddingBottom: 3,
        borderBottomWidth: 2,
        borderBottomColor: COLORS.navy,
    },

    // ===== Header row: customer left, company right =====
    coverHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },

    // Left: Customer + amount
    customerArea: {
        width: 280,
    },
    customerName: {
        fontSize: 11,
        fontWeight: 'bold',
        paddingBottom: 3,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },
    greetingText: {
        fontSize: 8.5,
        marginTop: 5,
        color: COLORS.textSecondary,
    },

    // Amount
    amountSection: {
        marginTop: 6,
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
        fontSize: 8.5,
        fontWeight: 'bold',
        width: '30%',
    },
    amountValue: {
        fontSize: 12,
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
        fontSize: 8.5,
        color: COLORS.textSecondary,
        width: '30%',
        textAlign: 'center',
    },
    amountSubValue: {
        fontSize: 8.5,
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
        marginBottom: 6,
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
        minHeight: 20,
    },
    tableRowLast: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderMedium,
        minHeight: 20,
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
function CoverPage({ estimate, project, companyInfo, creatorName }: Omit<EstimatePDFProps, 'includeDetails'>) {
    const createdDate = new Date(estimate.createdAt);
    const validUntilDate = new Date(estimate.validUntil);
    const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>
            <View style={styles.accentBar} fixed />

            {/* Title row: title center, date/No right */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 8 }}>
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
                        const len = fullName.length;
                        const fontSize = len <= 12 ? 11 : len <= 16 ? 10 : len <= 20 ? 9 : 8.5;
                        return <Text style={{ ...styles.customerName, fontSize }}>{fullName}</Text>;
                    })()}
                    <Text style={styles.greetingText}>下記の通り御見積り申し上げます。</Text>

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
                            {/* Logo — 会社名の上 */}
                            {companyInfo.logoImage && (
                                <Image src={companyInfo.logoImage} style={{ height: 35, marginBottom: 3, objectFit: 'contain' }} />
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
            <View style={styles.table}>
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
                    const topItems = estimate.items;
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
                                    <Text style={isNegative ? styles.cellTextRed : (isCat ? { fontSize: 7, fontWeight: 'bold' } : styles.cellText)}>
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
                                <View style={styles.cellRemarks}><Text style={styles.cellText}>{item?.notes ? sanitizePdfText(item.notes) : ''}</Text></View>
                            </View>
                        );
                    }
                    return rows;
                })()}

                {/* Subtotal */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                    <View style={styles.totalSubtotalLabel}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>¥{estimate.subtotal.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}></Text>
                <Text style={styles.footerText}>No. 1</Text>
            </View>
        </Page>
    );
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
                <Text style={isNegative ? styles.cellTextRed : (isCat ? { fontSize: 7, fontWeight: 'bold' } : styles.cellText)}>
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
    const maxRows = 25;

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>
            <View style={styles.accentBar} fixed />

            <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>内 訳 明 細 書</Text>
                <Text style={styles.detailsSubInfo}>
                    見積番号：{estimate.estimateNumber}
                </Text>
            </View>

            <View style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 8, color: COLORS.textSecondary }}>
                    工事名称: {sanitizePdfText(estimateTitle)}
                </Text>
            </View>

            <View style={styles.table}>
                <TableHeader />

                <View style={styles.tableRow}>
                    <View style={styles.cellNo}>
                        <Text style={styles.cellTextCenter}>1</Text>
                    </View>
                    <View style={styles.cellName}>
                        <Text style={{ fontSize: 7, fontWeight: 'bold' }}>{sanitizePdfText(category.description)}</Text>
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
                            <TableItemRow key={i} idx={i + 1} item={child} isLast={i === totalRows - 1} />
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
function FlatDetailsPage({
    estimate, companyInfo: _companyInfo, pageNo,
}: {
    estimate: Estimate;
    companyInfo: CompanyInfo;
    pageNo: number;
}) {
    const maxRows = 25;

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
        <Page size="A4" orientation="landscape" style={styles.page}>
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
            </View>

            <View style={styles.footer} fixed>
                <Text style={styles.footerText}></Text>
                <Text style={styles.footerText}>No. {pageNo}</Text>
            </View>
        </Page>
    );
}

// ===== Main Estimate PDF Document =====
export function EstimatePDF({ estimate, project, companyInfo, includeDetails = true, creatorName }: EstimatePDFProps) {
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
            <CoverPage estimate={estimate} project={project} companyInfo={companyInfo} creatorName={creatorName} />

            {includeDetails && (
                hasCategories ? (
                    categories.map((cat, idx) => (
                        <CategoryDetailsPage
                            key={cat.id}
                            category={cat}
                            estimate={estimate}
                            companyInfo={companyInfo}
                            pageNo={idx + 2}
                            title={estimateTitle}
                        />
                    ))
                ) : (
                    <FlatDetailsPage
                        estimate={estimate}
                        companyInfo={companyInfo}
                        pageNo={2}
                    />
                )
            )}
        </Document>
    );
}

export default EstimatePDF;
