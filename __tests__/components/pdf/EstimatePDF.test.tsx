/**
 * @jest-environment jsdom
 */
import React from 'react';
import { toReiwa } from '@/components/pdf/styles';

// Mock @react-pdf/renderer entirely
jest.mock('@react-pdf/renderer', () => ({
    Document: ({ children, ...props }: any) => <div data-testid="pdf-document" {...props}>{children}</div>,
    Page: ({ children, ...props }: any) => <div data-testid="pdf-page" {...props}>{children}</div>,
    Text: ({ children, ...props }: any) => <span data-testid="pdf-text" {...props}>{children}</span>,
    View: ({ children, ...props }: any) => <div data-testid="pdf-view" {...props}>{children}</div>,
    StyleSheet: { create: (s: any) => s },
    Font: { register: jest.fn() },
    Image: (props: any) => <img data-testid="pdf-image" {...props} />,
}));

describe('EstimatePDF', () => {
    describe('toReiwa helper', () => {
        it('should convert 2024 to 令和6年', () => {
            const date = new Date(2024, 5, 15); // June 15, 2024
            expect(toReiwa(date)).toBe('令和6年6月15日');
        });

        it('should convert 2019 to 令和1年', () => {
            const date = new Date(2019, 0, 1); // Jan 1, 2019
            expect(toReiwa(date)).toBe('令和1年1月1日');
        });

        it('should convert 2025 to 令和7年', () => {
            const date = new Date(2025, 11, 31); // Dec 31, 2025
            expect(toReiwa(date)).toBe('令和7年12月31日');
        });

        it('should handle month correctly (1-indexed)', () => {
            const date = new Date(2024, 0, 1); // Jan 1, 2024
            expect(toReiwa(date)).toBe('令和6年1月1日');
        });
    });

    describe('EstimatePDF component', () => {
        it('should be importable', async () => {
            const module = await import('@/components/pdf/EstimatePDF');
            expect(module.EstimatePDF).toBeDefined();
            expect(module.default).toBeDefined();
        });
    });
});
