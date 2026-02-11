/**
 * @jest-environment jsdom
 */
import React from 'react';

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

describe('InvoicePDF', () => {
    describe('InvoicePDF component', () => {
        it('should be importable', async () => {
            const module = await import('@/components/pdf/InvoicePDF');
            expect(module.InvoicePDF).toBeDefined();
            expect(module.default).toBeDefined();
        });
    });
});
