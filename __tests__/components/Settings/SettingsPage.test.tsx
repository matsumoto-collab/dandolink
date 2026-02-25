/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPage from '@/app/(master)/settings/page';
import { useSession } from 'next-auth/react';
import { useMasterData } from '@/hooks/useMasterData';
import toast from 'react-hot-toast';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/hooks/useMasterData');
jest.mock('react-hot-toast');

// Mock child components to verify authorized verify rendering without complex logic
jest.mock('@/components/Settings/ConstructionTypeSettings', () => () => <div data-testid="construction-type-settings">ConstructionTypeSettings</div>);
jest.mock('@/components/Settings/UnitPriceMasterSettings', () => () => <div data-testid="unit-price-settings">UnitPriceMasterSettings</div>);
jest.mock('@/components/Settings/CompanyInfoSettings', () => () => <div data-testid="company-info-settings">CompanyInfoSettings</div>);
jest.mock('@/components/Settings/UserManagement', () => () => <div data-testid="user-management">UserManagement</div>);

describe('SettingsPage', () => {
    // Mock Data
    const mockVehicles = [{ id: 'v1', name: 'Vehicle 1' }];
    const mockManagers = [{ id: 'm1', name: 'Manager 1' }];

    // Mock Actions
    const mockAddVehicle = jest.fn();
    const mockUpdateVehicle = jest.fn();
    const mockDeleteVehicle = jest.fn();
    const mockAddManager = jest.fn();
    const mockUpdateManager = jest.fn();
    const mockDeleteManager = jest.fn();
    const mockUpdateTotalMembers = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();

        // Default Session Mock (Admin)
        (useSession as jest.Mock).mockReturnValue({
            data: { user: { role: 'admin' } },
            status: 'authenticated',
        });

        // Default useMasterData Mock
        (useMasterData as jest.Mock).mockReturnValue({
            vehicles: mockVehicles,
            managers: mockManagers,
            totalMembers: 10,
            addVehicle: mockAddVehicle,
            updateVehicle: mockUpdateVehicle,
            deleteVehicle: mockDeleteVehicle,
            addManager: mockAddManager,
            updateManager: mockUpdateManager,
            deleteManager: mockDeleteManager,
            updateTotalMembers: mockUpdateTotalMembers,
        });
    });

    it('should render all tabs for admin user', () => {
        render(<SettingsPage />);

        expect(screen.getByText('車両管理')).toBeInTheDocument();
        expect(screen.getByText('総メンバー数設定')).toBeInTheDocument();
        expect(screen.getByText('工事種別')).toBeInTheDocument();
        expect(screen.getByText('単価マスター')).toBeInTheDocument();
        expect(screen.getByText('ユーザー管理')).toBeInTheDocument();
    });

    it('should not render user management tab for non-admin user', () => {
        (useSession as jest.Mock).mockReturnValue({
            data: { user: { role: 'user' } },
            status: 'authenticated',
        });

        render(<SettingsPage />);

        expect(screen.queryByText('ユーザー管理')).not.toBeInTheDocument();
    });

    it('should switch tabs and render content', () => {
        render(<SettingsPage />);

        // Default is Vehicles
        expect(screen.getByText('車両一覧')).toBeInTheDocument();
        expect(screen.getByText('Vehicle 1')).toBeInTheDocument();

        // Switch to Sub-components
        fireEvent.click(screen.getByText('工事種別'));
        expect(screen.getByTestId('construction-type-settings')).toBeInTheDocument();
    });

    it('should add a new vehicle', () => {
        render(<SettingsPage />);

        // Ensure we are on key vehicle tab
        const input = screen.getByPlaceholderText('新しい車両を追加');
        fireEvent.change(input, { target: { value: 'New Vehicle' } });
        fireEvent.click(screen.getByText('追加'));

        expect(mockAddVehicle).toHaveBeenCalledWith('New Vehicle');
    });

    it('should update total members', () => {
        render(<SettingsPage />);

        fireEvent.click(screen.getByText('総メンバー数設定'));

        const input = screen.getByPlaceholderText('人数を入力');
        fireEvent.change(input, { target: { value: '20' } });
        fireEvent.click(screen.getByText('保存'));

        expect(mockUpdateTotalMembers).toHaveBeenCalledWith(20);
        expect(toast.success).toHaveBeenCalled();
    });

    it('should handle edit mode cancellation', () => {
        render(<SettingsPage />);

        // Click edit button for Vehicle 1
        const editButtons = screen.getAllByTitle('編集');
        fireEvent.click(editButtons[0]);

        // Verify edit input appears
        const editInput = screen.getByDisplayValue('Vehicle 1');
        expect(editInput).toBeInTheDocument();

        // Click cancel
        const cancelButton = screen.getByTitle('キャンセル');
        fireEvent.click(cancelButton);

        // Verify revert to text
        expect(screen.queryByDisplayValue('Vehicle 1')).not.toBeInTheDocument();
        expect(screen.getByText('Vehicle 1')).toBeInTheDocument();
    });

    it('should delete an item', () => {
        render(<SettingsPage />);

        // Click delete button for Vehicle 1
        const deleteButtons = screen.getAllByTitle('削除');
        fireEvent.click(deleteButtons[0]);

        // Confirm delete (second click on "削除" in confirmation UI)
        const confirmDeleteButton = screen.getByText('削除', { selector: 'button.bg-slate-700' });
        fireEvent.click(confirmDeleteButton);

        expect(mockDeleteVehicle).toHaveBeenCalledWith('v1');
    });
});
