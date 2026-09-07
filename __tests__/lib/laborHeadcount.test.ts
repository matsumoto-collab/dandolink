import {
    summarizeLaborHeadcount,
    formatLaborHeadcountGroups,
    UNASSIGNED_FOREMAN_LABEL,
    UNKNOWN_CONSTRUCTION_TYPE_LABEL,
} from '@/lib/laborHeadcount';

describe('summarizeLaborHeadcount', () => {
    it('総人数を合計し、職長×作業内容ごとに人数をまとめる（職長は初出順・同じ職長は隣り合う）', () => {
        const rows = [
            { foremanName: '田畑', constructionTypeName: '組立', workerCount: 3 },
            { foremanName: '小笠原', constructionTypeName: '組立', workerCount: 2 },
            { foremanName: '田畑', constructionTypeName: '組立', workerCount: 2 },
            { foremanName: '玉ノ井', constructionTypeName: '搬入', workerCount: 1 },
            { foremanName: '田畑', constructionTypeName: '解体', workerCount: 4 },
        ];
        const s = summarizeLaborHeadcount(rows);
        expect(s.total).toBe(12);
        expect(s.groups).toEqual([
            { foremanName: '田畑', constructionTypeName: '組立', count: 5 },
            { foremanName: '田畑', constructionTypeName: '解体', count: 4 },
            { foremanName: '小笠原', constructionTypeName: '組立', count: 2 },
            { foremanName: '玉ノ井', constructionTypeName: '搬入', count: 1 },
        ]);
        expect(formatLaborHeadcountGroups(s.groups)).toBe('田畑 組立 5人・田畑 解体 4人・小笠原 組立 2人・玉ノ井 搬入 1人');
    });

    it('職長・作業内容が無い明細は「未割当」「—」にまとめる', () => {
        const s = summarizeLaborHeadcount([
            { foremanName: null, constructionTypeName: null, workerCount: 2 },
            { foremanName: '  ', constructionTypeName: '', workerCount: 1 },
        ]);
        expect(s.total).toBe(3);
        expect(s.groups).toEqual([
            { foremanName: UNASSIGNED_FOREMAN_LABEL, constructionTypeName: UNKNOWN_CONSTRUCTION_TYPE_LABEL, count: 3 },
        ]);
    });

    it('人数0の明細（日報未提出など）は内訳に出さず、合計にも影響しない', () => {
        const s = summarizeLaborHeadcount([
            { foremanName: '田畑', constructionTypeName: '組立', workerCount: 0 },
            { foremanName: '小笠原', constructionTypeName: '組立', workerCount: 3 },
            { foremanName: '田畑', constructionTypeName: '組立', workerCount: Number.NaN },
        ]);
        expect(s.total).toBe(3);
        expect(s.groups).toEqual([{ foremanName: '小笠原', constructionTypeName: '組立', count: 3 }]);
    });

    it('明細が空なら0人・内訳なし', () => {
        expect(summarizeLaborHeadcount([])).toEqual({ total: 0, groups: [] });
        expect(formatLaborHeadcountGroups([])).toBe('');
    });
});
