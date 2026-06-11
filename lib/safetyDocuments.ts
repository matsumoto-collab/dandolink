/**
 * 安全書類（グリーンファイル）共通ロジック。
 * 要件: docs/SAFETY_DOCUMENTS_REQUIREMENTS.md v1.2
 *
 * - 型定義（スナップショット構造）: SafetyDocument.data に保存される JSON の形
 * - 年齢計算: スナップショットの提出日基準（FR-3-7。「今日」基準にしない）
 * - 改ページ分割: 作業員名簿は1ページ10名（FR-3-3）
 * - 必須情報の欠落チェック: 警告表示用（FR-2-4。生成はブロックしない）
 *
 * サーバー（API）・クライアント（ウィザード/PDF）・テストの三者で共用する純関数のみを置く。
 */

export type SafetySource = 'worker' | 'user';

export const SAFETY_DOCUMENT_TYPES = {
    sagyoinMeibo: 'sagyoin_meibo',
} as const;

export type SafetyDocumentType = (typeof SAFETY_DOCUMENT_TYPES)[keyof typeof SAFETY_DOCUMENT_TYPES];

/** 資格・教育の種別 */
export const QUALIFICATION_CATEGORIES = [
    { value: 'special_education', label: '特別教育' },
    { value: 'skill_training', label: '技能講習' },
    { value: 'license', label: '免許' },
] as const;

export type QualificationCategory = (typeof QUALIFICATION_CATEGORIES)[number]['value'];

export interface QualificationSnapshot {
    category: string;
    name: string;
    /** 修了証・免許証の番号（任意。PDFでは名称に併記する） */
    licenseNumber: string | null;
    acquiredAt: string | null; // YYYY-MM-DD
    expiresAt: string | null;  // YYYY-MM-DD
}

/**
 * 安全プロフィールのスナップショット（書類保存時点の値）。
 * ⚠️ 健康保険の記号番号・基礎年金番号・マイナンバーのフィールドを追加してはならない（要件§7.4）。
 */
export interface SafetyProfileSnapshot {
    furigana: string | null;
    birthDate: string | null; // YYYY-MM-DD
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
    qualifications: QualificationSnapshot[];
}

/** 名簿に載る1名分のスナップショット */
export interface MeiboWorkerSnapshot {
    /** 一意キー。`worker:{id}` / `user:{id}` 合成形式 */
    key: string;
    source: SafetySource;
    sourceId: string;
    name: string;
    /** 保存時点の安全プロフィール。未登録者は null（名前のみ記載） */
    profile: SafetyProfileSnapshot | null;
}

/** 作業員名簿のヘッダー情報（書類単位の手入力項目） */
export interface MeiboHeader {
    /** 元請の事業所名（会社名） */
    primeContractor: string;
    /** 元請の所長名 */
    primeSiteManager: string;
    /** 現場名（案件選択 or 手入力） */
    siteName: string;
    /** 自社の次数（一次/二次…） */
    tier: string;
    /** 提出日 YYYY-MM-DD。年齢など派生値の算出基準（FR-3-7） */
    submitDate: string;
    /** 自社会社名 */
    companyName: string;
    /** 自社代表者名 */
    companyRepresentative: string;
    /** 自社所在地 */
    companyAddress: string;
}

/** SafetyDocument.data に保存されるスナップショット全体 */
export interface SagyoinMeiboData {
    header: MeiboHeader;
    workers: MeiboWorkerSnapshot[];
}

// ============================================
// 日付・年齢
// ============================================

/** Date → YYYY-MM-DD（UTC基準。date input 由来の値は UTC 0時で保存されるため一貫する） */
export function toIsoDateString(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

/**
 * 基準日時点の満年齢。生年月日・基準日のどちらかが不正なら null。
 * 基準日はスナップショットの提出日を渡すこと（FR-3-7。現在日は渡さない）。
 */
export function calcAgeAt(birthDateIso: string | null | undefined, baseDateIso: string): number | null {
    if (!birthDateIso) return null;
    const birth = new Date(birthDateIso);
    const base = new Date(baseDateIso);
    if (isNaN(birth.getTime()) || isNaN(base.getTime())) return null;
    let age = base.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = base.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && base.getUTCDate() < birth.getUTCDate())) {
        age--;
    }
    return age >= 0 ? age : null;
}

/** YYYY-MM-DD → 「令和X年Y月Z日」。不正値は空文字 */
export function isoDateToReiwa(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (year >= 2019) return `令和${year - 2018}年${month}月${day}日`;
    if (year >= 1989) return `平成${year - 1988}年${month}月${day}日`;
    if (year >= 1926) return `昭和${year - 1925}年${month}月${day}日`;
    return `${year}年${month}月${day}日`;
}

// ============================================
// 改ページ
// ============================================

/** 作業員名簿の1ページあたり人数（全建統一様式第5号の通例に合わせる） */
export const MEIBO_WORKERS_PER_PAGE = 10;

/**
 * 作業員を1ページぶんずつに分割する。0名でも1ページ（空の名簿）を返す。
 * 11名以上で2ページ目が生まれる（受け入れ基準3）。
 */
export function chunkMeiboWorkers<T>(workers: T[], perPage: number = MEIBO_WORKERS_PER_PAGE): T[][] {
    if (perPage <= 0) throw new Error('perPage must be positive');
    if (workers.length === 0) return [[]];
    const pages: T[][] = [];
    for (let i = 0; i < workers.length; i += perPage) {
        pages.push(workers.slice(i, i + perPage));
    }
    return pages;
}

// ============================================
// 欠落チェック（FR-2-4: 警告のみ・ブロックしない）
// ============================================

/** 名簿出力上とくに重要な項目の欠落を列挙する。空配列 = 警告なし */
export function getMeiboMissingFields(worker: MeiboWorkerSnapshot): string[] {
    if (!worker.profile) return ['安全情報が未登録'];
    const p = worker.profile;
    const missing: string[] = [];
    if (!p.birthDate) missing.push('生年月日');
    if (!p.healthCheckDate) missing.push('健康診断日');
    if (!p.address) missing.push('現住所');
    if (!p.healthInsurance) missing.push('健康保険');
    if (!p.pensionInsurance) missing.push('年金保険');
    if (!p.employmentInsurance) missing.push('雇用保険');
    return missing;
}

// ============================================
// 表示ラベル
// ============================================

export const SAFETY_DOCUMENT_TYPE_LABELS: Record<string, string> = {
    [SAFETY_DOCUMENT_TYPES.sagyoinMeibo]: '作業員名簿',
};

export function getQualificationCategoryLabel(category: string): string {
    return QUALIFICATION_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

/** 作業員選択一覧のグループ（FR-2-2: 自社社員 / 職方 / 協力会社） */
export type SafetyTargetGroup = 'employee' | 'worker' | 'partner';

export const SAFETY_TARGET_GROUP_LABELS: Record<SafetyTargetGroup, string> = {
    employee: '自社社員',
    worker: '職方',
    partner: '協力会社',
};

/** User.role / source からグループを判定（PARTNER 系の User は協力会社グループ） */
export function getSafetyTargetGroup(source: SafetySource, role?: string | null): SafetyTargetGroup {
    if (source === 'worker') return 'worker';
    const r = (role ?? '').toLowerCase();
    // 教訓: DBの role 生値は大文字混在があるため必ず .toLowerCase() で比較する
    if (r === 'partner' || r === 'partner_member') return 'partner';
    return 'employee';
}

// ============================================
// 入力選択肢（フォーム・PDF凡例で共用）
// ============================================

/** 属性記号（全建統一様式第5号の凡例準拠） */
export const WORKER_ATTRIBUTES: { value: string; label: string }[] = [
    { value: '現', label: '現場代理人' },
    { value: '主', label: '主任技術者' },
    { value: '職', label: '職長' },
    { value: '安', label: '安全衛生責任者' },
    { value: '女', label: '女性作業員' },
    { value: '未', label: '18歳未満' },
    { value: '基', label: '基幹技能者' },
    { value: '能', label: '能力向上教育修了者' },
    { value: '再', label: '再発防止教育修了者' },
    { value: '習', label: '外国人技能実習生' },
    { value: '技', label: '外国人建設就労者' },
];

export const HEALTH_INSURANCE_OPTIONS = ['健康保険組合', '協会けんぽ', '建設国保', '国民健康保険', '適用除外'] as const;
export const PENSION_INSURANCE_OPTIONS = ['厚生年金', '国民年金', '受給者'] as const;
export const EMPLOYMENT_INSURANCE_OPTIONS = ['雇用保険', '日雇保険', '適用除外'] as const;
export const BLOOD_TYPE_OPTIONS = ['A', 'B', 'O', 'AB', '不明'] as const;
export const WORKER_CATEGORY_OPTIONS = ['労働者', '一人親方', '中小事業主'] as const;
export const GENDER_OPTIONS = ['男', '女'] as const;

/** よく使う足場系資格のサジェスト（FR-1-5） */
export const COMMON_QUALIFICATIONS: { category: QualificationCategory; name: string }[] = [
    { category: 'skill_training', name: '足場の組立て等作業主任者' },
    { category: 'special_education', name: '足場の組立て等特別教育' },
    { category: 'special_education', name: 'フルハーネス型墜落制止用器具特別教育' },
    { category: 'skill_training', name: '玉掛け技能講習' },
    { category: 'special_education', name: '玉掛け特別教育（1t未満）' },
    { category: 'skill_training', name: '小型移動式クレーン運転技能講習' },
    { category: 'skill_training', name: '高所作業車運転技能講習' },
    { category: 'special_education', name: '高所作業車運転特別教育（10m未満）' },
    { category: 'license', name: '移動式クレーン運転士免許' },
    { category: 'special_education', name: '職長・安全衛生責任者教育' },
];
