import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, notFoundResponse, serverErrorResponse } from '@/lib/api/utils';
import { canEditEquipment } from '@/lib/equipment';

interface RouteContext { params: Promise<{ id: string }>; }

/** 日付文字列（YYYY-MM-DD）を UTC 0時の Date に。空文字・不正値は null。 */
const toDate = (v: unknown): Date | null => {
    if (v == null || v === '') return null;
    const s = String(v).slice(0, 10);
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const str = (v: unknown): string | null => {
    const s = v == null ? '' : String(v).trim();
    return s === '' ? null : s.slice(0, 200);
};

/**
 * 車両の詳細情報（車種・車番・車検・保険）を保存する。
 * VehicleSafetyProfile を upsert する（車両の名前・日額・有効/無効は設定＞車両管理の担当なのでここでは触らない）。
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canEditEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const { id } = await context.params;
        const vehicle = await prisma.vehicle.findUnique({ where: { id } });
        if (!vehicle) return notFoundResponse('車両');

        const body = await request.json().catch(() => ({}));
        const data = {
            vehicleType: str(body.vehicleType),
            registrationNumber: str(body.registrationNumber),
            usage: str(body.usage),
            inspectionExpiry: toDate(body.inspectionExpiry),
            jibaisekiCompany: str(body.jibaisekiCompany),
            jibaisekiExpiry: toDate(body.jibaisekiExpiry),
            insuranceCompany: str(body.insuranceCompany),
            insuranceExpiry: toDate(body.insuranceExpiry),
            insurancePersonal: str(body.insurancePersonal),
            insuranceObjective: str(body.insuranceObjective),
            insurancePassenger: str(body.insurancePassenger),
            defaultDriverName: str(body.defaultDriverName),
            notes: body.notes == null || String(body.notes).trim() === '' ? null : String(body.notes).trim().slice(0, 2000),
        };

        const saved = await prisma.vehicleSafetyProfile.upsert({
            where: { vehicleId: id },
            create: { vehicleId: id, ...data },
            update: data,
        });

        return NextResponse.json(saved);
    } catch (error) {
        return serverErrorResponse('車両情報の保存', error);
    }
}
