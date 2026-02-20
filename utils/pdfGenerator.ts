'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { NotoSansJPFont } from './fonts/NotoSansJP-font';

// PDF生成オプション
interface PDFOptions {
    includeCoverPage: boolean;
}

// 西暦を令和に変換
function toReiwa(date: Date): string {
    const year = date.getFullYear();
    const reiwaYear = year - 2018; // 令和は2019年から
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `令和${reiwaYear}年${month}月${day}日`;
}

/**
 * 見積書PDF（2ページ構成）を生成して出力
 */
export function exportEstimatePDF(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: PDFOptions = { includeCoverPage: true }
): void {
    try {
        // PDFドキュメントを作成（A4横向き）
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4',
        });

        // 日本語フォントを追加
        doc.addFileToVFS('NotoSansJP-Regular.ttf', NotoSansJPFont);
        doc.addFont('NotoSansJP-Regular.ttf', 'NotoSansJP', 'normal');
        doc.setFont('NotoSansJP');

        // PDFメタデータを設定
        doc.setProperties({
            title: `見積書 ${estimate.estimateNumber}`,
            subject: `${project.title}の見積書`,
            author: companyInfo.name,
            keywords: '見積書, estimate',
            creator: 'DandoLink'
        });

        // 表紙を生成（オプション）
        if (options.includeCoverPage) {
            generateCoverPage(doc, estimate, project, companyInfo);
            doc.addPage();
        }

        // 内訳書を生成
        generateDetailsPage(doc, estimate);

        // PDFをダウンロード
        const fileName = `見積書_${estimate.estimateNumber}_${new Date().getTime()}.pdf`;
        doc.save(fileName);
    } catch (error) {
        alert('PDFの生成に失敗しました。エラー: ' + (error as Error).message);
    }
}

/**
 * 見積書PDFをBlob URLとして生成（プレビュー用）
 */
export function generateEstimatePDFBlob(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: PDFOptions = { includeCoverPage: true }
): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const doc = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4',
            });

            // 日本語フォントを追加
            doc.addFileToVFS('NotoSansJP-Regular.ttf', NotoSansJPFont);
            doc.addFont('NotoSansJP-Regular.ttf', 'NotoSansJP', 'normal');
            doc.setFont('NotoSansJP');

            doc.setProperties({
                title: `見積書 ${estimate.estimateNumber}`,
                subject: `${project.title}の見積書`,
                author: companyInfo.name,
            });

            if (options.includeCoverPage) {
                generateCoverPage(doc, estimate, project, companyInfo);
                doc.addPage();
            }

            generateDetailsPage(doc, estimate);

            const pdfBlob = doc.output('blob');
            const url = URL.createObjectURL(pdfBlob);
            resolve(url);
        } catch (error) {
            console.error('PDF生成エラー:', error);
            reject(error);
        }
    });
}

/**
 * 表紙（1ページ目）を生成
 */
function generateCoverPage(
    doc: jsPDF,
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo
): void {
    const pageWidth = 297; // A4横向きの幅
    const margin = 15;

    // ========== 左上: 現場名 ==========
    doc.setFontSize(11);
    doc.text('現場名', margin, margin + 5);

    doc.setFontSize(12);
    const siteNameWithSuffix = `${project.title || estimate.title} 様`;
    doc.text(siteNameWithSuffix, margin + 25, margin + 5);

    // 下線
    doc.setLineWidth(0.3);
    doc.line(margin + 25, margin + 7, margin + 100, margin + 7);

    // ========== 中央上部: タイトル「御見積書」==========
    const titleBoxWidth = 100;
    const titleBoxHeight = 18;
    const titleBoxX = (pageWidth - titleBoxWidth) / 2;
    const titleBoxY = margin;

    // 枠線
    doc.setLineWidth(0.5);
    doc.rect(titleBoxX, titleBoxY, titleBoxWidth, titleBoxHeight);

    // タイトルテキスト
    doc.setFontSize(22);
    const titleText = '御 見 積 書';
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, titleBoxX + (titleBoxWidth - titleWidth) / 2, titleBoxY + 13);

    // ========== 右上: 日付 ==========
    doc.setFontSize(11);
    const dateStr = toReiwa(new Date(estimate.createdAt));
    const dateWidth = doc.getTextWidth(dateStr);
    doc.text(dateStr, pageWidth - margin - dateWidth, margin + 10);

    // ========== 中央: 宛先 ==========
    let y = 55;
    doc.setFontSize(18);
    const customerName = project.customer || '御中';
    const customerText = `${customerName} 様`;
    const customerWidth = doc.getTextWidth(customerText);
    doc.text(customerText, (pageWidth - customerWidth) / 2, y);

    // 下線
    doc.setLineWidth(0.5);
    const underlineWidth = customerWidth + 20;
    doc.line((pageWidth - underlineWidth) / 2, y + 3, (pageWidth + underlineWidth) / 2, y + 3);

    // 「下記のとおり御見積申し上げます。」
    y += 15;
    doc.setFontSize(10);
    const subText = '下記のとおり御見積申し上げます。';
    const subTextWidth = doc.getTextWidth(subText);
    doc.text(subText, (pageWidth - subTextWidth) / 2, y);

    // ========== 中央: 御見積金額ボックス ==========
    y += 15;
    const amountBoxX = pageWidth / 2 - 80;
    // 御見積金額ラベル
    doc.setFontSize(14);
    doc.rect(amountBoxX, y, 80, 12);
    doc.text('御見積金額', amountBoxX + 15, y + 9);

    // 金額（税込）
    doc.setFontSize(20);
    const totalStr = `¥${estimate.total.toLocaleString()} -`;
    doc.text(totalStr, amountBoxX + 85, y + 9);

    y += 18;

    // 税抜金額
    doc.setFontSize(10);
    doc.text('税抜金額', amountBoxX + 30, y);
    doc.text(`¥${estimate.subtotal.toLocaleString()} -`, amountBoxX + 100, y);

    y += 7;

    // 消費税
    doc.text('消費税', amountBoxX + 30, y);
    doc.text(`¥${estimate.tax.toLocaleString()} -`, amountBoxX + 100, y);

    // ========== 左下: 現場情報テーブル ==========
    const infoY = 125;
    const infoX = margin + 10;
    const labelWidth = 60;
    const valueWidth = 100;

    // 有効期限を計算
    const validUntilDate = new Date(estimate.validUntil);
    const createdDate = new Date(estimate.createdAt);
    const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));

    const infoData = [
        ['現場名称:', project.title || estimate.title],
        ['現場住所:', project.location || ''],
        ['予定工期:', ''],
        ['支払条件:', 'お打ち合わせによる'],
        ['有効期限:', `${monthsDiff}ヶ月`],
    ];

    doc.setFontSize(10);
    infoData.forEach((row, index) => {
        const rowY = infoY + index * 10;
        doc.text(row[0], infoX, rowY);
        doc.text(row[1], infoX + labelWidth, rowY);
        // 下線
        doc.setLineWidth(0.2);
        doc.line(infoX, rowY + 2, infoX + labelWidth + valueWidth, rowY + 2);
    });

    // ========== 右下: 会社情報 ==========
    const companyX = pageWidth - margin - 120;
    let companyY = infoY;

    doc.setFontSize(9);
    doc.text(`許可(般-1)第${companyInfo.tel.slice(-5) || '00000'}号`, companyX, companyY);
    companyY += 7;

    doc.setFontSize(11);
    doc.text(companyInfo.name, companyX, companyY);
    companyY += 7;

    doc.setFontSize(9);
    doc.text(`代表取締役 ${companyInfo.representative}`, companyX, companyY);
    companyY += 7;

    doc.text(`〒${companyInfo.postalCode} ${companyInfo.address}`, companyX, companyY);
    companyY += 5;

    doc.text(`TEL:${companyInfo.tel} FAX:${companyInfo.fax || ''}`, companyX, companyY);

    // 印鑑スペース（右下）
    const stampX = pageWidth - margin - 40;
    const stampY = infoY - 5;
    const stampSize = 35;
    doc.setLineWidth(0.3);
    doc.rect(stampX, stampY, stampSize, stampSize);
}

/**
 * 内訳書（2ページ目）を生成
 */
function generateDetailsPage(
    doc: jsPDF,
    estimate: Estimate
): void {
    const pageWidth = 297;
    const margin = 15;

    // ========== タイトル「内訳書」==========
    doc.setFontSize(18);
    const titleText = '内 訳 書';
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, margin + 10);

    // 下線
    doc.setLineWidth(0.5);
    doc.line((pageWidth - titleWidth) / 2 - 5, margin + 13, (pageWidth + titleWidth) / 2 + 5, margin + 13);

    // ========== 明細テーブル ==========
    const tableData: (string | number)[][] = [];

    // 明細行を追加
    estimate.items.forEach((item, index) => {
        const amount = item.amount;
        const isNegative = amount < 0;
        tableData.push([
            (index + 1).toString(),
            item.description || '',
            item.quantity.toString(),
            item.unit || '',
            item.unitPrice > 0 ? item.unitPrice.toLocaleString() : (item.unitPrice < 0 ? `(${Math.abs(item.unitPrice).toLocaleString()})` : ''),
            isNegative ? `(${Math.abs(amount).toLocaleString()})` : amount.toLocaleString(),
            item.notes || '',
        ]);
    });

    // 空行を追加して20行にする
    const maxRows = 20;
    for (let i = estimate.items.length; i < maxRows; i++) {
        tableData.push(['', '', '', '', '', '', '']);
    }

    autoTable(doc, {
        startY: margin + 20,
        head: [['', '工事名称', '数量', '単位', '単価', '金額', '備考']],
        body: tableData,
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 9,
            cellPadding: 2,
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
            valign: 'middle',
        },
        headStyles: {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            halign: 'center',
            fontStyle: 'normal',
        },
        columnStyles: {
            0: { cellWidth: 15, halign: 'center' },  // No
            1: { cellWidth: 120 },                    // 工事名称
            2: { cellWidth: 25, halign: 'right' },   // 数量
            3: { cellWidth: 20, halign: 'center' },  // 単位
            4: { cellWidth: 30, halign: 'right' },   // 単価
            5: { cellWidth: 35, halign: 'right' },   // 金額
            6: { cellWidth: 40 },                    // 備考
        },
        didParseCell: (data) => {
            // 値引き行（マイナス金額）を赤色に
            if (data.section === 'body' && data.column.index === 5) {
                const cellValue = String(data.cell.raw);
                if (cellValue.startsWith('(') && cellValue.endsWith(')')) {
                    data.cell.styles.textColor = [255, 0, 0];
                }
            }
            // 値引きの説明行も赤色に
            if (data.section === 'body' && data.column.index === 1) {
                const rowIndex = data.row.index;
                if (rowIndex < estimate.items.length && estimate.items[rowIndex].amount < 0) {
                    data.cell.styles.textColor = [255, 0, 0];
                }
            }
        },
    });

    // ========== 合計行 ==========
    const tableEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // 小計行
    autoTable(doc, {
        startY: tableEndY,
        body: [
            ['', '', '', '', '', estimate.subtotal.toLocaleString(), ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 9,
            cellPadding: 2,
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
        },
        columnStyles: {
            0: { cellWidth: 15 },
            1: { cellWidth: 120 },
            2: { cellWidth: 25 },
            3: { cellWidth: 20 },
            4: { cellWidth: 30 },
            5: { cellWidth: 35, halign: 'right' },
            6: { cellWidth: 40 },
        },
    });

    const subtotalEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // 消費税行
    autoTable(doc, {
        startY: subtotalEndY,
        body: [
            ['', '', '', '', '消費税', estimate.tax.toLocaleString(), ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 9,
            cellPadding: 2,
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
        },
        columnStyles: {
            0: { cellWidth: 15 },
            1: { cellWidth: 120 },
            2: { cellWidth: 25 },
            3: { cellWidth: 20 },
            4: { cellWidth: 30, halign: 'right' },
            5: { cellWidth: 35, halign: 'right' },
            6: { cellWidth: 40 },
        },
    });

    const taxEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // 合計行
    autoTable(doc, {
        startY: taxEndY,
        body: [
            ['', '', '', '', '合計', estimate.total.toLocaleString(), ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 10,
            cellPadding: 2,
            lineColor: [0, 0, 0],
            lineWidth: 0.2,
            fontStyle: 'bold',
        },
        columnStyles: {
            0: { cellWidth: 15 },
            1: { cellWidth: 120 },
            2: { cellWidth: 25 },
            3: { cellWidth: 20 },
            4: { cellWidth: 30, halign: 'right' },
            5: { cellWidth: 35, halign: 'right' },
            6: { cellWidth: 40 },
        },
    });
}
