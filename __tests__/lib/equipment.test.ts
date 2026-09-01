import {
    canEditEquipment,
    canViewEquipment,
    daysUntil,
    expiryStatus,
    expiryRank,
    isEquipmentTargetType,
    isMaintenanceCategory,
    isToolStatus,
    maintenanceCategoryLabel,
    toolStatusLabel,
} from '@/lib/equipment';

// 判定を決定的にするため「今日」を固定して渡す（実装は既定で JST の今日を使う）
const TODAY = new Date('2026-09-01T00:00:00.000Z');

describe('daysUntil', () => {
    it('未来の日付は残り日数を返す', () => {
        expect(daysUntil('2026-09-11', TODAY)).toBe(10);
    });

    it('当日は0を返す', () => {
        expect(daysUntil('2026-09-01', TODAY)).toBe(0);
    });

    it('過去の日付はマイナスになる', () => {
        expect(daysUntil('2026-08-25', TODAY)).toBe(-7);
    });

    it('日時つきの文字列でも日付だけで数える', () => {
        expect(daysUntil('2026-09-11T15:00:00.000Z', TODAY)).toBe(10);
    });

    it('未設定・不正値は null', () => {
        expect(daysUntil(null, TODAY)).toBeNull();
        expect(daysUntil('', TODAY)).toBeNull();
        expect(daysUntil('not-a-date', TODAY)).toBeNull();
    });
});

describe('expiryStatus', () => {
    it('期限切れ', () => {
        expect(expiryStatus('2026-08-31', TODAY)).toBe('expired');
    });

    it('当日と30日以内は danger', () => {
        expect(expiryStatus('2026-09-01', TODAY)).toBe('danger');
        expect(expiryStatus('2026-10-01', TODAY)).toBe('danger'); // 30日ちょうど
    });

    it('31〜60日は warn', () => {
        expect(expiryStatus('2026-10-02', TODAY)).toBe('warn');
        expect(expiryStatus('2026-10-31', TODAY)).toBe('warn'); // 60日ちょうど
    });

    it('61日以上先は ok', () => {
        expect(expiryStatus('2026-11-01', TODAY)).toBe('ok');
    });

    it('未登録は none', () => {
        expect(expiryStatus(null, TODAY)).toBe('none');
    });

    it('期限が近いものほど前に並ぶ', () => {
        const ranks = ['expired', 'danger', 'warn', 'ok', 'none'].map((s) => expiryRank(s as never));
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });
});

describe('canViewEquipment / canEditEquipment', () => {
    it('admin と manager は編集できる', () => {
        expect(canEditEquipment({ role: 'admin', isActive: true })).toBe(true);
        expect(canEditEquipment({ role: 'manager', isActive: true })).toBe(true);
    });

    it('職長・作業員・税理士は閲覧のみ', () => {
        for (const role of ['foreman1', 'foreman2', 'worker', 'accountant']) {
            expect(canViewEquipment({ role, isActive: true })).toBe(true);
            expect(canEditEquipment({ role, isActive: true })).toBe(false);
        }
    });

    it('協力会社には見せない', () => {
        expect(canViewEquipment({ role: 'partner', isActive: true })).toBe(false);
        expect(canViewEquipment({ role: 'partner_member', isActive: true })).toBe(false);
    });

    it('本番に混在する大文字ロールも同じ扱いになる', () => {
        expect(canViewEquipment({ role: 'PARTNER', isActive: true })).toBe(false);
        expect(canEditEquipment({ role: 'ADMIN', isActive: true })).toBe(true);
    });

    it('停止中のユーザーと未ログインは不可', () => {
        expect(canViewEquipment({ role: 'admin', isActive: false })).toBe(false);
        expect(canEditEquipment({ role: 'admin', isActive: false })).toBe(false);
        expect(canViewEquipment(null)).toBe(false);
        expect(canEditEquipment(undefined)).toBe(false);
    });
});

describe('区分・状態の判定', () => {
    it('機材の種類', () => {
        expect(isEquipmentTargetType('vehicle')).toBe(true);
        expect(isEquipmentTargetType('tool')).toBe(true);
        expect(isEquipmentTargetType('machine')).toBe(false);
    });

    it('整備の区分', () => {
        expect(isMaintenanceCategory('inspection')).toBe(true);
        expect(isMaintenanceCategory('unknown')).toBe(false);
        expect(maintenanceCategoryLabel('inspection')).toBe('車検');
        // 未知の値はそのまま出す（DBに古い値が残っていても表示が壊れない）
        expect(maintenanceCategoryLabel('legacy')).toBe('legacy');
    });

    it('工具の状態', () => {
        expect(isToolStatus('checked_out')).toBe(true);
        expect(isToolStatus('broken')).toBe(false);
        expect(toolStatusLabel('checked_out')).toBe('持出中');
        expect(toolStatusLabel('legacy')).toBe('legacy');
    });
});
