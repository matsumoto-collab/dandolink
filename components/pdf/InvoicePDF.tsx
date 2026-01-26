'use client';

import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Font,
} from '@react-pdf/renderer';
import { Invoice } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';

// Register Japanese font
Font.register({
    family: 'NotoSansJP',
    fonts: [
        {
            src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-400-normal.woff',
            fontWeight: 'normal',
        },
        {
            src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-700-normal.woff',
            fontWeight: 'bold',
        },
    ],
});

// Helper function to convert date to Reiwa format
function toReiwa(date: Date): string {
    const year = date.getFullYear();
    const reiwaYear = year - 2018;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `令和${reiwaYear}年 ${month}月${day}日`;
}

// Styles
const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        paddingTop: 30,
        paddingBottom: 40,
        paddingHorizontal: 40,
        backgroundColor: '#ffffff',
    },
    // ===== Header Section =====
    headerSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    // 左側：宛先（窓付き封筒用）
    customerSection: {
        width: '45%',
    },
    postalCode: {
        fontSize: 10,
        marginBottom: 3,
        marginLeft: 40,
        marginTop: 20,
    },
    addressText: {
        fontSize: 10,
        marginBottom: 8,
        marginLeft: 40,
    },
    customerName: {
        fontSize: 14,
        fontWeight: 'bold',
        marginLeft: 40,
    },
    // 右側：タイトル・会社情報
    rightSection: {
        width: '50%',
        alignItems: 'flex-end',
    },
    titleSection: {
        alignItems: 'center',
        marginBottom: 10,
    },
    titleText: {
        fontSize: 18,
        letterSpacing: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        paddingBottom: 3,
        paddingHorizontal: 10,
    },
    dateText: {
        fontSize: 10,
        marginTop: 5,
    },
    companyInfo: {
        alignItems: 'flex-end',
        marginTop: 10,
    },
    companyName: {
        fontSize: 11,
        marginBottom: 2,
    },
    companyText: {
        fontSize: 9,
        marginBottom: 1,
        textAlign: 'right',
    },
    // 振込先
    bankSection: {
        marginTop: 10,
        alignItems: 'flex-end',
    },
    bankLabel: {
        fontSize: 9,
        marginBottom: 2,
    },
    bankText: {
        fontSize: 9,
        marginBottom: 1,
        textAlign: 'right',
    },
    // ===== 挨拶文 =====
    greetingSection: {
        borderWidth: 0.5,
        borderColor: '#999',
        padding: 15,
        marginTop: 80,
        width: 300,
    },
    greetingText: {
        fontSize: 9,
        lineHeight: 1.8,
    },
    greetingEnd: {
        fontSize: 9,
        textAlign: 'right',
        marginTop: 10,
    },
    // ===== 件名・金額 =====
    subjectSection: {
        marginBottom: 15,
    },
    subjectLabel: {
        fontSize: 10,
        marginBottom: 5,
    },
    amountTable: {
        borderWidth: 1,
        borderColor: '#000',
        width: 300,
    },
    amountHeaderRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        backgroundColor: '#f5f5f5',
    },
    amountHeaderCell: {
        width: '50%',
        padding: 5,
        borderRightWidth: 1,
        borderRightColor: '#000',
    },
    amountHeaderCellLast: {
        width: '50%',
        padding: 5,
    },
    amountHeaderText: {
        fontSize: 9,
        textAlign: 'center',
    },
    amountValueRow: {
        flexDirection: 'row',
    },
    amountValueCell: {
        width: '50%',
        padding: 8,
        borderRightWidth: 1,
        borderRightColor: '#000',
    },
    amountValueCellLast: {
        width: '50%',
        padding: 8,
    },
    amountValueText: {
        fontSize: 14,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    amountValueTextSmall: {
        fontSize: 11,
        textAlign: 'center',
    },
    // ===== 明細テーブル =====
    detailsTable: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#000',
        marginTop: 15,
    },
    tableHeader: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#000',
        backgroundColor: '#f0f0f0',
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#ccc',
        minHeight: 22,
    },
    tableRowLast: {
        flexDirection: 'row',
        minHeight: 22,
    },
    // Columns
    cellCode: {
        width: 60,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
    },
    cellName: {
        flex: 1,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
    },
    cellQty: {
        width: 45,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellUnit: {
        width: 35,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellPrice: {
        width: 55,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellAmount: {
        width: 65,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    cellNotes: {
        width: 45,
        padding: 4,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellText: {
        fontSize: 8,
    },
    cellTextCenter: {
        fontSize: 8,
        textAlign: 'center',
    },
    // 合計セクション
    totalSection: {
        marginTop: 0,
    },
    totalRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minHeight: 22,
    },
    totalLabelCell: {
        flex: 1,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalAmountCell: {
        width: 65,
        padding: 4,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    totalNotesCell: {
        width: 45,
        padding: 4,
        justifyContent: 'center',
    },
    // Footer
    footer: {
        position: 'absolute',
        bottom: 20,
        left: 40,
        right: 40,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pageNumber: {
        fontSize: 9,
        textAlign: 'center',
        flex: 1,
    },
    registrationNumber: {
        fontSize: 8,
        textAlign: 'right',
    },
});

interface InvoicePDFProps {
    invoice: Invoice;
    project: Project;
    companyInfo: CompanyInfo;
    includeCoverPage?: boolean;
    bankAccounts?: Array<{ bankName: string; branchName: string; accountType: string; accountNumber: string }>;
    registrationNumber?: string;
}

// Main Invoice Page
function InvoicePage({
    invoice,
    project,
    companyInfo,
}: Omit<InvoicePDFProps, 'includeCoverPage' | 'bankAccounts' | 'registrationNumber'>) {
    const createdDate = new Date(invoice.createdAt);

    // 明細データ準備
    const items = invoice.items.filter(item => item.description);

    return (
        <Page size="A4" orientation="portrait" style={styles.page}>
            {/* ヘッダーセクション */}
            <View style={styles.headerSection}>
                {/* 左側：宛先（窓付き封筒用） */}
                <View style={styles.customerSection}>
                    <Text style={styles.postalCode}>〒</Text>
                    <Text style={styles.addressText}>{project.location || ''}</Text>
                    <Text style={styles.customerName}>{project.customer || ''} 御中</Text>

                    {/* 挨拶文 */}
                    <View style={styles.greetingSection}>
                        <Text style={styles.greetingText}>
                            拝啓　時下ますますご清栄のこととお喜び申し上げます。{'\n'}
                            平素は格別のご高配を賜り、厚く御礼申し上げます。{'\n'}
                            さて、下記の通りご請求申し上げますので、内容を{'\n'}
                            ご確認の上、右記口座までお振込み下さいますようお願い{'\n'}
                            申し上げます。
                        </Text>
                        <Text style={styles.greetingEnd}>敬具</Text>
                    </View>
                </View>

                {/* 右側：タイトル・会社情報 */}
                <View style={styles.rightSection}>
                    <View style={styles.titleSection}>
                        <Text style={styles.titleText}>請 求 書</Text>
                        <Text style={styles.dateText}>{toReiwa(createdDate)}</Text>
                    </View>

                    <View style={styles.companyInfo}>
                        <Text style={styles.companyName}>㈱{companyInfo.name.replace('株式会社', '').trim()}</Text>
                        <Text style={styles.companyText}>〒{companyInfo.postalCode}</Text>
                        <Text style={styles.companyText}>{companyInfo.address}</Text>
                        <Text style={styles.companyText}>TEL {companyInfo.tel} FAX {companyInfo.fax || ''}</Text>
                        {companyInfo.registrationNumber && (
                            <Text style={styles.companyText}>登録番号：{companyInfo.registrationNumber}</Text>
                        )}
                    </View>

                    {/* 振込先 */}
                    {companyInfo.bankAccounts && companyInfo.bankAccounts.length > 0 && (
                        <View style={styles.bankSection}>
                            <Text style={styles.bankLabel}>お振込先：</Text>
                            {companyInfo.bankAccounts.map((bank, idx) => (
                                <Text key={idx} style={styles.bankText}>
                                    {bank.bankName} {bank.branchName}（{bank.accountType}）{bank.accountNumber}
                                </Text>
                            ))}
                        </View>
                    )}
                </View>
            </View>

            {/* 件名・金額 */}
            <View style={styles.subjectSection}>
                <Text style={styles.subjectLabel}>件名：{project.title || invoice.title}</Text>
                <View style={styles.amountTable}>
                    <View style={styles.amountHeaderRow}>
                        <View style={styles.amountHeaderCell}>
                            <Text style={styles.amountHeaderText}>ご請求額</Text>
                        </View>
                        <View style={styles.amountHeaderCellLast}>
                            <Text style={styles.amountHeaderText}>消費税等</Text>
                        </View>
                    </View>
                    <View style={styles.amountValueRow}>
                        <View style={styles.amountValueCell}>
                            <Text style={styles.amountValueText}>¥{invoice.total.toLocaleString()}－</Text>
                        </View>
                        <View style={styles.amountValueCellLast}>
                            <Text style={styles.amountValueTextSmall}>¥{invoice.tax.toLocaleString()}－</Text>
                        </View>
                    </View>
                </View>
            </View>

            {/* 明細テーブル */}
            <View style={styles.detailsTable}>
                {/* ヘッダー */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellCode}><Text style={styles.cellTextCenter}>商品コード</Text></View>
                    <View style={styles.cellName}><Text style={styles.cellTextCenter}>品名</Text></View>
                    <View style={styles.cellQty}><Text style={styles.cellTextCenter}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.cellTextCenter}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.cellTextCenter}>単価</Text></View>
                    <View style={styles.cellAmount}><Text style={styles.cellTextCenter}>金額</Text></View>
                    <View style={styles.cellNotes}><Text style={styles.cellTextCenter}>備考</Text></View>
                </View>

                {/* 明細行 */}
                {items.map((item, idx) => (
                    <View key={idx} style={idx === items.length - 1 ? styles.tableRowLast : styles.tableRow}>
                        <View style={styles.cellCode}>
                            <Text style={styles.cellText}></Text>
                        </View>
                        <View style={styles.cellName}>
                            <Text style={styles.cellText}>{item.description}</Text>
                        </View>
                        <View style={styles.cellQty}>
                            <Text style={styles.cellText}>
                                {item.quantity > 0 ? item.quantity.toLocaleString() : ''}
                            </Text>
                        </View>
                        <View style={styles.cellUnit}>
                            <Text style={styles.cellText}>{item.unit || ''}</Text>
                        </View>
                        <View style={styles.cellPrice}>
                            <Text style={styles.cellText}>
                                {item.unitPrice > 0 ? item.unitPrice.toLocaleString() : ''}
                            </Text>
                        </View>
                        <View style={styles.cellAmount}>
                            <Text style={styles.cellText}>{item.amount.toLocaleString()}</Text>
                        </View>
                        <View style={styles.cellNotes}>
                            <Text style={styles.cellText}>{item.taxType === 'standard' ? '10%' : ''}</Text>
                        </View>
                    </View>
                ))}

                {/* 空行を追加して見栄えを整える */}
                {Array.from({ length: Math.max(0, 10 - items.length) }).map((_, idx) => (
                    <View key={`empty-${idx}`} style={styles.tableRow}>
                        <View style={styles.cellCode}><Text style={styles.cellText}></Text></View>
                        <View style={styles.cellName}><Text style={styles.cellText}></Text></View>
                        <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                        <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                        <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                        <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                        <View style={styles.cellNotes}><Text style={styles.cellText}></Text></View>
                    </View>
                ))}

                {/* 10%税抜計 */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.cellText}>10%税抜計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.cellText}>{invoice.subtotal.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>

                {/* 10%消費税 */}
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}>
                        <Text style={styles.cellText}>10%消費税</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <Text style={styles.cellText}>{invoice.tax.toLocaleString()}</Text>
                    </View>
                    <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                </View>
            </View>

            {/* 合計（テーブル外） */}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
                <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: '#000' }}>
                    <View style={{ padding: 5, borderRightWidth: 1, borderRightColor: '#000', width: 50 }}>
                        <Text style={{ fontSize: 9 }}>合計</Text>
                    </View>
                    <View style={{ padding: 5, width: 80, alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{invoice.total.toLocaleString()}</Text>
                    </View>
                </View>
            </View>

            {/* フッター */}
            <View style={styles.footer}>
                <Text style={styles.pageNumber}>－ 1 －</Text>
            </View>
        </Page>
    );
}

// Main Invoice PDF Document
export function InvoicePDF({
    invoice,
    project,
    companyInfo,
}: Omit<InvoicePDFProps, 'includeCoverPage' | 'bankAccounts' | 'registrationNumber'>) {
    return (
        <Document
            title={`請求書 ${invoice.invoiceNumber}`}
            author={companyInfo.name}
            subject={`${project.title}の請求書`}
            keywords="請求書, invoice"
            creator="YuSystem"
        >
            <InvoicePage
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
            />
        </Document>
    );
}

export default InvoicePDF;
