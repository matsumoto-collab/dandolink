
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse, validationErrorResponse, parseDateKeyRangeParams } from '@/lib/api/utils';
import { cellRemarkSchema, validateRequest } from '@/lib/validations';

export async function GET(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        // from/to (YYYY-MM-DD) 指定時は範囲のみ返す。未指定は全件（従来挙動）
        const { range, error: rangeError } = parseDateKeyRangeParams(req);
        if (rangeError) return rangeError;

        const remarks = await prisma.cellRemark.findMany(
            range ? { where: { dateKey: range } } : undefined
        );

        // { "foremanId-dateKey": text } の形式に変換
        const remarksMap = remarks.reduce((acc, remark) => {
            acc[`${remark.foremanId}-${remark.dateKey}`] = remark.text;
            return acc;
        }, {} as Record<string, string>);

        return NextResponse.json(remarksMap, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('セル備考の取得', error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(cellRemarkSchema, body);
        if (!validation.success) return validationErrorResponse(validation.error!, validation.details);

        const { foremanId, dateKey, text } = validation.data;

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
