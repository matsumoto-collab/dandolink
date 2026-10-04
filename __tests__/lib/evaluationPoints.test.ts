/**
 * @jest-environment node
 */
import {
    canConfirmRecord,
    canInputEvaluationPoints,
    canInputForForeman,
    canRemoveRecord,
    dateKeyToDate,
    dateToDateKey,
    decideDayToggle,
    isEvaluationPointAdmin,
    isEvaluationPointEligibleRole,
    isEvaluationPointManager,
    isEvaluationPointMemberRole,
    isFutureDateKey,
    isValidPoints,
    resolveRateAt,
    statusForNewRecord,
    summarizeRecords,
    toEvaluationPointStatus,
    todayJstDateKey,
    type PointItemLike,
    type PointRateLike,
    type PointRecordLike,
} from '@/lib/evaluationPoints';

const rate = (id: string, points: number, effectiveFrom: string, createdAt = `${effectiveFrom}T00:00:00.000Z`): PointRateLike =>
    ({ id, points, effectiveFrom, createdAt });

const record = (over: Partial<PointRecordLike> = {}): PointRecordLike =>
    ({ id: 'r1', userId: 'worker1', itemId: 'wash', status: 'confirmed', createdBy: 'foremanA', ...over });

describe('ロールの判定', () => {
    it('ロールごとの「できること」の表（1つでも変わったら、このテストが落ちる）', () => {
        //                        もらえる  付けられる  全員の一覧  自分の画面  点数表を直す
        const table: [string, boolean, boolean, boolean, boolean, boolean][] = [
            ['admin',          true,  true,  true,  false, true],
            ['manager',        true,  true,  true,  false, false],
            ['foreman1',       true,  true,  false, true,  false],
            ['foreman2',       true,  true,  false, true,  false],
            ['worker',         true,  false, false, true,  false],
            ['partner',        false, false, false, false, false],
            ['partner_member', false, false, false, false, false],
            ['support',        false, false, false, false, false],
            ['accountant',     false, false, false, false, false],
        ];
        for (const [role, eligible, input, manager, member, admin] of table) {
            expect([role, isEvaluationPointEligibleRole(role)]).toEqual([role, eligible]);
            expect([role, canInputEvaluationPoints(role)]).toEqual([role, input]);
            expect([role, isEvaluationPointManager(role)]).toEqual([role, manager]);
            expect([role, isEvaluationPointMemberRole(role)]).toEqual([role, member]);
            expect([role, isEvaluationPointAdmin(role)]).toEqual([role, admin]);
        }
    });

    it('DB の大文字ロールも小文字にそろえて判定する', () => {
        expect(isEvaluationPointEligibleRole('WORKER')).toBe(true);
        expect(canInputEvaluationPoints('FOREMAN2')).toBe(true);
        expect(isEvaluationPointManager('Admin')).toBe(true);
        expect(isEvaluationPointMemberRole('Foreman1')).toBe(true);
        expect(isEvaluationPointAdmin('ADMIN')).toBe(true);
    });

    it('点数表を直せるのは管理者だけ（ロールが空・無いときも false）', () => {
        for (const role of ['manager', 'MANAGER', 'foreman1', 'worker', 'accountant', '', null, undefined]) {
            expect(isEvaluationPointAdmin(role)).toBe(false);
        }
    });

    it('協力会社・応援・税理士はポイントの対象外', () => {
        for (const role of ['partner', 'partner_member', 'PARTNER_MEMBER', 'support', 'accountant', '', null, undefined]) {
            expect(isEvaluationPointEligibleRole(role)).toBe(false);
        }
    });

    it('作業員は付けられない・全員の一覧も見られない', () => {
        expect(canInputEvaluationPoints('worker')).toBe(false);
        expect(isEvaluationPointManager('worker')).toBe(false);
        expect(isEvaluationPointManager('foreman1')).toBe(false);
        expect(isEvaluationPointMemberRole('admin')).toBe(false);
    });
});

describe('日付', () => {
    it("'YYYY-MM-DD' を UTC 0時の Date にし、元に戻せる", () => {
        const d = dateKeyToDate('2026-10-03');
        expect(d?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
        expect(dateToDateKey(d!)).toBe('2026-10-03');
    });

    it('形が違う・実在しない日付は null', () => {
        for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '2026/10/03', '', null, undefined, 20261003]) {
            expect(dateKeyToDate(bad)).toBeNull();
        }
    });

    it('JST の今日: UTC では前日でも、日本の日付を返す', () => {
        // 2026-10-02 15:30 UTC = 2026-10-03 00:30 JST
        expect(todayJstDateKey(new Date('2026-10-02T15:30:00.000Z'))).toBe('2026-10-03');
        // 2026-10-02 14:59 UTC = 2026-10-02 23:59 JST
        expect(todayJstDateKey(new Date('2026-10-02T14:59:00.000Z'))).toBe('2026-10-02');
    });
});

describe('先の日付', () => {
    it('今日より後だけが「先の日付」', () => {
        expect(isFutureDateKey('2026-10-04', '2026-10-03')).toBe(true);
        expect(isFutureDateKey('2026-10-03', '2026-10-03')).toBe(false);
        expect(isFutureDateKey('2026-10-02', '2026-10-03')).toBe(false);
        expect(isFutureDateKey('2027-01-01', '2026-12-31')).toBe(true);
    });
});

describe('toEvaluationPointStatus（DB の文字列を2つの値にそろえる）', () => {
    it("'pending' だけが確認待ち。ほかは全部 'confirmed'", () => {
        expect(toEvaluationPointStatus('pending')).toBe('pending');
        expect(toEvaluationPointStatus('confirmed')).toBe('confirmed');
        for (const other of ['', 'PENDING', 'unknown', null, undefined]) {
            expect(toEvaluationPointStatus(other)).toBe('confirmed');
        }
    });
});

describe('点数として受け付ける値', () => {
    it('0〜9999 の整数だけ', () => {
        expect(isValidPoints(0)).toBe(true);
        expect(isValidPoints(3)).toBe(true);
        expect(isValidPoints(9999)).toBe(true);
        for (const bad of [-1, 10000, 1.5, NaN, Infinity, '3', null, undefined]) {
            expect(isValidPoints(bad)).toBe(false);
        }
    });
});

describe('resolveRateAt（その日付に使う点数）', () => {
    const rates = [
        rate('a', 2, '2026-10-05'),
        rate('b', 3, '2026-11-01'),
    ];

    it('点数を変える前の日付には、前の点数を使う（過去の分は変わらない）', () => {
        expect(resolveRateAt(rates, '2026-10-31')?.points).toBe(2);
    });

    it('適用開始日の当日から新しい点数', () => {
        expect(resolveRateAt(rates, '2026-11-01')?.points).toBe(3);
        expect(resolveRateAt(rates, '2027-01-15')?.points).toBe(3);
    });

    it('項目を作る前の日付の記録には、最初の点数を使う', () => {
        expect(resolveRateAt(rates, '2026-09-30')?.id).toBe('a');
    });

    it('同じ適用開始日に2回入れたら、後から入れたほう', () => {
        const same = [
            rate('typo', 30, '2026-10-05', '2026-10-05T01:00:00.000Z'),
            rate('fixed', 3, '2026-10-05', '2026-10-05T01:05:00.000Z'),
        ];
        expect(resolveRateAt(same, '2026-10-05')?.id).toBe('fixed');
        expect(resolveRateAt(same, '2026-10-01')?.id).toBe('fixed'); // 項目を作る前の日付でも同じ
        expect(resolveRateAt([...same].reverse(), '2026-10-05')?.id).toBe('fixed'); // 並び順に左右されない
    });

    it('入れた日時まで同じなら、毎回同じ行を返す（id の大きいほう）', () => {
        const same = [rate('x1', 1, '2026-10-05'), rate('x2', 2, '2026-10-05')];
        expect(resolveRateAt(same, '2026-10-05')?.id).toBe('x2');
        expect(resolveRateAt([...same].reverse(), '2026-10-05')?.id).toBe('x2');
    });

    it('先の日付の予約は、その日が来るまで使わない', () => {
        expect(resolveRateAt(rates, '2026-10-20')?.points).toBe(2);
    });

    it('行が無ければ null', () => {
        expect(resolveRateAt([], '2026-10-05')).toBeNull();
    });
});

describe('canInputForForeman（その職長の班でポイントを扱ってよいか）', () => {
    it('管理者・マネージャーはどの班でも', () => {
        expect(canInputForForeman({ id: 'admin1', role: 'admin' }, 'foremanA')).toBe(true);
        expect(canInputForForeman({ id: 'manager1', role: 'MANAGER' }, 'foremanA')).toBe(true);
    });

    it('職長は自分が職長の班だけ', () => {
        expect(canInputForForeman({ id: 'foremanA', role: 'foreman2' }, 'foremanA')).toBe(true);
        expect(canInputForForeman({ id: 'foremanA', role: 'FOREMAN1' }, 'foremanB')).toBe(false);
    });

    it('作業員・協力会社は、自分の ID を職長として指定しても扱えない', () => {
        expect(canInputForForeman({ id: 'worker1', role: 'worker' }, 'worker1')).toBe(false);
        expect(canInputForForeman({ id: 'partner1', role: 'partner' }, 'partner1')).toBe(false);
        expect(canInputForForeman({ id: 'pm1', role: 'partner_member' }, 'pm1')).toBe(false);
    });
});

describe('statusForNewRecord', () => {
    it('他の人に付けたら数える・自分に付けたら確認待ち', () => {
        expect(statusForNewRecord('foremanA', 'worker1')).toBe('confirmed');
        expect(statusForNewRecord('foremanA', 'foremanA')).toBe('pending');
        expect(statusForNewRecord('admin1', 'admin1')).toBe('pending');
    });
});

describe('canRemoveRecord（取り消してよいか）', () => {
    const foremanA = { id: 'foremanA', role: 'foreman2' };
    const foremanB = { id: 'foremanB', role: 'FOREMAN1' };
    const admin = { id: 'admin1', role: 'admin' };
    const manager = { id: 'manager1', role: 'manager' };
    const worker = { id: 'worker1', role: 'worker' };

    it('職長は自分が付けた記録だけ取り消せる', () => {
        expect(canRemoveRecord(foremanA, record({ createdBy: 'foremanA' }))).toBe(true);
        expect(canRemoveRecord(foremanB, record({ createdBy: 'foremanA' }))).toBe(false);
    });

    it('管理者・マネージャーは他の人の記録をどれでも取り消せる（確認待ちの却下も）', () => {
        expect(canRemoveRecord(admin, record({ createdBy: 'foremanA' }))).toBe(true);
        expect(canRemoveRecord(manager, record({ userId: 'foremanA', createdBy: 'foremanA', status: 'pending' }))).toBe(true);
    });

    it('自分の分は、確認待ちのあいだだけ取り下げられる', () => {
        expect(canRemoveRecord(foremanA, record({ userId: 'foremanA', createdBy: 'foremanA', status: 'pending' }))).toBe(true);
        expect(canRemoveRecord(foremanA, record({ userId: 'foremanA', createdBy: 'foremanA', status: 'confirmed' }))).toBe(false);
        // 今の作りでは起きない形（確認待ちになるのは、自分で自分に付けたときだけ）。
        // もし他の人が作った確認待ちがあっても、自分では取り下げられない
        expect(canRemoveRecord(foremanA, record({ userId: 'foremanA', createdBy: 'admin1', status: 'pending' }))).toBe(false);
    });

    it('管理者でも、自分の認められた記録は自分では消せない', () => {
        expect(canRemoveRecord(admin, record({ userId: 'admin1', createdBy: 'manager1', status: 'confirmed' }))).toBe(false);
        expect(canRemoveRecord(admin, record({ userId: 'admin1', createdBy: 'admin1', status: 'confirmed' }))).toBe(false);
    });

    it('作業員は何も取り消せない（自分が付けたことになっている記録でも）', () => {
        expect(canRemoveRecord(worker, record({ userId: 'worker2', createdBy: 'worker1' }))).toBe(false);
        expect(canRemoveRecord(worker, record({ userId: 'worker1', createdBy: 'foremanA' }))).toBe(false);
    });
});

describe('canConfirmRecord（確認待ちを認めてよいか）', () => {
    const pending = record({ userId: 'foremanA', createdBy: 'foremanA', status: 'pending' });

    it('管理者・マネージャーだけが認められる', () => {
        expect(canConfirmRecord({ id: 'admin1', role: 'admin' }, pending)).toBe(true);
        expect(canConfirmRecord({ id: 'manager1', role: 'MANAGER' }, pending)).toBe(true);
        expect(canConfirmRecord({ id: 'foremanB', role: 'foreman1' }, pending)).toBe(false);
    });

    it('管理者・マネージャーは、自分の分の確認待ちも認められる（kei 決定 2026-10-05）', () => {
        expect(canConfirmRecord({ id: 'admin1', role: 'admin' }, record({ userId: 'admin1', createdBy: 'admin1', status: 'pending' }))).toBe(true);
        expect(canConfirmRecord({ id: 'manager1', role: 'MANAGER' }, record({ userId: 'manager1', createdBy: 'manager1', status: 'pending' }))).toBe(true);
        // だれが付けた記録かでは変わらない（確認待ちなら認められる）
        expect(canConfirmRecord({ id: 'manager1', role: 'manager' }, record({ userId: 'manager1', createdBy: 'foremanA', status: 'pending' }))).toBe(true);
    });

    it('職長・作業員は、自分の分も、ほかの人の分も認められない', () => {
        expect(canConfirmRecord({ id: 'foremanA', role: 'foreman1' }, pending)).toBe(false);
        expect(canConfirmRecord({ id: 'foremanA', role: 'FOREMAN2' }, pending)).toBe(false);
        expect(canConfirmRecord({ id: 'worker1', role: 'worker' }, record({ userId: 'worker1', createdBy: 'worker1', status: 'pending' }))).toBe(false);
    });

    it('すでに数えている記録は対象外（自分の分でも）', () => {
        expect(canConfirmRecord({ id: 'admin1', role: 'admin' }, record({ status: 'confirmed' }))).toBe(false);
        expect(canConfirmRecord({ id: 'admin1', role: 'admin' }, record({ userId: 'admin1', createdBy: 'manager1', status: 'confirmed' }))).toBe(false);
    });
});

describe('decideDayToggle（出勤簿入力のボタンを1つ押したとき）', () => {
    const foremanA = { id: 'foremanA', role: 'foreman2' };
    const admin = { id: 'admin1', role: 'admin' };
    const wash: PointItemLike = { id: 'wash', isActive: true, inputBy: 'foreman' };
    const oldItem: PointItemLike = { id: 'oldItem', isActive: false, inputBy: 'foreman' };   // 「使わない」にした項目
    const adminOnly: PointItemLike = { id: 'holidayWork', isActive: true, inputBy: 'admin' };  // 管理者・マネージャーだけの項目

    it('付いていない項目を押したら付ける（他の人の行は、数える）', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: true, item: wash, existing: null }))
            .toEqual({ action: 'add', status: 'confirmed' });
    });

    it('自分の行は確認待ちで付ける', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'foremanA', on: true, item: wash, existing: null }))
            .toEqual({ action: 'add', status: 'pending' });
        expect(decideDayToggle({ operator: admin, targetUserId: 'admin1', on: true, item: wash, existing: null }))
            .toEqual({ action: 'add', status: 'pending' });
    });

    it('すでに付いていたら何もしない（二重に付けない）', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: true, item: wash, existing: record({ createdBy: 'admin1' }) }))
            .toEqual({ action: 'none', reason: 'unchanged' });
    });

    it('自分が付けた記録は取り消せる', () => {
        const mine = record({ id: 'r1', createdBy: 'foremanA' });
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: false, item: wash, existing: mine }))
            .toEqual({ action: 'remove', record: mine });
    });

    it('他の人が付けた記録は、職長には取り消せない', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: false, item: wash, existing: record({ createdBy: 'admin1' }) }))
            .toEqual({ action: 'none', reason: 'blocked' });
    });

    it('管理者は、職長が付けた記録も取り消せる', () => {
        const theirs = record({ id: 'r2', createdBy: 'foremanA' });
        expect(decideDayToggle({ operator: admin, targetUserId: 'worker1', on: false, item: wash, existing: theirs }))
            .toEqual({ action: 'remove', record: theirs });
    });

    it('もう無い記録を取り消そうとしても何もしない', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: false, item: wash, existing: null }))
            .toEqual({ action: 'none', reason: 'unchanged' });
    });

    it('自分の確認待ちは取り下げられる。認められた後は取り消せない', () => {
        const pending = record({ id: 'r3', userId: 'foremanA', createdBy: 'foremanA', status: 'pending' });
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'foremanA', on: false, item: wash, existing: pending }))
            .toEqual({ action: 'remove', record: pending });
        const confirmed = record({ id: 'r4', userId: 'foremanA', createdBy: 'foremanA', status: 'confirmed' });
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'foremanA', on: false, item: wash, existing: confirmed }))
            .toEqual({ action: 'none', reason: 'blocked' });
    });

    it('「使わない」にした項目は新しく付けられないが、付いている記録は取り消せる', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: true, item: oldItem, existing: null }))
            .toEqual({ action: 'none', reason: 'rejected' });
        const old = record({ id: 'r5', itemId: 'oldItem', createdBy: 'foremanA' });
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: false, item: oldItem, existing: old }))
            .toEqual({ action: 'remove', record: old });
        // すでに付いている項目を、もう一度「付ける」と送ってきたとき（画面が古い）は、
        // 使っていない項目でも「もうその状態」として扱う（断った扱いにしない）
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: true, item: oldItem, existing: old }))
            .toEqual({ action: 'none', reason: 'unchanged' });
    });

    it('管理者・マネージャーだけの項目は、出勤簿入力では付けることも取り消すこともできない（管理者でも）', () => {
        const rec = record({ id: 'r6', itemId: 'holidayWork', createdBy: 'admin1' });
        for (const operator of [foremanA, admin]) {
            expect(decideDayToggle({ operator, targetUserId: 'worker1', on: true, item: adminOnly, existing: null }))
                .toEqual({ action: 'none', reason: 'rejected' });
            expect(decideDayToggle({ operator, targetUserId: 'worker1', on: false, item: adminOnly, existing: rec }))
                .toEqual({ action: 'none', reason: 'rejected' });
        }
    });

    it('項目が見つからなければ何もしない', () => {
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: true, item: null, existing: null }))
            .toEqual({ action: 'none', reason: 'rejected' });
        expect(decideDayToggle({ operator: foremanA, targetUserId: 'worker1', on: false, item: null, existing: record() }))
            .toEqual({ action: 'none', reason: 'rejected' });
    });
});

describe('summarizeRecords（集計）', () => {
    it('記録に写してある点数を足す。確認待ちは合計に入れない', () => {
        const summary = summarizeRecords([
            { userId: 'w1', itemId: 'wash', points: 2, status: 'confirmed' },
            { userId: 'w1', itemId: 'wash', points: 3, status: 'confirmed' }, // 点数を変えた後の記録
            { userId: 'w1', itemId: 'help', points: 5, status: 'confirmed' },
            { userId: 'w1', itemId: 'extra', points: 4, status: 'pending' },
            { userId: 'w2', itemId: 'help', points: 5, status: 'pending' },
        ]);
        expect(summary.get('w1')).toEqual({
            userId: 'w1',
            byItem: { wash: { count: 2, points: 5 }, help: { count: 1, points: 5 } },
            totalCount: 3,
            totalPoints: 10,
            pendingCount: 1,
            pendingPoints: 4,
        });
        expect(summary.get('w2')).toEqual({
            userId: 'w2', byItem: {}, totalCount: 0, totalPoints: 0, pendingCount: 1, pendingPoints: 5,
        });
    });

    it('記録が無ければ空', () => {
        expect(summarizeRecords([]).size).toBe(0);
    });
});
