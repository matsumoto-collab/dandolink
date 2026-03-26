'use client';

import { pdf } from '@react-pdf/renderer';
import { EstimatePDF } from '@/components/pdf/EstimatePDF';
import { InvoicePDF } from '@/components/pdf/InvoicePDF';
import { Estimate } from '@/types/estimate';
import { Invoice } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';

// Register fonts on module load
import '@/components/pdf/styles';

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

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `見積書_${estimate.estimateNumber}_${new Date().getTime()}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('PDF生成エラー:', error);
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
        console.error('PDF生成エラー:', error);
        throw error;
    }
}

/**
 * Generate Invoice PDF and download it
 */
export async function exportInvoicePDFReact(
    invoice: Invoice,
    project: Project,
    companyInfo: CompanyInfo,
    projectMasters?: Array<{ id: string; title: string }>
): Promise<void> {
    try {
        const blob = await pdf(
            <InvoicePDF
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
                projectMasters={projectMasters || invoice.projectMasters}
            />
        ).toBlob();

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `請求書_${invoice.invoiceNumber}_${new Date().getTime()}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('PDF生成エラー:', error);
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
    projectMasters?: Array<{ id: string; title: string }>
): Promise<string> {
    try {
        const blob = await pdf(
            <InvoicePDF
                invoice={invoice}
                project={project}
                companyInfo={companyInfo}
                projectMasters={projectMasters || invoice.projectMasters}
            />
        ).toBlob();

        return URL.createObjectURL(blob);
    } catch (error) {
        console.error('PDF生成エラー:', error);
        throw error;
    }
}
