import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all workers
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const workers = await prisma.worker.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });

        return NextResponse.json(workers);
    } catch (error) {
        console.error('Failed to fetch workers:', error);
        return NextResponse.json({ error: 'Failed to fetch workers' }, { status: 500 });
    }
}

// POST: Create a new worker
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

        const worker = await prisma.worker.create({
            data: { name: name.trim() },
        });

        return NextResponse.json(worker, { status: 201 });
    } catch (error) {
        console.error('Failed to create worker:', error);
        return NextResponse.json({ error: 'Failed to create worker' }, { status: 500 });
    }
}
