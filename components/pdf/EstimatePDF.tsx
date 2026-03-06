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
    navy: '#1a365d',
    navyLight: '#2c5282',
    headerBg: '#1a365d',
    headerText: '#ffffff',
    infoBg: '#f0f4f8',
    zebraStripe: '#f8fafc',
    borderDark: '#2d3748',
    borderLight: '#cbd5e0',
    borderMedium: '#a0aec0',
    textPrimary: '#1a202c',
    textSecondary: '#4a5568',
    red: '#e53e3e',
    white: '#ffffff',
    totalBg: '#edf2f7',
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

    // Header row: customer left, title+company right
    coverHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 15,
        marginTop: 10,
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

    // Right: Title + Company
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
        marginBottom: 6,
    },
    dateText: {
        fontSize: 10,
        color: COLORS.textSecondary,
        marginBottom: 12,
    },
    companyRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    companyInfoBlock: {
        alignItems: 'flex-end',
        marginRight: 8,
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
        borderWidth: 0.5,
        borderColor: COLORS.borderLight,
    },

    // ===== Amount Section =====
    amountSection: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    amountBox: {
        flexDirection: 'row',
        borderWidth: 1.5,
        borderColor: COLORS.navy,
        width: '60%',
    },
    amountLabelBox: {
        backgroundColor: COLORS.navy,
        paddingVertical: 10,
        paddingHorizontal: 14,
        justifyContent: 'center',
    },
    amountLabel: {
        fontSize: 12,
        color: COLORS.headerText,
        fontWeight: 'bold',
    },
    amountValueBox: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 15,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    amountValue: {
        fontSize: 22,
        fontWeight: 'bold',
        color: COLORS.navy,
    },
    amountTaxNote: {
        fontSize: 8,
        color: COLORS.textSecondary,
        marginTop: 2,
    },
    amountDetailArea: {
        width: '38%',
        paddingLeft: 15,
        justifyContent: 'center',
    },
    amountDetailRow: {
        flexDirection: 'row',
        marginVertical: 1,
    },
    amountDetailLabel: {
        fontSize: 9,
        width: 70,
        color: COLORS.textSecondary,
    },
    amountDetailValue: {
        fontSize: 9,
        flex: 1,
        textAlign: 'right',
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
    cellNo: {
        width: 22,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellName: {
        width: 130,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellSpec: {
        width: 120,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellQty: {
        width: 42,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellUnit: {
        width: 30,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellPrice: {
        width: 55,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellAmount: {
        width: 65,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellNotes: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
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
        width: 399,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalAmountCell: {
        width: 65,
        padding: 3,
        borderRightWidth: 0.3,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalNotesCell: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
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
        justifyContent: 'center',
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

            {/* Header: Customer (left) + Title & Company (right) */}
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
                        const fullName = `${project.customer || ''} ${project.customerHonorific || '御中'}`;
                        const len = fullName.length;
                        const fontSize = len <= 12 ? 16 : len <= 16 ? 14 : len <= 20 ? 12 : 11;
                        return <Text style={{ ...styles.customerName, fontSize }}>{fullName}</Text>;
                    })()}
                    {/* contactPerson is available on Customer type if needed */}
                    <Text style={styles.greetingText}>下記の通り御見積り申し上げます。</Text>
                </View>

                {/* Right: Title + Company Info */}
                <View style={styles.rightArea}>
                    <Text style={styles.titleText}>御 見 積 書</Text>
                    <Text style={styles.dateText}>発行日：{toReiwa(createdDate)}</Text>

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
                        {companyInfo.sealImage ? (
                            <Image src={companyInfo.sealImage} style={styles.stampBox} />
                        ) : (
                            <View style={styles.stampBox} />
                        )}
                    </View>
                </View>
            </View>

            {/* Amount Section */}
            <View style={styles.amountSection}>
                <View style={styles.amountBox}>
                    <View style={styles.amountLabelBox}>
                        <Text style={styles.amountLabel}>合計金額</Text>
                    </View>
                    <View style={styles.amountValueBox}>
                        <Text style={styles.amountValue}>¥{estimate.total.toLocaleString()}</Text>
                        <Text style={styles.amountTaxNote}>（税込）</Text>
                    </View>
                </View>
                <View style={styles.amountDetailArea}>
                    <View style={styles.amountDetailRow}>
                        <Text style={styles.amountDetailLabel}>小計</Text>
                        <Text style={styles.amountDetailValue}>¥{estimate.subtotal.toLocaleString()}</Text>
                    </View>
                    <View style={styles.amountDetailRow}>
                        <Text style={styles.amountDetailLabel}>消費税額(10%)</Text>
                        <Text style={styles.amountDetailValue}>¥{estimate.tax.toLocaleString()}</Text>
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

            {/* Inline Details Table on Cover Page */}
            <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.headerCellText}></Text></View>
                    <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.headerCellText}>規格</Text></View>
                    <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
                    <View style={styles.cellNotes}><Text style={styles.headerCellText}>備考</Text></View>
                </View>

                {/* Body Rows */}
                {(() => {
                    const maxRows = 15;
                    const rows = [];

                    for (let i = 0; i < maxRows; i++) {
                        const item = i < estimate.items.length ? estimate.items[i] : null;
                        const isZebra = i % 2 === 1;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : (isZebra ? styles.tableRowZebra : styles.tableRow)}>
                                <View style={styles.cellNo}>
                                    <Text style={styles.cellTextCenter}>{item ? i + 1 : ''}</Text>
                                </View>
                                <View style={styles.cellName}>
                                    <Text style={isNegative ? styles.cellTextRed : styles.cellText}>
                                        {item ? sanitizePdfText(item.description || '') : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellSpec}>
                                    <Text style={styles.cellText}>
                                        {item?.specification ? sanitizePdfText(item.specification) : ''}
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
                                        {item && item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellAmount}>
                                    <Text style={isNegative ? styles.cellTextRed : styles.cellText}>
                                        {item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}
                                    </Text>
                                </View>
                                <View style={styles.cellNotes}>
                                    <Text style={styles.cellText}>
                                        {item ? sanitizePdfText(item.notes || '') : ''}
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
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}>DandoLink</Text>
            </View>
        </Page>
    );
}

// ===== Details Page Component =====
function DetailsPage({ estimate }: { estimate: Estimate }) {
    const maxRows = 25;

    const items: Array<{
        index: number;
        description: string;
        specification: string;
        quantity: number | null;
        unit: string;
        unitPrice: number | null;
        amount: number | null;
        notes: string;
        isNegative: boolean;
        isEmpty: boolean;
    }> = [];

    for (let i = 0; i < maxRows; i++) {
        if (i < estimate.items.length) {
            const item = estimate.items[i];
            items.push({
                index: i + 1,
                description: sanitizePdfText(item.description || ''),
                specification: sanitizePdfText(item.specification || ''),
                quantity: item.quantity > 0 ? item.quantity : null,
                unit: sanitizePdfText(item.unit || ''),
                unitPrice: item.unitPrice !== 0 ? item.unitPrice : null,
                amount: item.amount,
                notes: sanitizePdfText(item.notes || ''),
                isNegative: item.amount < 0,
                isEmpty: false,
            });
        } else {
            items.push({
                index: i + 1,
                description: '',
                specification: '',
                quantity: null,
                unit: '',
                unitPrice: null,
                amount: null,
                notes: '',
                isNegative: false,
                isEmpty: true,
            });
        }
    }

    const formatAmount = (amount: number | null, isNegative: boolean, isEmpty: boolean): string => {
        if (isEmpty || amount === null) return '';
        if (isNegative) return `(${Math.abs(amount).toLocaleString()})`;
        return amount.toLocaleString();
    };

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            {/* Top accent bar */}
            <View style={styles.accentBar} fixed />

            {/* Header */}
            <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>内 訳 書</Text>
                <Text style={styles.detailsSubInfo}>
                    見積番号：{estimate.estimateNumber}
                </Text>
            </View>

            {/* Table */}
            <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.headerCellText}></Text></View>
                    <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.headerCellText}>規格</Text></View>
                    <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
                    <View style={styles.cellNotes}><Text style={styles.headerCellText}>備考</Text></View>
                </View>

                {/* Body Rows */}
                {items.map((item, idx) => {
                    const isZebra = idx % 2 === 1;
                    const isLast = idx === items.length - 1;
                    return (
                        <View key={idx} style={isLast ? styles.tableRowLast : (isZebra ? styles.tableRowZebra : styles.tableRow)}>
                            <View style={styles.cellNo}>
                                <Text style={styles.cellTextCenter}>{!item.isEmpty ? item.index : ''}</Text>
                            </View>
                            <View style={styles.cellName}>
                                <Text style={item.isNegative ? styles.cellTextRed : styles.cellText}>
                                    {item.description}
                                </Text>
                            </View>
                            <View style={styles.cellSpec}>
                                <Text style={styles.cellText}>{item.specification}</Text>
                            </View>
                            <View style={styles.cellQty}>
                                <Text style={styles.cellText}>
                                    {item.quantity !== null ? item.quantity.toLocaleString() : ''}
                                </Text>
                            </View>
                            <View style={styles.cellUnit}>
                                <Text style={styles.cellText}>{item.unit}</Text>
                            </View>
                            <View style={styles.cellPrice}>
                                <Text style={styles.cellText}>
                                    {item.unitPrice !== null ? item.unitPrice.toLocaleString() : ''}
                                </Text>
                            </View>
                            <View style={styles.cellAmount}>
                                <Text style={item.isNegative ? styles.cellTextRed : styles.cellText}>
                                    {formatAmount(item.amount, item.isNegative, item.isEmpty)}
                                </Text>
                            </View>
                            <View style={styles.cellNotes}>
                                <Text style={styles.cellText}>{item.notes}</Text>
                            </View>
                        </View>
                    );
                })}

                {/* Subtotal Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{estimate.subtotal.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* Tax Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>消費税</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{estimate.tax.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* Total Row */}
                <View style={styles.totalRowFinal}>
                    <View style={styles.totalLabelCell}>
                        <Text style={{ ...styles.totalLabelText, fontSize: 10, color: COLORS.navy }}>合計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={{ ...styles.totalAmountText, fontSize: 10, color: COLORS.navy }}>
                            {estimate.total.toLocaleString()}
                        </Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}>DandoLink</Text>
            </View>
        </Page>
    );
}

// ===== Main Estimate PDF Document =====
export function EstimatePDF({ estimate, project, companyInfo, includeCoverPage = true }: EstimatePDFProps) {
    return (
        <Document
            title={`見積書 ${estimate.estimateNumber}`}
            author={companyInfo.name}
            subject={`${project.title}の見積書`}
            keywords="見積書, estimate"
            creator="DandoLink"
        >
            {includeCoverPage && (
                <CoverPage estimate={estimate} project={project} companyInfo={companyInfo} />
            )}
            <DetailsPage estimate={estimate} />
        </Document>
    );
}

export default EstimatePDF;
