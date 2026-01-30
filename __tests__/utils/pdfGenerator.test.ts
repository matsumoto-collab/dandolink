import { exportEstimatePDF } from '@/utils/pdfGenerator';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';

// Mock jsPDF
const mockText = jest.fn();
const mockRect = jest.fn();
const mockLine = jest.fn();
const mockAddPage = jest.fn();
const mockSave = jest.fn();
const mockSetFont = jest.fn();
const mockSetFontSize = jest.fn();
const mockSetLineWidth = jest.fn();
const mockSetProperties = jest.fn();
const mockAddFileToVFS = jest.fn();
const mockAddFont = jest.fn();
const mockGetTextWidth = jest.fn().mockReturnValue(10); // Dummy width

jest.mock('jspdf', () => {
    return {
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
            text: mockText,
            rect: mockRect,
            line: mockLine,
            addPage: mockAddPage,
            save: mockSave,
            setFont: mockSetFont,
            setFontSize: mockSetFontSize,
            setLineWidth: mockSetLineWidth,
            setProperties: mockSetProperties,
            addFileToVFS: mockAddFileToVFS,
            addFont: mockAddFont,
            getTextWidth: mockGetTextWidth,
            output: jest.fn(), // Added for generateEstimatePDFBlob
            lastAutoTable: { finalY: 100 },
        })),
    };
});

// Mock jspdf-autotable
jest.mock('jspdf-autotable', () => ({
    __esModule: true,
    default: jest.fn(),
}));

describe('pdfGenerator', () => {
    const mockEstimate: Estimate = {
        id: 'est-1',
        estimateNumber: 'EST-001',
        title: 'Test Estimate',
        items: [
            {
                id: 'item-1',
                description: 'Test Item',
                quantity: 1,
                unit: '式',
                unitPrice: 1000,
                amount: 1000,
            },
        ],
        subtotal: 1000,
        tax: 100,
        total: 1100,
        validUntil: new Date('2023-12-31'),
        status: 'draft',
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-01-01'),
    } as any; // Cast for simplified mock

    const mockProject: Project = {
        id: 'proj-1',
        title: 'Test Project',
        customer: 'Test Customer',
        startDate: new Date('2023-01-01'),
        category: 'construction',
        color: '#000000',
    } as any;

    const mockCompanyInfo: CompanyInfo = {
        id: 'default',
        name: 'Test Company',
        postalCode: '123-4567',
        address: 'Test Address',
        tel: '03-1234-5678',
        representative: 'Test Rep',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should generate PDF with correct properties', () => {
        exportEstimatePDF(mockEstimate, mockProject, mockCompanyInfo);

        // Verify jsPDF instantiation
        expect(require('jspdf').default).toHaveBeenCalledWith({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4',
        });

        // Verify properties
        expect(mockSetProperties).toHaveBeenCalledWith(expect.objectContaining({
            title: `見積書 ${mockEstimate.estimateNumber}`,
            author: mockCompanyInfo.name,
        }));

        // Verify basic content (Cover page)
        expect(mockText).toHaveBeenCalledWith(expect.stringContaining('御 見 積 書'), expect.any(Number), expect.any(Number));
        expect(mockText).toHaveBeenCalledWith(expect.stringContaining('Test Customer 様'), expect.any(Number), expect.any(Number));

        // Verify save
        expect(mockSave).toHaveBeenCalledWith(expect.stringContaining(`見積書_${mockEstimate.estimateNumber}_`));
    });

    it('should skip cover page when option is false', () => {
        exportEstimatePDF(mockEstimate, mockProject, mockCompanyInfo, { includeCoverPage: false });

        // Should NOT call text with cover page specific content like "御 見 積 書" which is only on cover
        // However, "御 見 積 書" logic in code: Cover page has '御 見 積 書' title. Details page has '内 訳 書'.
        // Let's check calls.

        // If cover page is skipped, addPage should not be called (unless there are too many rows, but here we have 1 item)
        expect(mockAddPage).not.toHaveBeenCalled();
    });
});
