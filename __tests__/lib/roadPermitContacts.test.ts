/**
 * 道路申請の「担当者の候補」（lib/roadPermit/contacts.ts）。
 * DB の JSON の正規化と、画面の「選ぶ」欄がどの候補を指すかの判定。
 */
import {
    ROAD_PERMIT_CONTACTS_MAX,
    contactPresetIndexOf,
    isContactBlank,
    normalizeRoadPermitContacts,
} from '@/lib/roadPermit/contacts';

describe('normalizeRoadPermitContacts', () => {
    it('配列でなければ空', () => {
        expect(normalizeRoadPermitContacts(null)).toEqual([]);
        expect(normalizeRoadPermitContacts('壊れた')).toEqual([]);
        expect(normalizeRoadPermitContacts({ name: 'a' })).toEqual([]);
    });

    it('前後の空白を取り、名前も電話も空の行は落とす。並び順は保つ', () => {
        expect(
            normalizeRoadPermitContacts([
                { name: ' 今井　公一郎 ', phone: '089-000-0000 ' },
                { name: '', phone: '  ' },
                null,
                '文字',
                { name: '三生　浩人' },
                { phone: '090-1111-2222' },
                { name: 123, phone: ['x'] },
            ]),
        ).toEqual([
            { name: '今井　公一郎', phone: '089-000-0000' },
            { name: '三生　浩人', phone: '' },
            { name: '', phone: '090-1111-2222' },
        ]);
    });

    it('上限を超えた分は落とす', () => {
        const many = Array.from({ length: ROAD_PERMIT_CONTACTS_MAX + 5 }, (_, i) => ({ name: `人${i}`, phone: '' }));
        expect(normalizeRoadPermitContacts(many)).toHaveLength(ROAD_PERMIT_CONTACTS_MAX);
    });
});

describe('contactPresetIndexOf', () => {
    const contacts = [
        { name: '今井　公一郎', phone: '089-000-0000' },
        { name: '三生　浩人', phone: '090-1111-2222' },
    ];

    it('氏名・電話が同じ候補の番号（前後の空白は無視）', () => {
        expect(contactPresetIndexOf(contacts, { name: '今井　公一郎', phone: '089-000-0000' })).toBe(0);
        expect(contactPresetIndexOf(contacts, { name: ' 三生　浩人 ', phone: '090-1111-2222 ' })).toBe(1);
    });

    it('どちらかが違えば -1（手で直したら「自由入力」）', () => {
        expect(contactPresetIndexOf(contacts, { name: '今井　公一郎', phone: '090-9999-9999' })).toBe(-1);
        expect(contactPresetIndexOf(contacts, { name: '別の人', phone: '089-000-0000' })).toBe(-1);
    });

    it('氏名も電話も空なら -1。候補が無くても落ちない', () => {
        expect(contactPresetIndexOf(contacts, { name: '', phone: ' ' })).toBe(-1);
        expect(contactPresetIndexOf([], { name: '今井　公一郎', phone: '089-000-0000' })).toBe(-1);
    });
});

describe('isContactBlank', () => {
    it('氏名も電話も空（空白だけ）のときだけ true', () => {
        expect(isContactBlank({ name: '', phone: '' })).toBe(true);
        expect(isContactBlank({ name: '  ', phone: ' ' })).toBe(true);
        expect(isContactBlank({ name: '今井', phone: '' })).toBe(false);
        expect(isContactBlank({ name: '', phone: '089' })).toBe(false);
    });
});
