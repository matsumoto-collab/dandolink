import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Get all customers
 * GET /api/customers
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        // Get pagination parameters
        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page');
        const limit = searchParams.get('limit');

        // If pagination params are provided, return paginated data
        if (page && limit) {
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;

            const [customers, total] = await Promise.all([
                prisma.customer.findMany({
                    skip,
                    take: limitNum,
                    orderBy: { name: 'asc' },
                }),
                prisma.customer.count(),
            ]);

            const parsedCustomers = customers.map((customer: any) => ({
                ...customer,
                contactPersons: customer.contactPersons ? JSON.parse(customer.contactPersons) : [],
            }));

            return NextResponse.json({
                data: parsedCustomers,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    totalPages: Math.ceil(total / limitNum),
                },
            });
        }

        // Otherwise, return all data
        const customers = await prisma.customer.findMany({
            orderBy: {
                name: 'asc',
            },
        });

        // Parse JSON fields
        const parsedCustomers = customers.map((customer: any) => ({
            ...customer,
            contactPersons: customer.contactPersons ? JSON.parse(customer.contactPersons) : [],
        }));

        return NextResponse.json(parsedCustomers);
    } catch (error) {
        console.error('Get customers error:', error);
        return NextResponse.json(
            { error: '顧客一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

/**
 * Create a new customer
 * POST /api/customers
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }

        const body = await req.json();
        const {
            name,
            shortName,
            contactPersons,
            email,
            phone,
            fax,
            address,
            notes,
        } = body;

        // Validation
        if (!name) {
            return NextResponse.json(
                { error: '会社名は必須です' },
                { status: 400 }
            );
        }

        // Create customer
        const newCustomer = await prisma.customer.create({
            data: {
                name,
                shortName: shortName || null,
                contactPersons: contactPersons ? JSON.stringify(contactPersons) : null,
                email: email || null,
                phone: phone || null,
                fax: fax || null,
                address: address || null,
                notes: notes || null,
            },
        });

        // Parse JSON fields for response
        const response = {
            ...newCustomer,
            contactPersons: newCustomer.contactPersons ? JSON.parse(newCustomer.contactPersons) : [],
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Create customer error:', error);
        return NextResponse.json(
            { error: '顧客の作成に失敗しました' },
            { status: 500 }
        );
    }
}
