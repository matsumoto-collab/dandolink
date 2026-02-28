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
import { Estimate, EstimateCategory } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { toReiwa } from './styles';

// ===== Styles =====
const styles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 10,
        paddingTop: 30,
        paddingBottom: 30,
        paddingHorizontal: 40,
        backgroundColor: '#ffffff',
    },
    // ===== Cover Page Header =====
    coverHeader: {
        position: 'relative',
        height: 50,
        marginBottom: 30,
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
    // ===== Customer Section =====
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
    // ===== Amount Section =====
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
        width: 80,
        textAlign: 'right',
        marginRight: 20,
    },
    amountDetailValue: {
        fontSize: 12,
        width: 120,
        textAlign: 'right',
    },
    // ===== Bottom Section =====
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
    // ===== Table (shared) =====
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
    categoryTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        marginBottom: 6,
        marginTop: 4,
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
        backgroundColor: '#f5f5f5',
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
    // Column definitions: No, 名称, 規格, 数量, 単位, 単価, 金額, 備考
    cellNo: {
        width: 25,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cellName: {
        width: 180,
        padding: 3,
        borderRightWidth: 0.5,
        borderRightColor: '#000',
        justifyContent: 'center',
    },
    cellSpec: {
        width: 100,
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
        width: 60,
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
    cellTextBold: {
        fontSize: 9,
        fontWeight: 'bold',
    },
    cellTextRed: {
        fontSize: 9,
        color: '#ff0000',
    },
    // Total rows
    totalRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minHeight: 20,
    },
    totalLabelCell: {
        width: 450,
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
    // Pattern A: cover page inline table (smaller)
    coverTable: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#000',
        marginTop: 15,
    },
    // Pattern B: cover category summary row
    categorySummaryRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#000',
        minHeight: 22,
    },
});

// ===== Helper =====
function formatAmount(amount: number | null, isNegative: boolean, isEmpty: boolean): string {
    if (isEmpty || amount === null) return '';
    if (isNegative) return `(${Math.abs(amount).toLocaleString()})`;
    return amount.toLocaleString();
}

// ===== Table Header (shared) =====
function TableHeader() {
    return (
        <View style={styles.tableHeader}>
            <View style={styles.cellNo}><Text style={styles.cellTextCenter}>No</Text></View>
            <View style={styles.cellName}><Text style={styles.cellTextCenter}>名称</Text></View>
            <View style={styles.cellSpec}><Text style={styles.cellTextCenter}>規格</Text></View>
            <View style={styles.cellQty}><Text style={styles.cellTextCenter}>数量</Text></View>
            <View style={styles.cellUnit}><Text style={styles.cellTextCenter}>単位</Text></View>
            <View style={styles.cellPrice}><Text style={styles.cellTextCenter}>単価</Text></View>
            <View style={styles.cellAmount}><Text style={styles.cellTextCenter}>金額</Text></View>
            <View style={styles.cellNotes}><Text style={styles.cellTextCenter}>備考</Text></View>
        </View>
    );
}

// ===== Item Row (shared) =====
function ItemRow({ item, index, isLast }: { item: Estimate['items'][0]; index: number; isLast: boolean }) {
    const isNegative = item.amount < 0;
    return (
        <View style={isLast ? styles.tableRowLast : styles.tableRow}>
            <View style={styles.cellNo}>
                <Text style={styles.cellText}>{index + 1}</Text>
            </View>
            <View style={styles.cellName}>
                <Text style={isNegative ? styles.cellTextRed : styles.cellText}>
                    {item.description || ''}
                </Text>
            </View>
            <View style={styles.cellSpec}>
                <Text style={styles.cellText}>{item.specification || ''}</Text>
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
                    {item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}
                </Text>
            </View>
            <View style={styles.cellAmount}>
                <Text style={isNegative ? styles.cellTextRed : styles.cellText}>
                    {formatAmount(item.amount, isNegative, false)}
                </Text>
            </View>
            <View style={styles.cellNotes}>
                <Text style={styles.cellText}>{item.notes || ''}</Text>
            </View>
        </View>
    );
}

// ===== Empty Row (for padding) =====
function EmptyRow({ index, isLast }: { index: number; isLast: boolean }) {
    return (
        <View style={isLast ? styles.tableRowLast : styles.tableRow}>
            <View style={styles.cellNo}><Text style={styles.cellText}>{index + 1}</Text></View>
            <View style={styles.cellName}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellNotes}><Text style={styles.cellText}></Text></View>
        </View>
    );
}

// ===== Total Rows (shared) =====
function TotalRows({ subtotal, tax, total }: { subtotal: number; tax: number; total: number }) {
    return (
        <>
            <View style={styles.totalRow}>
                <View style={styles.totalLabelCell}>
                    <Text style={styles.cellText}>小計</Text>
                </View>
                <View style={styles.totalAmountCell}>
                    <Text style={styles.cellText}>{subtotal.toLocaleString()}</Text>
                </View>
                <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
            </View>
            <View style={styles.totalRow}>
                <View style={styles.totalLabelCell}>
                    <Text style={styles.cellText}>消費税（10%）</Text>
                </View>
                <View style={styles.totalAmountCell}>
                    <Text style={styles.cellText}>{tax.toLocaleString()}</Text>
                </View>
                <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
            </View>
            <View style={styles.totalRow}>
                <View style={styles.totalLabelCell}>
                    <Text style={styles.cellTextBold}>合計</Text>
                </View>
                <View style={styles.totalAmountCell}>
                    <Text style={styles.cellTextBold}>{total.toLocaleString()}</Text>
                </View>
                <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
            </View>
        </>
    );
}

// ===== Cover Page Header Info (shared between Pattern A & B) =====
function CoverHeaderInfo({ estimate, project, companyInfo }: { estimate: Estimate; project: Project; companyInfo: CompanyInfo }) {
    const createdDate = new Date(estimate.createdAt);
    const validUntilDate = new Date(estimate.validUntil);
    const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    return (
        <>
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

            {/* Customer Name */}
            <View style={styles.customerSection}>
                <View style={styles.customerNameContainer}>
                    <Text style={styles.customerName}>{project.customer || ''} {project.customerHonorific || '御中'}</Text>
                    <View style={styles.customerUnderline} />
                    <Text style={styles.descriptionText}>下記のとおり御見積申し上げます。</Text>
                </View>
            </View>

            {/* Amount */}
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
                            <Text style={styles.amountDetailLabel}>消費税（10%）</Text>
                            <Text style={styles.amountDetailValue}>¥{estimate.tax.toLocaleString()} −</Text>
                        </View>
                    </View>
                </View>
            </View>

            {/* Bottom: Info + Company */}
            <View style={styles.bottomSection}>
                <View style={styles.infoSection}>
                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>件名：</Text>
                        <Text style={styles.infoValue}>{estimate.title || project.title || ''}</Text>
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
        </>
    );
}

// =============================================================================
// パターンA: 1枚完結（小規模工事向け）
// 表紙に明細テーブルを直接表示
// =============================================================================
function PatternACoverPage({ estimate, project, companyInfo }: { estimate: Estimate; project: Project; companyInfo: CompanyInfo }) {
    const maxRows = 15; // 表紙に収まる行数
    const allItems = estimate.items;

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>
            <CoverHeaderInfo estimate={estimate} project={project} companyInfo={companyInfo} />

            {/* Inline items table */}
            <View style={styles.coverTable}>
                <TableHeader />
                {allItems.map((item, idx) => (
                    <ItemRow key={item.id || idx} item={item} index={idx} isLast={idx === maxRows - 1 && idx === allItems.length - 1} />
                ))}
                {/* Fill empty rows */}
                {Array.from({ length: Math.max(0, maxRows - allItems.length) }).map((_, i) => {
                    const idx = allItems.length + i;
                    return <EmptyRow key={`empty-${idx}`} index={idx} isLast={idx === maxRows - 1} />;
                })}
                <TotalRows subtotal={estimate.subtotal} tax={estimate.tax} total={estimate.total} />
            </View>
        </Page>
    );
}

// =============================================================================
// パターンB: 表紙（大項目サマリー）+ 内訳明細書（複数ページ）
// =============================================================================

// パターンB表紙: 大項目の合計金額一覧
function PatternBCoverPage({ estimate, project, companyInfo, categories }: { estimate: Estimate; project: Project; companyInfo: CompanyInfo; categories: EstimateCategory[] }) {
    const maxRows = 15;

    return (
        <Page size="A4" orientation="landscape" style={styles.page}>
            <CoverHeaderInfo estimate={estimate} project={project} companyInfo={companyInfo} />

            {/* Category summary table */}
            <View style={styles.coverTable}>
                {/* Header: No, 名称, 金額, 備考 (simplified for summary) */}
                <View style={styles.tableHeader}>
                    <View style={styles.cellNo}><Text style={styles.cellTextCenter}>No</Text></View>
                    <View style={{ ...styles.cellName, width: 280 }}><Text style={styles.cellTextCenter}>名称</Text></View>
                    <View style={styles.cellSpec}><Text style={styles.cellTextCenter}></Text></View>
                    <View style={styles.cellQty}><Text style={styles.cellTextCenter}>数量</Text></View>
                    <View style={styles.cellUnit}><Text style={styles.cellTextCenter}>単位</Text></View>
                    <View style={styles.cellPrice}><Text style={styles.cellTextCenter}></Text></View>
                    <View style={styles.cellAmount}><Text style={styles.cellTextCenter}>金額</Text></View>
                    <View style={styles.cellNotes}><Text style={styles.cellTextCenter}>備考</Text></View>
                </View>

                {/* Category rows */}
                {categories.map((cat, idx) => (
                    <View key={cat.id || idx} style={idx === categories.length - 1 && categories.length >= maxRows ? styles.tableRowLast : styles.tableRow}>
                        <View style={styles.cellNo}>
                            <Text style={styles.cellText}>{idx + 1}</Text>
                        </View>
                        <View style={{ ...styles.cellName, width: 280 }}>
                            <Text style={styles.cellTextBold}>{cat.categoryName}</Text>
                        </View>
                        <View style={styles.cellSpec}>
                            <Text style={styles.cellText}></Text>
                        </View>
                        <View style={styles.cellQty}>
                            <Text style={styles.cellText}>1</Text>
                        </View>
                        <View style={styles.cellUnit}>
                            <Text style={styles.cellText}>式</Text>
                        </View>
                        <View style={styles.cellPrice}>
                            <Text style={styles.cellText}></Text>
                        </View>
                        <View style={styles.cellAmount}>
                            <Text style={styles.cellTextBold}>{cat.categoryTotal.toLocaleString()}</Text>
                        </View>
                        <View style={styles.cellNotes}>
                            <Text style={styles.cellText}></Text>
                        </View>
                    </View>
                ))}

                {/* Fill empty rows */}
                {Array.from({ length: Math.max(0, maxRows - categories.length) }).map((_, i) => {
                    const idx = categories.length + i;
                    return (
                        <View key={`empty-${idx}`} style={idx === maxRows - 1 ? styles.tableRowLast : styles.tableRow}>
                            <View style={styles.cellNo}><Text style={styles.cellText}>{idx + 1}</Text></View>
                            <View style={{ ...styles.cellName, width: 280 }}><Text style={styles.cellText}></Text></View>
                            <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                            <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                            <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                            <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                            <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                            <View style={styles.cellNotes}><Text style={styles.cellText}></Text></View>
                        </View>
                    );
                })}

                <TotalRows subtotal={estimate.subtotal} tax={estimate.tax} total={estimate.total} />
            </View>
        </Page>
    );
}

// パターンB内訳明細書: 大項目ごとの詳細ページ
function DetailBreakdownPage({ category, categoryIndex }: { category: EstimateCategory; categoryIndex: number }) {
    const maxRowsPerPage = 25;
    const items = category.items;

    // Split items into pages if needed
    const pages: EstimateCategory['items'][] = [];
    for (let i = 0; i < items.length; i += maxRowsPerPage) {
        pages.push(items.slice(i, i + maxRowsPerPage));
    }
    if (pages.length === 0) pages.push([]);

    return (
        <>
            {pages.map((pageItems, pageIdx) => (
                <Page key={`cat-${categoryIndex}-page-${pageIdx}`} size="A4" orientation="landscape" style={styles.detailsPage}>
                    {/* Title */}
                    <Text style={styles.detailsTitle}>内 訳 明 細 書</Text>
                    <View style={styles.detailsTitleUnderline} />

                    {/* Category name */}
                    <Text style={styles.categoryTitle}>
                        {categoryIndex + 1}. {category.categoryName}
                        {pages.length > 1 ? `（${pageIdx + 1}/${pages.length}）` : ''}
                    </Text>

                    {/* Table */}
                    <View style={styles.table}>
                        <TableHeader />

                        {pageItems.map((item, idx) => {
                            const globalIdx = pageIdx * maxRowsPerPage + idx;
                            return (
                                <ItemRow
                                    key={item.id || globalIdx}
                                    item={item}
                                    index={globalIdx}
                                    isLast={idx === pageItems.length - 1 && pageIdx === pages.length - 1}
                                />
                            );
                        })}

                        {/* Fill empty rows on last page */}
                        {pageIdx === pages.length - 1 && pageItems.length < maxRowsPerPage &&
                            Array.from({ length: maxRowsPerPage - pageItems.length }).map((_, i) => {
                                const idx = pageItems.length + i;
                                return <EmptyRow key={`empty-${idx}`} index={pageItems.length + pageIdx * maxRowsPerPage + i} isLast={idx === maxRowsPerPage - 1} />;
                            })
                        }

                        {/* Category subtotal on last page */}
                        {pageIdx === pages.length - 1 && (
                            <View style={styles.totalRow}>
                                <View style={styles.totalLabelCell}>
                                    <Text style={styles.cellTextBold}>{category.categoryName} 計</Text>
                                </View>
                                <View style={styles.totalAmountCell}>
                                    <Text style={styles.cellTextBold}>{category.categoryTotal.toLocaleString()}</Text>
                                </View>
                                <View style={styles.totalNotesCell}><Text style={styles.cellText}></Text></View>
                            </View>
                        )}
                    </View>
                </Page>
            ))}
        </>
    );
}

// =============================================================================
// パターンA用: 明細が表紙に収まらない場合の追加ページ（フォールバック）
// =============================================================================
function PatternADetailsPage({ estimate }: { estimate: Estimate }) {
    const maxRows = 25;
    const items = estimate.items;

    const pages: Estimate['items'][] = [];
    for (let i = 0; i < items.length; i += maxRows) {
        pages.push(items.slice(i, i + maxRows));
    }

    return (
        <>
            {pages.map((pageItems, pageIdx) => (
                <Page key={`details-${pageIdx}`} size="A4" orientation="landscape" style={styles.detailsPage}>
                    <Text style={styles.detailsTitle}>内 訳 書</Text>
                    <View style={styles.detailsTitleUnderline} />

                    <View style={styles.table}>
                        <TableHeader />
                        {pageItems.map((item, idx) => {
                            const globalIdx = pageIdx * maxRows + idx;
                            return (
                                <ItemRow
                                    key={item.id || globalIdx}
                                    item={item}
                                    index={globalIdx}
                                    isLast={idx === pageItems.length - 1 && pageIdx === pages.length - 1}
                                />
                            );
                        })}

                        {/* Fill empty rows on last page */}
                        {pageIdx === pages.length - 1 && pageItems.length < maxRows &&
                            Array.from({ length: maxRows - pageItems.length }).map((_, i) => {
                                const idx = pageItems.length + i;
                                return <EmptyRow key={`empty-${idx}`} index={pageItems.length + pageIdx * maxRows + i} isLast={idx === maxRows - 1} />;
                            })
                        }

                        {/* Total rows on last page only */}
                        {pageIdx === pages.length - 1 && (
                            <TotalRows subtotal={estimate.subtotal} tax={estimate.tax} total={estimate.total} />
                        )}
                    </View>
                </Page>
            ))}
        </>
    );
}

// =============================================================================
// Main Component
// =============================================================================
interface EstimatePDFProps {
    estimate: Estimate;
    project: Project;
    companyInfo: CompanyInfo;
    includeCoverPage?: boolean;
}

const MAX_INLINE_ITEMS = 15; // 表紙に直接表示可能な最大行数

export function EstimatePDF({ estimate, project, companyInfo, includeCoverPage = true }: EstimatePDFProps) {
    const isComplex = estimate.isComplex ?? false;
    const categories = estimate.categories ?? [];

    // パターンB: 大項目カテゴリがある場合
    if (isComplex && categories.length > 0) {
        return (
            <Document
                title={`見積書 ${estimate.estimateNumber}`}
                author={companyInfo.name}
                subject={`${project.title}の見積書`}
                keywords="見積書, estimate"
                creator="DandoLink"
            >
                {includeCoverPage && (
                    <PatternBCoverPage
                        estimate={estimate}
                        project={project}
                        companyInfo={companyInfo}
                        categories={categories}
                    />
                )}
                {categories.map((cat, idx) => (
                    <DetailBreakdownPage key={cat.id || idx} category={cat} categoryIndex={idx} />
                ))}
            </Document>
        );
    }

    // パターンA: 1枚完結（明細が少ない場合は表紙に直接表示）
    const fitsOnCover = estimate.items.length <= MAX_INLINE_ITEMS;

    return (
        <Document
            title={`見積書 ${estimate.estimateNumber}`}
            author={companyInfo.name}
            subject={`${project.title}の見積書`}
            keywords="見積書, estimate"
            creator="DandoLink"
        >
            {includeCoverPage && fitsOnCover && (
                <PatternACoverPage estimate={estimate} project={project} companyInfo={companyInfo} />
            )}
            {includeCoverPage && !fitsOnCover && (
                <>
                    {/* 明細が多い場合は従来通り表紙+明細ページ */}
                    <Page size="A4" orientation="landscape" style={styles.page}>
                        <CoverHeaderInfo estimate={estimate} project={project} companyInfo={companyInfo} />
                    </Page>
                </>
            )}
            {!fitsOnCover && (
                <PatternADetailsPage estimate={estimate} />
            )}
            {!includeCoverPage && (
                <PatternADetailsPage estimate={estimate} />
            )}
        </Document>
    );
}

export default EstimatePDF;
