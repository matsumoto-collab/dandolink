import type { SafetySource, SafetyDocumentData } from '@/lib/safetyDocuments';

/**
 * 安全書類（グリーンファイル）フロント用 DTO。
 * API レスポンス（Prisma 行の JSON シリアライズ。日付は ISO 文字列）の形。
 */

export interface SafetyQualificationDto {
    id: string;
    profileId: string;
    category: string;
    name: string;
    licenseNumber: string | null;
    acquiredAt: string | null;
    expiresAt: string | null;
    /** 資格証画像の Storage パス（有無判定用。閲覧は署名URLを使う） */
    imagePath: string | null;
    imageThumbPath: string | null;
    createdAt: string;
    updatedAt: string;
    /** GET /api/safety-profiles/[profileId]/qualifications でのみ付与される署名URL（1時間有効） */
    imageUrl?: string | null;
    imageThumbUrl?: string | null;
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
    data: SafetyDocumentData;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    projectMaster: { id: string; title: string } | null;
}

/** 車両安全プロフィール（API レスポンス。日付は ISO 文字列） */
export interface VehicleSafetyProfileDto {
    id: string;
    vehicleId: string;
    vehicleType: string | null;
    registrationNumber: string | null;
    usage: string | null;
    inspectionExpiry: string | null;
    jibaisekiCompany: string | null;
    jibaisekiExpiry: string | null;
    insuranceCompany: string | null;
    insuranceExpiry: string | null;
    insurancePersonal: string | null;
    insuranceObjective: string | null;
    insurancePassenger: string | null;
    defaultDriverName: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

/** GET /api/vehicle-safety-profiles 統合一覧の1行 */
export interface VehicleSafetyTargetDto {
    vehicleId: string;
    name: string;
    profile: VehicleSafetyProfileDto | null;
}

/** 機械マスター（API レスポンス） */
export interface MachineDto {
    id: string;
    name: string;
    category: string;
    model: string | null;
    serialNumber: string | null;
    maker: string | null;
    capacity: string | null;
    ownerName: string | null;
    defaultOperatorName: string | null;
    inspectionDate: string | null;
    inspectionExpiry: string | null;
    certificateNumber: string | null;
    notes: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
