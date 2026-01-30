import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '@/contexts/NavigationContext';

// Test component to access context
function TestComponent() {
    const {
        activePage,
        setActivePage,
        isMobileMenuOpen,
        toggleMobileMenu,
        closeMobileMenu,
    } = useNavigation();

    return (
        <div>
            <span data-testid="active-page">{activePage}</span>
            <span data-testid="mobile-menu-open">{isMobileMenuOpen.toString()}</span>
            <button onClick={() => setActivePage('customers')}>Go to Customers</button>
            <button onClick={toggleMobileMenu}>Toggle Menu</button>
            <button onClick={closeMobileMenu}>Close Menu</button>
        </div>
    );
}

describe('NavigationContext', () => {
    describe('NavigationProvider', () => {
        it('should provide default activePage as schedule', () => {
            render(
                <NavigationProvider>
                    <TestComponent />
                </NavigationProvider>
            );

            expect(screen.getByTestId('active-page')).toHaveTextContent('schedule');
        });

        it('should provide default isMobileMenuOpen as false', () => {
            render(
                <NavigationProvider>
                    <TestComponent />
                </NavigationProvider>
            );

            expect(screen.getByTestId('mobile-menu-open')).toHaveTextContent('false');
        });

        it('should allow setting activePage', () => {
            render(
                <NavigationProvider>
                    <TestComponent />
                </NavigationProvider>
            );

            act(() => {
                screen.getByText('Go to Customers').click();
            });

            expect(screen.getByTestId('active-page')).toHaveTextContent('customers');
        });

        it('should toggle mobile menu', () => {
            render(
                <NavigationProvider>
                    <TestComponent />
                </NavigationProvider>
            );

            expect(screen.getByTestId('mobile-menu-open')).toHaveTextContent('false');

            act(() => {
                screen.getByText('Toggle Menu').click();
            });

            expect(screen.getByTestId('mobile-menu-open')).toHaveTextContent('true');

            act(() => {
                screen.getByText('Toggle Menu').click();
            });

            expect(screen.getByTestId('mobile-menu-open')).toHaveTextContent('false');
        });

        it('should close mobile menu', () => {
            render(
                <NavigationProvider>
                    <TestComponent />
                </NavigationProvider>
            );

            // Open menu first
            act(() => {
                screen.getByText('Toggle Menu').click();
            });
            expect(screen.getByTestId('mobile-menu-open')).toHaveTextContent('true');

            // Close menu
            act(() => {
                screen.getByText('Close Menu').click();
            });
            expect(screen.getByTestId('mobile-menu-open')).toHaveTextContent('false');
        });
    });

    describe('useNavigation', () => {
        it('should throw error when used outside provider', () => {
            // Suppress console.error for this test
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            expect(() => {
                render(<TestComponent />);
            }).toThrow('useNavigation must be used within a NavigationProvider');

            consoleSpy.mockRestore();
        });
    });
});
