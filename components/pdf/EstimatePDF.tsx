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
import { toReiwa } from './styles';

// Styles
const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        paddingTop: 30,
        paddingBottom: 30,
        paddingHorizontal: 40,
        backgroundColor: '#ffffff',
    },
    // ===== Cover Page =====
    coverHeader: {
        position: 'relative',
        height: 50,
        marginBottom: 30,
    },
    siteNameSection: {
        position: 'absolute',
        left: 0,
        top: 0,
        flexDirection: 'row',
        alignItems: 'center',
    },
    siteNameLabel: {
        fontSize: 14,
        fontWeight: 'bold',
        marginRight: 15,
    },
    siteNameValue: {
        fontSize: 12,
        paddingBottom: 2,
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        minWidth: 150,
    },
    titleBoxContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        alignItems: 'center',
    },
    titleBox: {
        borderWidth: 1,
        borderColor: '#000',
        paddingVertical: 8,
        paddingHorizontal: 30,
    },
    titleText: {
        fontSize: 20,
        letterSpacing: 12,
        textAlign: 'center',
    },
    dateSection: {
        position: 'absolute',
        right: 0,
        top: 0,
    },
    dateText: {
        fontSize: 11,
    },
    customerSection: {
        marginTop: 40,
        marginBottom: 10,
        alignItems: 'center',
    },
    customerNameContainer: {
        width: 400,
        alignItems: 'center',
    },
    customerName: {
        fontSize: 22,
        paddingBottom: 5,
    },
    customerUnderline: {
        width: 400,
        borderBottomWidth: 1,
        borderBottomColor: '#000',
    },
    descriptionText: {
        fontSize: 10,
        marginTop: 8,
        alignSelf: 'flex-start',
    },
    amountSection: {
        marginTop: 30,
        marginBottom: 20,
        alignItems: 'center',
    },
    amountContainer: {
        width: 400,
    },
    amountMainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#000',
        marginBottom: 8,
    },
    amountLabelBox: {
        borderRightWidth: 1,
        borderRightColor: '#000',
        paddingVertical: 10,
        paddingHorizontal: 20,
    },
    amountLabel: {
        fontSize: 14,
    },
    amountValueBox: {
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 20,
        alignItems: 'flex-end',
    },
    amountValue: {
        fontSize: 26,
        fontWeight: 'bold',
    },
    amountDetailSection: {
        alignItems: 'flex-end',
    },
    amountDetailRow: {
        flexDirection: 'row',
        marginVertical: 1,
        minWidth: 200,
    },
    amountDetailLabel: {
        fontSize: 12,
        width: 60,
        textAlign: 'right',
        marginRight: 20,
    },
    amountDetailValue: {
        fontSize: 12,
        width: 120,
        textAlign: 'right',
    },
    bottomSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 30,
    },
    infoSection: {
        width: '45%',
    },
    infoRow: {
        flexDirection: 'row',
        marginVertical: 3,
        borderBottomWidth: 0.5,
        borderBottomColor: '#ccc',
        paddingBottom: 3,
    },
    infoLabel: {
        fontSize: 10,
        width: 70,
    },
    infoValue: {
        fontSize: 10,
        flex: 1,
    },
    companySection: {
        width: '45%',
        alignItems: 'flex-end',
    },
    companyRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    companyInfo: {
        marginRight: 10,
        alignItems: 'flex-end',
    },
    companyText: {
        fontSize: 9,
        marginBottom: 2,
        textAlign: 'right',
    },
    companyName: {
        fontSize: 12,
        marginBottom: 3,
        letterSpacing: 2,
        textAlign: 'right',
    },
    companyRep: {
        fontSize: 10,
        marginBottom: 3,
        textAlign: 'right',
    },
    stampBox: {
        width: 55,
        height: 55,
        borderWidth: 1,
        borderColor: '#ccc',
    },
    // ===== Details Page =====
    detailsPage: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        paddingTop: 25,
        paddingBottom: 25,
        paddingHorizontal: 30,
        backgroundColor: '#ffffff',
    },
    detailsTitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 5,
        letterSpacing: 8,
    },
    detailsTitleUnderline: {
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        width: 100,
        alignSelf: 'center',
        marginBottom: 15,
    },
    table: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#000',
    },
    tableHeader: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        backgroundColor: '#fff',
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minHeight: 18,
    },
    tableRowLast: {
        flexDirection: 'row',
        minHeight: 18,
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
    },
    // Column styles
    cellNo: {
        width: 25,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellName: {
        width: 260,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
    },
    cellQty: {
        width: 50,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellUnit: {
        width: 35,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellPrice: {
        width: 55,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellAmount: {
        width: 70,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellNotes: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
    },
    cellText: {
        fontSize: 9,
    },
    cellTextCenter: {
        fontSize: 9,
        textAlign: 'center',
    },
    cellTextRed: {
        fontSize: 9,
        color: '#ff0000',
    },
    // Total section
    totalRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minHeight: 20,
    },
    totalLabelCell: {
        width: 425,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalAmountCell: {
        width: 70,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalNotesCell: {
        flex: 1,
        padding: 3,
        justifyContent: 'center',
    },
});

interface EstimatePDFProps {
    estimate: Estimate;
    project: Project;
    companyInfo: CompanyInfo;
    includeCoverPage?: boolean;
}

// Cover Page Component
function CoverPage({ estimate, project, companyInfo }: Omit<EstimatePDFProps, 'includeCoverPage'>) {
    const createdDate = new Date(estimate.createdAt);
    const validUntilDate = new Date(estimate.validUntil);
    const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    // Calculate adjustment amount (if any negative items exist)
    const adjustmentAmount = estimate.items
        .filter(item => item.amount < 0)
        .reduce((sum, item) => sum + item.amount, 0);

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>
            {/* Header: Title, Date */}
            <View style={styles.coverHeader}>
                <View style={styles.titleBoxContainer}>
                    <View style={styles.titleBox}>
                        <Text style={styles.titleText}>御 見 積 書</Text>
                    </View>
                </View>
                <View style={styles.dateSection}>
                    <Text style={styles.dateText}>{toReiwa(createdDate)}</Text>
                </View>
            </View>

            {/* Customer Name and Description */}
            <View style={styles.customerSection}>
                <View style={styles.customerNameContainer}>
                    <Text style={styles.customerName}>{project.customer || '御中'} 様</Text>
                    <View style={styles.customerUnderline} />
                    <Text style={styles.descriptionText}>下記のとおり御見積申し上げます。</Text>
                </View>
            </View>

            {/* Amount Section */}
            <View style={styles.amountSection}>
                <View style={styles.amountContainer}>
                    <View style={styles.amountMainRow}>
                        <View style={styles.amountLabelBox}>
                            <Text style={styles.amountLabel}>御見積金額</Text>
                        </View>
                        <View style={styles.amountValueBox}>
                            <Text style={styles.amountValue}>¥{estimate.total.toLocaleString()} −</Text>
                        </View>
                    </View>
                    <View style={styles.amountDetailSection}>
                        <View style={styles.amountDetailRow}>
                            <Text style={styles.amountDetailLabel}>税抜金額</Text>
                            <Text style={styles.amountDetailValue}>¥{estimate.subtotal.toLocaleString()} −</Text>
                        </View>
                        <View style={styles.amountDetailRow}>
                            <Text style={styles.amountDetailLabel}>消費税</Text>
                            <Text style={styles.amountDetailValue}>¥{estimate.tax.toLocaleString()} −</Text>
                        </View>
                        <View style={styles.amountDetailRow}>
                            <Text style={styles.amountDetailLabel}>調整額</Text>
                            <Text style={styles.amountDetailValue}>
                                {adjustmentAmount !== 0 ? `¥${Math.abs(adjustmentAmount).toLocaleString()} −` : '−'}
                            </Text>
                        </View>
                    </View>
                </View>
            </View>

            {/* Bottom Section */}
            <View style={styles.bottomSection}>
                {/* Left: Site Information */}
                <View style={styles.infoSection}>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>現場名称：</Text>
                        <Text style={styles.infoValue}>{project.title || estimate.title}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>現場住所：</Text>
                        <Text style={styles.infoValue}>{project.location || ''}</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>予定工期：</Text>
                        <Text style={styles.infoValue}></Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>支払条件：</Text>
                        <Text style={styles.infoValue}>お打ち合わせによる</Text>
                    </View>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>有効期限：</Text>
                        <Text style={styles.infoValue}>{monthsDiff}ヶ月</Text>
                    </View>
                </View>

                {/* Right: Company Information */}
                <View style={styles.companySection}>
                    <View style={styles.companyRow}>
                        <View style={styles.companyInfo}>
                            {companyInfo.licenseNumber && (
                                <Text style={styles.companyText}>{companyInfo.licenseNumber}</Text>
                            )}
                            <Text style={styles.companyName}>{companyInfo.name}</Text>
                            <Text style={styles.companyRep}>{companyInfo.representativeTitle || '代表取締役'}　{companyInfo.representative}</Text>
                            <Text style={styles.companyText}>〒{companyInfo.postalCode}　{companyInfo.address}</Text>
                            <Text style={styles.companyText}>TEL:{companyInfo.tel}　FAX：{companyInfo.fax || ''}</Text>
                        </View>
                        {companyInfo.sealImage ? (
                            <Image src={companyInfo.sealImage} style={styles.stampBox} />
                        ) : (
                            <View style={styles.stampBox} />
                        )}
                    </View>
                </View>
            </View>
        </Page>
    );
}

// Details Page Component
function DetailsPage({ estimate }: { estimate: Estimate }) {
    const maxRows = 20;

    // Prepare items array with 20 rows
    const items: Array<{
        index: number;
        description: string;
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
                description: item.description || '',
                quantity: item.quantity > 0 ? item.quantity : null,
                unit: item.unit || '',
                unitPrice: item.unitPrice !== 0 ? item.unitPrice : null,
                amount: item.amount,
                notes: item.notes || '',
                isNegative: item.amount < 0,
                isEmpty: false,
            });
        } else {
            items.push({
                index: i + 1,
                description: '',
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

    // Format amount with parentheses for negative values
    const formatAmount = (amount: number | null, isNegative: boolean, isEmpty: boolean): string => {
        if (isEmpty || amount === null) return '';
        if (isNegative) return `(${Math.abs(amount).toLocaleString()})`;
        return amount.toLocaleString();
    };

    return (
        <Page size="A4" orientation="landscape" style={styles.detailsPage}>
            {/* Title */}
            <Text style={styles.detailsTitle}>内 訳 書</Text>
            <View style={styles.detailsTitleUnderline} />

            {/* Table */}
            <View style={styles.table}>
                {/* Header */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.cellTextCenter}></Text></View>
                    <View style={styles.cellName}><Text style={styles.cellTextCenter}>工事名称</Text></View>
                    <View style={styles.cellQty}><Text style={styles.cellTextCenter}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.cellTextCenter}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.cellTextCenter}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.cellTextCenter}>金額</Text></View>
                    <View style={styles.cellNotes}><Text style={styles.cellTextCenter}>備考</Text></View>
                </View>

                {/* Body Rows */}
                {items.map((item, idx) => (
                    <View key={idx} style={idx === items.length - 1 ? styles.tableRowLast : styles.tableRow}>
                        <View style={styles.cellNo}>
                            <Text style={styles.cellText}>{item.index}</Text>
                        </View>
                        <View style={styles.cellName}>
                            <Text style={item.isNegative ? styles.cellTextRed : styles.cellText}>
                                {item.description}
                            </Text>
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
                ))}

                {/* Subtotal Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.cellText}>{estimate.subtotal.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* Tax Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.cellText}>消費税</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.cellText}>{estimate.tax.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* Total Row */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.cellText}>合計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.cellText}>{estimate.total.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>
        </Page>
    );
}

// Main Estimate PDF Document
export function EstimatePDF({ estimate, project, companyInfo, includeCoverPage = true }: EstimatePDFProps) {
    return (
        <Document
            title={`見積書 ${estimate.estimateNumber}`}
            author={companyInfo.name}
            subject={`${project.title}の見積書`}
            keywords="見積書, estimate"
            creator="YuSystem"
        >
            {includeCoverPage && (
                <CoverPage estimate={estimate} project={project} companyInfo={companyInfo} />
            )}
            <DetailsPage estimate={estimate} />
        </Document>
    );
}

export default EstimatePDF;
