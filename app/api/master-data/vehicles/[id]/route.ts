import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// PATCH: Update a vehicle
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const { name } = body;

        if (!name || typeof name !== 'string') {
            return NextResponse.json({ error: 'Name is required' }, { status: 400 });
        }

        const vehicle = await prisma.vehicle.update({
            where: { id },
            data: { name: name.trim() },
        });

        return NextResponse.json(vehicle);
    } catch (error) {
        console.error('Failed to update vehicle:', error);
        return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
    }
}

// DELETE: Soft delete a vehicle
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        await prisma.vehicle.update({
            where: { id },
            data: { isActive: false },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete vehicle:', error);
        return NextResponse.json({ error: 'Failed to delete vehicle' }, { status: 500 });
    }
}
