'use client';

import { pdf } from '@react-pdf/renderer';
import { EstimatePDF } from '@/components/pdf/EstimatePDF';
import { InvoicePDF } from '@/components/pdf/InvoicePDF';
import { MaterialRequisitionSlipPDF, type MaterialRequisitionSlipPDFProps } from '@/components/pdf/MaterialRequisitionSlipPDF';
import { Estimate } from '@/types/estimate';
import { Invoice } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';

/** ファイル名に使えない文字を除去 */
function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}

/**
 * PDF Blob を保存/共有する
 * モバイル（Web Share API 対応かつファイル共有可）の場合は共有シートを使い、
 * それ以外は <a download> でダウンロードする
 */
async function savePdfBlob(blob: Blob, fileName: string, shareTitle?: string): Promise<void> {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
        try {
            // iOS では title/text が無いと LINE 等が共有シートの候補に出ない。
            // そこで短いあいさつ文（例:「見積書をお送りします」）を title に渡す。
            // この文面が LINE では本文(1通目)として送られる（ファイル名 File.name とは別物）。
            // ファイル名そのものを送ると重複・冗長になるため、文面は意味のある定型文にする。
            await nav.share(shareTitle ? { files: [file], title: shareTitle } : { files: [file] });
            return;
        } catch (err) {
            // ユーザーがキャンセルした場合は何もしない
            if ((err as Error)?.name === 'AbortError') return;
            // それ以外はフォールバック
        }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Register fonts on module load
import '@/components/pdf/styles';
import { logger } from '@/lib/logger';

interface EstimatePDFOptions {
    includeDetails?: boolean;
    creatorName?: string;
}

/**
 * Generate Estimate PDF and download it
 */
export async function exportEstimatePDFReact(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: EstimatePDFOptions = { includeDetails: true }
): Promise<void> {
    try {
        const blob = await pdf(
            <EstimatePDF
                estimate={estimate}
                project={project}
                companyInfo={companyInfo}
                includeDetails={options.includeDetails}
                creatorName={options.creatorName}
            />
        ).toBlob();

        const titlePart = sanitizeFileName(estimate.title || estimate.estimateNumber);
        await savePdfBlob(blob, `${titlePart}.pdf`, '見積書をお送りします');
    } catch (error) {
        logger.error('PDF生成エラー:', error);
        throw error;
    }
}

/**
 * Generate Estimate PDF as Blob URL for preview
 */
export async function generateEstimatePDFBlobReact(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: EstimatePDFOptions = { includeDetails: true }
): Promise<string> {
    try {
        const blob = await pdf(
            <EstimatePDF
                estimate={estimate}
                project={project}
                companyInfo={companyInfo}
                includeDetails={options.includeDetails}
                creatorName={options.creatorName}
            />
        ).toBlob();

        return URL.createObjectURL(blob);
    } catch (error) {
        logger.error('PDF生成エラー:', error);
        throw error;
    }
}

/**
 * Generate Estimate PDF as raw Blob (for live preview that manages its own URL lifecycle)
 */
export async function generateEstimatePDFBlobOnlyReact(
    estimate: Estimate,
    project: Project,
    companyInfo: CompanyInfo,
    options: EstimatePDFOptions = { includeDetails: true }
): Promise<Blob> {
    return await pdf(
        <EstimatePDF
            estimate={estimate}
            project={project}
            companyInfo={companyInfo}
            includeDetails={options.includeDetails}
            creatorName={options.creatorName}
        />
    ).toBlob();
}

/**
 * Generate Invoice PDF and download it
 */
export async function exportInvoicePDFReact(
    invoice: Invoice,
    project: Project,
    companyInfo: CompanyInfo,
    projectMasters?: Array<{ id: string; title: string }>,
    options: { includeCopy?: boolean; includeDetails?: boolean } = {}
): Promise<void> {
    try {
        const blob = await pdf(
            <InvoicePDF
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
                projectMasters={projectMasters || invoice.projectMasters}
                includeCopy={options.includeCopy ?? true}
                includeDetails={options.includeDetails ?? false}
            />
        ).toBlob();

        const customerPart = project.customer ? `_${project.customer}${project.customerHonorific || ''}` : '';
        const titlePart = sanitizeFileName((invoice.title || invoice.invoiceNumber) + customerPart);
        await savePdfBlob(blob, `請求書_${titlePart}.pdf`, '請求書をお送りします');
    } catch (error) {
        logger.error('PDF生成エラー:', error);
        throw error;
    }
}

/**
 * Generate Invoice PDF as Blob URL for preview
 */
export async function generateInvoicePDFBlobReact(
    invoice: Invoice,
    project: Project,
    companyInfo: CompanyInfo,
    projectMasters?: Array<{ id: string; title: string }>,
    options: { includeCopy?: boolean; includeDetails?: boolean } = {}
): Promise<string> {
    try {
        const blob = await pdf(
            <InvoicePDF
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
                projectMasters={projectMasters || invoice.projectMasters}
                includeCopy={options.includeCopy ?? true}
                includeDetails={options.includeDetails ?? false}
            />
        ).toBlob();

        return URL.createObjectURL(blob);
    } catch (error) {
        logger.error('PDF生成エラー:', error);
        throw error;
    }
}

/**
 * Generate Invoice PDF as raw Blob (for live preview that manages its own URL lifecycle)
 */
export async function generateInvoicePDFBlobOnlyReact(
    invoice: Invoice,
    project: Project,
    companyInfo: CompanyInfo,
    projectMasters?: Array<{ id: string; title: string }>,
    options: { includeCopy?: boolean; includeDetails?: boolean } = {}
): Promise<Blob> {
    return await pdf(
        <InvoicePDF
            invoice={invoice}
            project={project}
            companyInfo={companyInfo}
            projectMasters={projectMasters || invoice.projectMasters}
            includeCopy={options.includeCopy ?? true}
            includeDetails={options.includeDetails ?? false}
        />
    ).toBlob();
}

/**
 * Generate Material Requisition Slip PDF as raw Blob (for live preview)
 */
export async function generateMaterialRequisitionSlipPDFBlob(
    props: MaterialRequisitionSlipPDFProps
): Promise<Blob> {
    return await pdf(<MaterialRequisitionSlipPDF {...props} />).toBlob();
}
