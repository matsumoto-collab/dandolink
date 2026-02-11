/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ConstructionTypeSettings from '@/components/Settings/ConstructionTypeSettings';
import { useMasterStore } from '@/stores/masterStore';
import toast from 'react-hot-toast';

// Mock dependencies
jest.mock('@/stores/masterStore');
jest.mock('react-hot-toast');

// Mock Lucide icons to avoid rendering issues if any (optional, but good practice)
jest.mock('lucide-react', () => ({
    Trash2: () => <span data-testid="icon-trash" />,
    Edit: () => <span data-testid="icon-edit" />,
    Plus: () => <span data-testid="icon-plus" />,
    Check: () => <span data-testid="icon-check" />,
    X: () => <span data-testid="icon-x" />,
    GripVertical: () => <span data-testid="icon-grip" />,
}));

describe('ConstructionTypeSettings', () => {
    const mockRefreshMasterData = jest.fn();
    const mockConstructionTypes = [
        { id: 'ct1', name: 'Assembly', color: '#ff0000' },
        { id: 'ct2', name: 'Demolition', color: '#00ff00' },
    ];

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock Store
        (useMasterStore as unknown as jest.Mock).mockImplementation((selector) => {
            return selector({
                refreshMasterData: mockRefreshMasterData,
            });
        });

        // Mock Fetch
        global.fetch = jest.fn();
    });

    it('should fetch and display construction types on load', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockConstructionTypes,
        });

        render(<ConstructionTypeSettings />);

        // Should start loading
        expect(screen.queryByText('Assembly')).not.toBeInTheDocument();

        // Wait for data load
        await waitFor(() => {
            expect(screen.getByText('Assembly')).toBeInTheDocument();
            expect(screen.getByText('Demolition')).toBeInTheDocument();
        });

        expect(global.fetch).toHaveBeenCalledWith('/api/master-data/construction-types');
    });

    it('should add a new construction type', async () => {
        // Initial load
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => [],
            })
            // Add request
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'new', name: 'New Type', color: '#000000' }),
            })
            // Refresh fetch
            .mockResolvedValueOnce({
                ok: true,
                json: async () => [{ id: 'new', name: 'New Type', color: '#000000' }],
            });

        render(<ConstructionTypeSettings />);

        // Wait for loading to finish and input to appear
        const input = await waitFor(() => screen.getByPlaceholderText(/新しい工事種別を追加/));

        fireEvent.change(input, { target: { value: 'New Type' } });

        const addButton = screen.getByText('追加');
        fireEvent.click(addButton);

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('工事種別を追加しました');
            expect(global.fetch).toHaveBeenCalledWith('/api/master-data/construction-types', expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"name":"New Type"'),
            }));
            expect(mockRefreshMasterData).toHaveBeenCalled();
        });
    });

    it('should edit a construction type', async () => {
        // Initial load
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockConstructionTypes,
        });

        // Update request
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({}),
        });

        // Refresh fetch
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [{ id: 'ct1', name: 'Updated Type', color: '#ff0000' }],
        });

        render(<ConstructionTypeSettings />);
        await waitFor(() => expect(screen.getByText('Assembly')).toBeInTheDocument());

        // Click edit on first item
        const editButtons = screen.getAllByTitle('編集');
        fireEvent.click(editButtons[0]);

        // Input should appear
        const input = screen.getByDisplayValue('Assembly');
        fireEvent.change(input, { target: { value: 'Updated Type' } });

        // Save
        const saveButton = screen.getByTitle('保存');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('工事種別を更新しました');
            expect(global.fetch).toHaveBeenCalledWith('/api/master-data/construction-types/ct1', expect.objectContaining({
                method: 'PATCH',
                body: expect.stringContaining('"name":"Updated Type"'),
            }));
        });
    });

    it('should delete a construction type', async () => {
        // Initial load
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockConstructionTypes,
        });

        // Delete request
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
        });

        // Refresh fetch
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => [mockConstructionTypes[1]], // only second one remains
        });

        render(<ConstructionTypeSettings />);
        await waitFor(() => expect(screen.getByText('Assembly')).toBeInTheDocument());

        // Click delete on first item
        const deleteButtons = screen.getAllByTitle('削除');
        fireEvent.click(deleteButtons[0]);

        // Confirm
        const confirmButton = screen.getByText('削除', { selector: 'button.bg-red-600' });
        fireEvent.click(confirmButton);

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('工事種別を削除しました');
            expect(global.fetch).toHaveBeenCalledWith('/api/master-data/construction-types/ct1', expect.objectContaining({
                method: 'DELETE',
            }));
        });
    });
});
