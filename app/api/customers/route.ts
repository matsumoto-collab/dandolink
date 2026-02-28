import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createCustomerSchema, validateRequest } from '@/lib/validations';
import {
    requireAuth,
    requireManagerOrAbove,
    parseJsonField,
    stringifyJsonField,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';

// 顧客レコードのJSONフィールドをパース
function parseCustomer<T extends { contactPersons: string | null }>(customer: T) {
    return {
        ...customer,
        contactPersons: parseJsonField(customer.contactPersons, []),
    };
}

/**
 * Get all customers
 * GET /api/customers
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        // ページネーションあり
        if (page && limit) {
            const pageNum = parseInt(page, 10);
            const limitNum = parseInt(limit, 10);
            if (isNaN(pageNum) || isNaN(limitNum) || pageNum < 1 || limitNum < 1) {
                return validationErrorResponse('無効なページネーションパラメータです');
            }
            const skip = (pageNum - 1) * limitNum;

            const [customers, total] = await Promise.all([
                prisma.customer.findMany({
                    skip,
                    take: limitNum,
                    orderBy: { name: 'asc' },
                }),
                prisma.customer.count(),
            ]);

            return NextResponse.json({
                data: customers.map(parseCustomer),
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        // 全件取得
        const customers = await prisma.customer.findMany({
            orderBy: { name: 'asc' },
        });

        return NextResponse.json(customers.map(parseCustomer), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('顧客一覧の取得', error);
    }
}

/**
 * Create a new customer
 * POST /api/customers
 */
export async function POST(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();

        // Zodバリデーション
        const validation = validateRequest(createCustomerSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const { name, shortName, honorific, contactPersons, email, phone, fax, address, notes } = validation.data;

        const newCustomer = await prisma.customer.create({
            data: {
                name,
                shortName: shortName || null,
                honorific: honorific || '御中',
                contactPersons: stringifyJsonField(contactPersons),
                email: email || null,
                phone: phone || null,
                fax: fax || null,
                address: address || null,
                notes: notes || null,
            },
        });

        return NextResponse.json(parseCustomer(newCustomer));
    } catch (error) {
        return serverErrorResponse('顧客の作成', error);
    }
}
