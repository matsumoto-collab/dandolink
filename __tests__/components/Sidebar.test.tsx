import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '@/components/Sidebar';

// lucide-react モック


// next-auth モック
const mockSignOut = jest.fn();
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: {
            user: { id: 'user-1', name: 'テストユーザー', role: 'admin' },
        },
    }),
    signOut: (opts: unknown) => mockSignOut(opts),
}));

// NavigationContext モック
const mockSetActivePage = jest.fn();
const mockCloseMobileMenu = jest.fn();
jest.mock('@/contexts/NavigationContext', () => ({
    useNavigation: () => ({
        activePage: 'schedule',
        setActivePage: mockSetActivePage,
        isMobileMenuOpen: false,
        closeMobileMenu: mockCloseMobileMenu,
    }),
}));

describe('Sidebar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('ナビゲーション表示', () => {
        it('業務管理セクションを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('業務管理')).toBeInTheDocument();
        });

        it('書類・経理セクションを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('書類・経理')).toBeInTheDocument();
        });

        it('マスター・設定セクションを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('マスター・設定')).toBeInTheDocument();
        });

        it('スケジュール管理リンクを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('スケジュール管理')).toBeInTheDocument();
        });

        it('見積書リンクを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('見積書')).toBeInTheDocument();
        });

        it('請求書リンクを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('請求書')).toBeInTheDocument();
        });

        it('設定リンクを表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('設定')).toBeInTheDocument();
        });
    });

    describe('ナビゲーション操作', () => {
        it('リンククリックでsetActivePageが呼ばれる', () => {
            render(<Sidebar />);
            fireEvent.click(screen.getByText('見積書'));
            expect(mockSetActivePage).toHaveBeenCalledWith('estimates');
        });

        it('リンククリックでcloseMobileMenuが呼ばれる', () => {
            render(<Sidebar />);
            fireEvent.click(screen.getByText('請求書'));
            expect(mockCloseMobileMenu).toHaveBeenCalled();
        });
    });

    describe('ユーザー情報', () => {
        it('ユーザー名を表示する', () => {
            render(<Sidebar />);
            expect(screen.getByText('テストユーザー')).toBeInTheDocument();
        });
    });
});
