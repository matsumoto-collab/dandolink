import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/Header';

// lucide-react モック
jest.mock('lucide-react', () => ({
    Menu: () => <svg data-testid="menu-icon" />,
}));

// NavigationContext モック
const mockToggleMobileMenu = jest.fn();
jest.mock('@/contexts/NavigationContext', () => ({
    useNavigation: () => ({
        toggleMobileMenu: mockToggleMobileMenu,
    }),
}));

describe('Header', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('タイトルを表示する', () => {
        render(<Header />);
        expect(screen.getByAltText('DandLink')).toBeInTheDocument();
    });

    it('メニューボタンを表示する', () => {
        render(<Header />);
        expect(screen.getByRole('button', { name: 'メニューを開く' })).toBeInTheDocument();
    });

    it('メニューボタンクリックでtoggleMobileMenuが呼ばれる', () => {
        render(<Header />);
        fireEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
        expect(mockToggleMobileMenu).toHaveBeenCalledTimes(1);
    });

    it('メニューアイコンが表示される', () => {
        render(<Header />);
        expect(screen.getByTestId('menu-icon')).toBeInTheDocument();
    });
});
