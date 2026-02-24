/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '@/app/(standalone)/login/page';

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
    signIn: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(() => ({
        push: jest.fn(),
        refresh: jest.fn(),
    })),
}));

// Mock lucide-react
jest.mock('lucide-react', () => ({
    Eye: (props: any) => <span data-testid="icon-eye" {...props} />,
    EyeOff: (props: any) => <span data-testid="icon-eyeoff" {...props} />,
    Lock: (props: any) => <span data-testid="icon-lock" {...props} />,
    User: (props: any) => <span data-testid="icon-user" {...props} />,
}));

// Mock Loading
jest.mock('@/components/ui/Loading', () => ({
    ButtonLoading: ({ size: _size }: { size?: string }) => <span data-testid="button-loading" />,
}));

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

describe('LoginPage', () => {
    const mockPush = jest.fn();
    const mockRefresh = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue({
            push: mockPush,
            refresh: mockRefresh,
        });
    });

    it('should render login form', () => {
        render(<LoginPage />);
        expect(screen.getByAltText('DandLink')).toBeInTheDocument();
        expect(screen.getByText('施工管理システム')).toBeInTheDocument();
        expect(screen.getByLabelText('ユーザー名')).toBeInTheDocument();
        expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
        expect(screen.getByText('ログイン')).toBeInTheDocument();
    });

    it('should render password toggle button', () => {
        render(<LoginPage />);
        const passwordInput = screen.getByLabelText('パスワード');
        expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('should toggle password visibility', () => {
        render(<LoginPage />);
        const passwordInput = screen.getByLabelText('パスワード');
        expect(passwordInput).toHaveAttribute('type', 'password');

        // Click the toggle button (the button inside the password field)
        const toggleButtons = screen.getAllByRole('button');
        const toggleBtn = toggleButtons.find(btn => btn.getAttribute('type') === 'button');
        if (toggleBtn) fireEvent.click(toggleBtn);
        expect(passwordInput).toHaveAttribute('type', 'text');
    });

    it('should update username and password inputs', () => {
        render(<LoginPage />);
        const usernameInput = screen.getByLabelText('ユーザー名');
        const passwordInput = screen.getByLabelText('パスワード');

        fireEvent.change(usernameInput, { target: { value: 'testuser' } });
        fireEvent.change(passwordInput, { target: { value: 'testpass' } });

        expect(usernameInput).toHaveValue('testuser');
        expect(passwordInput).toHaveValue('testpass');
    });

    it('should call signIn on form submit', async () => {
        (signIn as jest.Mock).mockResolvedValue({ ok: true });
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } });
        fireEvent.click(screen.getByText('ログイン'));

        await waitFor(() => {
            expect(signIn).toHaveBeenCalledWith('credentials', {
                username: 'admin',
                password: 'password',
                redirect: false,
            });
        });
    });

    it('should redirect after successful login', async () => {
        (signIn as jest.Mock).mockResolvedValue({ ok: true });
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } });
        fireEvent.click(screen.getByText('ログイン'));

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith('/');
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('should show error on login failure', async () => {
        (signIn as jest.Mock).mockResolvedValue({ error: 'Invalid credentials' });
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'bad' } });
        fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'bad' } });
        fireEvent.click(screen.getByText('ログイン'));

        await waitFor(() => {
            expect(screen.getByText('ユーザー名またはパスワードが正しくありません')).toBeInTheDocument();
        });
    });

    it('should show error on network exception', async () => {
        (signIn as jest.Mock).mockRejectedValue(new Error('Network error'));
        render(<LoginPage />);

        fireEvent.change(screen.getByLabelText('ユーザー名'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } });
        fireEvent.click(screen.getByText('ログイン'));

        await waitFor(() => {
            expect(screen.getByText('ログインに失敗しました')).toBeInTheDocument();
        });
    });

    it('should show info text', () => {
        render(<LoginPage />);
        expect(screen.getByText('ログインに問題がある場合は、管理者にお問い合わせください')).toBeInTheDocument();
    });
});
