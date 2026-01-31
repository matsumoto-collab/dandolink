import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ForemanSelector from '@/components/Calendar/ForemanSelector';

// Mock dependencies
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({
        data: { user: { name: 'Test User', email: 'test@example.com' } },
        status: 'authenticated',
    })),
    SessionProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock hook
const mockAddForeman = jest.fn();
const mockGetAvailableForemen = jest.fn();

jest.mock('@/hooks/useCalendarDisplay', () => ({
    useCalendarDisplay: () => ({
        getAvailableForemen: mockGetAvailableForemen,
        addForeman: mockAddForeman,
    }),
}));

const mockForemen = [
    { id: 'f1', name: 'Foreman 1', role: 'foreman' },
    { id: 'f2', name: 'Foreman 2', role: 'foreman' },
];

describe('ForemanSelector', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAvailableForemen.mockReturnValue(mockForemen);

        // Ensure fetch returns array by default to avoid filter errors in hooks if any
        (global.fetch as jest.Mock) = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            })
        );
    });

    it('renders add button when foremen are available', async () => {
        await act(async () => {
            render(<ForemanSelector />);
        });

        expect(screen.getByText('職長を追加')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /職長を追加/ })).not.toBeDisabled();
    });

    it('opens dropdown and shows foremen on click', async () => {
        await act(async () => {
            render(<ForemanSelector />);
        });

        // Open dropdown
        fireEvent.click(screen.getByText('職長を追加'));

        expect(screen.getByText('Foreman 1')).toBeInTheDocument();
        expect(screen.getByText('Foreman 2')).toBeInTheDocument();
    });

    it('calls addForeman when foreman is selected', async () => {
        await act(async () => {
            render(<ForemanSelector />);
        });

        // Open dropdown
        fireEvent.click(screen.getByText('職長を追加'));

        // Select foreman
        fireEvent.click(screen.getByText('Foreman 1'));

        expect(mockAddForeman).toHaveBeenCalledWith('f1');
    });

    it('disables button when no foremen available', async () => {
        mockGetAvailableForemen.mockReturnValue([]);

        await act(async () => {
            render(<ForemanSelector />);
        });

        expect(screen.getByRole('button', { name: /職長を追加/ })).toBeDisabled();
    });
});
