import { isPartnerEntity } from '@/lib/partnerHelpers';

/** 機材の種類。'vehicle' = Vehicle.id / 'tool' = Tool.id を targetId に持つ。 */
export const EQUIPMENT_TARGET_TYPES = ['vehicle', 'tool'] as const;
export type EquipmentTargetType = (typeof EQUIPMENT_TARGET_TYPES)[number];

export function isEquipmentTargetType(v: unknown): v is EquipmentTargetType {
    return typeof v === 'string' && (EQUIPMENT_TARGET_TYPES as readonly string[]).includes(v);
}

/** 整備・修理履歴の区分。値はDBに入るので変更しないこと（表示名だけ変えてよい）。 */
export const MAINTENANCE_CATEGORIES = [
    { value: 'repair', label: '修理' },
    { value: 'inspection', label: '車検' },
    { value: 'maintenance', label: '点検・整備' },
    { value: 'consumable', label: '消耗品・部品' },
    { value: 'insurance', label: '保険' },
    { value: 'other', label: 'その他' },
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number]['value'];

export function isMaintenanceCategory(v: unknown): v is MaintenanceCategory {
    return typeof v === 'string' && MAINTENANCE_CATEGORIES.some((c) => c.value === v);
}

export function maintenanceCategoryLabel(value: string): string {
    return MAINTENANCE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

interface EquipmentUser {
    role?: string | null;
    isActive?: boolean | null;
}

/**
 * 機材台帳を閲覧できるか。社内ロールのみ（協力会社には出さない）。
 * role は本番に大文字が混在するため必ず小文字化して判定する。
 */
export function canViewEquipment(user: EquipmentUser | null | undefined): boolean {
    if (!user || user.isActive === false) return false;
    const role = (user.role || '').toLowerCase();
    if (!role) return false;
    return !isPartnerEntity({ isPartner: false, role });
}

/** 機材台帳を登録・編集できるか。admin / manager のみ（kei決定 2026-09-01）。 */
export function canEditEquipment(user: EquipmentUser | null | undefined): boolean {
    if (!user || user.isActive === false) return false;
    const role = (user.role || '').toLowerCase();
    return role === 'admin' || role === 'manager';
}

/** 期限の状態。画面の色分けに使う（通知は出さない＝kei決定 2026-09-01）。 */
export type ExpiryStatus = 'none' | 'expired' | 'danger' | 'warn' | 'ok';

/** danger = 30日以内 / warn = 60日以内。車検は1ヶ月前から受けられるので30日を強調にしている。 */
export const EXPIRY_DANGER_DAYS = 30;
export const EXPIRY_WARN_DAYS = 60;

/** JSTの今日を UTC 0時の Date で返す（日付だけを比べるため）。 */
export const todayJstDate = (): Date => {
    const ymd = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    return new Date(`${ymd}T00:00:00.000Z`);
};

/** 満了日までの日数（今日=0、過去=マイナス）。 */
export function daysUntil(date: Date | string | null | undefined, today: Date = todayJstDate()): number | null {
    if (!date) return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) return null;
    const target = new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function expiryStatus(date: Date | string | null | undefined, today: Date = todayJstDate()): ExpiryStatus {
    const days = daysUntil(date, today);
    if (days === null) return 'none';
    if (days < 0) return 'expired';
    if (days <= EXPIRY_DANGER_DAYS) return 'danger';
    if (days <= EXPIRY_WARN_DAYS) return 'warn';
    return 'ok';
}

/** 一覧の並び：期限切れ・期限が近いものを先頭に出すための優先度（小さいほど先）。 */
export function expiryRank(status: ExpiryStatus): number {
    return status === 'expired' ? 0 : status === 'danger' ? 1 : status === 'warn' ? 2 : status === 'ok' ? 3 : 4;
}

/** 電動工具の状態。値はDBに入るので変更しないこと（旧・工具持出しリストと同じ値）。 */
export const TOOL_STATUSES = [
    { value: 'in_stock', label: '社内保管中' },
    { value: 'checked_out', label: '持出中' },
    { value: 'repairing', label: '修理中' },
    { value: 'lost', label: '紛失' },
    { value: 'disposed', label: '廃棄' },
] as const;

export type ToolStatus = (typeof TOOL_STATUSES)[number]['value'];

export function isToolStatus(v: unknown): v is ToolStatus {
    return typeof v === 'string' && TOOL_STATUSES.some((s) => s.value === v);
}

export function toolStatusLabel(value: string): string {
    return TOOL_STATUSES.find((s) => s.value === value)?.label ?? value;
}
