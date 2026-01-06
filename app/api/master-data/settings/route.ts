import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch system settings
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let settings = await prisma.systemSettings.findFirst({
            where: { id: 'default' },
        });

        // Create default settings if not exist
        if (!settings) {
            settings = await prisma.systemSettings.create({
                data: { id: 'default', totalMembers: 20 },
            });
        }

        return NextResponse.json(settings);
    } catch (error) {
        console.error('Failed to fetch settings:', error);
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

// PATCH: Update system settings
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { totalMembers } = body;

        if (typeof totalMembers !== 'number' || totalMembers < 1) {
            return NextResponse.json({ error: 'Invalid totalMembers' }, { status: 400 });
        }

        const settings = await prisma.systemSettings.upsert({
            where: { id: 'default' },
            update: { totalMembers },
            create: { id: 'default', totalMembers },
        });

        return NextResponse.json(settings);
    } catch (error) {
        console.error('Failed to update settings:', error);
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
