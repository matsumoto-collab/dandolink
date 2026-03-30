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
        paddingBottom: 40,
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

    // Column styles for portrait table
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
    totalRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderDark,
        minHeight: 18,
    },
    totalLabelCell: {
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

    // Info table
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

    // Footer
    footer: {
        position: 'absolute',
        bottom: 12,
        left: 30,
        right: 30,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
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

// Helper: get extra fields from project (cast)
function getExtra(project: Project): { customerPostalCode?: string; customerAddress?: string } {
    return project as unknown as { customerPostalCode?: string; customerAddress?: string };
}

// ===== Cover Page Component =====
function CoverPage({
    invoice,
    project,
    companyInfo,
    projectMasters,
}: Omit<InvoicePDFProps, 'includeDetails' | 'bankAccounts' | 'registrationNumber'>) {
    const createdDate = new Date(invoice.createdAt);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const extra = getExtra(project);

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

    const customerFullName = `${project.customer || ''}\u3000${project.customerHonorific || '御中'}`;

    // Bank accounts from companyInfo
    const bankAccounts = companyInfo.bankAccounts || [];

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>

            {/* 1段目: 〒住所(左) + 御請求書タイトル(右) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 12, marginBottom: 4 }}>
                <View style={{ width: '45%', paddingLeft: 40 }}>
                    {extra.customerPostalCode && (
                        <Text style={{ fontSize: 11, marginBottom: 1 }}>〒 {extra.customerPostalCode}</Text>
                    )}
                    {extra.customerAddress && (
                        <Text style={{ fontSize: 11 }}>{extra.customerAddress}</Text>
                    )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.titleText}>御 請 求 書</Text>
                    <Text style={{ fontSize: 8, color: COLORS.textSecondary, marginTop: 4, textAlign: 'right' }}>請求日　{toReiwa(createdDate)}</Text>
                    <Text style={{ fontSize: 8, color: COLORS.textSecondary, marginTop: 1, textAlign: 'right' }}>請求No. {invoice.invoiceNumber}</Text>
                </View>
            </View>

            {/* 2段目: 顧客名+合計金額+件名(左) + 会社情報(右) — 横並び */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                {/* 左: 顧客名 + 合計金額 + 件名 */}
                <View style={{ width: '50%', paddingLeft: 40 }}>
                    {(() => {
                        const len = customerFullName.length;
                        const fontSize = len <= 12 ? 16 : len <= 16 ? 14 : len <= 20 ? 12 : 11;
                        return <Text style={{ fontSize, fontWeight: 'bold', color: COLORS.navy, marginBottom: 40 }}>{customerFullName}</Text>;
                    })()}

                    {/* 合計金額セクション */}
                    <View style={{ width: 240, marginBottom: 8, borderWidth: 0.5, borderColor: COLORS.borderMedium }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', borderBottomWidth: 1, borderBottomColor: COLORS.borderDark, paddingVertical: 3, paddingHorizontal: 4 }}>
                            <Text style={{ fontSize: 11, fontWeight: 'bold', width: 80 }}>合計金額</Text>
                            <Text style={{ fontSize: 16, fontWeight: 'bold', flex: 1, textAlign: 'center' }}>¥{invoice.total.toLocaleString()}</Text>
                            <Text style={{ fontSize: 8, color: COLORS.textSecondary, width: 40 }}>（税込）</Text>
                        </View>
                        <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.borderLight, paddingVertical: 2, paddingHorizontal: 4 }}>
                            <Text style={{ fontSize: 8, color: COLORS.textSecondary, width: 80, paddingLeft: 10 }}>小計</Text>
                            <Text style={{ fontSize: 8, flex: 1, textAlign: 'center' }}>¥{invoice.subtotal.toLocaleString()}</Text>
                            <View style={{ width: 40 }} />
                        </View>
                        <View style={{ flexDirection: 'row', paddingVertical: 2, paddingHorizontal: 4 }}>
                            <Text style={{ fontSize: 8, color: COLORS.textSecondary, width: 80, paddingLeft: 10 }}>消費税額(10%)</Text>
                            <Text style={{ fontSize: 8, flex: 1, textAlign: 'center' }}>¥{invoice.tax.toLocaleString()}</Text>
                            <View style={{ width: 40 }} />
                        </View>
                    </View>

                    {/* 件名テーブル */}
                    <View style={{ width: 240, borderWidth: 0.5, borderColor: COLORS.borderMedium }}>
                {[
                    { label: '件名', value: project.title || invoice.title },
                    { label: '現場住所', value: project.location || '' },
                    { label: '有効期限', value: paymentTermText },
                    { label: '工期', value: '' },
                    { label: '支払条件', value: '従来通り' },
                ].map((row, i, arr) => (
                    <View key={i} style={{ flexDirection: 'row', borderBottomWidth: i < arr.length - 1 ? 0.5 : 0, borderBottomColor: COLORS.borderLight, minHeight: 16 }}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>{row.label}</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <Text style={styles.infoValueText}>{row.value}</Text>
                        </View>
                    </View>
                ))}
                    </View>
                </View>

                {/* 右: 会社情報（見積書と同じスタイル） */}
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <View style={{ position: 'relative' }}>
                        {companyInfo.sealImage && (
                            <Image src={companyInfo.sealImage} style={{ position: 'absolute', top: 36, right: 10, width: 50, height: 50 }} />
                        )}
                        <View style={{ alignSelf: 'flex-end' }}>
                            {companyInfo.logoImage && (
                                <Image src={companyInfo.logoImage} style={{ height: 35, marginBottom: 3, objectFit: 'contain', alignSelf: 'flex-start' }} />
                            )}
                            <Text style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 2, letterSpacing: 1 }}>{companyInfo.name}</Text>
                            {companyInfo.licenseNumber && (
                                <Text style={{ fontSize: 8.5, color: COLORS.textSecondary, marginBottom: 1, textAlign: 'right' }}>{companyInfo.licenseNumber}</Text>
                            )}
                            {(companyInfo.representativeTitle || companyInfo.representative) && (
                                <Text style={{ fontSize: 8.5, color: COLORS.textSecondary, marginBottom: 1, textAlign: 'right' }}>
                                    {companyInfo.representativeTitle ? `${companyInfo.representativeTitle}　` : ''}{companyInfo.representative}
                                </Text>
                            )}
                            <Text style={{ fontSize: 8.5, color: COLORS.textSecondary, marginTop: 8, marginBottom: 1 }}>〒{companyInfo.postalCode}　{companyInfo.address}</Text>

                            {companyInfo.registrationNumber && (
                                <Text style={{ fontSize: 8.5, color: COLORS.textSecondary, marginTop: 6, marginBottom: 1 }}>登録番号：{companyInfo.registrationNumber}</Text>
                            )}

                            {bankAccounts.length > 0 && (
                                <View style={{ marginTop: 6 }}>
                                    <Text style={{ fontSize: 8.5, color: COLORS.textSecondary, marginBottom: 2 }}>お振込先：</Text>
                                    {bankAccounts.map((ba, i) => (
                                        <Text key={i} style={{ fontSize: 8.5, color: COLORS.textSecondary, marginBottom: 1 }}>
                                            {ba.bankName} {ba.branchName}（{ba.accountType}）{ba.accountNumber}
                                        </Text>
                                    ))}
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            </View>

            {/* Details Table */}
            <View style={{ width: '100%', borderWidth: 1, borderColor: COLORS.borderDark }}>
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
            <View style={{ width: '100%', borderWidth: 1, borderColor: COLORS.borderDark }}>
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
                projectMasters={projectMasters}
            />
        </Document>
    );
}

export default InvoicePDF;
