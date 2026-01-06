import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch all vacations
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const vacations = await prisma.vacationRecord.findMany();

        // Convert to object format { dateKey: { employeeIds, remarks } }
        const vacationsMap: Record<string, { employeeIds: string[]; remarks: string }> = {};
        vacations.forEach(v => {
            vacationsMap[v.dateKey] = {
                employeeIds: JSON.parse(v.employeeIds || '[]'),
                remarks: v.remarks || '',
            };
        });

        return NextResponse.json(vacationsMap);
    } catch (error) {
        console.error('Failed to fetch vacations:', error);
        return NextResponse.json({ error: 'Failed to fetch vacations' }, { status: 500 });
    }
}

// POST: Set vacation data for a date
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { dateKey, employeeIds, remarks } = body;

        if (!dateKey) {
            return NextResponse.json({ error: 'dateKey is required' }, { status: 400 });
        }

        // Delete if no employees and no remarks
        if ((!employeeIds || employeeIds.length === 0) && (!remarks || remarks.trim() === '')) {
            await prisma.vacationRecord.deleteMany({ where: { dateKey } });
            return NextResponse.json({ success: true, deleted: true });
        }

        const vacation = await prisma.vacationRecord.upsert({
            where: { dateKey },
            update: {
                employeeIds: JSON.stringify(employeeIds || []),
                remarks: remarks || null,
            },
            create: {
                dateKey,
                employeeIds: JSON.stringify(employeeIds || []),
                remarks: remarks || null,
            },
        });

        return NextResponse.json({
            ...vacation,
            employeeIds: JSON.parse(vacation.employeeIds),
        });
    } catch (error) {
        console.error('Failed to set vacation:', error);
        return NextResponse.json({ error: 'Failed to set vacation' }, { status: 500 });
    }
}
