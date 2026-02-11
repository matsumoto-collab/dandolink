/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CustomersPage from '@/app/(master)/customers/page';
import { useCustomers } from '@/hooks/useCustomers';

// Mock hooks
jest.mock('@/hooks/useCustomers');
jest.mock('react-hot-toast', () => ({
    success: jest.fn(),
    error: jest.fn(),
}));

// Mock CustomerModal (default export)
jest.mock('@/components/Customers/CustomerModal', () => {
    return function MockCustomerModal({ isOpen, onClose, onSubmit, title }: any) {
        if (!isOpen) return null;
        return (
            <div data-testid="customer-modal">
                <h2>{title}</h2>
                <button onClick={onClose}>Close</button>
                <button onClick={() => onSubmit({ name: 'New Customer' })}>Submit</button>
            </div>
        );
    };
});

// Mock Loading
jest.mock('@/components/ui/Loading', () => ({
    CardSkeleton: () => <div data-testid="card-skeleton" />,
}));

// Mock icons
jest.mock('lucide-react', () => ({
    Plus: () => <span data-testid="icon-plus" />,
    Search: () => <span data-testid="icon-search" />,
    Edit: () => <span data-testid="icon-edit" />,
    Trash2: () => <span data-testid="icon-trash" />,
    User: () => <span data-testid="icon-user" />,
    Mail: () => <span data-testid="icon-mail" />,
    Phone: () => <span data-testid="icon-phone" />,
    MapPin: () => <span data-testid="icon-map-pin" />,
}));

const mockCustomers = [
    {
        id: 'cust1',
        name: '株式会社テスト',
        shortName: 'テスト社',
        address: '東京都新宿区',
        phone: '03-0000-0000',
        contactPersons: [{ id: 'cp1', name: '担当者A', phone: '090-0000-0000' }],
    },
    {
        id: 'cust2',
        name: '有限会社サンプル',
        shortName: 'サンプル',
        address: '大阪府大阪市',
        phone: '06-0000-0000',
    },
];

describe('CustomersPage', () => {
    const mockAddCustomer = jest.fn();
    const mockUpdateCustomer = jest.fn();
    const mockDeleteCustomer = jest.fn();
    const mockEnsureDataLoaded = jest.fn();

    beforeEach(() => {
        (useCustomers as jest.Mock).mockReturnValue({
            customers: mockCustomers,
            isLoading: false,
            isInitialized: true,
            ensureDataLoaded: mockEnsureDataLoaded,
            addCustomer: mockAddCustomer,
            updateCustomer: mockUpdateCustomer,
            deleteCustomer: mockDeleteCustomer,
        });
        window.confirm = jest.fn(() => true);
    });

    it('should render customers list', () => {
        render(<CustomersPage />);
        expect(screen.getByText('顧客一覧')).toBeInTheDocument();
        expect(screen.getByText('株式会社テスト')).toBeInTheDocument();
        expect(screen.getByText('有限会社サンプル')).toBeInTheDocument();
    });

    it('should filter customers by search query', () => {
        render(<CustomersPage />);
        const searchInput = screen.getByPlaceholderText('顧客名または担当者名で検索...');
        fireEvent.change(searchInput, { target: { value: 'テスト' } });

        expect(screen.getByText('株式会社テスト')).toBeInTheDocument();
        expect(screen.queryByText('有限会社サンプル')).not.toBeInTheDocument();
    });

    it('should open modal on "New Customer" click', () => {
        render(<CustomersPage />);
        fireEvent.click(screen.getByText('新規登録'));
        expect(screen.getByTestId('customer-modal')).toBeInTheDocument();
        expect(screen.getByText('顧客登録')).toBeInTheDocument();
    });

    it('should handle edit customer click', () => {
        render(<CustomersPage />);
        // Find edit button for first customer
        const editButtons = screen.getAllByLabelText('編集');
        fireEvent.click(editButtons[0]);

        expect(screen.getByTestId('customer-modal')).toBeInTheDocument();
        expect(screen.getByText('顧客編集')).toBeInTheDocument();
    });

    it('should handle customer deletion', async () => {
        render(<CustomersPage />);
        const deleteButtons = screen.getAllByLabelText('削除');
        fireEvent.click(deleteButtons[0]);

        await waitFor(() => {
            expect(mockDeleteCustomer).toHaveBeenCalledWith('cust1');
        });
    });

    it('should submit new customer', async () => {
        render(<CustomersPage />);
        fireEvent.click(screen.getByText('新規登録'));
        fireEvent.click(screen.getByText('Submit'));

        await waitFor(() => {
            expect(mockAddCustomer).toHaveBeenCalledWith({ name: 'New Customer' });
        });
    });

    it('should show skeletons when loading', () => {
        (useCustomers as jest.Mock).mockReturnValue({
            customers: [],
            isLoading: true,
            isInitialized: false,
            ensureDataLoaded: mockEnsureDataLoaded,
        });
        render(<CustomersPage />);
        expect(screen.getAllByTestId('card-skeleton')).toHaveLength(6);
    });
});
