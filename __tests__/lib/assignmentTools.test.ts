import { normalizeToolIds } from '@/lib/assignmentTools';

describe('normalizeToolIds', () => {
    it('配列でなければ空配列', () => {
        expect(normalizeToolIds(undefined)).toEqual([]);
        expect(normalizeToolIds(null)).toEqual([]);
        expect(normalizeToolIds('t1')).toEqual([]);
        expect(normalizeToolIds({ 0: 't1' })).toEqual([]);
    });

    it('重複・空文字・非文字列を落とし、前後の空白を詰める', () => {
        expect(normalizeToolIds(['t1', 't1', ' t2 ', '', '   ', 3, null, 't3'])).toEqual(['t1', 't2', 't3']);
    });

    it('選んだ順番は保つ（画面の並びと手配表の並びを合わせるため）', () => {
        expect(normalizeToolIds(['t3', 't1', 't2'])).toEqual(['t3', 't1', 't2']);
    });
});
