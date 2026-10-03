/**
 * @jest-environment node
 *
 * lib/evaluationPointsServer.ts の Phase 4 の部品（docs/指示書_評価ポイント.md の 5-2 の 3・4）のテスト。
 *   getEvaluationPointSetting() — 公開の設定（行が無ければ「見せない」）
 *   resolveAccessMode(role)     — 'manager' / 'member' / 'none'
 *
 * @/lib/prisma は jest.setup.ts がモックに差し替えている（where を見ずに、決めた答えを返すだけ）。
 * Phase 1 の部品のテスト（__tests__/lib/evaluationPointsServer.test.ts）は添付そのものなので、そちらには足さない。
 */
import { prisma } from '@/lib/prisma';
import { getEvaluationPointSetting, resolveAccessMode } from '@/lib/evaluationPointsServer';

const settingFindUnique = prisma.evaluationPointSetting.findUnique as unknown as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    settingFindUnique.mockReset();
});

describe('getEvaluationPointSetting', () => {
    it('行が無ければ { showToMembers: false, memberNotice: null }', async () => {
        settingFindUnique.mockResolvedValue(null);
        await expect(getEvaluationPointSetting()).resolves.toEqual({ showToMembers: false, memberNotice: null });
    });

    it('行があれば、その値（id は default）', async () => {
        settingFindUnique.mockResolvedValue({ showToMembers: true, memberNotice: '今は試しの期間です' });
        await expect(getEvaluationPointSetting()).resolves.toEqual({ showToMembers: true, memberNotice: '今は試しの期間です' });
        expect(settingFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'default' } }));
    });
});

describe('resolveAccessMode', () => {
    it('admin・manager は manager（大文字でも）。公開の設定は読まない', async () => {
        for (const role of ['admin', 'manager', 'ADMIN', 'Manager']) {
            expect([role, await resolveAccessMode(role)]).toEqual([role, 'manager']);
        }
        expect(settingFindUnique).not.toHaveBeenCalled();
    });

    it('worker・foreman1・foreman2 は、公開の設定がオンなら member', async () => {
        settingFindUnique.mockResolvedValue({ showToMembers: true, memberNotice: null });
        for (const role of ['worker', 'foreman1', 'foreman2', 'WORKER', 'FOREMAN1']) {
            expect([role, await resolveAccessMode(role)]).toEqual([role, 'member']);
        }
    });

    it('worker・foreman1・foreman2 は、公開の設定がオフ・行が無いなら none', async () => {
        settingFindUnique.mockResolvedValue({ showToMembers: false, memberNotice: 'メモ' });
        for (const role of ['worker', 'foreman1', 'foreman2']) {
            expect([role, await resolveAccessMode(role)]).toEqual([role, 'none']);
        }
        settingFindUnique.mockResolvedValue(null);
        expect(await resolveAccessMode('worker')).toBe('none');
    });

    it('それ以外のロール（協力会社・協力会社のメンバー・応援・税理士・空・無し）は none。公開の設定は読まない', async () => {
        settingFindUnique.mockResolvedValue({ showToMembers: true, memberNotice: null });
        for (const role of ['partner', 'partner_member', 'support', 'accountant', 'PARTNER', '', null, undefined]) {
            expect([role, await resolveAccessMode(role)]).toEqual([role, 'none']);
        }
        expect(settingFindUnique).not.toHaveBeenCalled();
    });
});
