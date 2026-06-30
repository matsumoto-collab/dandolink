import { resolveConstructionTypeForFile, type AssignmentForMatch } from '@/lib/photoConstructionType';

const ctNameById = new Map([
    ['ct-joto', '上棟シート貼り'],
    ['ct-kaitai', '解体'],
]);

// 既定: 2026-06-30(JST) の foreman1 の配置・工種=上棟シート貼り
function asg(over: Partial<AssignmentForMatch> = {}): AssignmentForMatch {
    return {
        date: '2026-06-30T00:00:00+09:00',
        assignedEmployeeId: 'foreman1',
        workerIds: [],
        workStartedAt: null,
        workEndedAt: null,
        constructionType: 'ct-joto',
        ...over,
    };
}

describe('resolveConstructionTypeForFile', () => {
    it('保存者が不明(null)なら null', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: null, createdAt: '2026-06-30T09:03:00+09:00' },
                [asg()],
                ctNameById,
            ),
        ).toBeNull();
    });

    it('保存者が職長でもメンバーでもない配置しか無ければ null', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'stranger', createdAt: '2026-06-30T09:03:00+09:00' },
                [asg({ assignedEmployeeId: 'foreman1', workerIds: ['member1'] })],
                ctNameById,
            ),
        ).toBeNull();
    });

    it('職長一致・同日なら工種名を返す', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'foreman1', createdAt: '2026-06-30T09:03:00+09:00' },
                [asg({ constructionType: 'ct-joto' })],
                ctNameById,
            ),
        ).toBe('上棟シート貼り');
    });

    it('確定メンバー(workerIds)一致でも工種名を返す', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'member1', createdAt: '2026-06-30T09:03:00+09:00' },
                [asg({ assignedEmployeeId: 'foreman1', workerIds: ['member1'], constructionType: 'ct-kaitai' })],
                ctNameById,
            ),
        ).toBe('解体');
    });

    it('同日に複数配置があれば作業時刻が近い方を選ぶ', () => {
        const assignments = [
            asg({ workEndedAt: '2026-06-30T10:00:00+09:00', constructionType: 'ct-joto' }),
            asg({ workEndedAt: '2026-06-30T17:00:00+09:00', constructionType: 'ct-kaitai' }),
        ];
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'foreman1', createdAt: '2026-06-30T17:05:00+09:00' },
                assignments,
                ctNameById,
            ),
        ).toBe('解体');
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'foreman1', createdAt: '2026-06-30T10:10:00+09:00' },
                assignments,
                ctNameById,
            ),
        ).toBe('上棟シート貼り');
    });

    it('同日が無くても候補から最も近い配置を選ぶ(後日まとめ保存)', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'foreman1', createdAt: '2026-07-02T09:00:00+09:00' },
                [asg({ date: '2026-06-30T00:00:00+09:00', workEndedAt: '2026-06-30T17:00:00+09:00', constructionType: 'ct-joto' })],
                ctNameById,
            ),
        ).toBe('上棟シート貼り');
    });

    it('配置に工種が無ければ null', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'foreman1', createdAt: '2026-06-30T09:03:00+09:00' },
                [asg({ constructionType: null })],
                ctNameById,
            ),
        ).toBeNull();
    });

    it('工種IDがマスタに無ければ null', () => {
        expect(
            resolveConstructionTypeForFile(
                { uploadedBy: 'foreman1', createdAt: '2026-06-30T09:03:00+09:00' },
                [asg({ constructionType: 'ct-unknown' })],
                ctNameById,
            ),
        ).toBeNull();
    });
});
