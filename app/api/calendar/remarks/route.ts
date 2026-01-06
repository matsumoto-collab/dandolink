import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all remarks
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const remarks = await prisma.calendarRemark.findMany();

        // Convert to object format { dateKey: text }
        const remarksMap: Record<string, string> = {};
        remarks.forEach(r => {
            remarksMap[r.dateKey] = r.text;
        });

        return NextResponse.json(remarksMap);
    } catch (error) {
        console.error('Failed to fetch remarks:', error);
        return NextResponse.json({ error: 'Failed to fetch remarks' }, { status: 500 });
    }
}

// POST/PATCH: Set a remark for a date
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { dateKey, text } = body;

        if (!dateKey) {
            return NextResponse.json({ error: 'dateKey is required' }, { status: 400 });
        }

        if (!text || text.trim() === '') {
            // Delete if text is empty
            await prisma.calendarRemark.deleteMany({ where: { dateKey } });
            return NextResponse.json({ success: true, deleted: true });
        }

        const remark = await prisma.calendarRemark.upsert({
            where: { dateKey },
            update: { text },
            create: { dateKey, text },
        });

        return NextResponse.json(remark);
    } catch (error) {
        console.error('Failed to set remark:', error);
        return NextResponse.json({ error: 'Failed to set remark' }, { status: 500 });
    }
}
