/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EstimateDetailModal from '@/components/Estimates/EstimateDetailModal';
import { Estimate } from '@/types/estimate';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    X: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-x" {...props} />,
    FileDown: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-filedown" {...props} />,
    Printer: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-printer" {...props} />,
    Trash2: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-trash" {...props} />,
    Edit: (props: React.SVGAttributes<SVGElement>) => <span data-testid="icon-edit" {...props} />,
}));

// Mock the PDF generator (dynamic import)
jest.mock('@/utils/reactPdfGenerator', () => ({
    generateEstimatePDFBlobReact: jest.fn().mockResolvedValue('blob:mock-url'),
    exportEstimatePDFReact: jest.fn().mockResolvedValue(undefined),
}));

describe('EstimateDetailModal', () => {
    const mockOnClose = jest.fn();
    const mockOnDelete = jest.fn();
    const mockOnEdit = jest.fn();

    const mockEstimate: Estimate = {
        id: 'est1',
        projectId: 'p1',
        estimateNumber: 'EST-001',
        title: 'テスト見積書',
        items: [
            {
                id: 'item1',
                description: '足場組立',
                quantity: 1,
                unit: '式',
                unitPrice: 100000,
                amount: 100000,
                taxType: 'standard' as const,
            },
        ],
        subtotal: 100000,
        tax: 10000,
        total: 110000,
        validUntil: new Date('2024-12-31'),
        status: 'draft',
        notes: 'テスト備考',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
    };

    const mockProject: Project = {
        id: 'p1',
        title: 'テストプロジェクト',
        startDate: new Date('2024-06-01'),
        color: '#3B82F6',
        customer: '山田建設',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockCompanyInfo: CompanyInfo = {
        id: 'c1',
        name: 'テスト会社',
        postalCode: '100-0001',
        address: '東京都千代田区1-1-1',
        tel: '03-1234-5678',
        representative: '代表太郎',
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock window.print
        window.print = jest.fn();
        // Mock URL.revokeObjectURL
        URL.revokeObjectURL = jest.fn();
        // Mock confirm
        window.confirm = jest.fn();
    });

    it('should return null when isOpen is false', () => {
        const { container } = render(
            <EstimateDetailModal
                isOpen={false}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('should return null when estimate is null', () => {
        const { container } = render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={null}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('should render modal when isOpen and estimate provided', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        expect(screen.getAllByText('見積書').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('テストプロジェクト')).toBeInTheDocument();
    });

    it('should render action buttons', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        expect(screen.getByText('編集')).toBeInTheDocument();
        expect(screen.getByTitle('PDF出力')).toBeInTheDocument();
        expect(screen.getByTitle('印刷')).toBeInTheDocument();
        expect(screen.getByTitle('削除')).toBeInTheDocument();
    });

    it('should render tabs', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        // Both '見積書' label and tab exist, so at least 2
        expect(screen.getAllByText('見積書').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText('予算書')).toBeInTheDocument();
    });

    it('should switch to budget tab and show placeholder message', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        fireEvent.click(screen.getByText('予算書'));
        expect(screen.getByText('予算書機能は今後実装予定です')).toBeInTheDocument();
    });

    it('should call onClose when overlay is clicked', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        // Click the overlay (first bg-black element)
        const overlay = document.querySelector('.bg-black.bg-opacity-50');
        if (overlay) fireEvent.click(overlay);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onEdit and onClose when edit button is clicked', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        fireEvent.click(screen.getByText('編集'));
        expect(mockOnEdit).toHaveBeenCalledWith(mockEstimate);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onDelete when delete is confirmed', () => {
        (window.confirm as jest.Mock).mockReturnValue(true);
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        fireEvent.click(screen.getByTitle('削除'));
        expect(window.confirm).toHaveBeenCalledWith('この見積書を削除しますか？');
        expect(mockOnDelete).toHaveBeenCalledWith('est1');
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not call onDelete when delete is cancelled', () => {
        (window.confirm as jest.Mock).mockReturnValue(false);
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        fireEvent.click(screen.getByTitle('削除'));
        expect(mockOnDelete).not.toHaveBeenCalled();
    });

    it('should call window.print when print button is clicked', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        fireEvent.click(screen.getByTitle('印刷'));
        expect(window.print).toHaveBeenCalled();
    });

    it('should render cover page checkbox', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        expect(screen.getByText('表紙を含める')).toBeInTheDocument();
        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked();
    });

    it('should toggle cover page checkbox', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
    });

    it('should show loading when PDF not yet generated', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={mockProject}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        expect(screen.getByText('PDFを読み込んでいます...')).toBeInTheDocument();
    });

    it('should create dummy project when project is null', () => {
        render(
            <EstimateDetailModal
                isOpen={true}
                onClose={mockOnClose}
                estimate={mockEstimate}
                project={null}
                companyInfo={mockCompanyInfo}
                onDelete={mockOnDelete}
                onEdit={mockOnEdit}
            />
        );
        // Title falls back to estimate title
        expect(screen.getByText('テスト見積書')).toBeInTheDocument();
    });
});
