import { groupFilesByUpload, formatUploadedAt, type GroupableFile } from '@/lib/projectFileGroups';

// 固定基準時刻（Date.now() は使わない）
const BASE = Date.parse('2026-06-30T05:00:00.000Z');
const at = (offsetMin: number) => new Date(BASE + offsetMin * 60000).toISOString();

function file(
    id: string,
    offsetMin: number,
    uploadedBy: string | null,
    uploadedByName: string | null = null,
): GroupableFile {
    return { id, createdAt: at(offsetMin), uploadedBy, uploadedByName };
}

describe('groupFilesByUpload', () => {
    it('空配列は空グループを返す', () => {
        expect(groupFilesByUpload([])).toEqual([]);
    });

    it('単一ファイルは1グループ（保存者情報を引き継ぐ）', () => {
        const groups = groupFilesByUpload([file('a', 0, 'u1', '山田太郎')]);
        expect(groups).toHaveLength(1);
        expect(groups[0].files.map((f) => f.id)).toEqual(['a']);
        expect(groups[0].uploadedBy).toBe('u1');
        expect(groups[0].uploadedByName).toBe('山田太郎');
    });

    it('同一保存者で時刻が近い（30分以内）ものは1グループにまとまる', () => {
        // 入力は createdAt 降順（新しい順）: 5分 → 0分
        const groups = groupFilesByUpload([file('b', 5, 'u1'), file('a', 0, 'u1')]);
        expect(groups).toHaveLength(1);
        expect(groups[0].files.map((f) => f.id)).toEqual(['b', 'a']);
    });

    it('時刻差がちょうど30分なら同一グループ（境界は許容）', () => {
        const groups = groupFilesByUpload([file('b', 30, 'u1'), file('a', 0, 'u1')]);
        expect(groups).toHaveLength(1);
    });

    it('同一保存者でも時刻差が30分を超えると別グループ', () => {
        const groups = groupFilesByUpload([file('b', 31, 'u1'), file('a', 0, 'u1')]);
        expect(groups).toHaveLength(2);
        expect(groups[0].files.map((f) => f.id)).toEqual(['b']);
        expect(groups[1].files.map((f) => f.id)).toEqual(['a']);
    });

    it('保存者が異なれば近接でも別グループ', () => {
        const groups = groupFilesByUpload([file('b', 1, 'u2'), file('a', 0, 'u1')]);
        expect(groups).toHaveLength(2);
    });

    it('連続アップロードは累積でなく直近ファイルとの差で判定する', () => {
        // 各20分間隔で連続: 40 → 20 → 0。先頭と末尾は40分離れるが直近差は20分ずつ → 全て同一
        const groups = groupFilesByUpload([
            file('c', 40, 'u1'),
            file('b', 20, 'u1'),
            file('a', 0, 'u1'),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].files).toHaveLength(3);
    });

    it('保存者不明(null)同士は近接なら同一、nullと実IDは別グループ', () => {
        expect(groupFilesByUpload([file('b', 1, null), file('a', 0, null)])).toHaveLength(1);
        expect(groupFilesByUpload([file('b', 1, null), file('a', 0, 'u1')])).toHaveLength(2);
    });

    it('representativeAt はグループ先頭（最新）の createdAt、key は先頭ファイルの id', () => {
        const groups = groupFilesByUpload([file('b', 5, 'u1'), file('a', 0, 'u1')]);
        expect(groups[0].representativeAt).toBe(at(5));
        expect(groups[0].key).toBe('b');
    });

    it('入力の並び順（降順）を保ったままグループ化する', () => {
        const groups = groupFilesByUpload([
            file('d', 100, 'u1'), // 単独
            file('c', 5, 'u2'),
            file('b', 2, 'u2'),
            file('a', 0, 'u1'),
        ]);
        expect(groups.map((g) => g.key)).toEqual(['d', 'c', 'a']);
        expect(groups[1].files.map((f) => f.id)).toEqual(['c', 'b']);
    });

    it('グループは先頭ファイルの constructionTypeName を採用する', () => {
        const groups = groupFilesByUpload([
            { id: 'b', createdAt: at(5), uploadedBy: 'u1', constructionTypeName: '上棟シート貼り' },
            { id: 'a', createdAt: at(0), uploadedBy: 'u1', constructionTypeName: '上棟シート貼り' },
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].constructionTypeName).toBe('上棟シート貼り');
    });

    it('constructionTypeName が無ければ null', () => {
        const groups = groupFilesByUpload([file('a', 0, 'u1')]);
        expect(groups[0].constructionTypeName).toBeNull();
    });
});

describe('formatUploadedAt', () => {
    it('正常な ISO 文字列は空でない文字列を返す', () => {
        expect(formatUploadedAt('2026-06-30T05:25:00.000Z').length).toBeGreaterThan(0);
    });

    it('不正な日付文字列は空文字を返す', () => {
        expect(formatUploadedAt('not-a-date')).toBe('');
    });
});
