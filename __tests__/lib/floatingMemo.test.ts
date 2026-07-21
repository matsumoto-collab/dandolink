/**
 * @jest-environment node
 */
import { getFloatingMemo, appendFloatingMemo } from '@/lib/floatingMemo';
import { prisma } from '@/lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
    cellRemark: { findUnique: jest.Mock; upsert: jest.Mock };
};

const whereKey = (dateKey: string) => ({
    foremanId_dateKey: { foremanId: 'unassigned', dateKey },
});

describe('getFloatingMemo', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('保存済みのメモがあればその text を返す', async () => {
        mockPrisma.cellRemark.findUnique.mockResolvedValue({ text: '橋本様邸の資材だけ先に降ろす' });

        const text = await getFloatingMemo('2026-07-23');

        expect(text).toBe('橋本様邸の資材だけ先に降ろす');
        // foremanId='unassigned' 固定・dateKey で1件に絞っていること
        expect(mockPrisma.cellRemark.findUnique).toHaveBeenCalledWith({
            where: whereKey('2026-07-23'),
            select: { text: true },
        });
    });

    it('メモが無いときは空文字を返す', async () => {
        mockPrisma.cellRemark.findUnique.mockResolvedValue(null);

        expect(await getFloatingMemo('2026-07-23')).toBe('');
    });

    it('不正な日付形式は throw する', async () => {
        await expect(getFloatingMemo('2026/07/23')).rejects.toThrow('YYYY-MM-DD');
        await expect(getFloatingMemo('')).rejects.toThrow('YYYY-MM-DD');
        expect(mockPrisma.cellRemark.findUnique).not.toHaveBeenCalled();
    });
});

describe('appendFloatingMemo', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.cellRemark.upsert.mockImplementation(async (args: { create: { text: string }; update: { text: string } }) => ({
            foremanId: 'unassigned',
            dateKey: '2026-07-23',
            text: args.update.text,
        }));
    });

    it('メモが無ければ新規作成する（出所印を付けない素のテキスト）', async () => {
        mockPrisma.cellRemark.findUnique.mockResolvedValue(null);

        const result = await appendFloatingMemo('2026-07-23', '10時に材料到着');

        expect(result).toEqual({ dateKey: '2026-07-23', text: '10時に材料到着' });
        expect(mockPrisma.cellRemark.upsert).toHaveBeenCalledWith({
            where: whereKey('2026-07-23'),
            update: { text: '10時に材料到着' },
            create: { foremanId: 'unassigned', dateKey: '2026-07-23', text: '10時に材料到着' },
        });
    });

    it('既存メモがあれば改行で追記し、上書きしない', async () => {
        mockPrisma.cellRemark.findUnique.mockResolvedValue({ text: '先の予定あり' });

        const result = await appendFloatingMemo('2026-07-23', '田中さんに確認');

        // 既存を残したまま改行で連結（上書きしていない）
        expect(result.text).toBe('先の予定あり\n田中さんに確認');
        expect(mockPrisma.cellRemark.upsert).toHaveBeenCalledWith({
            where: whereKey('2026-07-23'),
            update: { text: '先の予定あり\n田中さんに確認' },
            create: { foremanId: 'unassigned', dateKey: '2026-07-23', text: '先の予定あり\n田中さんに確認' },
        });
    });

    it('追記後に500文字を超えるときは追記せず tooLong を返す（丸めない）', async () => {
        const existing = 'あ'.repeat(495);
        mockPrisma.cellRemark.findUnique.mockResolvedValue({ text: existing });

        // 495 + 改行1 + 10 = 506 > 500
        const result = await appendFloatingMemo('2026-07-23', 'い'.repeat(10));

        expect(result.tooLong).toBe(true);
        expect(result.text).toBe(existing); // 現在値のまま
        expect(mockPrisma.cellRemark.upsert).not.toHaveBeenCalled();
    });

    it('ちょうど500文字に収まる追記は許可する', async () => {
        const existing = 'あ'.repeat(489);
        mockPrisma.cellRemark.findUnique.mockResolvedValue({ text: existing });

        // 489 + 改行1 + 10 = 500（上限ちょうど）
        const result = await appendFloatingMemo('2026-07-23', 'い'.repeat(10));

        expect(result.tooLong).toBeUndefined();
        expect(result.text.length).toBe(500);
        expect(mockPrisma.cellRemark.upsert).toHaveBeenCalled();
    });

    it('不正な日付形式は throw し、DB を触らない', async () => {
        await expect(appendFloatingMemo('2026-7-3', 'x')).rejects.toThrow('YYYY-MM-DD');
        expect(mockPrisma.cellRemark.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.cellRemark.upsert).not.toHaveBeenCalled();
    });

    it('追記内容が空（空白のみ）なら現在値を返すだけで書き込まない', async () => {
        mockPrisma.cellRemark.findUnique.mockResolvedValue({ text: '既存メモ' });

        const result = await appendFloatingMemo('2026-07-23', '   ');

        expect(result).toEqual({ dateKey: '2026-07-23', text: '既存メモ' });
        expect(mockPrisma.cellRemark.upsert).not.toHaveBeenCalled();
    });
});
