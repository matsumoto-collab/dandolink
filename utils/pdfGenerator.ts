'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { NotoSansJPFont } from './fonts/NotoSansJP-font';

// Color palette
const COLORS = {
    navy: [26, 54, 93] as [number, number, number],      // #1a365d
    white: [255, 255, 255] as [number, number, number],
    black: [0, 0, 0] as [number, number, number],
    textPrimary: [26, 32, 44] as [number, number, number],
    textSecondary: [74, 85, 104] as [number, number, number],
    infoBg: [240, 244, 248] as [number, number, number],  // #f0f4f8
    zebraStripe: [248, 250, 252] as [number, number, number], // #f8fafc
    borderLight: [203, 213, 224] as [number, number, number], // #cbd5e0
    borderMedium: [160, 174, 192] as [number, number, number], // #a0aec0
    totalBg: [237, 242, 247] as [number, number, number], // #edf2f7
    red: [229, 62, 62] as [number, number, number],
};

// PDF生成オプション
interface PDFOptions {
    includeDetails: boolean;
}

// 西暦を令和に変換
function toReiwa(date: Date): string {
    const year = date.getFullYear();
    const reiwaYear = year - 2018;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `令和${reiwaYear}年${month}月${day}日`;
}

/**
 * 見積書PDF（ポートレート版）を生成して出力
 */
export function exportEstimatePDF(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: PDFOptions = { includeDetails: true }
): void {
    try {
        const doc = new jsPDF({
            orientation: 'portrait',
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

        // 表紙を生成
        generateCoverPage(doc, estimate, project, companyInfo);

        // 内訳書を生成
        if (options.includeDetails) {
            doc.addPage();
            generateDetailsPage(doc, estimate);
        }

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
    options: PDFOptions = { includeDetails: true }
): Promise<string> {
    return new Promise((resolve, reject) => {
        try {
            const doc = new jsPDF({
                orientation: 'portrait',
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

            generateCoverPage(doc, estimate, project, companyInfo);

            if (options.includeDetails) {
                doc.addPage();
                generateDetailsPage(doc, estimate);
            }

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
 * 表紙（ポートレート版）を生成
 */
function generateCoverPage(
    doc: jsPDF,
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo
): void {
    const pageWidth = 210; // A4 portrait width
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;

    // ========== Top accent bar ==========
    doc.setFillColor(...COLORS.navy);
    doc.rect(0, 0, pageWidth, 2, 'F');

    // ========== Left: Customer info ==========
    let leftY = margin + 5;
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.textSecondary);

    if (project.location) {
        const postalMatch = project.location.match(/〒[\d-]+/);
        if (postalMatch) {
            doc.text(postalMatch[0], margin, leftY);
            leftY += 5;
        }
        const addressText = project.location.replace(/〒[\d-]+\s*/, '');
        if (addressText) {
            doc.text(addressText, margin, leftY);
            leftY += 6;
        }
    }

    // Customer name
    leftY += 2;
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.textPrimary);
    const customerName = `${project.customer || ''} ${project.customerHonorific || '御中'}`;
    doc.text(customerName, margin, leftY);

    // Underline
    const nameWidth = doc.getTextWidth(customerName);
    doc.setDrawColor(...COLORS.navy);
    doc.setLineWidth(0.5);
    doc.line(margin, leftY + 2, margin + Math.max(nameWidth, 60), leftY + 2);
    leftY += 10;

    // Greeting
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.textSecondary);
    doc.text('下記の通り御見積り申し上げます。', margin, leftY);

    // ========== Right: Title + Company info ==========
    const rightX = pageWidth - margin;
    let rightY = margin + 5;

    // Title
    doc.setFontSize(20);
    doc.setTextColor(...COLORS.navy);
    const titleStr = '御 見 積 書';
    const titleWidth = doc.getTextWidth(titleStr);
    doc.text(titleStr, rightX - titleWidth, rightY);

    // Title underline
    doc.setDrawColor(...COLORS.navy);
    doc.setLineWidth(0.7);
    doc.line(rightX - titleWidth - 3, rightY + 2, rightX, rightY + 2);
    rightY += 10;

    // Date
    doc.setFontSize(10);
    doc.setTextColor(...COLORS.textSecondary);
    const dateStr = `発行日：${toReiwa(new Date(estimate.createdAt))}`;
    const dateWidth = doc.getTextWidth(dateStr);
    doc.text(dateStr, rightX - dateWidth, rightY);
    rightY += 10;

    // Company info
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textSecondary);

    if (companyInfo.licenseNumber) {
        const licWidth = doc.getTextWidth(companyInfo.licenseNumber);
        doc.text(companyInfo.licenseNumber, rightX - licWidth, rightY);
        rightY += 5;
    }

    doc.setFontSize(11);
    doc.setTextColor(...COLORS.textPrimary);
    const compNameWidth = doc.getTextWidth(companyInfo.name);
    doc.text(companyInfo.name, rightX - compNameWidth, rightY);
    rightY += 6;

    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textSecondary);
    const postalStr = `〒${companyInfo.postalCode}`;
    doc.text(postalStr, rightX - doc.getTextWidth(postalStr), rightY);
    rightY += 4;

    doc.text(companyInfo.address, rightX - doc.getTextWidth(companyInfo.address), rightY);
    rightY += 4;

    const telFax = `TEL：${companyInfo.tel}　FAX：${companyInfo.fax || ''}`;
    doc.text(telFax, rightX - doc.getTextWidth(telFax), rightY);
    rightY += 4;

    // Stamp box
    const stampSize = 18;
    const stampX = rightX - stampSize;
    const stampY = rightY + 1;
    doc.setDrawColor(...COLORS.borderLight);
    doc.setLineWidth(0.3);
    doc.rect(stampX, stampY, stampSize, stampSize);

    // ========== Amount Section ==========
    const amountY = Math.max(leftY, 52) + 8;
    const amountBoxWidth = contentWidth * 0.58;
    const amountLabelW = 32;

    // Label box (navy background)
    doc.setFillColor(...COLORS.navy);
    doc.rect(margin, amountY, amountLabelW, 16, 'F');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.white);
    doc.text('合計金額', margin + 4, amountY + 11);

    // Value box
    doc.setDrawColor(...COLORS.navy);
    doc.setLineWidth(0.5);
    doc.rect(margin, amountY, amountBoxWidth, 16);

    doc.setFontSize(18);
    doc.setTextColor(...COLORS.navy);
    const totalStr = `¥${estimate.total.toLocaleString()}`;
    const totalWidth = doc.getTextWidth(totalStr);
    doc.text(totalStr, margin + amountBoxWidth - totalWidth - 5, amountY + 11);

    // Tax note
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textSecondary);
    doc.text('（税込）', margin + amountBoxWidth - 16, amountY + 15);

    // Detail (right of amount)
    const detailX = margin + amountBoxWidth + 8;
    let detailY = amountY + 6;
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.textSecondary);
    doc.text('小計', detailX, detailY);
    doc.setTextColor(...COLORS.textPrimary);
    const subtotalStr = `¥${estimate.subtotal.toLocaleString()}`;
    doc.text(subtotalStr, rightX - doc.getTextWidth(subtotalStr), detailY);
    detailY += 6;
    doc.setTextColor(...COLORS.textSecondary);
    doc.text('消費税額(10%)', detailX, detailY);
    doc.setTextColor(...COLORS.textPrimary);
    const taxStr = `¥${estimate.tax.toLocaleString()}`;
    doc.text(taxStr, rightX - doc.getTextWidth(taxStr), detailY);

    // ========== Info Table + Remarks ==========
    const infoY = amountY + 22;
    const infoTableW = contentWidth * 0.58;
    const infoLabelW = 25;
    const infoRows = [
        ['件名', project.title || estimate.title],
        ['現場住所', project.location || ''],
        ['有効期限', (() => {
            const validUntilDate = new Date(estimate.validUntil);
            const createdDate = new Date(estimate.createdAt);
            const monthsDiff = Math.ceil((validUntilDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
            return `発行日より${monthsDiff}ヶ月`;
        })()],
        ['工期', ''],
        ['支払条件', '従来通り'],
    ];

    doc.setFontSize(9);
    const infoRowH = 7;

    infoRows.forEach((row, idx) => {
        const rowY = infoY + idx * infoRowH;

        // Label cell (gray bg)
        doc.setFillColor(...COLORS.infoBg);
        doc.rect(margin, rowY, infoLabelW, infoRowH, 'F');

        // Borders
        doc.setDrawColor(...COLORS.borderMedium);
        doc.setLineWidth(0.2);
        doc.rect(margin, rowY, infoLabelW, infoRowH);
        doc.rect(margin + infoLabelW, rowY, infoTableW - infoLabelW, infoRowH);

        // Text
        doc.setTextColor(...COLORS.textSecondary);
        doc.text(row[0], margin + 2, rowY + 5);
        doc.setTextColor(...COLORS.textPrimary);
        doc.text(row[1], margin + infoLabelW + 2, rowY + 5);
    });

    // Remarks box
    const remarksX = margin + infoTableW + 5;
    const remarksW = contentWidth - infoTableW - 5;
    const remarksH = infoRowH * infoRows.length;

    // Remarks header
    doc.setFillColor(...COLORS.infoBg);
    doc.setDrawColor(...COLORS.borderMedium);
    doc.setLineWidth(0.2);
    doc.rect(remarksX, infoY, remarksW, 7, 'F');
    doc.rect(remarksX, infoY, remarksW, 7);
    doc.setTextColor(...COLORS.textSecondary);
    doc.setFontSize(8);
    const bikoStr = '備考';
    doc.text(bikoStr, remarksX + (remarksW - doc.getTextWidth(bikoStr)) / 2, infoY + 5);

    // Remarks body
    doc.rect(remarksX, infoY + 7, remarksW, remarksH - 7);
    if (estimate.notes) {
        doc.setFontSize(7);
        doc.setTextColor(...COLORS.textSecondary);
        // Split notes into lines
        const lines = doc.splitTextToSize(estimate.notes, remarksW - 4);
        doc.text(lines.slice(0, 5), remarksX + 2, infoY + 12);
    }

    // ========== Detail Table ==========
    const tableStartY = infoY + infoRows.length * infoRowH + 5;

    // Prepare items
    const maxRows = 15;
    const tableData: (string | number)[][] = [];

    estimate.items.forEach((item, index) => {
        const amount = item.amount;
        const isNegative = amount < 0;
        tableData.push([
            (index + 1).toString(),
            item.description || '',
            item.specification || '',
            item.quantity > 0 ? item.quantity.toString() : '',
            item.unit || '',
            item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : '',
            isNegative ? `(${Math.abs(amount).toLocaleString()})` : amount.toLocaleString(),
            item.notes || '',
        ]);
    });

    // Fill with empty rows
    for (let i = estimate.items.length; i < maxRows; i++) {
        tableData.push(['', '', '', '', '', '', '', '']);
    }

    autoTable(doc, {
        startY: tableStartY,
        head: [['', '名称', '規格', '数量', '単位', '単価', '金額', '備考']],
        body: tableData,
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 7.5,
            cellPadding: 1.5,
            lineColor: COLORS.borderMedium,
            lineWidth: 0.1,
            valign: 'middle',
            textColor: COLORS.textPrimary,
        },
        headStyles: {
            fillColor: COLORS.navy,
            textColor: COLORS.white,
            halign: 'center',
            fontStyle: 'bold',
            fontSize: 7.5,
        },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },   // No
            1: { cellWidth: 38 },                     // 名称
            2: { cellWidth: 38 },                     // 規格
            3: { cellWidth: 16, halign: 'right' },    // 数量
            4: { cellWidth: 12, halign: 'center' },   // 単位
            5: { cellWidth: 20, halign: 'right' },    // 単価
            6: { cellWidth: 22, halign: 'right' },    // 金額
            7: { cellWidth: 26 },                     // 備考
        },
        alternateRowStyles: {
            fillColor: COLORS.zebraStripe,
        },
        didParseCell: (data) => {
            // Red color for negative amounts
            if (data.section === 'body' && data.column.index === 6) {
                const cellValue = String(data.cell.raw);
                if (cellValue.startsWith('(') && cellValue.endsWith(')')) {
                    data.cell.styles.textColor = COLORS.red;
                }
            }
            if (data.section === 'body' && data.column.index === 1) {
                const rowIndex = data.row.index;
                if (rowIndex < estimate.items.length && estimate.items[rowIndex].amount < 0) {
                    data.cell.styles.textColor = COLORS.red;
                }
            }
        },
    });

    // ========== Subtotal row ==========
    const tableEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    autoTable(doc, {
        startY: tableEndY,
        body: [
            ['', '', '', '', '', '小計', `¥${estimate.subtotal.toLocaleString()}`, ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 8,
            cellPadding: 1.5,
            lineColor: COLORS.borderMedium,
            lineWidth: 0.1,
            textColor: COLORS.textPrimary,
        },
        columnStyles: {
            0: { cellWidth: 8 },
            1: { cellWidth: 38 },
            2: { cellWidth: 38 },
            3: { cellWidth: 16 },
            4: { cellWidth: 12 },
            5: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
            6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
            7: { cellWidth: 26 },
        },
    });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.borderMedium);
    doc.text('DandoLink', pageWidth / 2, 290, { align: 'center' });
}

/**
 * 内訳書（ポートレート版）を生成
 */
function generateDetailsPage(
    doc: jsPDF,
    estimate: Estimate
): void {
    const pageWidth = 210;
    const margin = 15;

    // ========== Top accent bar ==========
    doc.setFillColor(...COLORS.navy);
    doc.rect(0, 0, pageWidth, 2, 'F');

    // ========== Title ==========
    doc.setFontSize(16);
    doc.setTextColor(...COLORS.navy);
    const titleText = '内 訳 書';
    doc.text(titleText, margin, margin + 8);

    // Title underline
    const titleWidth = doc.getTextWidth(titleText);
    doc.setDrawColor(...COLORS.navy);
    doc.setLineWidth(0.5);
    doc.line(margin, margin + 10, margin + titleWidth + 3, margin + 10);

    // Estimate number
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.textSecondary);
    const numStr = `見積番号：${estimate.estimateNumber}`;
    const numWidth = doc.getTextWidth(numStr);
    doc.text(numStr, pageWidth - margin - numWidth, margin + 8);

    // ========== Detail table ==========
    const maxRows = 25;
    const tableData: (string | number)[][] = [];

    estimate.items.forEach((item, index) => {
        const amount = item.amount;
        const isNegative = amount < 0;
        tableData.push([
            (index + 1).toString(),
            item.description || '',
            item.specification || '',
            item.quantity > 0 ? item.quantity.toString() : '',
            item.unit || '',
            item.unitPrice !== 0 ? item.unitPrice.toLocaleString() : '',
            isNegative ? `(${Math.abs(amount).toLocaleString()})` : amount.toLocaleString(),
            item.notes || '',
        ]);
    });

    for (let i = estimate.items.length; i < maxRows; i++) {
        tableData.push(['', '', '', '', '', '', '', '']);
    }

    autoTable(doc, {
        startY: margin + 15,
        head: [['', '名称', '規格', '数量', '単位', '単価', '金額', '備考']],
        body: tableData,
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 7.5,
            cellPadding: 1.5,
            lineColor: COLORS.borderMedium,
            lineWidth: 0.1,
            valign: 'middle',
            textColor: COLORS.textPrimary,
        },
        headStyles: {
            fillColor: COLORS.navy,
            textColor: COLORS.white,
            halign: 'center',
            fontStyle: 'bold',
            fontSize: 7.5,
        },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 38 },
            2: { cellWidth: 38 },
            3: { cellWidth: 16, halign: 'right' },
            4: { cellWidth: 12, halign: 'center' },
            5: { cellWidth: 20, halign: 'right' },
            6: { cellWidth: 22, halign: 'right' },
            7: { cellWidth: 26 },
        },
        alternateRowStyles: {
            fillColor: COLORS.zebraStripe,
        },
        didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 6) {
                const cellValue = String(data.cell.raw);
                if (cellValue.startsWith('(') && cellValue.endsWith(')')) {
                    data.cell.styles.textColor = COLORS.red;
                }
            }
            if (data.section === 'body' && data.column.index === 1) {
                const rowIndex = data.row.index;
                if (rowIndex < estimate.items.length && estimate.items[rowIndex].amount < 0) {
                    data.cell.styles.textColor = COLORS.red;
                }
            }
        },
    });

    // ========== Summary rows ==========
    const tableEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // Subtotal
    autoTable(doc, {
        startY: tableEndY,
        body: [
            ['', '', '', '', '', '小計', estimate.subtotal.toLocaleString(), ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 8,
            cellPadding: 1.5,
            lineColor: COLORS.borderMedium,
            lineWidth: 0.1,
            textColor: COLORS.textPrimary,
        },
        columnStyles: {
            0: { cellWidth: 8 },
            1: { cellWidth: 38 },
            2: { cellWidth: 38 },
            3: { cellWidth: 16 },
            4: { cellWidth: 12 },
            5: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
            6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
            7: { cellWidth: 26 },
        },
    });

    const subtotalEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // Tax
    autoTable(doc, {
        startY: subtotalEndY,
        body: [
            ['', '', '', '', '', '消費税', estimate.tax.toLocaleString(), ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 8,
            cellPadding: 1.5,
            lineColor: COLORS.borderMedium,
            lineWidth: 0.1,
            textColor: COLORS.textPrimary,
        },
        columnStyles: {
            0: { cellWidth: 8 },
            1: { cellWidth: 38 },
            2: { cellWidth: 38 },
            3: { cellWidth: 16 },
            4: { cellWidth: 12 },
            5: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
            6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
            7: { cellWidth: 26 },
        },
    });

    const taxEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

    // Total
    autoTable(doc, {
        startY: taxEndY,
        body: [
            ['', '', '', '', '', '合計', estimate.total.toLocaleString(), ''],
        ],
        theme: 'grid',
        styles: {
            font: 'NotoSansJP',
            fontSize: 9,
            cellPadding: 2,
            lineColor: COLORS.borderMedium,
            lineWidth: 0.2,
            fontStyle: 'bold',
            textColor: COLORS.navy,
        },
        bodyStyles: {
            fillColor: COLORS.totalBg,
        },
        columnStyles: {
            0: { cellWidth: 8 },
            1: { cellWidth: 38 },
            2: { cellWidth: 38 },
            3: { cellWidth: 16 },
            4: { cellWidth: 12 },
            5: { cellWidth: 20, halign: 'right' },
            6: { cellWidth: 22, halign: 'right' },
            7: { cellWidth: 26 },
        },
    });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.borderMedium);
    doc.text('DandoLink', pageWidth / 2, 290, { align: 'center' });
}
