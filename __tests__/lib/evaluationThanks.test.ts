/**
 * lib/evaluationThanks.ts（評価ポイント「ありがとう」の決まりごと）のテスト。
 */
import {
    THANKS_DAILY_LIMIT,
    THANKS_ITEM_NAME,
    THANKS_MESSAGE_MAX,
    THANKS_POINTS_MAX,
    THANKS_POINTS_MIN,
    THANKS_VIRTUAL_ITEM_ID,
    canRemoveThanks,
    canUseThanks,
    decideSendThanks,
    isThanksAdmin,
    isThanksManager,
    isValidThanksPoints,
    normalizeThanksMessage,
    remainingThanksToday,
    summarizeThanks,
    type SendThanksDecisionInput,
} from '@/lib/evaluationThanks';

const MSG = {
    forbidden: '権限がありません',
    inactive: '「ありがとう」は、今は使えません（管理者が、設定の「評価ポイント」で「使う」にすると、送れます）',
    notFound: '相手が見つかりません',
    self: '自分には送れません',
    notEligible: '「ありがとう」を送れない相手です',
    already: '今日は、もうこの人に送っています（同じ人には1日1回までです）',
    limit: '1日に送れるのは3回までです',
};

describe('定数', () => {
    it('決まった値', () => {
        expect([THANKS_DAILY_LIMIT, THANKS_MESSAGE_MAX, THANKS_POINTS_MIN, THANKS_POINTS_MAX]).toEqual([3, 100, 0, 9999]);
        expect([THANKS_VIRTUAL_ITEM_ID, THANKS_ITEM_NAME]).toEqual(['__thanks__', 'ありがとう']);
    });
});

describe('ロールの判定（大文字が混ざっても小文字にそろえて比べる）', () => {
    it('canUseThanks: worker・foreman1・foreman2・manager・admin だけ', () => {
        for (const role of ['worker', 'foreman1', 'foreman2', 'manager', 'admin', 'WORKER', 'Admin', 'FOREMAN2']) {
            expect([role, canUseThanks(role)]).toEqual([role, true]);
        }
        for (const role of ['partner', 'PARTNER', 'partner_member', 'support', 'accountant', 'tax_accountant', '', null, undefined]) {
            expect([role, canUseThanks(role)]).toEqual([role, false]);
        }
    });

    it('isThanksManager: admin・manager だけ', () => {
        expect(['admin', 'MANAGER', 'manager'].map(isThanksManager)).toEqual([true, true, true]);
        expect(['foreman1', 'foreman2', 'worker', 'partner', null].map(isThanksManager)).toEqual([false, false, false, false, false]);
    });

    it('isThanksAdmin: admin だけ', () => {
        expect(['admin', 'ADMIN'].map(isThanksAdmin)).toEqual([true, true]);
        expect(['manager', 'foreman1', 'worker', undefined].map(isThanksAdmin)).toEqual([false, false, false, false]);
    });
});

describe('isValidThanksPoints（0〜9999 の整数）', () => {
    it.each([0, 1, 9999])('%p は受け付ける', (v) => expect(isValidThanksPoints(v)).toBe(true));
    it.each([-1, 10000, 1.5, NaN, Infinity, '1', null, undefined, true])('%p は受け付けない', (v) => expect(isValidThanksPoints(v)).toBe(false));
});

describe('normalizeThanksMessage', () => {
    it('undefined・null・空・空白だけ → null', () => {
        for (const v of [undefined, null, '', '   ', '\n\t ']) expect(normalizeThanksMessage(v)).toEqual({ ok: true, value: null });
    });
    it('前後の空白を取る', () => {
        expect(normalizeThanksMessage('  助かりました！ ')).toEqual({ ok: true, value: '助かりました！' });
    });
    it('100字ちょうどは受け付け、101字は断る（前後の空白は字数に入れない）', () => {
        expect(normalizeThanksMessage(` ${'あ'.repeat(100)} `)).toEqual({ ok: true, value: 'あ'.repeat(100) });
        expect(normalizeThanksMessage('あ'.repeat(101))).toEqual({ ok: false });
    });
    it('文字列でないものは断る', () => {
        for (const v of [1, true, {}, [], ['a']]) expect(normalizeThanksMessage(v)).toEqual({ ok: false });
    });
});

describe('decideSendThanks', () => {
    const base = (over: Partial<SendThanksDecisionInput> = {}): SendThanksDecisionInput => ({
        active: true,
        fromId: 'me',
        fromRole: 'worker',
        to: { id: 'you', role: 'foreman1', isActive: true },
        sentTodayToIds: [],
        ...over,
    });
    const fail = (status: number, message: string) => ({ ok: false, status, message });

    it('すべて満たせば ok（ロールは大文字が混ざってもよい）', () => {
        expect(decideSendThanks(base())).toEqual({ ok: true });
        expect(decideSendThanks(base({ fromRole: 'FOREMAN2', to: { id: 'you', role: 'ADMIN', isActive: true }, sentTodayToIds: ['a', 'b'] }))).toEqual({ ok: true });
    });

    it('1. 送る人のロールが対象外 → 403', () => {
        for (const fromRole of ['partner', 'partner_member', 'support', 'accountant', '', null, undefined]) {
            expect(decideSendThanks(base({ fromRole }))).toEqual(fail(403, MSG.forbidden));
        }
    });
    it('2. 使わない → 400', () => {
        expect(decideSendThanks(base({ active: false }))).toEqual(fail(400, MSG.inactive));
    });
    it('3. 相手が無い・在籍していない → 400', () => {
        expect(decideSendThanks(base({ to: null }))).toEqual(fail(400, MSG.notFound));
        expect(decideSendThanks(base({ to: { id: 'you', role: 'worker', isActive: false } }))).toEqual(fail(400, MSG.notFound));
    });
    it('4. 相手が自分 → 400', () => {
        expect(decideSendThanks(base({ to: { id: 'me', role: 'worker', isActive: true } }))).toEqual(fail(400, MSG.self));
    });
    it('5. 相手のロールが対象外 → 400', () => {
        for (const role of ['partner', 'PARTNER', 'support', 'accountant', null]) {
            expect(decideSendThanks(base({ to: { id: 'you', role, isActive: true } }))).toEqual(fail(400, MSG.notEligible));
        }
    });
    it('6. 今日もうその相手に送っている → 400', () => {
        expect(decideSendThanks(base({ sentTodayToIds: ['you'] }))).toEqual(fail(400, MSG.already));
    });
    it('7. 今日もう3回送っている → 400（2回なら送れる）', () => {
        expect(decideSendThanks(base({ sentTodayToIds: ['a', 'b', 'c'] }))).toEqual(fail(400, MSG.limit));
        expect(decideSendThanks(base({ sentTodayToIds: ['a', 'b'] }))).toEqual({ ok: true });
    });

    describe('順番: 2つ以上に当たるときは、先のほうの文言', () => {
        it('1 と 2〜7 の全部 → 1', () => {
            expect(decideSendThanks({
                active: false, fromId: 'me', fromRole: 'partner', to: { id: 'me', role: 'partner', isActive: false }, sentTodayToIds: ['me', 'a', 'b'],
            })).toEqual(fail(403, MSG.forbidden));
        });
        it('2 と 3〜7 → 2', () => {
            expect(decideSendThanks(base({ active: false, to: null, sentTodayToIds: ['a', 'b', 'c'] }))).toEqual(fail(400, MSG.inactive));
            expect(decideSendThanks(base({ active: false, to: { id: 'me', role: 'worker', isActive: true } }))).toEqual(fail(400, MSG.inactive));
        });
        it('3 と 4・5・7 → 3（在籍していない自分・対象外）', () => {
            expect(decideSendThanks(base({ to: { id: 'me', role: 'partner', isActive: false }, sentTodayToIds: ['a', 'b', 'c'] }))).toEqual(fail(400, MSG.notFound));
        });
        it('4 と 5・6・7 → 4', () => {
            expect(decideSendThanks(base({ to: { id: 'me', role: 'partner', isActive: true }, sentTodayToIds: ['me', 'a', 'b'] }))).toEqual(fail(400, MSG.self));
        });
        it('5 と 6・7 → 5', () => {
            expect(decideSendThanks(base({ to: { id: 'you', role: 'support', isActive: true }, sentTodayToIds: ['you', 'a', 'b'] }))).toEqual(fail(400, MSG.notEligible));
        });
        it('6 と 7 → 6', () => {
            expect(decideSendThanks(base({ sentTodayToIds: ['you', 'a', 'b'] }))).toEqual(fail(400, MSG.already));
        });
    });
});

describe('remainingThanksToday', () => {
    it('3 − 送った数（0 より小さくしない）', () => {
        expect([0, 1, 2, 3, 4].map(remainingThanksToday)).toEqual([3, 2, 1, 0, 0]);
    });
});

describe('canRemoveThanks', () => {
    const TODAY = '2026-10-05';
    const mine = { fromUserId: 'foremanA', dateKey: TODAY };

    it('送った本人: 送った日のうちは取り消せる', () => {
        expect(canRemoveThanks({ id: 'foremanA', role: 'foreman1' }, mine, TODAY)).toBe(true);
        expect(canRemoveThanks({ id: 'worker1', role: 'WORKER' }, { fromUserId: 'worker1', dateKey: TODAY }, TODAY)).toBe(true);
    });
    it('送った本人: 翌日からは取り消せない', () => {
        expect(canRemoveThanks({ id: 'foremanA', role: 'foreman1' }, mine, '2026-10-06')).toBe(false);
    });
    it('ほかの職長・作業員は、当日でも取り消せない', () => {
        expect(canRemoveThanks({ id: 'foremanB', role: 'foreman2' }, mine, TODAY)).toBe(false);
        expect(canRemoveThanks({ id: 'worker1', role: 'worker' }, mine, TODAY)).toBe(false);
    });
    it('マネージャー・管理者は、いつでも・だれの分でも', () => {
        expect(canRemoveThanks({ id: 'manager1', role: 'manager' }, mine, '2027-01-01')).toBe(true);
        expect(canRemoveThanks({ id: 'admin1', role: 'ADMIN' }, { fromUserId: 'x', dateKey: '2020-01-01' }, TODAY)).toBe(true);
    });
    it('対象外のロールは、自分が送った分（の形の行）でも取り消せない', () => {
        expect(canRemoveThanks({ id: 'p1', role: 'partner' }, { fromUserId: 'p1', dateKey: TODAY }, TODAY)).toBe(false);
    });
});

describe('summarizeThanks', () => {
    it('もらった人ごとに、回数と行の点数の合計', () => {
        const result = summarizeThanks([
            { toUserId: 'a', points: 1 },
            { toUserId: 'b', points: 2 },
            { toUserId: 'a', points: 3 },
            { toUserId: 'a', points: 0 },
        ]);
        expect(Object.fromEntries(result)).toEqual({ a: { count: 3, points: 4 }, b: { count: 1, points: 2 } });
    });
    it('空なら空', () => {
        expect(summarizeThanks([]).size).toBe(0);
    });
});
