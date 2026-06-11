import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
    notFoundResponse,
} from '@/lib/api/utils';
import { vehicleSafetyProfileUpsertSchema } from '@/lib/validations/safety';

/**
 * 車両安全プロフィール API（安全書類 Phase 2）。admin / manager のみ。
 *
 * GET /api/vehicle-safety-profiles               … 車両＋プロフィールの統合一覧
 * GET /api/vehicle-safety-profiles?vehicleId=…   … 単体取得（未登録は null）
 * PUT /api/vehicle-safety-profiles?vehicleId=…   … upsert
 */

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const vehicleId = searchParams.get('vehicleId');

        if (vehicleId) {
            const profile = await prisma.vehicleSafetyProfile.findUnique({ where: { vehicleId } });
            return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store' } });
        }

        const vehicles = await prisma.vehicle.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
            include: { safetyProfile: true },
        });

        const targets = vehicles.map((v) => ({
            vehicleId: v.id,
            name: v.name,
            profile: v.safetyProfile,
        }));

        return NextResponse.json(targets, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('車両安全プロフィール一覧取得', error);
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const vehicleId = searchParams.get('vehicleId');
        if (!vehicleId) return validationErrorResponse('vehicleId を指定してください');

        const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
        if (!vehicle) return notFoundResponse('車両');

        const body = await request.json();
        const parsed = vehicleSafetyProfileUpsertSchema.safeParse(body);
        if (!parsed.success) {
            return validationErrorResponse('入力値が不正です', parsed.error.flatten());
        }

        const profile = await prisma.vehicleSafetyProfile.upsert({
            where: { vehicleId },
            create: { ...parsed.data, vehicleId },
            update: parsed.data,
        });

        return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('車両安全プロフィール保存', error);
    }
}
