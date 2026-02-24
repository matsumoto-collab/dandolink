/**
 * @jest-environment node
 */
import { GET, POST } from '@/app/api/customers/route';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

describe('/api/customers', () => {
    const mockSession = {
        user: { id: 'user-1', role: 'manager', isActive: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireAuth as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('GET', () => {
        it('should return customers list', async () => {
            const mockCustomers = [
                { id: '1', name: 'Customer 1', contactPersons: '[]', createdAt: new Date() },
            ];
            (prisma.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);

            const req = new NextRequest('http://localhost:3000/api/customers');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toHaveLength(1);
            expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
                orderBy: { name: 'asc' }
            }));
        });

        it('should handle pagination', async () => {
            (prisma.customer.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.customer.count as jest.Mock).mockResolvedValue(0);

            const req = new NextRequest('http://localhost:3000/api/customers?page=1&limit=10');
            const res = await GET(req);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.data).toEqual([]);
            expect(json.pagination).toBeDefined();
            expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
                skip: 0,
                take: 10
            }));
        });
    });

    describe('POST', () => {
        const validBody = {
            name: 'New Customer',
            shortName: 'NC',
            contactPersons: [],
        };

        it('should create a customer', async () => {
            const createdCustomer = { id: 'new-1', ...validBody, contactPersons: '[]', createdAt: new Date(), updatedAt: new Date() };
            (prisma.customer.create as jest.Mock).mockResolvedValue(createdCustomer);

            const req = new NextRequest('http://localhost:3000/api/customers', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);

            expect(res.status).toBe(200);
            expect(prisma.customer.create).toHaveBeenCalled();
        });

        it('should return 400 validation error', async () => {
            const invalidBody = { ...validBody, name: undefined };

            const req = new NextRequest('http://localhost:3000/api/customers', {
                method: 'POST',
                body: JSON.stringify(invalidBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(400);
        });

        it('should return 401 if not authenticated', async () => {
            const errorRes = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: errorRes });

            const req = new NextRequest('http://localhost:3000/api/customers', {
                method: 'POST',
                body: JSON.stringify(validBody),
            });

            const res = await POST(req);
            expect(res.status).toBe(401);
        });
    });
});
