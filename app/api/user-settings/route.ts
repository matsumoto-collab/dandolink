import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch user settings
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const settings = await prisma.userSettings.findUnique({
            where: { userId: session.user.id },
        });

        if (!settings) {
            return NextResponse.json({ displayedForemanIds: [] });
        }

        return NextResponse.json({
            displayedForemanIds: JSON.parse(settings.displayedForemanIds || '[]'),
        });
    } catch (error) {
        console.error('Failed to fetch user settings:', error);
        return NextResponse.json({ error: 'Failed to fetch user settings' }, { status: 500 });
    }
}

// PATCH: Update user settings
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { displayedForemanIds } = body;

        const settings = await prisma.userSettings.upsert({
            where: { userId: session.user.id },
            update: {
                displayedForemanIds: JSON.stringify(displayedForemanIds || []),
            },
            create: {
                userId: session.user.id,
                displayedForemanIds: JSON.stringify(displayedForemanIds || []),
            },
        });

        return NextResponse.json({
            displayedForemanIds: JSON.parse(settings.displayedForemanIds),
        });
    } catch (error) {
        console.error('Failed to update user settings:', error);
        return NextResponse.json({ error: 'Failed to update user settings' }, { status: 500 });
    }
}
