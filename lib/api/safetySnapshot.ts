import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    toIsoDateString,
    type MeiboWorkerSnapshot,
    type SafetyProfileSnapshot,
} from '@/lib/safetyDocuments';
import type { MeiboMemberRef } from '@/lib/validations/safety';

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
