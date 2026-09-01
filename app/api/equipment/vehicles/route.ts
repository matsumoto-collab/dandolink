import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { canViewEquipment } from '@/lib/equipment';

/**
 * 機材台帳（車両）の一覧。
 * 車両そのもの（名前・日額・有効/無効）は既存の設定＞車両管理と同じ Vehicle を見ている。
 * 車種・車番・車検・保険は VehicleSafetyProfile（旧・安全書類用テーブルの再利用）。
 */
export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canViewEquipment(session!.user)) return errorResponse('権限がありません', 403);

        const [vehicles, stats] = await Promise.all([
            prisma.vehicle.findMany({
                orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
                include: { safetyProfile: true },
            }),
            prisma.equipmentMaintenanceRecord.groupBy({
                by: ['targetId'],
                where: { targetType: 'vehicle' },
                _sum: { amount: true },
                _count: { _all: true },
                _max: { date: true },
            }),
        ]);

        const statMap = new Map(stats.map((s) => [s.targetId, s]));

        return NextResponse.json(
            vehicles.map((v) => {
                const st = statMap.get(v.id);
                const p = v.safetyProfile;
                return {
                    id: v.id,
                    name: v.name,
                    isActive: v.isActive,
                    dailyRate: v.dailyRate ? Number(v.dailyRate) : null,
                    profile: p
                        ? {
                              vehicleType: p.vehicleType,
                              registrationNumber: p.registrationNumber,
                              usage: p.usage,
                              inspectionExpiry: p.inspectionExpiry,
                              jibaisekiCompany: p.jibaisekiCompany,
                              jibaisekiExpiry: p.jibaisekiExpiry,
                              insuranceCompany: p.insuranceCompany,
                              insuranceExpiry: p.insuranceExpiry,
                              insurancePersonal: p.insurancePersonal,
                              insuranceObjective: p.insuranceObjective,
                              insurancePassenger: p.insurancePassenger,
                              defaultDriverName: p.defaultDriverName,
                              notes: p.notes,
                          }
                        : null,
                    maintenance: {
                        count: st?._count._all ?? 0,
                        totalAmount: st?._sum.amount ? Number(st._sum.amount) : 0,
                        lastDate: st?._max.date ?? null,
                    },
                };
            }),
            { headers: { 'Cache-Control': 'no-store' } },
        );
    } catch (error) {
        return serverErrorResponse('機材台帳（車両）の取得', error);
    }
}
