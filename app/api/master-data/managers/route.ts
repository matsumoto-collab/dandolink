import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all managers
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const managers = await prisma.manager.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });

        return NextResponse.json(managers);
    } catch (error) {
        console.error('Failed to fetch managers:', error);
        return NextResponse.json({ error: 'Failed to fetch managers' }, { status: 500 });
    }
}

// POST: Create a new manager
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name } = body;

        if (!name || typeof name !== 'string') {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        const manager = await prisma.manager.create({
            data: { name: name.trim() },
        });

        return NextResponse.json(manager, { status: 201 });
    } catch (error) {
        console.error('Failed to create manager:', error);
        return NextResponse.json({ error: 'Failed to create manager' }, { status: 500 });
    }
}
