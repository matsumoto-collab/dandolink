/**
 * @jest-environment node
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    createInvoiceWithRetry,
    computeNextInvoiceNumber,
    isInvoiceNumberConflict,
} from '@/lib/billing/createInvoiceWithRetry';

function makeP2002(target: string[] = ['invoiceNumber']) {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target },
    });
}

describe('createInvoiceWithRetry', () => {
    const YEAR = new Date().getFullYear();

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
    });

    describe('computeNextInvoiceNumber', () => {
        it('starts at 0001 when no invoice exists for the year', async () => {
            (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
            await expect(computeNextInvoiceNumber(prisma as never)).resolves.toBe(`I${YEAR}0001`);
        });

        it('increments from the latest invoiceNumber', async () => {
            (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({ invoiceNumber: `I${YEAR}0007` });
            await expect(computeNextInvoiceNumber(prisma as never)).resolves.toBe(`I${YEAR}0008`);
        });
    });

    it('takes an advisory lock and runs once on success', async () => {
        const run = jest.fn(async (_tx, invoiceNumber: string) => ({ invoiceNumber }));
        const result = await createInvoiceWithRetry(run);

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ invoiceNumber: `I${YEAR}0001` });
    });

    it('retries in a fresh transaction on an invoiceNumber conflict (P2002)', async () => {
        const run = jest
            .fn()
            .mockRejectedValueOnce(makeP2002())
            .mockResolvedValueOnce({ ok: true });

        const result = await createInvoiceWithRetry(run, 5);

        expect(run).toHaveBeenCalledTimes(2);
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('throws immediately on a non-P2002 error (no retry)', async () => {
        const run = jest.fn().mockRejectedValue(new Error('boom'));
        await expect(createInvoiceWithRetry(run, 5)).rejects.toThrow('boom');
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('does not retry on a P2002 unrelated to invoiceNumber', async () => {
        const run = jest.fn().mockRejectedValue(makeP2002(['someOtherField']));
        await expect(createInvoiceWithRetry(run, 5)).rejects.toBeDefined();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('gives up after maxRetries consecutive conflicts', async () => {
        const err = makeP2002();
        const run = jest.fn().mockRejectedValue(err);
        await expect(createInvoiceWithRetry(run, 3)).rejects.toBe(err);
        expect(run).toHaveBeenCalledTimes(3);
    });

    it('isInvoiceNumberConflict detects only invoiceNumber P2002', () => {
        expect(isInvoiceNumberConflict(makeP2002())).toBe(true);
        expect(isInvoiceNumberConflict(makeP2002(['otherField']))).toBe(false);
        expect(isInvoiceNumberConflict(new Error('x'))).toBe(false);
    });
});
