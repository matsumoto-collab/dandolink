import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProjectMasterForm, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';

// Global fetch is mocked in jest.setup.ts.

describe('ProjectMasterForm', () => {
    const mockSetFormData = jest.fn();
    const mockOnSubmit = jest.fn();
    const mockOnCancel = jest.fn();

    // Mock CollapsibleSection
    jest.mock('@/components/ProjectMasters/common/CollapsibleSection', () => ({
        CollapsibleSection: ({ title, children, isExpanded, onToggle }: any) => (
            <div>
                <button onClick={onToggle}>{title}</button>
                {isExpanded && <div>{children}</div>}
            </div>
        ),
    }));

    beforeEach(() => {
        jest.clearAllMocks();

        // Ensure fetch returns array by default to avoid filter errors in child components
        (global.fetch as jest.Mock).mockImplementation(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            })
        );
    });

    it('renders all sections and initially expands correct ones', async () => {
        await act(async () => {
            render(
                <ProjectMasterForm
                    formData={DEFAULT_FORM_DATA}
                    setFormData={mockSetFormData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );
        });

        // Check Section Headers
        expect(screen.getByText('基本情報')).toBeInTheDocument();
        expect(screen.getByText('住所情報')).toBeInTheDocument();
        expect(screen.getByText('工事情報')).toBeInTheDocument();
        expect(screen.getByText('足場仕様')).toBeInTheDocument();

        const remarksElements = screen.getAllByText('備考');
        expect(remarksElements.length).toBeGreaterThan(0);

        // Check content visibility (using correct placeholder)
        expect(screen.getByPlaceholderText('例: 松本様邸')).toBeInTheDocument();
    });

    it('toggles sections', async () => {
        await act(async () => {
            render(
                <ProjectMasterForm
                    formData={DEFAULT_FORM_DATA}
                    setFormData={mockSetFormData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );
        });

        const addressHeader = screen.getByText('住所情報');

        // Toggle Close
        fireEvent.click(addressHeader);
        expect(screen.queryByText('郵便番号')).not.toBeInTheDocument();

        // Toggle Open
        fireEvent.click(addressHeader);

        await waitFor(() => {
            expect(screen.getByText('郵便番号')).toBeInTheDocument();
        });
    });

    it('updates form data when input changes', async () => {
        await act(async () => {
            render(
                <ProjectMasterForm
                    formData={DEFAULT_FORM_DATA}
                    setFormData={mockSetFormData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );
        });

        // Use correct placeholder
        const titleInput = screen.getByPlaceholderText('例: 松本様邸');
        fireEvent.change(titleInput, { target: { value: 'New Project' } });

        expect(mockSetFormData).toHaveBeenCalled();
    });

    it('triggers submit callback', async () => {
        await act(async () => {
            render(
                <ProjectMasterForm
                    formData={DEFAULT_FORM_DATA}
                    setFormData={mockSetFormData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );
        });

        fireEvent.click(screen.getByText('作成'));
        expect(mockOnSubmit).toHaveBeenCalled();
    });

    it('triggers cancel callback', async () => {
        await act(async () => {
            render(
                <ProjectMasterForm
                    formData={DEFAULT_FORM_DATA}
                    setFormData={mockSetFormData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );
        });

        fireEvent.click(screen.getByText('キャンセル'));
        expect(mockOnCancel).toHaveBeenCalled();
    });
});
