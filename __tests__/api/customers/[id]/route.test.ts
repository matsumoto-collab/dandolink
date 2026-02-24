/**
 * @jest-environment node
 */
import { PATCH, DELETE } from '@/app/api/customers/[id]/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove } from '@/lib/api/utils';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
    prisma: {
        customer: {
            findUnique: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        projectMaster: {
            count: jest.fn(),
        },
    },
}));

jest.mock('@/lib/api/utils', () => ({
    requireManagerOrAbove: jest.fn(),
    parseJsonField: (val: any) => val,
    stringifyJsonField: (val: any) => JSON.stringify(val),
    validationErrorResponse: jest.fn().mockImplementation((msg, details) => NextResponse.json({ error: msg, details }, { status: 400 })),
    notFoundResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ error: `${msg}が見つかりません` }, { status: 404 })),
    serverErrorResponse: jest.fn().mockImplementation((msg, error) => NextResponse.json({ error: msg, details: error }, { status: 500 })),
    deleteSuccessResponse: jest.fn().mockImplementation((msg) => NextResponse.json({ message: `${msg}を削除しました` }, { status: 200 })),
}));

describe('/api/customers/[id]', () => {
    const mockSession = { user: { id: 'user-1' } };
    const mockId = 'cust-1';
    const mockCustomer = {
        id: mockId,
        name: 'Test Customer',
        shortName: 'Test',
        contactPersons: '["Person A"]',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: mockSession, error: null });
    });

    describe('PATCH', () => {
        const updateBody = {
            name: 'Updated Customer',
            shortName: 'Updated',
            contactPersons: [{ name: 'Person B', position: 'Manager' }],
        };
        const createReq = (body: any) => new NextRequest(`http://localhost:3000/api/customers/${mockId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
        const context = { params: { id: mockId } };

        it('should update customer successfully', async () => {
            (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
            (prisma.customer.update as jest.Mock).mockResolvedValue({ ...mockCustomer, ...updateBody, contactPersons: JSON.stringify(updateBody.contactPersons) });

            const res = await PATCH(createReq(updateBody), context);
            const json = await res.json();

            expect(res.status).toBe(200);
            expect(json.name).toBe(updateBody.name);
            expect(prisma.customer.update).toHaveBeenCalled();
        });

        it('should return 404 if customer not found', async () => {
            (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(404);
        });

        it('should return 400 on validation error', async () => {
            const invalidBody = { name: '' }; // name is required
            const res = await PATCH(createReq(invalidBody), context);
            expect(res.status).toBe(400);
        });

        it('should return 401 if unauthorized', async () => {
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) });
            const res = await PATCH(createReq(updateBody), context);
            expect(res.status).toBe(401);
        });
    });

    describe('DELETE', () => {
        const createReq = () => new NextRequest(`http://localhost:3000/api/customers/${mockId}`, { method: 'DELETE' });
        const context = { params: { id: mockId } };

        it('should delete customer successfully', async () => {
            (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
            (prisma.projectMaster.count as jest.Mock).mockResolvedValue(0); // No references

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(200);
            expect(prisma.customer.delete).toHaveBeenCalledWith({ where: { id: mockId } });
        });

        it('should return 400 if customer is referenced by projects', async () => {
            (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
            (prisma.projectMaster.count as jest.Mock).mockResolvedValue(5); // Referenced

            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(400);
            expect(prisma.customer.delete).not.toHaveBeenCalled();
        });

        it('should return 404 if customer not found', async () => {
            (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await DELETE(createReq(), context);
            expect(res.status).toBe(404);
        });
    });
});
