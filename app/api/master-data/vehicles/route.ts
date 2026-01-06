import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all vehicles
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const vehicles = await prisma.vehicle.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });

        return NextResponse.json(vehicles);
    } catch (error) {
        console.error('Failed to fetch vehicles:', error);
        return NextResponse.json({ error: 'Failed to fetch vehicles' }, { status: 500 });
    }
}

// POST: Create a new vehicle
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

        const vehicle = await prisma.vehicle.create({
            data: { name: name.trim() },
        });

        return NextResponse.json(vehicle, { status: 201 });
    } catch (error) {
        console.error('Failed to create vehicle:', error);
        return NextResponse.json({ error: 'Failed to create vehicle' }, { status: 500 });
    }
}
