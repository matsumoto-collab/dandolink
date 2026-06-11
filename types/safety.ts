import type { SafetySource } from '@/lib/safetyDocuments';
import type { SagyoinMeiboData } from '@/lib/safetyDocuments';

/**
 * 安全書類（グリーンファイル）フロント用 DTO。
 * API レスポンス（Prisma 行の JSON シリアライズ。日付は ISO 文字列）の形。
 */

export interface SafetyQualificationDto {
    id: string;
    profileId: string;
    category: string;
    name: string;
    acquiredAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface SafetyProfileDto {
    id: string;
    workerId: string | null;
    userId: string | null;
    furigana: string | null;
    birthDate: string | null;
    gender: string | null;
    jobType: string | null;
    attributes: string[];
    hireDate: string | null;
    experienceYears: number | null;
    workerCategory: string | null;
    address: string | null;
    tel: string | null;
    familyContact: string | null;
    familyTel: string | null;
    healthCheckDate: string | null;
    bloodPressure: string | null;
    bloodType: string | null;
    specialHealthCheckDate: string | null;
    specialHealthCheckType: string | null;
    healthInsurance: string | null;
    pensionInsurance: string | null;
    employmentInsurance: string | null;
    employmentInsuranceLast4: string | null;
    rosaiSpecialInsurance: boolean | null;
    kentaikyo: boolean | null;
    chutaikyo: boolean | null;
    kentaikyoTechou: boolean | null;
    ccusId: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    qualifications: SafetyQualificationDto[];
}

/** GET /api/safety-profiles 統合一覧の1行（Worker / User 横断） */
export interface SafetyTargetDto {
    /** `worker:{id}` / `user:{id}` 合成キー（フロントの一意キー） */
    key: string;
    source: SafetySource;
    sourceId: string;
    name: string;
    /** User のときのみ。Worker は null */
    role: string | null;
    companyId: string | null;
    companyName: string | null;
    profile: SafetyProfileDto | null;
}

/** GET /api/safety-documents の1行 */
export interface SafetyDocumentDto {
    id: string;
    type: string;
    projectId: string | null;
    title: string;
    data: SagyoinMeiboData;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    projectMaster: { id: string; title: string } | null;
}
