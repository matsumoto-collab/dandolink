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

// ===== Color Palette (same as EstimatePDF) =====
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
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 9,
        paddingTop: 30,
        paddingBottom: 30,
        paddingHorizontal: 35,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // Top accent bar
    accentBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: COLORS.navy,
    },

    // Top row: invoiceNo (left), title (center), date (right)
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginTop: 10,
        marginBottom: 12,
    },
    invoiceNoText: {
        fontSize: 9,
        color: COLORS.textSecondary,
    },
    titleCenter: {
        width: '50%',
        alignItems: 'center',
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
        fontSize: 8,
        marginTop: 10,
        color: COLORS.textSecondary,
        lineHeight: 1.8,
    },

    // Right: Company
    rightArea: {
        width: '45%',
        alignItems: 'flex-end',
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
        width: '100%',
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
    projectHeaderRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.3,
        borderBottomColor: COLORS.borderLight,
        minHeight: 18,
        backgroundColor: COLORS.infoBg,
    },

    // Column styles
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

interface InvoicePDFProps {
    invoice: Invoice;
    project: Project;
    companyInfo: CompanyInfo;
    includeCoverPage?: boolean;
    bankAccounts?: Array<{ bankName: string; branchName: string; accountType: string; accountNumber: string }>;
    registrationNumber?: string;
    projectMasters?: Array<{ id: string; title: string }>;
}

// ===== Cover Page Component =====
function CoverPage({
    invoice,
    project,
    companyInfo,
    projectMasters,
}: Omit<InvoicePDFProps, 'includeCoverPage' | 'bankAccounts' | 'registrationNumber'>) {
    const createdDate = new Date(invoice.createdAt);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;

    // 明細データ準備（案件ごとにグループ化）
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

    // 表紙用最大行数
    const maxRows = 15;

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            {/* Top accent bar */}
            <View style={styles.accentBar} fixed />

            {/* Title center */}
            <View style={{ alignItems: 'center', marginTop: 10, marginBottom: 15 }}>
                <Text style={styles.titleText}>請 求 書</Text>
            </View>

            {/* Main header: Left (customer + greeting + amount) / Right (date + No + company) */}
            <View style={styles.coverHeader}>
                {/* Left side */}
                <View style={styles.customerArea}>
                    {(() => {
                        const fullName = `${project.customer || ''}\u3000${project.customerHonorific || '御中'}`;
                        const len = fullName.length;
                        const fontSize = len <= 12 ? 16 : len <= 16 ? 14 : len <= 20 ? 12 : 11;
                        return <Text style={{ ...styles.customerName, fontSize }}>{fullName}</Text>;
                    })()}
                    <Text style={styles.greetingText}>
                        拝啓　時下ますますご清栄のこととお喜び申し上げます。{'\n'}
                        平素は格別のご高配を賜り、厚く御礼申し上げます。{'\n'}
                        下記の通りご請求申し上げます。
                    </Text>

                    {/* Amount Section */}
                    <View style={[styles.amountSection, { marginTop: 12 }]}>
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

                {/* Right side */}
                <View style={styles.rightArea}>
                    <Text style={{ fontSize: 10, color: COLORS.textSecondary, textAlign: 'right' }}>請求日　{toReiwa(createdDate)}</Text>
                    <Text style={[styles.invoiceNoText, { marginTop: 2, textAlign: 'right' }]}>請求No. {invoice.invoiceNumber}</Text>

                    <View style={[styles.companyRow, { marginTop: 10 }]}>
                        <View style={styles.companyInfoBlock}>
                            {companyInfo.licenseNumber && (
                                <Text style={styles.companyText}>{companyInfo.licenseNumber}</Text>
                            )}
                            <Text style={styles.companyName}>{companyInfo.name}</Text>
                            <Text style={styles.companyText}>〒{companyInfo.postalCode}</Text>
                            <Text style={styles.companyText}>{companyInfo.address}</Text>
                            <Text style={styles.companyText}>TEL：{companyInfo.tel}　FAX：{companyInfo.fax || ''}</Text>
                            {companyInfo.email && (
                                <Text style={styles.companyText}>{companyInfo.email}</Text>
                            )}
                            {companyInfo.registrationNumber && (
                                <Text style={styles.companyText}>登録番号：{companyInfo.registrationNumber}</Text>
                            )}
                        </View>
                        {companyInfo.sealImage && (
                            <Image src={companyInfo.sealImage} style={styles.stampBox} />
                        )}
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
                            <Text style={styles.infoLabelText}>お支払期限</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>{dueDate ? toReiwa(dueDate) : ''}</Text>
                        </View>
                    </View>
                    <View style={styles.infoRowLast}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>お振込先</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>
                                {companyInfo.bankAccounts && companyInfo.bankAccounts.length > 0
                                    ? companyInfo.bankAccounts.map(b => `${b.bankName} ${b.branchName}（${b.accountType}）${b.accountNumber}`).join('\n')
                                    : ''}
                            </Text>
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
                            {invoice.notes ? sanitizePdfText(invoice.notes) : ''}
                        </Text>
                    </View>
                </View>
            </View>

            {/* Inline Details Table on Cover Page */}
            <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.headerCellText}>No.</Text></View>
                    <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.headerCellText}>仕様</Text></View>
                    <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
                </View>

                {/* Body Rows */}
                {(() => {
                    const rows = [];
                    let zebraIdx = 0;

                    for (let i = 0; i < maxRows; i++) {
                        const row = i < displayRows.length ? displayRows[i] : null;

                        if (row && row.type === 'header') {
                            rows.push(
                                <View key={`header-${i}`} style={styles.projectHeaderRow}>
                                    <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                                    <View style={{ ...styles.cellName, width: 320 }}>
                                        <Text style={{ fontSize: 8, fontWeight: 'bold', color: COLORS.navy }}>{sanitizePdfText(row.title)}</Text>
                                    </View>
                                    <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                                </View>
                            );
                            continue;
                        }

                        const item = row && row.type === 'item' ? row.item : null;
                        const idx = row && row.type === 'item' ? row.index : 0;
                        const isZebra = zebraIdx % 2 === 1;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;
                        zebraIdx++;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : (isZebra ? styles.tableRowZebra : styles.tableRow)}>
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
                        <Text style={styles.totalAmountText}>¥{invoice.subtotal.toLocaleString()}</Text>
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

// ===== Details Page Component =====
function DetailsPage({
    invoice,
    companyInfo,
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
            {/* Top accent bar */}
            <View style={styles.accentBar} fixed />

            {/* Header */}
            <View style={styles.detailsHeader}>
                <Text style={styles.detailsTitle}>請求内訳明細書</Text>
                <Text style={styles.detailsSubInfo}>
                    請求番号：{invoice.invoiceNumber}
                </Text>
            </View>

            {/* Table */}
            <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.headerCellText}>No.</Text></View>
                    <View style={styles.cellName}><Text style={styles.headerCellText}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.headerCellText}>仕様</Text></View>
                    <View style={styles.cellQty}><Text style={styles.headerCellText}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.headerCellText}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.headerCellText}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.headerCellText}>金額</Text></View>
                </View>

                {/* Body Rows */}
                {(() => {
                    const rows = [];
                    let zebraIdx = 0;

                    for (let i = 0; i < maxRows; i++) {
                        const row = i < displayRows.length ? displayRows[i] : null;

                        if (row && row.type === 'header') {
                            rows.push(
                                <View key={`header-${i}`} style={styles.projectHeaderRow}>
                                    <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                                    <View style={{ ...styles.cellName, width: 320 }}>
                                        <Text style={{ fontSize: 8, fontWeight: 'bold', color: COLORS.navy }}>{sanitizePdfText(row.title)}</Text>
                                    </View>
                                    <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                                </View>
                            );
                            continue;
                        }

                        const item = row && row.type === 'item' ? row.item : null;
                        const idx = row && row.type === 'item' ? row.index : 0;
                        const isZebra = zebraIdx % 2 === 1;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;
                        zebraIdx++;

                        rows.push(
                            <View key={i} style={isLast ? styles.tableRowLast : (isZebra ? styles.tableRowZebra : styles.tableRow)}>
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
                            </View>
                        );
                    }
                    return rows;
                })()}

                {/* Subtotal Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{invoice.subtotal.toLocaleString()}</Text>
                    </View>
                </View>

                {/* Tax Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.totalLabelText}>消費税</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.totalAmountText}>{invoice.tax.toLocaleString()}</Text>
                    </View>
                </View>

                {/* Total Row */}
                <View style={styles.totalRowFinal}>
                    <View style={styles.totalLabelCell}>
                        <Text style={{ ...styles.totalLabelText, fontSize: 10, color: COLORS.navy }}>合計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={{ ...styles.totalAmountText, fontSize: 10, color: COLORS.navy }}>
                            {invoice.total.toLocaleString()}
                        </Text>
                    </View>
                </View>
            </View>

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}>{companyInfo.name}</Text>
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
}: Omit<InvoicePDFProps, 'includeCoverPage' | 'bankAccounts' | 'registrationNumber'>) {
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
