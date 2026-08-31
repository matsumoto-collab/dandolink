/**
 * @jest-environment node
 */
import {
    isSpecValueFilled,
    sanitizePresetSpec,
    collectDefaultSpec,
    applyPresetToSpec,
    underlayDefaults,
    hasAnySpecValue,
    normalizeItemDefaultValue,
} from '@/lib/scaffoldingSpec';

describe('isSpecValueFilled', () => {
    it('null / undefined / false / 空文字 は未入力', () => {
        for (const v of [null, undefined, false, '']) {
            expect(isSpecValueFilled(v)).toBe(false);
        }
    });
    it('true / 文字列 は入力済み', () => {
        expect(isSpecValueFilled(true)).toBe(true);
        expect(isSpecValueFilled('一側足場')).toBe(true);
    });
});

describe('sanitizePresetSpec', () => {
    it('未入力の項目は落とす（適用時に既存の入力を消さないため）', () => {
        expect(sanitizePresetSpec({ a: true, b: false, c: null, d: '', e: '2本' })).toEqual({ a: true, e: '2本' });
    });

    it('数値やオブジェクトなど、想定外の型は落とす', () => {
        expect(sanitizePresetSpec({ a: 1, b: { x: 1 }, c: ['x'], d: true })).toEqual({ d: true });
    });

    it('文字列は500文字で切る', () => {
        const long = 'あ'.repeat(600);
        const out = sanitizePresetSpec({ a: long })!;
        expect((out.a as string).length).toBe(500);
    });

    it('オブジェクト以外は null を返す', () => {
        expect(sanitizePresetSpec(null)).toBeNull();
        expect(sanitizePresetSpec('x')).toBeNull();
        expect(sanitizePresetSpec(['x'])).toBeNull();
    });

    it('補足テキスト（__text）もそのまま保持する', () => {
        expect(sanitizePresetSpec({ 'item1__text': 'W900' })).toEqual({ 'item1__text': 'W900' });
    });
});

describe('collectDefaultSpec', () => {
    const groups = [
        { items: [{ id: 'i1', defaultValue: true }, { id: 'i2', defaultValue: null }] },
        { items: [{ id: 'i3', defaultValue: '二類' }, { id: 'i4', defaultValue: false }, { id: 'i5' }] },
    ];

    it('既定値がある項目だけを集める', () => {
        expect(collectDefaultSpec(groups)).toEqual({ i1: true, i3: '二類' });
    });

    it('項目が無いグループでも壊れない', () => {
        expect(collectDefaultSpec([{ items: [] }])).toEqual({});
    });
});

describe('applyPresetToSpec', () => {
    it('テンプレに入っている項目だけ上書きし、他は残す', () => {
        const current = { a: '1本', b: true, c: 'メモ' };
        const preset = { a: '2本', d: true };
        expect(applyPresetToSpec(current, preset)).toEqual({ a: '2本', b: true, c: 'メモ', d: true });
    });

    it('現在の入力が無くても動く', () => {
        expect(applyPresetToSpec(undefined, { a: true })).toEqual({ a: true });
    });
});

describe('underlayDefaults', () => {
    it('既に入っている値のほうを優先する（既定値でユーザー入力を潰さない）', () => {
        expect(underlayDefaults({ a: '2本' }, { a: '1本', b: true })).toEqual({ a: '2本', b: true });
    });

    it('現在が空なら既定値がそのまま入る', () => {
        expect(underlayDefaults(undefined, { a: true })).toEqual({ a: true });
    });
});

describe('hasAnySpecValue', () => {
    it('未入力だけの spec は false', () => {
        expect(hasAnySpecValue({})).toBe(false);
        expect(hasAnySpecValue({ a: null, b: false, c: '' })).toBe(false);
        expect(hasAnySpecValue(undefined)).toBe(false);
    });
    it('1つでも入力があれば true', () => {
        expect(hasAnySpecValue({ a: null, b: '1本' })).toBe(true);
    });
});

describe('normalizeItemDefaultValue', () => {
    it('toggle は真偽値だけ通す', () => {
        expect(normalizeItemDefaultValue('toggle', true)).toBe(true);
        expect(normalizeItemDefaultValue('toggle', '有')).toBeNull();
        expect(normalizeItemDefaultValue('toggle', false)).toBeNull(); // false=既定値なし
    });

    it('segment は選択肢に含まれる値だけ通す', () => {
        expect(normalizeItemDefaultValue('segment', '2本', ['1本', '2本'])).toBe('2本');
        expect(normalizeItemDefaultValue('segment', '3本', ['1本', '2本'])).toBeNull();
        expect(normalizeItemDefaultValue('segment', '2本', null)).toBeNull();
        expect(normalizeItemDefaultValue('segment', true, ['1本'])).toBeNull();
    });

    it('text は文字列をそのまま通す', () => {
        expect(normalizeItemDefaultValue('text', 'W900')).toBe('W900');
        expect(normalizeItemDefaultValue('text', true)).toBeNull();
    });

    it('未入力はすべて null（既定値なし）', () => {
        for (const v of [null, undefined, '']) {
            expect(normalizeItemDefaultValue('text', v as string | null | undefined)).toBeNull();
        }
    });
});
