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
import { Invoice, InvoiceItem } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { toReiwa, sanitizePdfText, PDF_COLORS as COLORS } from './styles';
import { invoiceStyles as styles } from './invoice/invoiceStyles';

// 各列セルの内寸（cell width − 左右padding2 − 罫線0.5）。長い文字列はこの幅に1行で
// 収まるよう FitText がフォントを自動縮小する。備考は flex 列なので概算内寸。
const INV_FS = 9;            // テーブル基本フォント
const INV_UNIT_FS = 7;       // 単位セル（値）は基本より小さめに表示
const INV_W = {
    no: 14, name: 115, spec: 95, qty: 31, unit: 21, price: 46, amount: 56, remarks: 116,
    headerName: 216,         // 見出し行（名称セルを width220 に拡張）
} as const;
const INV_SUBJECT_FS = 8;    // 表紙・件名/支払期限などの値セル（infoValueCell）
const INV_SUBJECT_W = 197;

interface InvoicePDFProps {
    invoice: Invoice;
    project: Project;
    companyInfo: CompanyInfo;
    includeDetails?: boolean;
    includeCopy?: boolean;
    bankAccounts?: Array<{ bankName: string; branchName: string; accountType: string; accountNumber: string }>;
    registrationNumber?: string;
    projectMasters?: Array<{ id: string; title: string }>;
}

// Helper: get extra fields from project (cast)
function getExtra(project: Project): { customerPostalCode?: string; customerAddress?: string } {
    return project as unknown as { customerPostalCode?: string; customerAddress?: string };
}

type InvoiceDisplayRow =
    | { type: 'header'; title: string; groupTotal?: number }
    | { type: 'category'; item: InvoiceItem }
    | { type: 'item'; item: InvoiceItem; index: number; isChild?: boolean };

/**
 * 明細を案件グループごとに並べ、各グループの見出し行を差し込む。
 * 見出しは「明細に保存された sectionTitle（この請求書だけの上書き）」を最優先し、
 * 無ければ案件マスタ名にフォールバックする（＝従来挙動を維持）。
 * 案件なし（orphan）の明細でも sectionTitle があれば見出しを表示する。
 */
export function buildInvoiceDisplayRows(
    allItems: InvoiceItem[],
    projectMasters?: Array<{ id: string; title: string }>,
): InvoiceDisplayRow[] {
    const rows: InvoiceDisplayRow[] = [];
    let itemIndex = 0;
    const pmList = projectMasters ?? [];

    // カテゴリ（isCategory）かつ categoryType==='inline' のとき、見出し行＋子明細行に展開する。
    // detail カテゴリ／通常項目はそのまま1行（従来どおり）。子明細の金額は親カテゴリの amount に
    // 含まれており合計（invoice.subtotal）はカテゴリ amount で計上済みのため、ここで子を展開しても
    // 表示が増えるだけで二重加算は起きない（合計欄は invoice.subtotal/total を表示）。
    const pushItem = (item: InvoiceItem) => {
        const children = (item.children || []).filter(c => c.description);
        if (item.isCategory && item.categoryType === 'inline' && children.length > 0) {
            rows.push({ type: 'category', item });
            children.forEach(child => {
                itemIndex++;
                rows.push({ type: 'item', item: child, index: itemIndex, isChild: true });
            });
        } else {
            itemIndex++;
            rows.push({ type: 'item', item, index: itemIndex });
        }
    };

    // グループ（案件／見出し）合計：そのグループのトップレベル明細 amount の合算。
    // inlineカテゴリの amount は子明細を内包済みのため、トップレベルのみ合算し二重加算を避ける。
    const sumGroup = (groupItems: InvoiceItem[]) => groupItems.reduce((s, it) => s + (it.amount || 0), 0);

    for (const pm of pmList) {
        const pmItems = allItems.filter(item => item.projectMasterId === pm.id);
        if (pmItems.length === 0) continue;
        const override = pmItems.find(it => it.sectionTitle && it.sectionTitle.trim())?.sectionTitle?.trim();
        rows.push({ type: 'header', title: `【${override || pm.title}】`, groupTotal: sumGroup(pmItems) });
        pmItems.forEach(pushItem);
    }

    const orphanItems = allItems.filter(
        item => !item.projectMasterId || !pmList.find(pm => pm.id === item.projectMasterId),
    );
    // 案件なし（手入力）の明細は見出し(sectionTitle)ごとに別セクションへ分ける。
    // 連続する同一見出しを1ブロックにまとめ、見出し行（グループ合計付き）を差し込む。
    let oi = 0;
    while (oi < orphanItems.length) {
        const title = orphanItems[oi].sectionTitle?.trim() || '';
        const block: InvoiceItem[] = [];
        let oj = oi;
        while (oj < orphanItems.length && (orphanItems[oj].sectionTitle?.trim() || '') === title) {
            block.push(orphanItems[oj]);
            oj++;
        }
        if (title) rows.push({ type: 'header', title: `【${title}】`, groupTotal: sumGroup(block) });
        block.forEach(pushItem);
        oi = oj;
    }

    return rows;
}

// FitText（fitCellFontSize）は各セルを内寸に1行で収まるようフォントを自動縮小する（最小5pt）。
// よって通常はどのセルも1行で描画され、最小フォントまで縮めても収まらない極端な長文のときだけ
// 折り返して複数行になる。ページ分割の占有行数 rowSpan も、この実挙動に合わせて
// 「各セルが最小フォント(5pt)で何行に折り返すか」で見積もる。
// （旧実装は base フォント前提で折り返しを過大計上し、規格が長い明細＝実際は自動縮小で1行＝が
//  多い請求書を、わずかな超過で不要に2ページへ送っていた。）
const ROW_MIN_FS = 5;

// 文字の概算占有 units（全角=1.0 / 半角英数・半角ｶﾅ=0.6）。fitCellFontSize と同一換算。
function textUnits(s = ''): number {
    let u = 0;
    for (const ch of s) u += /[\x00-\xff｡-ﾟ]/.test(ch) ? 0.6 : 1;
    return u;
}

// セル内寸 contentWidth に対し、最小フォント(5pt)で何行に折り返すか＝実描画での占有行数。
function cellLineCount(text: string, contentWidth: number): number {
    const u = textUnits(text);
    if (u <= 0) return 1;
    const maxUnits = (contentWidth * 0.98) / ROW_MIN_FS; // 5ptで1行に収まる最大units（0.98=fitCellFontSizeと同じ安全マージン）
    return Math.max(1, Math.ceil(u / maxUnits));
}

function rowSpan(row: InvoiceDisplayRow): number {
    if (row.type === 'header') {
        return cellLineCount(row.title, INV_W.headerName);
    }
    const it = row.item;
    const indent = row.type === 'item' && row.isChild ? '　' : ''; // 子明細インデント(全角space)
    const nameLines = cellLineCount(indent + (it.description || ''), INV_W.name);
    const specLines = cellLineCount(it.specification || '', INV_W.spec);
    const noteLines = cellLineCount(it.notes || '', INV_W.remarks);
    return Math.max(1, nameLines, specLines, noteLines);
}

// 案件（見出し）行。複数案件を1枚に請求するとき、見出し行の金額列にその案件のグループ合計を表示する。
// showGroupTotals=false（案件1件以下）のときは従来どおり金額を出さない（＝単独案件では小計を出さない）。
function HeaderRow({ title, groupTotal, showGroupTotals }: { title: string; groupTotal?: number; showGroupTotals: boolean }) {
    const showTotal = showGroupTotals && groupTotal != null;
    const gt = groupTotal ?? 0;
    return (
        <View style={styles.projectHeaderRow}>
            <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
            <View style={{ ...styles.cellName, width: 220 }}>
                <FitText width={INV_W.headerName} base={INV_FS} style={{ fontWeight: 'bold' }}>{sanitizePdfText(title)}</FitText>
            </View>
            <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
            <View style={styles.cellAmount}>
                {showTotal
                    ? <FitText width={INV_W.amount} base={INV_FS} style={gt < 0 ? styles.groupTotalNeg : styles.groupTotalAmount}>{gt < 0 ? `(${Math.abs(gt).toLocaleString()})` : gt.toLocaleString()}</FitText>
                    : <Text style={styles.cellText}></Text>}
            </View>
            <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
        </View>
    );
}

// ===== Cover Page Component =====
function CoverPage({
    invoice,
    project,
    companyInfo,
    projectMasters,
    isCopy,
}: Omit<InvoicePDFProps, 'includeDetails' | 'includeCopy' | 'bankAccounts' | 'registrationNumber'> & { isCopy?: boolean }) {
    const createdDate = new Date(invoice.createdAt);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const extra = getExtra(project);

    // 明細データ準備
    const allItems = invoice.items.filter(item => item.description);
    // 見出しは sectionTitle（この請求書だけの上書き）を優先し、無ければ案件マスタ名にフォールバック
    const displayRows = buildInvoiceDisplayRows(allItems, projectMasters);
    // 複数案件（見出し2つ以上）を1枚に請求するときだけ、各案件の小計を見出し行に表示する。
    const showGroupTotals = displayRows.filter(r => r.type === 'header').length >= 2;

    // 1枚に収まらない場合のみページ分割（各ページは独立した完結テーブル）。
    // *_NO_TOTALS = そのページが続く場合に載る行数 / *_WITH_TOTALS = そのページが最終（小計・備考あり）に載る行数。
    // FIRST_* は表紙の大きなヘッダー（住所・御請求書・合計金額・件名・会社情報）ぶん容量が小さい。
    // CONT_* は続きページの小ヘッダー（「御請求書（続き）」1行）ぶん容量が大きい。
    //
    // 基準値は実測（`npx tsx scripts/measure-invoice-page-capacity.tsx`）で決めている。
    // 表紙は「振込先2件・備考なし」で 22 行がちょうど収まる上限（23 行にすると罫線が
    // 用紙下端を超えて空の2ページ目が出る）。旧値 21 は 1 行ぶん保守的で、案件11件＝22行の
    // 請求書が「下部を大きく空けたまま2ページ目送り」になっていた（2026-07-28 kei報告）。
    //
    // 上限ちょうどを使うため、ページ高さを動かす2要素は基準（振込先2件・備考2行まで）を
    // 超えたぶんだけ容量から差し引く。
    const bankAccountCount = (companyInfo.bankAccounts || []).length;
    const extraBankRows = Math.max(0, bankAccountCount - 2);  // 振込先1件 ≒ 9.5pt（1行17ptの約0.6）→ 安全側に1行として引く
    // 備考欄は全幅（内寸約527pt・9pt）。枠の minHeight 40 にラベル＋2行ぶんの高さがあるため、3行目以降が超過。
    const notesLines = (invoice.notes || '')
        .split('\n')
        .reduce((s, line) => s + Math.max(1, Math.ceil(textUnits(line) / (527 / INV_FS))), 0);
    const extraNotesRows = Math.max(0, notesLines - 2);
    const FIRST_NO_TOTALS = Math.max(16, 24 - extraBankRows);
    const FIRST_WITH_TOTALS = Math.max(14, 22 - extraBankRows - extraNotesRows);
    const CONT_NO_TOTALS = 38;
    const CONT_WITH_TOTALS = Math.max(20, 33 - extraNotesRows);
    // 各行の推定占有行数（折り返し考慮）。行数ではなくこの合計でページを分割する。
    // 案件（見出し header 〜 次の header 手前）を1セクションとして扱い、セクション単位でページに詰める
    // ＝1つの案件が見出しと明細でページ境界に割れないようにする。先頭に見出しの無い明細があれば
    // それも独立した1セクションになる。1セクションが1ページ容量を超える場合のみ単独ページで載せる。
    type Section = { rows: typeof displayRows; span: number };
    const sections: Section[] = [];
    {
        let cur: typeof displayRows = [];
        for (const row of displayRows) {
            if (row.type === 'header' && cur.length > 0) {
                sections.push({ rows: cur, span: cur.reduce((s, r) => s + rowSpan(r), 0) });
                cur = [];
            }
            cur.push(row);
        }
        if (cur.length > 0) sections.push({ rows: cur, span: cur.reduce((s, r) => s + rowSpan(r), 0) });
    }
    const sectionSpanFrom = (start: number) => {
        let s = 0;
        for (let k = start; k < sections.length; k++) s += sections[k].span;
        return s;
    };
    // budget を超えない範囲でセクションを詰める（最低1セクションは進める＝1案件が1ページ超でも単独ページに）
    const takeSectionsUntil = (start: number, budget: number) => {
        let acc = 0;
        let n = 0;
        while (start + n < sections.length && acc + sections[start + n].span <= budget) { acc += sections[start + n].span; n++; }
        if (n === 0) n = 1;
        return n;
    };
    const pageChunks: (typeof displayRows)[] = [];
    {
        let si = 0;
        while (si < sections.length) {
            const isFirstChunk = pageChunks.length === 0;
            const capNo = isFirstChunk ? FIRST_NO_TOTALS : CONT_NO_TOTALS;
            const capWith = isFirstChunk ? FIRST_WITH_TOTALS : CONT_WITH_TOTALS;
            const remaining = sectionSpanFrom(si);
            // 残り全セクションが「集計欄ありで1ページに収まる」なら最終ページ、そうでなければ集計欄なしで詰める
            const takeN = remaining <= capWith
                ? sections.length - si
                : takeSectionsUntil(si, remaining <= capNo ? capWith : capNo);
            pageChunks.push(sections.slice(si, si + takeN).flatMap(s => s.rows));
            si += takeN;
        }
        if (pageChunks.length === 0) pageChunks.push([]);
    }
    const totalPages = pageChunks.length;

    const renderRow = (row: (typeof displayRows)[number], i: number) => {
        if (row.type === 'header') {
            return <HeaderRow key={`header-${i}`} title={row.title} groupTotal={row.groupTotal} showGroupTotals={showGroupTotals} />;
        }
        if (row.type === 'category') {
            const cat = row.item;
            const catNegative = cat.amount < 0;
            return (
                <View key={`cat-${i}`} style={styles.tableRow}>
                    <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellName}>
                        <FitText width={INV_W.name} base={INV_FS} style={{ fontWeight: 'bold' }}>{sanitizePdfText(cat.description || '')}</FitText>
                    </View>
                    <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                    <View style={styles.cellAmount}>
                        <FitText width={INV_W.amount} base={INV_FS} style={catNegative ? { fontWeight: 'bold', color: COLORS.red } : { fontWeight: 'bold' }}>
                            {catNegative ? `(${Math.abs(cat.amount).toLocaleString()})` : cat.amount.toLocaleString()}
                        </FitText>
                    </View>
                    <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
                </View>
            );
        }
        const item = row.item;
        const isNegative = item.amount < 0;
        return (
            <View key={`item-${i}`} style={styles.tableRow}>
                <View style={styles.cellNo}><FitText width={INV_W.no} base={INV_FS} style={styles.cellTextCenter}>{row.index}</FitText></View>
                <View style={styles.cellName}>
                    <FitText width={INV_W.name} base={INV_FS} style={isNegative ? styles.cellTextRed : styles.cellText}>{`${row.isChild ? '　' : ''}${sanitizePdfText(item.description || '')}`}</FitText>
                </View>
                <View style={styles.cellSpec}>
                    <FitText width={INV_W.spec} base={INV_FS} style={styles.cellText}>{item.specification ? sanitizePdfText(item.specification) : ''}</FitText>
                </View>
                <View style={styles.cellQty}>
                    <FitText width={INV_W.qty} base={INV_FS} style={styles.cellText}>{item.quantity > 0 ? item.quantity.toLocaleString() : ''}</FitText>
                </View>
                <View style={styles.cellUnit}>
                    <FitText width={INV_W.unit} base={INV_UNIT_FS} style={styles.cellText}>{sanitizePdfText(item.unit || '')}</FitText>
                </View>
                <View style={styles.cellPrice}>
                    <FitText width={INV_W.price} base={INV_FS} style={styles.cellText}>{item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}</FitText>
                </View>
                <View style={styles.cellAmount}>
                    <FitText width={INV_W.amount} base={INV_FS} style={isNegative ? styles.cellTextRed : styles.cellText}>{isNegative ? `(${Math.abs(item.amount).toLocaleString()})` : item.amount.toLocaleString()}</FitText>
                </View>
                <View style={styles.cellRemarks}><FitText width={INV_W.remarks} base={INV_FS} style={styles.cellText}>{item.notes ? sanitizePdfText(item.notes) : ''}</FitText></View>
            </View>
        );
    };

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
        <>
            {pageChunks.map((chunk, pageIdx) => {
                const isFirst = pageIdx === 0;
                const isLast = pageIdx === totalPages - 1;
                const chunkSpan = chunk.reduce((s, row) => s + rowSpan(row), 0);
                const fillRows = isLast
                    ? Math.max(0, (isFirst ? FIRST_WITH_TOTALS : CONT_WITH_TOTALS) - chunkSpan)
                    : 0;
                return (
        <Page key={pageIdx} size="A4" orientation="portrait" style={styles.page}>

            {isFirst ? (
            <View>
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
                    {isCopy ? (
                        <Text style={{ ...styles.titleText, fontSize: 13, letterSpacing: 5 }}>御 請 求 書 （ 控 ）</Text>
                    ) : (
                        <Text style={styles.titleText}>御 請 求 書</Text>
                    )}
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
                        return <Text style={{ fontSize, fontWeight: 'bold', color: COLORS.navy, marginBottom: 55 }}>{customerFullName}</Text>;
                    })()}

                    <Text style={{ fontSize: 9, marginBottom: 10, marginLeft: -40 }}>下記の通りご請求申し上げます。</Text>

                    {/* 合計金額セクション */}
                    <View style={{ width: 260, marginBottom: 8, marginLeft: -40, borderWidth: 0.5, borderColor: COLORS.borderMedium }}>
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
                    <View style={{ width: 260, marginLeft: -40, borderWidth: 0.5, borderColor: COLORS.borderMedium }}>
                {[
                    { label: '件名', value: invoice.title || project.title },
                    { label: '支払期限', value: paymentTermText },
                    { label: '支払条件', value: '従来通り' },
                ].map((row, i, arr) => (
                    <View key={i} style={{ flexDirection: 'row', borderBottomWidth: i < arr.length - 1 ? 0.5 : 0, borderBottomColor: COLORS.borderLight, minHeight: 16 }}>
                        <View style={styles.infoLabelCell}>
                            <Text style={styles.infoLabelText}>{row.label}</Text>
                        </View>
                        <View style={styles.infoValueCell}>
                            <FitText width={INV_SUBJECT_W} base={INV_SUBJECT_FS} style={styles.infoValueText}>{row.value}</FitText>
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
            </View>
            ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 10 }}>
                <Text style={{ fontSize: 14, letterSpacing: 6, color: COLORS.navy, fontWeight: 'bold', paddingBottom: 2, borderBottomWidth: 1.5, borderBottomColor: COLORS.navy }}>
                    {isCopy ? '御 請 求 書（控・続き）' : '御 請 求 書（続き）'}
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.navy }}>{customerFullName}</Text>
                    <Text style={{ fontSize: 8, color: COLORS.textSecondary, marginTop: 2 }}>請求No. {invoice.invoiceNumber}</Text>
                </View>
            </View>
            )}

            {/* Details Table（用紙下端まで伸ばす） */}
            <View style={{ width: '100%', borderWidth: 1, borderColor: COLORS.borderDark, flexGrow: 1, flexDirection: 'column' }}>
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

                {chunk.map((row, i) => renderRow(row, i))}

                {/* 余白を用紙下端まで空行で埋める（最終/単一ページのみ。flex 伸縮・グリッド線維持） */}
                {fillRows > 0 && (
                    <View style={{ flexGrow: 1, flexDirection: 'column' }}>
                        {Array.from({ length: fillRows }).map((_, i) => (
                            <View key={`empty-${i}`} style={styles.tableEmptyRow}>
                                <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellName}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellAmount}><Text style={styles.cellText}></Text></View>
                                <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
                            </View>
                        ))}
                    </View>
                )}

                {/* Subtotal（最終ページのみ） */}
                {isLast && (
                <View style={styles.totalRow}>
                    <View style={styles.totalLabelCell}><Text style={styles.cellText}></Text></View>
                    <View style={styles.totalSubtotalLabel}>
                        <Text style={styles.totalLabelText}>小計</Text>
                    </View>
                    <View style={styles.totalAmountCell}>
                        <FitText width={INV_W.amount} base={INV_FS} style={styles.totalAmountText}>{`¥${invoice.subtotal.toLocaleString()}`}</FitText>
                    </View>
                    <View style={styles.totalRemarksCell}><Text style={styles.cellText}></Text></View>
                </View>
                )}
            </View>

            {/* 備考欄（最終ページのみ） */}
            {isLast && (
            <View style={{ marginTop: 6, borderWidth: 0.5, borderColor: COLORS.borderDark, minHeight: 40, padding: 4 }}>
                <Text style={{ fontSize: 8, color: COLORS.textSecondary, marginBottom: 3 }}>備考</Text>
                {invoice.notes && (
                    <Text style={{ fontSize: 9 }}>{sanitizePdfText(invoice.notes)}</Text>
                )}
            </View>
            )}

            {/* Footer */}
            <View style={styles.footer} fixed>
                <Text style={styles.footerText}></Text>
                <Text style={styles.footerText}>{totalPages > 1 ? `${pageIdx + 1} / ${totalPages}` : 'No. 1'}</Text>
            </View>
        </Page>
                );
            })}
        </>
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
    // 見出しは sectionTitle（この請求書だけの上書き）を優先し、無ければ案件マスタ名にフォールバック
    const displayRows = buildInvoiceDisplayRows(allItems, projectMasters);
    // 複数案件（見出し2つ以上）を1枚に請求するときだけ、各案件の小計を見出し行に表示する。
    const showGroupTotals = displayRows.filter(r => r.type === 'header').length >= 2;

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

            {/* Table（用紙下端まで伸ばす） */}
            <View style={{ width: '100%', borderWidth: 1, borderColor: COLORS.borderDark, flexGrow: 1, flexDirection: 'column' }}>
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
                            rows.push(<HeaderRow key={`header-${i}`} title={row.title} groupTotal={row.groupTotal} showGroupTotals={showGroupTotals} />);
                            continue;
                        }

                        if (row && row.type === 'category') {
                            const cat = row.item;
                            const catNeg = cat.amount < 0;
                            rows.push(
                                <View key={`cat-${i}`} style={styles.tableRow}>
                                    <View style={styles.cellNo}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellName}>
                                        <FitText width={INV_W.name} base={INV_FS} style={{ fontWeight: 'bold' }}>{sanitizePdfText(cat.description || '')}</FitText>
                                    </View>
                                    <View style={styles.cellSpec}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellQty}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellUnit}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellPrice}><Text style={styles.cellText}></Text></View>
                                    <View style={styles.cellAmount}>
                                        <FitText width={INV_W.amount} base={INV_FS} style={catNeg ? { fontWeight: 'bold', color: COLORS.red } : { fontWeight: 'bold' }}>
                                            {catNeg ? `(${Math.abs(cat.amount).toLocaleString()})` : cat.amount.toLocaleString()}
                                        </FitText>
                                    </View>
                                    <View style={styles.cellRemarks}><Text style={styles.cellText}></Text></View>
                                </View>
                            );
                            continue;
                        }

                        const item = row && row.type === 'item' ? row.item : null;
                        const idx = row && row.type === 'item' ? row.index : 0;
                        const isChild = row && row.type === 'item' ? row.isChild : false;
                        const isLast = i === maxRows - 1;
                        const isNegative = item ? item.amount < 0 : false;

                        rows.push(
                            <View key={i} style={!row ? styles.tableEmptyRow : (isLast ? styles.tableRowLast : styles.tableRow)}>
                                <View style={styles.cellNo}>
                                    <FitText width={INV_W.no} base={INV_FS} style={styles.cellTextCenter}>{item ? idx : ''}</FitText>
                                </View>
                                <View style={styles.cellName}>
                                    <FitText width={INV_W.name} base={INV_FS} style={isNegative ? styles.cellTextRed : styles.cellText}>{item ? `${isChild ? '　' : ''}${sanitizePdfText(item.description || '')}` : ''}</FitText>
                                </View>
                                <View style={styles.cellSpec}>
                                    <FitText width={INV_W.spec} base={INV_FS} style={styles.cellText}>{item?.specification ? sanitizePdfText(item.specification) : ''}</FitText>
                                </View>
                                <View style={styles.cellQty}>
                                    <FitText width={INV_W.qty} base={INV_FS} style={styles.cellText}>{item && item.quantity > 0 ? item.quantity.toLocaleString() : ''}</FitText>
                                </View>
                                <View style={styles.cellUnit}>
                                    <FitText width={INV_W.unit} base={INV_UNIT_FS} style={styles.cellText}>{item ? sanitizePdfText(item.unit || '') : ''}</FitText>
                                </View>
                                <View style={styles.cellPrice}>
                                    <FitText width={INV_W.price} base={INV_FS} style={styles.cellText}>{item && item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : ''}</FitText>
                                </View>
                                <View style={styles.cellAmount}>
                                    <FitText width={INV_W.amount} base={INV_FS} style={isNegative ? styles.cellTextRed : styles.cellText}>{item ? formatAmount(item.amount, isNegative) : ''}</FitText>
                                </View>
                                <View style={styles.cellRemarks}><FitText width={INV_W.remarks} base={INV_FS} style={styles.cellText}>{item?.notes ? sanitizePdfText(item.notes) : ''}</FitText></View>
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
                        <FitText width={INV_W.amount} base={8} style={styles.totalAmountText}>{invoice.subtotal.toLocaleString()}</FitText>
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
                        <FitText width={INV_W.amount} base={8} style={styles.totalAmountText}>{invoice.tax.toLocaleString()}</FitText>
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
                        <FitText width={INV_W.amount} base={9} style={styles.totalAmountText}>{invoice.total.toLocaleString()}</FitText>
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
    includeCopy = true,
    includeDetails = false,
}: Omit<InvoicePDFProps, 'bankAccounts' | 'registrationNumber'>) {
    return (
        <Document
            title={`請求書 ${invoice.invoiceNumber}`}
            author={companyInfo.name}
            subject={`${invoice.title || project.title}の請求書`}
            keywords="請求書, invoice"
            creator={process.env.NEXT_PUBLIC_APP_NAME || 'DandoLink'}
        >
            <CoverPage
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
                projectMasters={projectMasters}
            />
            {includeDetails && (
                <DetailsPage
                    invoice={invoice}
                    projectMasters={projectMasters}
                />
            )}
            {includeCopy && (
                <CoverPage
                    invoice={invoice}
                    project={project}
                    companyInfo={companyInfo}
                    projectMasters={projectMasters}
                    isCopy
                />
            )}
            {includeCopy && includeDetails && (
                <DetailsPage
                    invoice={invoice}
                    projectMasters={projectMasters}
                />
            )}
        </Document>
    );
}

export default InvoicePDF;
