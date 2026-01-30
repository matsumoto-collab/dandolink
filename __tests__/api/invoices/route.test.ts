/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/invoices/route';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/invoices', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should return invoices list', async () => {
            const mockInvoices = [
                { id: '1', invoiceNumber: 'INV-001', items: '[]', createdAt: new Date(), dueDate: new Date() },
            ];
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue(mockInvoices);

            const req = new NextRequest('http://localhost:3000/api/invoices');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);
        });

        it('should handle pagination', async () => {
            (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.invoice.count as jest.Mock).mockResolvedValue(0);

            const req = new NextRequest('http://localhost:3000/api/invoices?page=1&limit=10');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.data).toEqual([]);
        });
    });

    describe('POST', () => {
        const validBody = {
            projectMasterId: 'pm-1',
            invoiceNumber: 'INV-001',
            title: 'Invoice 1',
            items: [],
            subtotal: 1000,
            tax: 100,
            total: 1100,
            dueDate: '2023-01-31',
        };

        it('should create an invoice', async () => {
            const createdInvoice = {
                id: 'new-1',
                ...validBody,
                items: JSON.stringify(validBody.items),
                createdAt: new Date(),
                updatedAt: new Date(),
                dueDate: new Date(validBody.dueDate)
            };
            (prisma.invoice.create as jest.Mock).mockResolvedValue(createdInvoice);

            const req = new NextRequest('http://localhost:3000/api/invoices', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.invoice.create).toHaveBeenCalled();
        });

        it('should return 400 validation error for missing fields', async () => {
            const invalidBody = { ...validBody, invoiceNumber: undefined };

            const req = new NextRequest('http://localhost:3000/api/invoices', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
        });
    });
});
