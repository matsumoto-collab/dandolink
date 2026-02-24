/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CompanyInfoSettings from '@/components/Settings/CompanyInfoSettings';
import { useCompany } from '@/hooks/useCompany';
import toast from 'react-hot-toast';

// Mock hooks
jest.mock('@/hooks/useCompany');
jest.mock('react-hot-toast');

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Trash2: () => <span data-testid="icon-trash" />,
    Save: () => <span data-testid="icon-save" />,
    Loader2: () => <span data-testid="icon-loader" />,
}));

describe('CompanyInfoSettings', () => {
    const mockUpdateCompanyInfo = jest.fn();

    const mockCompanyInfo = {
        name: 'Test Company',
        postalCode: '123-4567',
        address: 'Test Address',
        tel: '03-1234-5678',
        fax: '03-1234-5679',
        email: 'info@test.com',
        representativeTitle: 'CEO',
        representative: 'John Doe',
        sealImage: '',
        licenseNumber: 'License 123',
        registrationNumber: 'T123456',
        bankAccounts: [
            { bankName: 'Bank A', branchName: 'Branch 1', accountType: '普', accountNumber: '123456' }
        ],
    };

    beforeEach(() => {
        jest.clearAllMocks();

        (useCompany as jest.Mock).mockReturnValue({
            companyInfo: mockCompanyInfo,
            updateCompanyInfo: mockUpdateCompanyInfo,
            isLoading: false,
            ensureDataLoaded: jest.fn(),
        });
    });

    it('should render loading state', () => {
        (useCompany as jest.Mock).mockReturnValue({
            companyInfo: null,
            updateCompanyInfo: mockUpdateCompanyInfo,
            isLoading: true,
            ensureDataLoaded: jest.fn(),
        });

        render(<CompanyInfoSettings />);
        expect(screen.getByTestId('icon-loader')).toBeInTheDocument();
    });

    it('should render company info form', () => {
        render(<CompanyInfoSettings />);

        expect(screen.getByDisplayValue('Test Company')).toBeInTheDocument();
        expect(screen.getByDisplayValue('123-4567')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Bank A')).toBeInTheDocument();
    });

    it('should update form fields', () => {
        render(<CompanyInfoSettings />);

        const nameInput = screen.getByDisplayValue('Test Company');
        fireEvent.change(nameInput, { target: { value: 'Updated Company' } });

        expect(nameInput).toHaveValue('Updated Company');
    });

    it('should add a bank account', () => {
        render(<CompanyInfoSettings />);

        fireEvent.click(screen.getByText('口座追加'));

        const inputs = screen.getAllByPlaceholderText('銀行名');
        expect(inputs).toHaveLength(2); // Original + New
    });

    it('should remove a bank account', () => {
        render(<CompanyInfoSettings />);

        const trashButton = screen.getByTestId('icon-trash');
        fireEvent.click(trashButton.closest('button')!);

        expect(screen.queryByDisplayValue('Bank A')).not.toBeInTheDocument();
        expect(screen.getByText('口座が登録されていません')).toBeInTheDocument();
    });

    it('should handle save', async () => {
        render(<CompanyInfoSettings />); // Reset render to initial state

        mockUpdateCompanyInfo.mockResolvedValue(undefined);

        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => {
            expect(mockUpdateCompanyInfo).toHaveBeenCalledWith(expect.objectContaining({
                name: 'Test Company',
                bankAccounts: expect.anything(),
            }));
            expect(toast.success).toHaveBeenCalledWith('会社情報を保存しました');
        });
    });

    it('should handle save error', async () => {
        render(<CompanyInfoSettings />); // Reset render

        mockUpdateCompanyInfo.mockRejectedValue(new Error('Save failed'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('保存に失敗しました');
        });
        consoleSpy.mockRestore();
    });

    it('should handle image upload', async () => {
        render(<CompanyInfoSettings />);

        const file = new File(['(⌐□_□)'], 'seal.png', { type: 'image/png' });
        const input = screen.getByLabelText(/会社印/i);

        // Mock FileReader
        const originalFileReader = window.FileReader;
        window.FileReader = class {
            onloadend: any = null;
            result = 'data:image/png;base64,fake';
            readAsDataURL() {
                setTimeout(() => {
                    this.onloadend && this.onloadend();
                }, 0);
            }
        } as any;

        try {
            await waitFor(() => {
                fireEvent.change(input, { target: { files: [file] } });
            });

            // Wait for state update (img tag should appear)
            await waitFor(() => {
                expect(screen.getByAltText('会社印')).toBeInTheDocument();
            });
        } finally {
            // Restore FileReader
            window.FileReader = originalFileReader;
        }
    });
});
