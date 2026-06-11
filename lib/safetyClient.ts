import type { SafetyProfileDto, SafetyTargetDto } from '@/types/safety';
import {
    toIsoDateString,
    type MeiboWorkerSnapshot,
    type SafetyProfileSnapshot,
} from '@/lib/safetyDocuments';

/**
 * 安全書類クライアント側ヘルパー。
 * API レスポンス（DTO）→ スナップショット形の変換。プレビューが「保存される内容」と
 * 一致するよう、サーバーの profileToSnapshot（lib/api/safetySnapshot.ts）と同じ意味論にする。
 */

export function profileDtoToSnapshot(profile: SafetyProfileDto): SafetyProfileSnapshot {
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
        qualifications: (profile.qualifications ?? []).map((q) => ({
            category: q.category,
            name: q.name,
            acquiredAt: toIsoDateString(q.acquiredAt),
            expiresAt: toIsoDateString(q.expiresAt),
        })),
    };
}

/** 統合一覧の1行 → 名簿スナップショット（プレビュー用） */
export function targetToWorkerSnapshot(target: SafetyTargetDto): MeiboWorkerSnapshot {
    return {
        key: target.key,
        source: target.source,
        sourceId: target.sourceId,
        name: target.name,
        profile: target.profile ? profileDtoToSnapshot(target.profile) : null,
    };
}

/** 今日の日付（JST）を YYYY-MM-DD で返す（提出日の初期値用） */
export function todayJstIsoDate(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}
