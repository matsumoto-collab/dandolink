import {
    haversineKm,
    normalizePlace,
    medianPoint,
    formatAddress,
    resolvePlaceFromAddresses,
    formatGeocodedLabel,
    findNearbyJobs,
    DEFAULT_RADIUS_KM,
} from '@/lib/nearbyJobs';
import { prisma } from '@/lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma> & {
    projectMaster: { findMany: jest.Mock };
    projectAssignment: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
};

// 松山市周辺の実座標に近い値（実データのサンプルから）
const MATSUYAMA = { latitude: 33.8392, longitude: 132.7657 }; // 松山市中心部
const HOJO = { latitude: 33.9773, longitude: 132.7727 };      // 松山市北条（中心から約15km北）
const NIIHAMA = { latitude: 33.9601, longitude: 133.2836 };   // 新居浜市（中心から約48km東）

const addr = (prefecture: string, city: string, location: string, p: { latitude: number; longitude: number } | null) => ({
    prefecture, city, location,
    latitude: p?.latitude ?? null,
    longitude: p?.longitude ?? null,
});

describe('haversineKm', () => {
    it('同じ地点は0km', () => {
        expect(haversineKm(MATSUYAMA, MATSUYAMA)).toBe(0);
    });

    it('松山市中心〜北条は約15km', () => {
        const d = haversineKm(MATSUYAMA, HOJO);
        expect(d).toBeGreaterThan(14);
        expect(d).toBeLessThan(17);
    });

    it('松山市中心〜新居浜は約48km', () => {
        const d = haversineKm(MATSUYAMA, NIIHAMA);
        expect(d).toBeGreaterThan(44);
        expect(d).toBeLessThan(52);
    });
});

describe('normalizePlace', () => {
    it('全角数字・空白のゆらぎを吸収する', () => {
        expect(normalizePlace('松山市西石井３丁目 ４')).toBe(normalizePlace('松山市西石井3丁目4'));
    });

    it('大字・字を落とす', () => {
        expect(normalizePlace('松山市大字北条')).toBe('松山市北条');
    });

    it('ヶ・ケのゆらぎを吸収する', () => {
        expect(normalizePlace('八ヶ峰')).toBe(normalizePlace('八ケ峰'));
    });
});

describe('medianPoint', () => {
    it('空配列は null', () => {
        expect(medianPoint([])).toBeNull();
    });

    it('外れ値1件に引きずられない（平均ではなく中央値）', () => {
        const points = [
            { latitude: 33.98, longitude: 132.77 },
            { latitude: 33.97, longitude: 132.78 },
            { latitude: 33.96, longitude: 132.76 },
            { latitude: 35.68, longitude: 139.76 }, // 東京（同名地名の別地域を想定）
        ];
        const center = medianPoint(points)!;
        expect(haversineKm(center, HOJO)).toBeLessThan(3);
    });
});

describe('formatAddress', () => {
    it('県＋市区町村＋番地を連結し、欠けている項目は詰める', () => {
        expect(formatAddress({ prefecture: '愛媛県', city: '松山市南吉田町', location: '354-7' })).toBe('愛媛県松山市南吉田町354-7');
        expect(formatAddress({ prefecture: '愛媛県', city: null, location: null })).toBe('愛媛県');
    });
});

describe('resolvePlaceFromAddresses', () => {
    const rows = [
        addr('愛媛県', '松山市北条辻', '12', { latitude: 33.9773, longitude: 132.7727 }),
        addr('愛媛県', '松山市北条', '3-1', { latitude: 33.9750, longitude: 132.7800 }),
        addr('愛媛県', '松山市南吉田町', '354-7', MATSUYAMA),
        addr('愛媛県', '新居浜市船木', '4626-2', NIIHAMA),
    ];

    it('地名を含む案件の座標の中央値を基準点にする', () => {
        const r = resolvePlaceFromAddresses('北条', rows)!;
        expect(r.source).toBe('projects');
        expect(r.matchedProjects).toBe(2);
        expect(haversineKm(r, HOJO)).toBeLessThan(2);
        expect(r.label).toContain('北条');
    });

    it('座標が無い案件しか当たらなければ null', () => {
        const r = resolvePlaceFromAddresses('道後', [addr('愛媛県', '松山市道後町', '1', null)]);
        expect(r).toBeNull();
    });

    it('1文字の地名は誤ヒットするので受け付けない', () => {
        expect(resolvePlaceFromAddresses('市', rows)).toBeNull();
    });

    it('全角数字で書かれた住所も引ける', () => {
        const zenkaku = [addr('愛媛県', '松山市西石井３丁目４', '１２', MATSUYAMA)];
        expect(resolvePlaceFromAddresses('西石井3丁目', zenkaku)).not.toBeNull();
    });

    it('どの案件にも無い地名は null（呼び出し側が地図サービスへ回す）', () => {
        expect(resolvePlaceFromAddresses('那覇市', rows)).toBeNull();
    });
});

describe('formatGeocodedLabel', () => {
    it('細→粗の display_name を「県市町 付近」に直す（国名と郵便番号は落とす）', () => {
        expect(formatGeocodedLabel('喜与町, 松山市, 愛媛県, 790-0000, 日本', '喜与町')).toBe('愛媛県松山市喜与町 付近');
    });

    it('道路名など余計な要素が先頭にあっても粗い側3つだけ使う', () => {
        expect(formatGeocodedLabel('護国神社前線, 喜与町二丁目, 喜与町, 松山市, 愛媛県, 日本', '喜与町')).toBe('愛媛県松山市喜与町 付近');
    });

    it('display_name が無ければ質問された地名で代用する', () => {
        expect(formatGeocodedLabel(undefined, '愛媛県北条')).toBe('愛媛県北条 付近');
    });
});

describe('findNearbyJobs', () => {
    const projectAt = (name: string, p: { latitude: number; longitude: number } | null, city: string) => ({
        name, title: `${name} 工事`, honorific: '様邸', createdBy: JSON.stringify(['u1']),
        prefecture: '愛媛県', city, location: '1-1',
        latitude: p?.latitude ?? null, longitude: p?.longitude ?? null,
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // 地名解決用（北条＝2件・松山中心＝1件）
        mockPrisma.projectMaster.findMany.mockResolvedValue([
            addr('愛媛県', '松山市北条辻', '12', HOJO),
            addr('愛媛県', '松山市南吉田町', '354-7', MATSUYAMA),
        ]);
        mockPrisma.user.findMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
            const ids: string[] = args?.where?.id?.in ?? [];
            const all: Record<string, string> = { f1: '玉ノ井', f2: '開成工業', u1: '佐藤' };
            return ids.filter((id) => all[id]).map((id) => ({ id, displayName: all[id] }));
        });
    });

    it('既定の半径3km以内の現場だけを近い順に返す', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('山田', HOJO, '松山市北条辻') },
            { date: new Date('2026-07-24T00:00:00+09:00'), projectMasterId: 'p2', assignedEmployeeId: 'f2', memberCount: 2, dateStatus: 'confirmed', projectMaster: projectAt('鈴木', MATSUYAMA, '松山市南吉田町') },
        ]);

        const result = await findNearbyJobs({ place: '北条', startDate: '2026-07-22', endDate: '2026-07-28' });

        expect(result.radiusKm).toBe(DEFAULT_RADIUS_KM);
        expect(DEFAULT_RADIUS_KM).toBe(3);
        expect(result.expanded).toBe(false);
        expect(result.resolved?.source).toBe('projects');
        expect(result.checkedCount).toBe(2);
        // 松山市中心（約15km）は範囲外なので落ちる
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0].site).toBe('山田様邸');
        expect(result.jobs[0].schedule).toEqual([
            { date: '2026-07-23', team: '玉ノ井', memberCount: 3, dateStatus: 'confirmed' },
        ]);
        expect(result.jobs[0].distanceKm).toBeLessThan(2);
        expect(result.jobs[0].owners).toEqual(['佐藤']);
        expect(result.totalInRadius).toBe(1);
    });

    it('同じ現場の複数日は1件にまとめ、日付順の schedule にする', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-24T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 4, dateStatus: 'confirmed', projectMaster: projectAt('山田', HOJO, '松山市北条辻') },
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('山田', HOJO, '松山市北条辻') },
            { date: new Date('2026-07-25T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f2', memberCount: 2, dateStatus: 'tentative', projectMaster: projectAt('山田', HOJO, '松山市北条辻') },
        ]);

        const result = await findNearbyJobs({ place: '北条' });

        expect(result.jobs).toHaveLength(1);
        expect(result.checkedCount).toBe(1);
        expect(result.jobs[0].schedule.map((d) => d.date)).toEqual(['2026-07-23', '2026-07-24', '2026-07-25']);
        expect(result.jobs[0].schedule[2]).toMatchObject({ team: '開成工業', dateStatus: 'tentative' });
    });

    it('浮き（班未定）は team=null で返す', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'unassigned', memberCount: 4, dateStatus: 'tentative', projectMaster: projectAt('高橋', HOJO, '松山市北条辻') },
        ]);

        const result = await findNearbyJobs({ place: '北条' });

        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0].schedule[0].team).toBeNull();
        expect(result.jobs[0].schedule[0].dateStatus).toBe('tentative');
    });

    it('座標が無い案件は距離を出さず unknownLocation に件数と現場名を積む（黙って落とさない）', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('山田', HOJO, '松山市北条辻') },
            { date: new Date('2026-07-24T00:00:00+09:00'), projectMasterId: 'p2', assignedEmployeeId: 'f2', memberCount: 2, dateStatus: 'confirmed', projectMaster: projectAt('田中', null, '松山市') },
        ]);

        const result = await findNearbyJobs({ place: '北条' });

        expect(result.checkedCount).toBe(1);
        expect(result.unknownLocation.count).toBe(1);
        expect(result.unknownLocation.sites).toEqual(['田中様邸']);
    });

    it('3km以内が0件なら5kmまで広げて拾う（expanded=true）', async () => {
        // 基準点（北条）から約4km北の現場＝3kmでは空振り・5kmなら入る
        const four_km_north = { latitude: HOJO.latitude + 0.036, longitude: HOJO.longitude };
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('山田', four_km_north, '松山市河野') },
        ]);

        const result = await findNearbyJobs({ place: '北条' });

        expect(result.expanded).toBe(true);
        expect(result.radiusKm).toBe(5);
        expect(result.totalInRadius).toBe(1);
        expect(result.jobs[0].outsideRadius).toBeUndefined();
        expect(result.jobs[0].distanceKm).toBeGreaterThan(3);
        // 「広げた」ことはプロンプト任せにせずデータで渡す
        expect(result.notice).toBe('3km以内には予定がなかったため、5km以内まで広げた結果です。');
    });

    it('半径を明示された質問では自動拡大しない（指定の意図を尊重する）', async () => {
        const four_km_north = { latitude: HOJO.latitude + 0.036, longitude: HOJO.longitude };
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('山田', four_km_north, '松山市河野') },
        ]);

        const result = await findNearbyJobs({ place: '北条', radiusKm: 2 });

        expect(result.radiusKm).toBe(2);
        expect(result.expanded).toBe(false);
        expect(result.totalInRadius).toBe(0);
        expect(result.jobs[0].outsideRadius).toBe(true);
    });

    it('5km以内にも無ければ一番近い現場を outsideRadius 付きで返す', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('鈴木', MATSUYAMA, '松山市南吉田町') },
        ]);

        const result = await findNearbyJobs({ place: '北条' });

        // 3km→5kmまで広げても見つからなかったので最寄りを参考として返す
        expect(result.expanded).toBe(true);
        expect(result.radiusKm).toBe(5);
        expect(result.notice).toBe('5km以内には予定がありません。参考に一番近い現場を挙げています。');
        expect(result.totalInRadius).toBe(0);
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0].outsideRadius).toBe(true);
        expect(result.jobs[0].distanceKm).toBeGreaterThan(10);
    });

    it('半径を指定すればその範囲で判定する（上限50km）', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([
            { date: new Date('2026-07-23T00:00:00+09:00'), projectMasterId: 'p1', assignedEmployeeId: 'f1', memberCount: 3, dateStatus: 'confirmed', projectMaster: projectAt('鈴木', MATSUYAMA, '松山市南吉田町') },
        ]);

        const result = await findNearbyJobs({ place: '北条', radiusKm: 20 });

        expect(result.radiusKm).toBe(20);
        expect(result.totalInRadius).toBe(1);
        expect(result.jobs[0].outsideRadius).toBeUndefined();

        const capped = await findNearbyJobs({ place: '北条', radiusKm: 999 });
        expect(capped.radiusKm).toBe(50);
    });

    it('地名を特定できなければ resolved=null で予定は返さない（推測させない）', async () => {
        mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
        // 過去案件に無い地名 → Nominatim も失敗させる
        const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
        (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

        const result = await findNearbyJobs({ place: '存在しない町' });

        expect(result.resolved).toBeNull();
        expect(result.jobs).toHaveLength(0);
        expect(mockPrisma.projectAssignment.findMany).not.toHaveBeenCalled();
    });

    it('地名が短すぎる場合はDBを引かずに空で返す', async () => {
        const result = await findNearbyJobs({ place: '北' });

        expect(result.resolved).toBeNull();
        expect(mockPrisma.projectMaster.findMany).not.toHaveBeenCalled();
    });
});
