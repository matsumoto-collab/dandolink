import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserManagement from '@/components/Settings/UserManagement';

// Mock UserModal to simplify testing (integration test style)
jest.mock('@/components/Settings/UserModal', () => {
    return function MockUserModal({ isOpen, onSave, onClose, mode }: any) {
        if (!isOpen) return null;
        return (
            <div data-testid="user-modal">
                <h2>{mode === 'create' ? 'ユーザー追加' : 'ユーザー編集'}</h2>
                <button
                    onClick={() => {
                        onSave({ displayName: 'New User', email: 'new@example.com', username: 'newuser', role: 'worker' });
                        onClose();
                    }}
                >
                    Save
                </button>
                <button onClick={onClose}>Close</button>
            </div>
        );
    };
});

// Mock react-hot-toast
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
}));

const mockUsers = [
    { id: 'u1', username: 'user1', displayName: 'User 1', email: 'u1@example.com', role: 'admin', isActive: true },
    { id: 'u2', username: 'user2', displayName: 'User 2', email: 'u2@example.com', role: 'worker', isActive: true },
];

const mockFetch = jest.fn((url: string, options?: any): Promise<any> => {
    if (url === '/api/users' && (!options || options.method === 'GET')) {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockUsers),
        });
    }
    if (url === '/api/users' && options.method === 'POST') {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });
    }
    if (url.startsWith('/api/users/') && options.method === 'DELETE') {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });
    }
    // Default fallback
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([])
    });
});

global.fetch = mockFetch as jest.Mock;

describe('UserManagement', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockClear();
    });

    it('renders user list correctly', async () => {
        render(<UserManagement />);

        // Wait for loading to finish
        await waitFor(() => {
            expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument();
        });

        expect(screen.getAllByText('ユーザー管理')[0]).toBeInTheDocument();
        expect(screen.getByText('User 1')).toBeInTheDocument();
        expect(screen.getByText('User 2')).toBeInTheDocument();
    });

    it('opens create modal when add button is clicked', async () => {
        render(<UserManagement />);

        await waitFor(() => {
            expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument();
        });

        const addButton = screen.getByRole('button', { name: /ユーザー追加/i });
        fireEvent.click(addButton);

        expect(screen.getByTestId('user-modal')).toBeInTheDocument();
    });

    it('handles fetch error gracefully', async () => {
        mockFetch.mockImplementationOnce(() => Promise.reject('API Error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        render(<UserManagement />);

        await waitFor(() => {
            expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument();
        });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch users'), 'API Error');
        consoleSpy.mockRestore();
    });
});
