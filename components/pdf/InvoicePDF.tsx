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
import { Invoice } from '@/types/invoice';
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

// ===== Styles (Portrait A4) =====
const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        paddingTop: 25,
        paddingBottom: 25,
        paddingHorizontal: 30,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // ===== Title =====
    titleText: {
        fontSize: 20,
        letterSpacing: 12,
        fontWeight: 'bold',
        color: COLORS.navy,
    },

    // ===== Header row =====
    coverHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },

    // Left: Customer + amount
    customerArea: {
        width: 230,
    },
    customerName: {
        fontSize: 13,
        fontWeight: 'bold',
        paddingBottom: 3,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },
    customerAddress: {
        fontSize: 8,
        color: COLORS.textSecondary,
        marginTop: 4,
        paddingBottom: 2,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
    },

    // Amount
    amountSection: {
        marginTop: 8,
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
        fontSize: 8,
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

    // Right: Company
    rightArea: {
        flex: 1,
        alignItems: 'flex-end',
    },
    invoiceNoText: {
        fontSize: 8,
        color: COLORS.textSecondary,
    },
    companyName: {
        fontSize: 10,
        fontWeight: 'bold',
        marginBottom: 2,
        letterSpacing: 1,
    },
    companyText: {
        fontSize: 7.5,
        color: COLORS.textSecondary,
        marginBottom: 1,
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
        minHeight: 16,
    },
    infoRowLast: {
        flexDirection: 'row',
        minHeight: 16,
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
        fontSize: 8,
        color: COLORS.textSecondary,
    },
    infoValueCell: {
        flex: 1,
        paddingHorizontal: 3,
        paddingVertical: 2,
        justifyContent: 'center',
    },
    infoValueText: {
        fontSize: 8,
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
        fontSize: 8,
        color: COLORS.textSecondary,
        textAlign: 'center',
    },
    remarksBody: {
        flex: 1,
        padding: 3,
    },
    remarksText: {
        fontSize: 7.5,
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
        minHeight: 16,
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
    projectHeaderRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.3,
        borderBottomColor: COLORS.borderLight,
        minHeight: 18,
    },

    // Column styles for portrait
    cellNo: {
        width: 18,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellName: {
        width: 120,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellSpec: {
        width: 100,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
    },
    cellQty: {
        width: 35,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellUnit: {
        width: 25,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellPrice: {
        width: 50,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellAmount: {
        width: 60,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellRemarks: {
        flex: 1,
        padding: 2,
        justifyContent: 'center',
    },

    headerCellText: {
        fontSize: 7.5,
        color: COLORS.textSecondary,
        textAlign: 'center',
        width: '100%',
    },
    cellText: {
        fontSize: 7.5,
    },
    cellTextCenter: {
        fontSize: 7.5,
        textAlign: 'center',
    },
    cellTextRed: {
        fontSize: 7.5,
        color: COLORS.red,
    },

    // Total section
    totalRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderDark,
        minHeight: 18,
    },
    totalLabelCell: {
        // No(18)+Name(120)+Spec(100)+Qty(35) = 273
        width: 273,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalSubtotalLabel: {
        width: 75,
        padding: 2,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalAmountCell: {
        width: 60,
        padding: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderMedium,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalRemarksCell: {
        flex: 1,
        padding: 2,
    },
    totalLabelText: {
        fontSize: 8,
        fontWeight: 'bold',
        color: COLORS.textSecondary,
    },
    totalAmountText: {
        fontSize: 8,
        fontWeight: 'bold',
    },

    // Footer
    footer: {
        position: 'absolute',
        bottom: 12,
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

interface InvoicePDFProps {
    invoice: Invoice;
    project: Project;
    companyInfo: CompanyInfo;
    includeDetails?: boolean;
    bankAccounts?: Array<{ bankName: string; branchName: string; accountType: string; accountNumber: string }>;
    registrationNumber?: string;
    projectMasters?: Array<{ id: string; title: string }>;
}

// ===== Cover Page Component (Portrait — matches EstimatePDF layout) =====
function CoverPage({
    invoice,
    project,
    companyInfo,
    projectMasters,
}: Omit<InvoicePDFProps, 'includeDetails' | 'bankAccounts' | 'registrationNumber'>) {
    const createdDate = new Date(invoice.createdAt);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;

    // 明細データ準備
    const allItems = invoice.items.filter(item => item.description);
    const hasMultipleProjects = projectMasters && projectMasters.length > 1;

    type DisplayRow = { type: 'header'; title: string } | { type: 'item'; item: typeof allItems[0]; index: number };
    const displayRows: DisplayRow[] = [];
    let itemIndex = 0;

    if (hasMultipleProjects) {
        for (const pm of projectMasters!) {
            const pmItems = allItems.filter(item => item.projectMasterId === pm.id);
            if (pmItems.length > 0) {
                displayRows.push({ type: 'header', title: `【${pm.title}】` });
                pmItems.forEach(item => {
                    itemIndex++;
                    displayRows.push({ type: 'item', item, index: itemIndex });
                });
            }
        }
        const orphanItems = allItems.filter(item => !item.projectMasterId || !projectMasters!.find(pm => pm.id === item.projectMasterId));
        orphanItems.forEach(item => {
            itemIndex++;
            displayRows.push({ type: 'item', item, index: itemIndex });
        });
    } else {
        allItems.forEach(item => {
            itemIndex++;
            displayRows.push({ type: 'item', item, index: itemIndex });
        });
    }

    const maxRows = 15;

    // 支払期限の表示
    const paymentTermText = (() => {
        if (!dueDate) return '';
        const diffMs = dueDate.getTime() - createdDate.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays >= 28 && diffDays <= 31) return '発行日より1ヶ月';
        if (diffDays >= 58 && diffDays <= 62) return '発行日より2ヶ月';
        if (diffDays >= 88 && diffDays <= 93) return '発行日より3ヶ月';
        return toReiwa(dueDate);
    })();

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>

            {/* Title row: title center, date/No right */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 10 }}>
                <View style={{ width: '25%' }} />
                <View style={{ alignItems: 'center' }}>
                    <Text style={styles.titleText}>御 請 求 書</Text>
                </View>
                <View style={{ width: '25%', alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 8, color: COLORS.textSecondary, textAlign: 'right' }}>請求日　{toReiwa(createdDate)}</Text>
                    <Text style={[styles.invoiceNoText, { marginTop: 1, textAlign: 'right' }]}>請求No. {invoice.invoiceNumber}</Text>
                </View>
            </View>

            {/* Header: Left (customer + amount) / Right (company) */}
            <View style={styles.coverHeader}>
                <View style={styles.customerArea}>
                    {(() => {
                        const fullName = `${project.customer || ''}\u3000${project.customerHonorific || '御中'}`;
                        const len = fullName.length;
                        const fontSize = len <= 12 ? 13 : len <= 16 ? 11 : len <= 20 ? 10 : 9;
                        return <Text style={{ ...styles.customerName, fontSize }}>{fullName}</Text>;
                    })()}
                    <Text style={styles.customerAddress}>{(project as unknown as Record<string, string>).customerAddress || ''}</Text>

                    <View style={styles.amountSection}>
                        <View style={styles.amountMainRow}>
                            <Text style={styles.amountLabel}>合計金額</Text>
                            <Text style={styles.amountValue}>¥{invoice.total.toLocaleString()}</Text>
                            <Text style={styles.amountTaxNote}>（税込）</Text>
                        </View>
                        <View style={styles.amountSubRow}>
                            <Text style={styles.amountSubLabel}>小計</Text>
                            <Text style={styles.amountSubValue}>¥{invoice.subtotal.toLocaleString()}</Text>
                        </View>
                        <View style={styles.amountSubRow}>
                            <Text style={styles.amountSubLabel}>消費税額(10%)</Text>
                            <Text style={styles.amountSubValue}>¥{invoice.tax.toLocaleString()}</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.rightArea}>
                    <View style={{ position: 'relative' }}>
                        {companyInfo.sealImage && (
                            <Image src={companyInfo.sealImage} style={{ position: 'absolute', top: 30, right: 5, width: 45, height: 45 }} />
                        )}
                        <View style={{ alignSelf: 'flex-end' }}>
                            {companyInfo.logoImage && (
                                <Image src={companyInfo.logoImage} style={{ height: 30, marginBottom: 2, objectFit: 'contain', alignSelf: 'flex-start' }} />
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
                            <Text style={[styles.companyText, { marginTop: 6 }]}>〒{companyInfo.postalCode}　{companyInfo.address}</Text>
                            <Text style={styles.companyText}>TEL　{companyInfo.tel}　　FAX　{companyInfo.fax || ''}</Text>
                            {companyInfo.email && (
                                <Text style={styles.companyText}>e-mail　{companyInfo.email}</Text>
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
                            <Text style={styles.infoValueText}>{project.title || invoice.title}</Text>
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
                            <Text style={styles.infoValueText}>{paymentTermText}</Text>
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
                            {invoice.notes ? sanitizePdfText(invoice.notes) : ''}
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
                    const rows = [];
                    for (let i = 0; i < maxRows; i++) {
                        const row = i < displayRows.length ? displayRows[i] : null;

                        if (row && row.type === 'header') {
                            rows.push(
                                <View key={`header-${i}`} style={styles.projectHeaderRow}>
                                    <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                                    <View style={{ ...styles.cellName, width: 220 }}>
                                        <Text style={{ fontSize: 7.5, fontWeight: 'bold' }}>{sanitizePdfText(row.title)}</Text>
                                    </View>
                                    <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
                                </View>
                            );
                            continue;
                        }

                        const item = row && row.type === 'item' ? row.item : null;
                        const idx = row && row.type === 'item' ? row.index : 0;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : styles.tableRow}>
                                <View style={styles.cellNo}>
                                    <Text style={styles.cellTextCenter}>{item ? idx : ''}</Text>
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
                        <Text style={styles.totalAmountText}>¥{invoice.subtotal.toLocaleString()}</Text>
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

// ===== Details Page Component =====
function DetailsPage({
    invoice,
    projectMasters,
}: {
    invoice: Invoice;
    companyInfo: CompanyInfo;
    projectMasters?: Array<{ id: string; title: string }>;
}) {
    const maxRows = 25;
    const allItems = invoice.items.filter(item => item.description);
    const hasMultipleProjects = projectMasters && projectMasters.length > 1;

    type DisplayRow = { type: 'header'; title: string } | { type: 'item'; item: typeof allItems[0]; index: number };
    const displayRows: DisplayRow[] = [];
    let itemIndex = 0;

    if (hasMultipleProjects) {
        for (const pm of projectMasters!) {
            const pmItems = allItems.filter(item => item.projectMasterId === pm.id);
            if (pmItems.length > 0) {
                displayRows.push({ type: 'header', title: `【${pm.title}】` });
                pmItems.forEach(item => {
                    itemIndex++;
                    displayRows.push({ type: 'item', item, index: itemIndex });
                });
            }
        }
        const orphanItems = allItems.filter(item => !item.projectMasterId || !projectMasters!.find(pm => pm.id === item.projectMasterId));
        orphanItems.forEach(item => {
            itemIndex++;
            displayRows.push({ type: 'item', item, index: itemIndex });
        });
    } else {
        allItems.forEach(item => {
            itemIndex++;
            displayRows.push({ type: 'item', item, index: itemIndex });
        });
    }

    const formatAmount = (amount: number, isNegative: boolean): string => {
        if (isNegative) return `(${Math.abs(amount).toLocaleString()})`;
        return amount.toLocaleString();
    };

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>

            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 5 }}>
                <Text style={{ fontSize: 14, letterSpacing: 8, color: COLORS.navy, fontWeight: 'bold', paddingBottom: 2, borderBottomWidth: 1.5, borderBottomColor: COLORS.navy }}>
                    請求内訳明細書
                </Text>
                <Text style={{ fontSize: 8, color: COLORS.textSecondary }}>
                    請求No. {invoice.invoiceNumber}
                </Text>
            </View>

            {/* Table */}
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
                    const rows = [];
                    for (let i = 0; i < maxRows; i++) {
                        const row = i < displayRows.length ? displayRows[i] : null;

                        if (row && row.type === 'header') {
                            rows.push(
                                <View key={`header-${i}`} style={styles.projectHeaderRow}>
                                    <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                                    <View style={{ ...styles.cellName, width: 220 }}>
                                        <Text style={{ fontSize: 7.5, fontWeight: 'bold' }}>{sanitizePdfText(row.title)}</Text>
                                    </View>
                                    <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
                                </View>
                            );
                            continue;
                        }

                        const item = row && row.type === 'item' ? row.item : null;
                        const idx = row && row.type === 'item' ? row.index : 0;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : styles.tableRow}>
                                <View style={styles.cellNo}>
                                    <Text style={styles.cellTextCenter}>{item ? idx : ''}</Text>
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
                                        {item ? formatAmount(item.amount, isNegative) : ''}
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
                        <Text style={styles.totalAmountText}>{invoice.subtotal.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* Tax */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                    <View style={styles.totalSubtotalLabel}>
                        <Text style={styles.totalLabelText}>消費税</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{invoice.tax.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* Total */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                    <View style={styles.totalSubtotalLabel}>
                        <Text style={{ ...styles.totalLabelText, fontSize: 9 }}>合計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={{ ...styles.totalAmountText, fontSize: 9 }}>
                            {invoice.total.toLocaleString()}
                        </Text>
                    </View>
                    <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}></Text>
                <Text style={styles.footerText}>No. 2</Text>
            </View>
        </Page>
    );
}

// ===== Main Invoice PDF Document =====
export function InvoicePDF({
    invoice,
    project,
    companyInfo,
    projectMasters,
}: Omit<InvoicePDFProps, 'includeDetails' | 'bankAccounts' | 'registrationNumber'>) {
    return (
        <Document
            title={`請求書 ${invoice.invoiceNumber}`}
            author={companyInfo.name}
            subject={`${project.title}の請求書`}
            keywords="請求書, invoice"
            creator="DandoLink"
        >
            <CoverPage
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
                projectMasters={projectMasters}
            />
            <DetailsPage
                invoice={invoice}
                companyInfo={companyInfo}
                projectMasters={projectMasters}
            />
        </Document>
    );
}

export default InvoicePDF;
