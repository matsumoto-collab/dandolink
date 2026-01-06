import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all unit prices
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const unitPrices = await prisma.unitPriceMaster.findMany({
            where: { isActive: true },
            orderBy: { description: 'asc' },
        });

        // Parse templates JSON string to array
        const parsed = unitPrices.map(up => ({
            ...up,
            templates: JSON.parse(up.templates || '[]'),
        }));

        return NextResponse.json(parsed);
    } catch (error) {
        console.error('Failed to fetch unit prices:', error);
        return NextResponse.json({ error: 'Failed to fetch unit prices' }, { status: 500 });
    }
}

// POST: Create a new unit price
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { description, unit, unitPrice, category, templates, notes } = body;

        if (!description || !unit || unitPrice === undefined || !category || !templates) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const newUnitPrice = await prisma.unitPriceMaster.create({
            data: {
                description,
                unit,
                unitPrice,
                category,
                templates: JSON.stringify(templates),
                notes: notes || null,
            },
        });

        return NextResponse.json({
            ...newUnitPrice,
            templates: JSON.parse(newUnitPrice.templates),
        }, { status: 201 });
    } catch (error) {
        console.error('Failed to create unit price:', error);
        return NextResponse.json({ error: 'Failed to create unit price' }, { status: 500 });
    }
}
