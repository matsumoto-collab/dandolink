/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScaffoldingSection } from '@/components/ProjectMasters/sections/ScaffoldingSection';
import { DEFAULT_SCAFFOLDING_SPEC } from '@/types/calendar';
import { ProjectMasterFormData, DEFAULT_FORM_DATA } from '@/components/ProjectMasters/ProjectMasterForm';

// Mock icons
jest.mock('lucide-react', () => ({
    ChevronDown: () => <span data-testid="icon-down" />,
    ChevronUp: () => <span data-testid="icon-up" />,
}));

describe('ScaffoldingSection', () => {
    let mockFormData: ProjectMasterFormData;
    let mockSetFormData: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFormData = { ...DEFAULT_FORM_DATA, scaffoldingSpec: { ...DEFAULT_SCAFFOLDING_SPEC } };
        mockSetFormData = jest.fn();
    });

    it('should render section headers', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        expect(screen.getByText('項目1')).toBeInTheDocument();
        expect(screen.getByText('項目2')).toBeInTheDocument();
        expect(screen.getByText('項目3')).toBeInTheDocument();
    });

    it('should show section 1 expanded by default', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        // Section 1 fields should be visible
        expect(screen.getByText('一側足場')).toBeInTheDocument();
        expect(screen.getByText('本足場')).toBeInTheDocument();
    });

    it('should hide section 2 and 3 by default', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        // Section 2 fields should NOT be visible
        expect(screen.queryByText('シート')).not.toBeInTheDocument();
        // Section 3 fields should NOT be visible
        expect(screen.queryByText('親綱')).not.toBeInTheDocument();
    });

    it('should expand section 2 on click', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        fireEvent.click(screen.getByText('項目2'));
        expect(screen.getByText('シート')).toBeInTheDocument();
        expect(screen.getByText('階段')).toBeInTheDocument();
        expect(screen.getByText('タラップ')).toBeInTheDocument();
    });

    it('should expand section 3 on click', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        fireEvent.click(screen.getByText('項目3'));
        expect(screen.getByText('親綱')).toBeInTheDocument();
        expect(screen.getByText('養生カバークッション')).toBeInTheDocument();
        expect(screen.getByText('スペースチューブ')).toBeInTheDocument();
    });

    it('should collapse section 1 on click', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        // Section 1 is expanded. Click to collapse.
        fireEvent.click(screen.getByText('項目1'));
        expect(screen.queryByText('一側足場')).not.toBeInTheDocument();
    });

    it('should call setFormData when checkbox is toggled', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );

        // Find checkbox for "一側足場" (singleSideScaffold)
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // First checkbox = singleSideScaffold

        expect(mockSetFormData).toHaveBeenCalledWith(
            expect.objectContaining({
                scaffoldingSpec: expect.objectContaining({
                    singleSideScaffold: true,
                }),
            })
        );
    });

    it('should call setFormData when radio is selected', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );

        // Radio for outerHandrail: '1本' or '2本'
        const radioButtons = screen.getAllByRole('radio');
        fireEvent.click(radioButtons[0]); // First radio = '1本' for outerHandrail

        expect(mockSetFormData).toHaveBeenCalledWith(
            expect.objectContaining({
                scaffoldingSpec: expect.objectContaining({
                    outerHandrail: '1本',
                }),
            })
        );
    });

    it('should call setFormData when text field is changed', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );

        // Text field for "内手摺" (innerHandrail)
        const textInputs = screen.getAllByRole('textbox');
        fireEvent.change(textInputs[0], { target: { value: '3本' } });

        expect(mockSetFormData).toHaveBeenCalledWith(
            expect.objectContaining({
                scaffoldingSpec: expect.objectContaining({
                    innerHandrail: '3本',
                }),
            })
        );
    });

    it('should render all section 2 fields when expanded', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        fireEvent.click(screen.getByText('項目2'));

        expect(screen.getByText('シート')).toBeInTheDocument();
        expect(screen.getByText('イメージシート')).toBeInTheDocument();
        expect(screen.getByText('足場表示看板')).toBeInTheDocument();
        expect(screen.getByText('階段')).toBeInTheDocument();
        expect(screen.getByText('タラップ')).toBeInTheDocument();
        expect(screen.getByText('階段墜')).toBeInTheDocument();
        expect(screen.getByText('1・2コマアンチ')).toBeInTheDocument();
    });

    it('should update section 2 checkbox (sheet)', () => {
        render(
            <ScaffoldingSection formData={mockFormData} setFormData={mockSetFormData} />
        );
        fireEvent.click(screen.getByText('項目2'));

        // Get all checkboxes in section 2
        const checkboxes = screen.getAllByRole('checkbox');
        // Find the "シート" checkbox by looking for the label text
        const sheetCheckbox = checkboxes.find(cb => {
            const label = cb.closest('label');
            return label?.textContent?.includes('必要') &&
                cb.closest('.flex')?.textContent?.includes('シート');
        });

        if (sheetCheckbox) {
            fireEvent.click(sheetCheckbox);
            expect(mockSetFormData).toHaveBeenCalledWith(
                expect.objectContaining({
                    scaffoldingSpec: expect.objectContaining({
                        sheet: true,
                    }),
                })
            );
        }
    });
});
