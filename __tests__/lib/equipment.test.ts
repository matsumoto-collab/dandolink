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
    isSchedulableTool,
    toolHardDeleteBlockers,
    toolCategorySoftDeleteBlockers,
    toolCategoryHardDeleteBlockers,
    describeDeleteBlockers,
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

describe('isSchedulableTool', () => {
    const tool = (over: Partial<{ id: string; status: string; isActive: boolean }> = {}) => ({
        id: 't1', status: 'in_stock', isActive: true, ...over,
    });

    it('台帳にある通常の工具は選べる', () => {
        expect(isSchedulableTool(tool())).toBe(true);
        expect(isSchedulableTool(tool({ status: 'checked_out' }))).toBe(true);
        expect(isSchedulableTool(tool({ status: 'repairing' }))).toBe(true);
    });

    it('台帳から外した工具・廃棄・紛失は選べない', () => {
        expect(isSchedulableTool(tool({ isActive: false }))).toBe(false);
        expect(isSchedulableTool(tool({ status: 'disposed' }))).toBe(false);
        expect(isSchedulableTool(tool({ status: 'lost' }))).toBe(false);
    });

    it('既に選ばれている工具は状態が変わっても残す（選択が勝手に外れないように）', () => {
        expect(isSchedulableTool(tool({ isActive: false }), ['t1'])).toBe(true);
        expect(isSchedulableTool(tool({ status: 'disposed' }), ['t1'])).toBe(true);
        expect(isSchedulableTool(tool({ isActive: false }), ['t9'])).toBe(false);
    });
});

describe('toolHardDeleteBlockers', () => {
    const usage = (over: Partial<Parameters<typeof toolHardDeleteBlockers>[0]> = {}) => ({
        status: 'in_stock', assignmentCount: 0, checkoutLogCount: 0, maintenanceCount: 0, ...over,
    });

    it('記録が1件も無ければ完全に削除できる', () => {
        expect(toolHardDeleteBlockers(usage())).toEqual([]);
        // status を渡さなくても止めない
        expect(toolHardDeleteBlockers({ assignmentCount: 0, checkoutLogCount: 0, maintenanceCount: 0 })).toEqual([]);
    });

    it('持出中は削除できない', () => {
        expect(toolHardDeleteBlockers(usage({ status: 'checked_out' }))).toEqual(['持出中です']);
    });

    it('廃棄・紛失でも記録が無ければ削除できる（状態では止めない）', () => {
        expect(toolHardDeleteBlockers(usage({ status: 'disposed' }))).toEqual([]);
        expect(toolHardDeleteBlockers(usage({ status: 'lost' }))).toEqual([]);
    });

    it('現場で使われていたら件数つきで理由を返す', () => {
        expect(toolHardDeleteBlockers(usage({ assignmentCount: 3 }))).toEqual(['現場の予定で3件使われています']);
    });

    it('持出しの記録・整備の履歴も削除を止める', () => {
        expect(toolHardDeleteBlockers(usage({ checkoutLogCount: 2 }))).toEqual(['持出し・返却の記録が2件あります']);
        expect(toolHardDeleteBlockers(usage({ maintenanceCount: 1 }))).toEqual(['整備・修理の履歴が1件あります']);
    });

    it('理由が複数あるときは全部返す', () => {
        expect(
            toolHardDeleteBlockers({ status: 'checked_out', assignmentCount: 1, checkoutLogCount: 1, maintenanceCount: 1 })
        ).toHaveLength(4);
    });
});

describe('toolCategorySoftDeleteBlockers', () => {
    it('使っている工具が無ければ一覧から外せる', () => {
        expect(toolCategorySoftDeleteBlockers({ activeToolCount: 0, inactiveToolCount: 0 })).toEqual([]);
        // 台帳から外した工具だけなら外してよい
        expect(toolCategorySoftDeleteBlockers({ activeToolCount: 0, inactiveToolCount: 5 })).toEqual([]);
    });

    it('使っている工具が残っていたら外せない', () => {
        expect(toolCategorySoftDeleteBlockers({ activeToolCount: 2, inactiveToolCount: 0 }))
            .toEqual(['この分類の工具が2台あります']);
    });
});

describe('toolCategoryHardDeleteBlockers', () => {
    it('工具が1台も無いときだけ完全に削除できる', () => {
        expect(toolCategoryHardDeleteBlockers({ activeToolCount: 0, inactiveToolCount: 0 })).toEqual([]);
    });

    it('使っている工具があるときは合計台数で止める', () => {
        expect(toolCategoryHardDeleteBlockers({ activeToolCount: 2, inactiveToolCount: 3 }))
            .toEqual(['この分類の工具が5台あります']);
    });

    it('台帳から外した工具だけでも完全削除は止める（categoryId は必須のため）', () => {
        expect(toolCategoryHardDeleteBlockers({ activeToolCount: 0, inactiveToolCount: 1 }))
            .toEqual(['台帳から外した工具が1台残っています']);
    });
});

describe('describeDeleteBlockers', () => {
    it('理由を並べて1文にする', () => {
        expect(describeDeleteBlockers('「インパクト#1」', ['持出中です', '整備・修理の履歴が1件あります']))
            .toBe('「インパクト#1」は削除できません（持出中です／整備・修理の履歴が1件あります）');
    });

    it('操作名を差し替えられる（分類を一覧から外すとき）', () => {
        expect(describeDeleteBlockers('分類「丸ノコ」', ['この分類の工具が2台あります'], '一覧から外せません'))
            .toBe('分類「丸ノコ」は一覧から外せません（この分類の工具が2台あります）');
    });
});
