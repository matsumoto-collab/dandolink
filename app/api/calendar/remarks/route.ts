import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validationErrorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const remarks = await prisma.calendarRemark.findMany();
        const remarksMap: Record<string, string> = {};
        remarks.forEach(r => { remarksMap[r.dateKey] = r.text; });
        return NextResponse.json(remarksMap);
    } catch (error) {
        return serverErrorResponse('備考取得', error);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { dateKey, text } = await request.json();
        if (!dateKey) return validationErrorResponse('日付キーは必須です');

        if (!text || text.trim() === '') {
            await prisma.calendarRemark.deleteMany({ where: { dateKey } });
            return NextResponse.json({ success: true, deleted: true });
        }

        const remark = await prisma.calendarRemark.upsert({ where: { dateKey }, update: { text }, create: { dateKey, text } });
        return NextResponse.json(remark);
    } catch (error) {
        return serverErrorResponse('備考設定', error);
    }
}
