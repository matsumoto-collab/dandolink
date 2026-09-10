import {
    CELLS_PER_MONTH,
    addDays,
    buildScheduleChart,
    classifyConstructionType,
    daysBetween,
    lastDayOfMonth,
    type ScheduleChartInputProject,
} from '@/lib/scheduleChart';

const TYPES = [
    { id: 'ct-assembly', name: '組立', color: '#a8c8e8' },
    { id: 'ct-demolition', name: '解体', color: '#f0a8a8' },
    { id: 'ct-other', name: 'その他', color: '#fef08a' },
    { id: 'ct-carry', name: '搬入', color: '#BCAAA4' },
    { id: 'ct-inner', name: '内部足場組立', color: '#81D4FA' },
];

function project(
    id: string,
    label: string,
    entries: [string, string | null][],
): ScheduleChartInputProject {
    return {
        projectMasterId: id,
        label,
        workEntries: entries.map(([date, constructionTypeId]) => ({ date, constructionTypeId })),
    };
}

/** 工程行を取り出すヘルパー */
function line(chart: ReturnType<typeof buildScheduleChart>, rowIndex: number, category: string) {
    return chart.rows[rowIndex].lines.find(l => l.category === category)!;
}

describe('日付ヘルパー', () => {
    it('月末日を返す（うるう年も含む）', () => {
        expect(lastDayOfMonth(2026, 1)).toBe(31);
        expect(lastDayOfMonth(2026, 2)).toBe(28);
        expect(lastDayOfMonth(2028, 2)).toBe(29);
        expect(lastDayOfMonth(2026, 4)).toBe(30);
    });

    it('月・年をまたいでも正しく進む', () => {
        expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('日数の差を返す', () => {
        expect(daysBetween('2026-09-01', '2026-09-01')).toBe(0);
        expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30);
        expect(daysBetween('2026-09-30', '2026-09-01')).toBe(-29);
    });
});

describe('classifyConstructionType', () => {
    it('組立・解体ちょうどだけを専用行にし、それ以外はすべて「その他」', () => {
        expect(classifyConstructionType('組立')).toBe('assembly');
        expect(classifyConstructionType('解体')).toBe('demolition');
        expect(classifyConstructionType('その他')).toBe('other');
        expect(classifyConstructionType('二工程')).toBe('other');
        expect(classifyConstructionType('内部足場組立')).toBe('other');
        expect(classifyConstructionType('組立・解体')).toBe('other');
        expect(classifyConstructionType(null)).toBe('other');
    });
});

describe('buildScheduleChart', () => {
    it('配置が無ければ空のチャートを返す', () => {
        const chart = buildScheduleChart([project('p1', 'A', [])], TYPES);
        expect(chart.months).toHaveLength(0);
        expect(chart.columnCount).toBe(0);
        expect(chart.rows).toHaveLength(0);
        expect(chart.termLabel).toBe('');
    });

    it('1案件を組立・その他・解体の3行に分ける（並び順もこの順）', () => {
        const chart = buildScheduleChart(
            [
                project('p1', 'A現場', [
                    ['2026-09-01', 'ct-assembly'],
                    ['2026-09-20', 'ct-other'],
                    ['2026-10-05', 'ct-demolition'],
                ]),
            ],
            TYPES,
        );
        expect(chart.rows[0].lines.map(l => l.label)).toEqual(['組立', 'その他', '解体']);
        expect(line(chart, 0, 'assembly').bars).toHaveLength(1);
        expect(line(chart, 0, 'other').bars).toHaveLength(1);
        expect(line(chart, 0, 'demolition').bars).toHaveLength(1);
    });

    it('組立・解体以外はすべて「その他」の行に入る', () => {
        const chart = buildScheduleChart(
            [
                project('p1', 'A現場', [
                    ['2026-09-01', 'ct-carry'],
                    ['2026-09-02', 'ct-inner'],
                ]),
            ],
            TYPES,
        );
        expect(line(chart, 0, 'assembly').bars).toHaveLength(0);
        expect(line(chart, 0, 'demolition').bars).toHaveLength(0);
        // 種別が違うのでバーは2本に分かれ、それぞれの色を持つ
        const other = line(chart, 0, 'other');
        expect(other.bars).toHaveLength(2);
        expect(other.bars.map(b => b.constructionTypeName)).toEqual(['搬入', '内部足場組立']);
        expect(other.bars[0].color).toBe('#BCAAA4');
    });

    it('同じ日に組立と解体があれば両方の行にバーが出る', () => {
        const chart = buildScheduleChart(
            [project('p1', 'A現場', [['2026-09-10', 'ct-assembly'], ['2026-09-10', 'ct-demolition']])],
            TYPES,
        );
        expect(line(chart, 0, 'assembly').bars).toHaveLength(1);
        expect(line(chart, 0, 'demolition').bars).toHaveLength(1);
        expect(chart.rows[0].workDays).toBe(1);
    });

    it('134日以内は1日1目盛になり、日付の列がそのまま並ぶ', () => {
        const chart = buildScheduleChart(
            [project('p1', 'A現場', [['2026-09-01', 'ct-assembly'], ['2026-10-24', 'ct-demolition']])],
            TYPES,
        );
        expect(chart.scale).toBe('day');
        // 9月(30) + 10月(31)
        expect(chart.columnCount).toBe(61);
        expect(chart.months[0].cellLabels[0]).toBe('1');
        expect(chart.months[0].cellLabels).toHaveLength(30);
        expect(chart.gridStart).toBe('2026-09-01');
    });

    it('1日1目盛のとき、9/1の配置は0列目、9/2は1列目になる', () => {
        const chart = buildScheduleChart(
            [
                project('p1', 'A現場', [
                    ['2026-09-01', 'ct-assembly'],
                    ['2026-09-02', 'ct-assembly'],
                    ['2026-09-03', 'ct-assembly'],
                ]),
            ],
            TYPES,
        );
        const [bar] = line(chart, 0, 'assembly').bars;
        expect(bar.start).toBe(0);
        // 3日ぶん＝3列
        expect(bar.end).toBe(3);
    });

    it('185日（約6ヶ月）を超えると5日刻みに切り替わる', () => {
        // 1/1〜6/30 = 181日 → まだ1日1目盛
        const withinLimit = buildScheduleChart(
            [project('p1', 'A現場', [['2026-01-05', 'ct-assembly'], ['2026-06-20', 'ct-demolition']])],
            TYPES,
        );
        expect(withinLimit.scale).toBe('day');

        // 1/1〜7/31 = 212日 → 5日刻み
        const chart = buildScheduleChart(
            [project('p1', 'A現場', [['2026-01-05', 'ct-assembly'], ['2026-07-20', 'ct-demolition']])],
            TYPES,
        );
        expect(chart.scale).toBe('fiveDay');
        expect(chart.columnCount).toBe(7 * CELLS_PER_MONTH);
        expect(chart.months[0].cellLabels).toEqual(['5', '10', '15', '20', '25', '31']);
    });

    it('月の見出しは年が変わるところだけ年を添える', () => {
        const chart = buildScheduleChart(
            [project('p1', 'A', [['2026-12-01', 'ct-assembly'], ['2027-01-05', 'ct-assembly']])],
            TYPES,
        );
        expect(chart.months.map(m => m.label)).toEqual(['2026年12月', '2027年1月']);
    });

    it('日が飛んだところでバーを分ける', () => {
        const chart = buildScheduleChart(
            [
                project('p1', 'A', [
                    ['2026-09-06', 'ct-assembly'],
                    ['2026-09-07', 'ct-assembly'],
                    ['2026-09-20', 'ct-assembly'],
                ]),
            ],
            TYPES,
        );
        expect(line(chart, 0, 'assembly').bars).toHaveLength(2);
        expect(chart.rows[0].workDays).toBe(3);
    });

    it('月をまたぐ連続配置は1本のバーになる', () => {
        const chart = buildScheduleChart(
            [
                project('p1', 'A', [
                    ['2026-09-29', 'ct-assembly'],
                    ['2026-09-30', 'ct-assembly'],
                    ['2026-10-01', 'ct-assembly'],
                ]),
            ],
            TYPES,
        );
        const bars = line(chart, 0, 'assembly').bars;
        expect(bars).toHaveLength(1);
        expect(bars[0].start).toBe(28);
        expect(bars[0].end).toBe(31);
    });

    it('工事種別が未設定の配置は「その他」の既定色で出る', () => {
        const chart = buildScheduleChart([project('p1', 'A', [['2026-09-01', null]])], TYPES);
        const [bar] = line(chart, 0, 'other').bars;
        expect(bar.constructionTypeId).toBeNull();
        expect(bar.color).toBe('#fef08a');
    });

    it('凡例用に実際に使われた工事種別だけを返す', () => {
        const chart = buildScheduleChart(
            [project('p1', 'A', [['2026-09-01', 'ct-assembly'], ['2026-09-02', 'ct-carry']])],
            TYPES,
        );
        expect(chart.usedTypes.map(t => t.name).sort()).toEqual(['搬入', '組立']);
    });

    it('工期は実データの最初と最後の配置日', () => {
        const chart = buildScheduleChart(
            [
                project('p1', 'A', [['2026-09-03', 'ct-assembly']]),
                project('p2', 'B', [['2026-10-24', 'ct-demolition']]),
            ],
            TYPES,
        );
        expect(chart.termLabel).toBe('2026/9/3 〜 2026/10/24');
        expect(chart.rangeStart).toBe('2026-09-03');
        expect(chart.rangeEnd).toBe('2026-10-24');
    });

    it('バーが表の範囲内に収まる', () => {
        const chart = buildScheduleChart(
            [project('p1', 'A', [['2026-09-01', 'ct-assembly'], ['2026-10-31', 'ct-demolition']])],
            TYPES,
        );
        for (const row of chart.rows) {
            for (const l of row.lines) {
                for (const bar of l.bars) {
                    expect(bar.start).toBeGreaterThanOrEqual(0);
                    expect(bar.end).toBeLessThanOrEqual(chart.columnCount);
                    expect(bar.end).toBeGreaterThan(bar.start);
                }
            }
        }
    });
});
