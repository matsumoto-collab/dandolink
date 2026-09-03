import {
    bucketKeyFor,
    siteKindFromProject,
    workKindFromConstructionContent,
} from '@/lib/orderBacklog/classify';
import { DEFAULT_INDIVIDUAL_THRESHOLD } from '@/lib/orderBacklog/types';

describe('workKindFromConstructionContent', () => {
    it('新築だけが新築工事になる', () => {
        expect(workKindFromConstructionContent('新築')).toBe('new');
    });

    it('UUIDマスタ化前の旧enum値も新築として拾う', () => {
        expect(workKindFromConstructionContent('new_construction')).toBe('new');
    });

    it('改修・大規模・その他・屋根壁・仮囲いは仮設工事', () => {
        for (const v of ['改修', 'renovation', '大規模', 'large_scale', 'その他', 'other', '屋根・壁', '仮囲い']) {
            expect(workKindFromConstructionContent(v)).toBe('temp');
        }
    });

    it('未設定・空文字・空白だけは仮設工事', () => {
        expect(workKindFromConstructionContent(null)).toBe('temp');
        expect(workKindFromConstructionContent(undefined)).toBe('temp');
        expect(workKindFromConstructionContent('')).toBe('temp');
        expect(workKindFromConstructionContent('   ')).toBe('temp');
    });

    it('前後の空白は無視する', () => {
        expect(workKindFromConstructionContent(' 新築 ')).toBe('new');
    });
});

describe('siteKindFromProject', () => {
    it('敬称が様邸・様なら住宅', () => {
        expect(siteKindFromProject({ honorific: '様邸', name: 'A工事' })).toBe('house');
        expect(siteKindFromProject({ honorific: '様', name: 'A工事' })).toBe('house');
    });

    it('敬称が御中なら住宅ではない', () => {
        expect(siteKindFromProject({ honorific: '御中', name: 'A工事' })).toBe('other');
    });

    it('敬称が無くても現場名・案件名に「邸」があれば住宅', () => {
        expect(siteKindFromProject({ name: '山田邸' })).toBe('house');
        expect(siteKindFromProject({ honorific: '', title: '山田邸　外壁塗装工事' })).toBe('house');
    });

    it('どこにも手がかりが無ければ他', () => {
        expect(siteKindFromProject({})).toBe('other');
        expect(siteKindFromProject({ honorific: null, name: null, title: null })).toBe('other');
        expect(siteKindFromProject({ name: '○○ビル新築工事' })).toBe('other');
    });
});

describe('bucketKeyFor', () => {
    const line = (contractAmount: number, over: Partial<{ workKind: 'temp' | 'new'; siteKind: 'house' | 'other' }> = {}) => ({
        workKind: 'temp' as const,
        siteKind: 'other' as const,
        contractAmount,
        ...over,
    });

    it('既定の閾値（100万円）の境界', () => {
        // 499,999→low / 500,000→mid / 999,999→mid / 1,000,000→個別行(null)
        expect(bucketKeyFor(line(499999), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_other_low');
        expect(bucketKeyFor(line(500000), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_other_mid');
        expect(bucketKeyFor(line(999999), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_other_mid');
        expect(bucketKeyFor(line(1000000), DEFAULT_INDIVIDUAL_THRESHOLD)).toBeNull();
    });

    it('0円・マイナスは low', () => {
        expect(bucketKeyFor(line(0), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_other_low');
        expect(bucketKeyFor(line(-1), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_other_low');
    });

    it('工事の種類×現場の種類で8区分に分かれる', () => {
        expect(bucketKeyFor(line(600000, { workKind: 'temp', siteKind: 'other' }), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_other_mid');
        expect(bucketKeyFor(line(400000, { workKind: 'temp', siteKind: 'house' }), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('temp_house_low');
        expect(bucketKeyFor(line(600000, { workKind: 'new', siteKind: 'other' }), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('new_other_mid');
        expect(bucketKeyFor(line(400000, { workKind: 'new', siteKind: 'house' }), DEFAULT_INDIVIDUAL_THRESHOLD)).toBe('new_house_low');
    });

    it('閾値を変えると個別行になる範囲が変わる', () => {
        // 閾値 300万 → 100万は集約側（50万以上なので mid）
        expect(bucketKeyFor(line(1000000), 3000000)).toBe('temp_other_mid');
        expect(bucketKeyFor(line(3000000), 3000000)).toBeNull();
        // 閾値 30万 → 40万は個別行
        expect(bucketKeyFor(line(400000), 300000)).toBeNull();
        expect(bucketKeyFor(line(200000), 300000)).toBe('temp_other_low');
    });
});
