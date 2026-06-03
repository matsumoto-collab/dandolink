'use client';

import React from 'react';
import {
    Document,
    Page,
    View,
    Image,
} from '@react-pdf/renderer';
import { Text } from './SafeText';
import { FitText } from './FitText';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { toReiwa, sanitizePdfText, PDF_COLORS as COLORS } from './styles';
import { estimateStyles as styles } from './estimate/estimateStyles';

// 各列セルの内寸（cell width − 左右padding3 − 罫線0.5）。長い文字列はこの幅に1行で
// 収まるよう FitText がフォントを自動縮小する。備考は flex 列なので概算内寸。
const EST_FS = 8.5;          // テーブル基本フォント
const EST_W = {
    no: 14, name: 173, spec: 173, qty: 44, unit: 29, price: 59, amount: 74, remarks: 164,
} as const;
const EST_SUBJECT_FS = 8.5;  // 表紙・件名/住所などの値セル（infoValueCell）
const EST_SUBJECT_W = 408;

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
                            <FitText width={EST_SUBJECT_W} base={EST_SUBJECT_FS} style={styles.infoValueText}>{project.title || estimate.title}</FitText>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>現場住所</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <FitText width={EST_SUBJECT_W} base={EST_SUBJECT_FS} style={styles.infoValueText}>{sanitizePdfText(estimate.location || project.location || '')}</FitText>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>有効期限</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <FitText width={EST_SUBJECT_W} base={EST_SUBJECT_FS} style={styles.infoValueText}>{`発行日より${monthsDiff}ヶ月`}</FitText>
                        </View>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>工期</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <FitText width={EST_SUBJECT_W} base={EST_SUBJECT_FS} style={styles.infoValueText}>{estimate.constructionPeriod ? sanitizePdfText(estimate.constructionPeriod) : ''}</FitText>
                        </View>
                    </View>
                    <View style={styles.infoRowLast}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>支払条件</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <FitText width={EST_SUBJECT_W} base={EST_SUBJECT_FS} style={styles.infoValueText}>従来通り</FitText>
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
                                    <FitText width={EST_W.no} base={EST_FS} style={styles.cellTextCenter}>{item ? i + 1 : ''}</FitText>
                                </View>
                                <View style={styles.cellName}>
                                    <FitText width={EST_W.name} base={EST_FS} style={isNegative ? styles.cellTextRed : (isCat ? { fontWeight: 'bold' } : styles.cellText)}>{item ? sanitizePdfText(item.description || '') : ''}</FitText>
                                </View>
                                <View style={styles.cellSpec}>
                                    <FitText width={EST_W.spec} base={EST_FS} style={styles.cellText}>{(!isCat && item?.specification) ? sanitizePdfText(item.specification) : ''}</FitText>
                                </View>
                                <View style={styles.cellQty}>
                                    <FitText width={EST_W.qty} base={EST_FS} style={styles.cellText}>{item && item.quantity > 0 ? item.quantity.toLocaleString() : ''}</FitText>
                                </View>
                                <View style={styles.cellUnit}>
                                    <FitText width={EST_W.unit} base={EST_FS} style={styles.cellText}>{item ? sanitizePdfText(item.unit || '') : ''}</FitText>
                                </View>
                                <View style={styles.cellPrice}>
                                    <FitText width={EST_W.price} base={EST_FS} style={styles.cellText}>{!isCat && item && item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}</FitText>
                                </View>
                                <View style={styles.cellAmount}>
                                    <FitText width={EST_W.amount} base={EST_FS} style={isNegative ? styles.cellTextRed : (isCat ? [styles.cellText, { fontWeight: 'bold' }] : styles.cellText)}>{item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}</FitText>
                                </View>
                                <View style={styles.cellRemarks}><FitText width={EST_W.remarks} base={EST_FS} style={styles.cellText}>{item?.notes ? sanitizePdfText(item.notes) : ''}</FitText></View>
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
                                <FitText width={EST_W.amount} base={9} style={styles.totalAmountText}>{`¥${pageSubtotal.toLocaleString()}`}</FitText>
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
                            <FitText width={EST_W.amount} base={9} style={styles.totalAmountText}>{`¥${cumulativeSubtotal.toLocaleString()}`}</FitText>
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
                <FitText width={EST_W.no} base={EST_FS} style={styles.cellTextCenter}>{item ? idx + 1 : ''}</FitText>
            </View>
            <View style={styles.cellName}>
                <FitText width={EST_W.name} base={EST_FS} style={isNegative ? styles.cellTextRed : (isCat ? { fontWeight: 'bold' } : styles.cellText)}>{item ? sanitizePdfText(item.description || '') : ''}</FitText>
            </View>
            <View style={styles.cellSpec}>
                <FitText width={EST_W.spec} base={EST_FS} style={styles.cellText}>{(!isCat && item?.specification) ? sanitizePdfText(item.specification) : ''}</FitText>
            </View>
            <View style={styles.cellQty}>
                <FitText width={EST_W.qty} base={EST_FS} style={styles.cellText}>{item && item.quantity > 0 ? item.quantity.toLocaleString() : ''}</FitText>
            </View>
            <View style={styles.cellUnit}>
                <FitText width={EST_W.unit} base={EST_FS} style={styles.cellText}>{item ? sanitizePdfText(item.unit || '') : ''}</FitText>
            </View>
            <View style={styles.cellPrice}>
                <FitText width={EST_W.price} base={EST_FS} style={styles.cellText}>{!isCat && item && item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}</FitText>
            </View>
            <View style={styles.cellAmount}>
                <FitText width={EST_W.amount} base={EST_FS} style={isNegative ? styles.cellTextRed : (isCat ? [styles.cellText, { fontWeight: 'bold' }] : styles.cellText)}>{item ? (isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()) : ''}</FitText>
            </View>
            <View style={styles.cellRemarks}><FitText width={EST_W.remarks} base={EST_FS} style={styles.cellText}>{item?.notes ? sanitizePdfText(item.notes) : ''}</FitText></View>
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
                        <FitText width={EST_W.name} base={EST_FS} style={{ fontWeight: 'bold' }}>{sanitizePdfText(category.description)}</FitText>
                    </View>
                    <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellQty}><FitText width={EST_W.qty} base={EST_FS} style={styles.cellText}>{category.quantity && category.quantity > 0 ? category.quantity.toLocaleString() : ''}</FitText></View>
                    <View style={styles.cellUnit}><FitText width={EST_W.unit} base={EST_FS} style={styles.cellText}>{sanitizePdfText(category.unit || '')}</FitText></View>
                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellAmount}><FitText width={EST_W.amount} base={EST_FS} style={styles.cellText}>{category.amount > 0 ? category.amount.toLocaleString() : ''}</FitText></View>
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
                        <FitText width={EST_W.amount} base={9} style={styles.totalAmountText}>{`¥${category.amount.toLocaleString()}`}</FitText>
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
                                    <FitText width={EST_W.amount} base={9} style={styles.totalAmountText}>{estimate.subtotal.toLocaleString()}</FitText>
                                </View>
                                <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                            </View>
                            <View style={styles.totalRow}>
                                <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                                <View style={styles.totalSubtotalLabel}>
                                    <Text style={styles.totalLabelText}>消費税</Text>
                                </View>
                                <View style={styles.totalAmountCell}>
                                    <FitText width={EST_W.amount} base={9} style={styles.totalAmountText}>{estimate.tax.toLocaleString()}</FitText>
                                </View>
                                <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                            </View>
                            <View style={styles.totalRow}>
                                <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                                <View style={styles.totalSubtotalLabel}>
                                    <Text style={{ ...styles.totalLabelText, fontSize: 9 }}>合計</Text>
                                </View>
                                <View style={styles.totalAmountCell}>
                                    <FitText width={EST_W.amount} base={9} style={styles.totalAmountText}>{estimate.total.toLocaleString()}</FitText>
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
            creator={process.env.NEXT_PUBLIC_APP_NAME || 'DandoLink'}
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
