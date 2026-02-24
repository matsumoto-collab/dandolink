/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserModal from '@/components/Settings/UserModal';
import { User } from '@/types/user';

// Mock ButtonLoading
jest.mock('@/components/ui/Loading', () => ({
    ButtonLoading: () => <div data-testid="button-loading">Loading...</div>,
}));

// Mock icons
jest.mock('lucide-react', () => ({
    X: () => <span data-testid="icon-x" />,
}));

describe('UserModal', () => {
    const mockOnClose = jest.fn();
    const mockOnSave = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should prompt to create a new user', () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                mode="create"
            />
        );

        expect(screen.getByText('ユーザー追加')).toBeInTheDocument();
        expect(screen.getByText('追加')).toBeInTheDocument();
        // Password required asterisk
        const passwordLabel = screen.getByText('パスワード');
        expect(passwordLabel).toContainHTML('<span class="text-slate-500">*</span>');
    });

    it('should fill form with user data in edit mode', () => {
        const mockUser: User = {
            id: 'u1',
            username: 'testuser',
            email: 'test@example.com',
            displayName: 'Test User',
            role: 'manager',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                user={mockUser}
                mode="edit"
            />
        );

        expect(screen.getByText('ユーザー編集')).toBeInTheDocument();
        expect(screen.getByDisplayValue('testuser')).toBeInTheDocument();
        expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        expect(screen.getByDisplayValue('マネージャー')).toBeInTheDocument();

        // Username should be disabled
        expect(screen.getByDisplayValue('testuser')).toBeDisabled();
    });

    it('should validate required fields', async () => {
        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                mode="create"
            />
        );

        // Submit empty form (HTML5 validation will stop it, but we can check if onSave is NOT called)
        const submitButton = screen.getByText('追加');
        fireEvent.click(submitButton);

        expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should call onSave with correct data when creating', async () => {
        mockOnSave.mockResolvedValue(undefined);

        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                mode="create"
            />
        );

        fireEvent.change(screen.getByLabelText(/ユーザー名/), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'New User' } });
        fireEvent.change(screen.getByLabelText(/^パスワード/), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText(/ロール/), { target: { value: 'worker' } });

        fireEvent.click(screen.getByText('追加'));

        await waitFor(() => {
            expect(mockOnSave).toHaveBeenCalledWith({
                username: 'newuser',
                email: 'new@example.com',
                displayName: 'New User',
                password: 'password123',
                role: 'worker',
                isActive: true,
                assignedProjects: [],
            });
            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    it('should call onSave with partial data when editing', async () => {
        const mockUser: User = {
            id: 'u1',
            username: 'testuser',
            email: 'test@example.com',
            displayName: 'Test User',
            role: 'manager',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        mockOnSave.mockResolvedValue(undefined);

        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                user={mockUser}
                mode="edit"
            />
        );

        fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'Updated User' } });

        fireEvent.click(screen.getByText('更新'));

        await waitFor(() => {
            const calledArg = mockOnSave.mock.calls[0][0];
            expect(calledArg.displayName).toBe('Updated User');
            expect(calledArg.username).toBeUndefined(); // Username not included in edit
            expect(calledArg.password).toBeUndefined(); // Password not changed
        });
    });

    it('should display error message on failure', async () => {
        mockOnSave.mockRejectedValue(new Error('Duplicate username'));

        render(
            <UserModal
                isOpen={true}
                onClose={mockOnClose}
                onSave={mockOnSave}
                mode="create"
            />
        );

        // Fill required fields to bypass HTML validation
        fireEvent.change(screen.getByLabelText(/ユーザー名/), { target: { value: 'newuser' } });
        fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'a@b.com' } });
        fireEvent.change(screen.getByLabelText(/表示名/), { target: { value: 'A' } });
        fireEvent.change(screen.getByLabelText(/^パスワード/), { target: { value: 'p' } });

        fireEvent.click(screen.getByText('追加'));

        // Wait for error
        await waitFor(() => {
            expect(screen.getByText('Duplicate username')).toBeInTheDocument();
        });
    });
});
