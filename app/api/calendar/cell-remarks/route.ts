
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET(_req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        // 全件取得 (必要に応じて期間指定などを追加)
        const remarks = await prisma.cellRemark.findMany();

        // { "foremanId-dateKey": text } の形式に変換
        const remarksMap = remarks.reduce((acc, remark) => {
            acc[`${remark.foremanId}-${remark.dateKey}`] = remark.text;
            return acc;
        }, {} as Record<string, string>);

        return NextResponse.json(remarksMap);
    } catch (error) {
        return serverErrorResponse('セル備考の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { foremanId, dateKey, text } = await req.json();

        if (!foremanId || !dateKey) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        if (!text) {
            // テキストが空の場合は削除
            await prisma.cellRemark.deleteMany({
                where: {
                    foremanId,
                    dateKey,
                },
            });
            return NextResponse.json({ success: true, deleted: true });
        }

        // Upsert
        const remark = await prisma.cellRemark.upsert({
            where: {
                foremanId_dateKey: {
                    foremanId,
                    dateKey,
                },
            },
            update: {
                text,
            },
            create: {
                foremanId,
                dateKey,
                text,
            },
        });

        return NextResponse.json(remark);
    } catch (error) {
        return serverErrorResponse('セル備考の更新', error);
    }
}
