import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    toIsoDateString,
    type MachineSnapshot,
    type MeiboWorkerSnapshot,
    type SafetyProfileSnapshot,
    type TodokeVehicleSnapshot,
    type VehicleSafetySnapshot,
} from '@/lib/safetyDocuments';
import type { MeiboMemberRef } from '@/lib/validations/safety';

interface TodokeVehicleRef {
    vehicleId: string;
    driverName: string;
}

interface TodokeMachineRef {
    machineId: string;
    operatorName: string;
}

/**
 * 安全書類スナップショット生成（サーバー専用）。
 * SafetyDocument.data に保存する作業員スナップショットを、現在のマスター値から組み立てる。
 * 作成（POST）・メンバー変更（PUT の新規分のみ）・最新化（refresh）の3箇所で共用。
 */

type ProfileWithQualifications = Prisma.WorkerSafetyProfileGetPayload<{
    include: { qualifications: true };
}>;

/** DBのプロフィール行 → 保存用スナップショット（日付は YYYY-MM-DD 文字列に正規化） */
export function profileToSnapshot(profile: ProfileWithQualifications): SafetyProfileSnapshot {
    return {
        furigana: profile.furigana,
        birthDate: toIsoDateString(profile.birthDate),
        gender: profile.gender,
        jobType: profile.jobType,
        attributes: profile.attributes ?? [],
        hireDate: toIsoDateString(profile.hireDate),
        experienceYears: profile.experienceYears,
        workerCategory: profile.workerCategory,
        address: profile.address,
        tel: profile.tel,
        familyContact: profile.familyContact,
        familyTel: profile.familyTel,
        healthCheckDate: toIsoDateString(profile.healthCheckDate),
        bloodPressure: profile.bloodPressure,
        bloodType: profile.bloodType,
        specialHealthCheckDate: toIsoDateString(profile.specialHealthCheckDate),
        specialHealthCheckType: profile.specialHealthCheckType,
        healthInsurance: profile.healthInsurance,
        pensionInsurance: profile.pensionInsurance,
        employmentInsurance: profile.employmentInsurance,
        employmentInsuranceLast4: profile.employmentInsuranceLast4,
        rosaiSpecialInsurance: profile.rosaiSpecialInsurance,
        kentaikyo: profile.kentaikyo,
        chutaikyo: profile.chutaikyo,
        kentaikyoTechou: profile.kentaikyoTechou,
        ccusId: profile.ccusId,
        notes: profile.notes,
        qualifications: profile.qualifications.map((q) => ({
            category: q.category,
            name: q.name,
            licenseNumber: q.licenseNumber,
            acquiredAt: toIsoDateString(q.acquiredAt),
            expiresAt: toIsoDateString(q.expiresAt),
        })),
    };
}

export interface BuildSnapshotsResult {
    /** members の並び順を維持したスナップショット（見つからなかった対象は含まない） */
    snapshots: MeiboWorkerSnapshot[];
    /** マスターに存在しなかった参照（`worker:{id}` / `user:{id}`） */
    notFoundKeys: string[];
}

/** メンバー参照リストから現在のマスター値でスナップショットを組み立てる（並び順維持） */
export async function buildMeiboWorkerSnapshots(members: MeiboMemberRef[]): Promise<BuildSnapshotsResult> {
    const workerIds = members.filter((m) => m.source === 'worker').map((m) => m.sourceId);
    const userIds = members.filter((m) => m.source === 'user').map((m) => m.sourceId);

    const [workers, users] = await Promise.all([
        workerIds.length
            ? prisma.worker.findMany({
                  where: { id: { in: workerIds } },
                  include: { safetyProfile: { include: { qualifications: { orderBy: { createdAt: 'asc' } } } } },
              })
            : Promise.resolve([]),
        userIds.length
            ? prisma.user.findMany({
                  where: { id: { in: userIds } },
                  select: {
                      id: true,
                      displayName: true,
                      safetyProfile: { include: { qualifications: { orderBy: { createdAt: 'asc' } } } },
                  },
              })
            : Promise.resolve([]),
    ]);

    const workerMap = new Map(workers.map((w) => [w.id, w]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    const snapshots: MeiboWorkerSnapshot[] = [];
    const notFoundKeys: string[] = [];

    for (const ref of members) {
        const key = `${ref.source}:${ref.sourceId}`;
        if (ref.source === 'worker') {
            const worker = workerMap.get(ref.sourceId);
            if (!worker) {
                notFoundKeys.push(key);
                continue;
            }
            snapshots.push({
                key,
                source: 'worker',
                sourceId: worker.id,
                name: worker.name,
                profile: worker.safetyProfile ? profileToSnapshot(worker.safetyProfile) : null,
            });
        } else {
            const user = userMap.get(ref.sourceId);
            if (!user) {
                notFoundKeys.push(key);
                continue;
            }
            snapshots.push({
                key,
                source: 'user',
                sourceId: user.id,
                name: user.displayName,
                profile: user.safetyProfile ? profileToSnapshot(user.safetyProfile) : null,
            });
        }
    }

    return { snapshots, notFoundKeys };
}

/**
 * 書類更新時のメンバー差し替え。
 * 既存メンバーは保存済みスナップショットを据え置き（FR-4-2 の決定性維持）、
 * 新規メンバーのみ現在のマスター値でスナップショット化する。並び順は refs に従う。
 */
export async function mergeMeiboWorkerSnapshots(
    existing: MeiboWorkerSnapshot[],
    refs: MeiboMemberRef[]
): Promise<BuildSnapshotsResult> {
    const existingMap = new Map(existing.map((w) => [w.key, w]));
    const newRefs = refs.filter((r) => !existingMap.has(`${r.source}:${r.sourceId}`));
    const { snapshots: newSnapshots, notFoundKeys } = await buildMeiboWorkerSnapshots(newRefs);
    const newMap = new Map(newSnapshots.map((w) => [w.key, w]));

    const merged: MeiboWorkerSnapshot[] = [];
    for (const ref of refs) {
        const key = `${ref.source}:${ref.sourceId}`;
        const snapshot = existingMap.get(key) ?? newMap.get(key);
        if (snapshot) merged.push(snapshot);
    }
    return { snapshots: merged, notFoundKeys };
}

/**
 * スナップショットの最新化（FR-4-3）。
 * 取得できた対象は現在のマスター値で更新し、マスターから消えた対象は既存スナップショットを
 * 据え置く（書類の内容を勝手に減らさない）。並び順は既存のまま。
 */
export async function refreshMeiboWorkerSnapshots(
    existing: MeiboWorkerSnapshot[]
): Promise<BuildSnapshotsResult> {
    const refs: MeiboMemberRef[] = existing.map((w) => ({ source: w.source, sourceId: w.sourceId }));
    const { snapshots: freshSnapshots, notFoundKeys } = await buildMeiboWorkerSnapshots(refs);
    const freshMap = new Map(freshSnapshots.map((w) => [w.key, w]));

    const refreshed = existing.map((w) => freshMap.get(w.key) ?? w);
    return { snapshots: refreshed, notFoundKeys };
}

// ============================================
// Phase 2: 車両届
// ============================================

type VehicleProfileRow = Prisma.VehicleSafetyProfileGetPayload<Record<string, never>>;

export function vehicleProfileToSnapshot(profile: VehicleProfileRow): VehicleSafetySnapshot {
    return {
        vehicleType: profile.vehicleType,
        registrationNumber: profile.registrationNumber,
        usage: profile.usage,
        inspectionExpiry: toIsoDateString(profile.inspectionExpiry),
        jibaisekiCompany: profile.jibaisekiCompany,
        jibaisekiExpiry: toIsoDateString(profile.jibaisekiExpiry),
        insuranceCompany: profile.insuranceCompany,
        insuranceExpiry: toIsoDateString(profile.insuranceExpiry),
        insurancePersonal: profile.insurancePersonal,
        insuranceObjective: profile.insuranceObjective,
        insurancePassenger: profile.insurancePassenger,
        notes: profile.notes,
    };
}

export interface BuildVehicleSnapshotsResult {
    snapshots: TodokeVehicleSnapshot[];
    notFoundKeys: string[];
}

/** 車両参照リストから現在のマスター値でスナップショットを組み立てる（並び順維持） */
export async function buildTodokeVehicleSnapshots(refs: TodokeVehicleRef[]): Promise<BuildVehicleSnapshotsResult> {
    const ids = refs.map((r) => r.vehicleId);
    const vehicles = ids.length
        ? await prisma.vehicle.findMany({
              where: { id: { in: ids } },
              include: { safetyProfile: true },
          })
        : [];
    const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

    const snapshots: TodokeVehicleSnapshot[] = [];
    const notFoundKeys: string[] = [];
    for (const ref of refs) {
        const vehicle = vehicleMap.get(ref.vehicleId);
        if (!vehicle) {
            notFoundKeys.push(`vehicle:${ref.vehicleId}`);
            continue;
        }
        snapshots.push({
            vehicleId: vehicle.id,
            name: vehicle.name,
            // 運転者は書類固有入力。未指定ならプロフィールの既定運転者を初期採用
            driverName: ref.driverName || vehicle.safetyProfile?.defaultDriverName || '',
            profile: vehicle.safetyProfile ? vehicleProfileToSnapshot(vehicle.safetyProfile) : null,
        });
    }
    return { snapshots, notFoundKeys };
}

/** 車両届の更新: 既存車両のプロフィールスナップショットは据え置き・driverName は送信値を採用 */
export async function mergeTodokeVehicleSnapshots(
    existing: TodokeVehicleSnapshot[],
    refs: TodokeVehicleRef[]
): Promise<BuildVehicleSnapshotsResult> {
    const existingMap = new Map(existing.map((v) => [v.vehicleId, v]));
    const newRefs = refs.filter((r) => !existingMap.has(r.vehicleId));
    const { snapshots: newSnapshots, notFoundKeys } = await buildTodokeVehicleSnapshots(newRefs);
    const newMap = new Map(newSnapshots.map((v) => [v.vehicleId, v]));

    const merged: TodokeVehicleSnapshot[] = [];
    for (const ref of refs) {
        const kept = existingMap.get(ref.vehicleId);
        if (kept) {
            merged.push({ ...kept, driverName: ref.driverName });
        } else {
            const created = newMap.get(ref.vehicleId);
            if (created) merged.push(created);
        }
    }
    return { snapshots: merged, notFoundKeys };
}

/** 車両届の最新化: プロフィール・車両名を最新化し、driverName（書類固有）は維持 */
export async function refreshTodokeVehicleSnapshots(
    existing: TodokeVehicleSnapshot[]
): Promise<BuildVehicleSnapshotsResult> {
    const refs: TodokeVehicleRef[] = existing.map((v) => ({ vehicleId: v.vehicleId, driverName: v.driverName }));
    const { snapshots: fresh, notFoundKeys } = await buildTodokeVehicleSnapshots(refs);
    const freshMap = new Map(fresh.map((v) => [v.vehicleId, v]));
    const refreshed = existing.map((v) => {
        const f = freshMap.get(v.vehicleId);
        return f ? { ...f, driverName: v.driverName } : v;
    });
    return { snapshots: refreshed, notFoundKeys };
}

// ============================================
// Phase 2: 持込機械届・クレーン等使用届
// ============================================

type MachineRow = Prisma.MachineGetPayload<Record<string, never>>;

export function machineToSnapshot(machine: MachineRow, operatorName: string): MachineSnapshot {
    return {
        machineId: machine.id,
        name: machine.name,
        category: machine.category,
        operatorName: operatorName || machine.defaultOperatorName || '',
        model: machine.model,
        serialNumber: machine.serialNumber,
        maker: machine.maker,
        capacity: machine.capacity,
        ownerName: machine.ownerName,
        inspectionDate: toIsoDateString(machine.inspectionDate),
        inspectionExpiry: toIsoDateString(machine.inspectionExpiry),
        certificateNumber: machine.certificateNumber,
        notes: machine.notes,
    };
}

export interface BuildMachineSnapshotsResult {
    snapshots: MachineSnapshot[];
    notFoundKeys: string[];
}

export async function buildMachineSnapshots(refs: TodokeMachineRef[]): Promise<BuildMachineSnapshotsResult> {
    const ids = refs.map((r) => r.machineId);
    const machines = ids.length
        ? await prisma.machine.findMany({ where: { id: { in: ids } } })
        : [];
    const machineMap = new Map(machines.map((m) => [m.id, m]));

    const snapshots: MachineSnapshot[] = [];
    const notFoundKeys: string[] = [];
    for (const ref of refs) {
        const machine = machineMap.get(ref.machineId);
        if (!machine) {
            notFoundKeys.push(`machine:${ref.machineId}`);
            continue;
        }
        snapshots.push(machineToSnapshot(machine, ref.operatorName));
    }
    return { snapshots, notFoundKeys };
}

/** 機械届の更新: 既存機械のマスター値スナップショットは据え置き・operatorName は送信値を採用 */
export async function mergeMachineSnapshots(
    existing: MachineSnapshot[],
    refs: TodokeMachineRef[]
): Promise<BuildMachineSnapshotsResult> {
    const existingMap = new Map(existing.map((m) => [m.machineId, m]));
    const newRefs = refs.filter((r) => !existingMap.has(r.machineId));
    const { snapshots: newSnapshots, notFoundKeys } = await buildMachineSnapshots(newRefs);
    const newMap = new Map(newSnapshots.map((m) => [m.machineId, m]));

    const merged: MachineSnapshot[] = [];
    for (const ref of refs) {
        const kept = existingMap.get(ref.machineId);
        if (kept) {
            merged.push({ ...kept, operatorName: ref.operatorName });
        } else {
            const created = newMap.get(ref.machineId);
            if (created) merged.push(created);
        }
    }
    return { snapshots: merged, notFoundKeys };
}

/** 機械届の最新化: マスター値を最新化し、operatorName（書類固有）は維持 */
export async function refreshMachineSnapshots(existing: MachineSnapshot[]): Promise<BuildMachineSnapshotsResult> {
    const refs: TodokeMachineRef[] = existing.map((m) => ({ machineId: m.machineId, operatorName: m.operatorName }));
    const { snapshots: fresh, notFoundKeys } = await buildMachineSnapshots(refs);
    const freshMap = new Map(fresh.map((m) => [m.machineId, m]));
    const refreshed = existing.map((m) => {
        const f = freshMap.get(m.machineId);
        return f ? { ...f, operatorName: m.operatorName } : m;
    });
    return { snapshots: refreshed, notFoundKeys };
}
