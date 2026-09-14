import {
    buildOwnCrewVolume,
    computeProjectEarnings,
    emptyOwnCrewVolumeTotals,
    type OwnCrewVolumeAssignment,
    type OwnCrewVolumeProject,
} from '@/lib/ownCrewVolume';
import type { LaborCostRow } from '@/lib/projectCost';
import { DEFAULT_VALUE_ADDED_SETTINGS } from '@/lib/valueAdded';

const SETTINGS = { ...DEFAULT_VALUE_ADDED_SETTINGS, breakevenPerManday: 40000 };
// 実データの既定値（SystemSettings）: 売上の60%が協力業者費、うち組立60%・解体40%
const RATES = { revenueRate: 60, assemblyRate: 60, demolitionRate: 40 };

function labor(params: {
    id: string;
    date: string;
    foremanId: string;
    type?: string | null;
    workerCount: number;
    memberCount?: number;
    workerIds?: string[];
    cost: number;
    override?: number | null;
    hours?: number;
}): LaborCostRow {
    return {
        assignmentId: params.id,
        date: params.date,
        constructionTypeName: params.type ?? null,
        hours: params.hours ?? 8,
        foremanName: params.foremanId,
        workerCount: params.workerCount,
        autoCost: params.cost,
        override: params.override ?? null,
        effectiveCost: params.cost,
        foremanId: params.foremanId,
        memberCount: params.memberCount ?? params.workerCount,
        workerIds: params.workerIds ?? [],
    };
}

function project(params: {
    id?: string;
    title?: string;
    customerName?: string | null;
    managerName?: string | null;
    invoiceSubtotal?: number;
    estimateSubtotal?: number;
    contractAmount?: number;
    revenueOverride?: number | null;
    subcontractorCosts?: Array<{ constructionTypeName: string | null; amount: number }>;
    laborCost: number;
    subcontractorCost?: number;
    totalCost: number;
    laborRows: LaborCostRow[];
}): OwnCrewVolumeProject {
    return {
        projectMasterId: params.id ?? 'p1',
        projectTitle: params.title ?? '現場A',
        customerName: params.customerName ?? '元請A',
        managerName: params.managerName ?? '担当A',
        contractAmount: params.contractAmount ?? 0,
        revenueOverride: params.revenueOverride ?? null,
        invoiceSubtotal: params.invoiceSubtotal ?? 0,
        estimateSubtotal: params.estimateSubtotal ?? 0,
        registeredSubcontractorCosts: params.subcontractorCosts ?? [],
        cost: {
            laborCost: params.laborCost,
            loadingCost: 0,
            vehicleCost: 0,
            materialCost: 0,
            subcontractorCost: params.subcontractorCost ?? 0,
            otherExpenses: 0,
            totalCost: params.totalCost,
        },
        laborRows: params.laborRows,
        hasManualCost: false,
        hasAssignments: params.laborRows.length > 0,
    };
}

function assignmentsOf(rows: LaborCostRow[], nameById: Record<string, string> = {}): OwnCrewVolumeAssignment[] {
    return rows.map(r => ({
        assignmentId: r.assignmentId,
        foremanId: r.foremanId ?? '',
        foremanName: nameById[r.foremanId ?? ''] ?? r.foremanId ?? '',
    }));
}

describe('lib/ownCrewVolume / 稼ぎの日割り', () => {
    it('案件の全行（全月・全班）の稼ぎを足すと案件の稼ぎに一致する（誤差は行数未満）', () => {
        // 稼ぎ V = 1,000,000 − (1,300,000 − 500,000) = 200,000 を 総人数 7 で割る
        const rows = [
            labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 3, cost: 54000 }),
            labor({ id: 'a2', date: '2026-08-04', foremanId: 'f1', workerCount: 2, cost: 36000 }),
            labor({ id: 'a3', date: '2026-09-01', foremanId: 'f2', workerCount: 2, cost: 36000 }),
        ];
        const p = project({ invoiceSubtotal: 1_000_000, laborCost: 500_000, totalCost: 1_300_000, laborRows: rows });
        const earnings = computeProjectEarnings(p, SETTINGS);
        expect(earnings.valueAdded).toBe(200_000);
        expect(earnings.headcount).toBe(7);
        expect(earnings.salesBasis).toBe('invoice');

        // 全月・全班ぶんを行にすると合計が V と一致する（切り捨て誤差は行数未満）
        const result = buildOwnCrewVolume({
            projects: [p],
            assignments: assignmentsOf(rows),
            partnerUserIds: [],
            rates: RATES,
            settings: SETTINGS,
        });
        const sum = result.groups.flatMap(g => g.rows).reduce((s, r) => s + (r.earnings ?? 0), 0);
        expect(earnings.valueAdded! - sum).toBeGreaterThanOrEqual(0);
        expect(earnings.valueAdded! - sum).toBeLessThan(rows.length);
        // 3人ぶん = trunc(200000 / 7 × 3) = 85714
        expect(result.groups[0].rows[0].earnings).toBe(85_714);
    });

    it('総人数が 0（日報が1件も無い案件）なら稼ぎは出さない', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 0, memberCount: 4, cost: 0 })];
        const p = project({ invoiceSubtotal: 500_000, laborCost: 0, totalCost: 100_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups[0].rows[0].earnings).toBeNull();
        expect(result.groups[0].rows[0].flags).toContain('no_report');
        expect(result.groups[0].rows[0].memberCount).toBe(4);
    });

    it('未請求は見積ベースの仮の稼ぎを出し、salesBasis と unbilled を付ける', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 4, cost: 72000 })];
        const p = project({ estimateSubtotal: 800_000, laborCost: 72_000, totalCost: 300_000, laborRows: rows });
        // V = 800,000 − (300,000 − 72,000) = 572,000、人工4なので全額この行に乗る
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        const row = result.groups[0].rows[0];
        expect(row.salesBasis).toBe('estimate');
        expect(row.earnings).toBe(572_000);
        expect(row.flags).toContain('unbilled');
        expect(result.totals.unbilledRowCount).toBe(1);
    });

    it('売上の手がかりが何も無ければ salesBasis=none で稼ぎは null', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 2, cost: 36000 })];
        const p = project({ laborCost: 36_000, totalCost: 36_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups[0].rows[0].salesBasis).toBe('none');
        expect(result.groups[0].rows[0].earnings).toBeNull();
    });

    it('契約金額しか無ければ contract、手動上書きがあれば override', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 2, cost: 36000 })];
        const contract = computeProjectEarnings(
            project({ contractAmount: 400_000, laborCost: 36_000, totalCost: 136_000, laborRows: rows }), SETTINGS);
        expect(contract.salesBasis).toBe('contract');
        expect(contract.valueAdded).toBe(300_000); // 400,000 − (136,000 − 36,000)

        const override = computeProjectEarnings(
            project({ revenueOverride: 250_000, estimateSubtotal: 900_000, laborCost: 36_000, totalCost: 136_000, laborRows: rows }), SETTINGS);
        expect(override.salesBasis).toBe('override');
        expect(override.valueAdded).toBe(150_000); // 上書きが見積より優先
    });
});

describe('lib/ownCrewVolume / 外注換算', () => {
    it('登録済みの協力業者費があればその額を、その種別の自社人工で日割りする', () => {
        const rows = [
            labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', type: '組立', workerCount: 3, cost: 54000 }),
            labor({ id: 'a2', date: '2026-08-04', foremanId: 'f1', type: '組立', workerCount: 2, cost: 36000 }),
        ];
        const p = project({
            invoiceSubtotal: 1_000_000, laborCost: 90_000, totalCost: 200_000, laborRows: rows,
            subcontractorCosts: [{ constructionTypeName: '組立', amount: 300_000 }],
        });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        const [r1, r2] = result.groups[0].rows;
        // 300,000 ÷ 自社人工5 × 3 / × 2
        expect(r1.outsourcingEquivalent).toBe(180_000);
        expect(r2.outsourcingEquivalent).toBe(120_000);
        expect(result.totals.outsourcingEquivalent).toBe(300_000);
    });

    it('登録が無ければ 売上×協力業者率 を組立・解体へ按分した額を使う', () => {
        const rows = [
            labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', type: '組立', workerCount: 2, cost: 36000 }),
            labor({ id: 'a2', date: '2026-08-10', foremanId: 'f1', type: '解体', workerCount: 1, cost: 18000 }),
        ];
        const p = project({ invoiceSubtotal: 1_000_000, laborCost: 54_000, totalCost: 154_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        // total = 1,000,000 × 60% = 600,000 → 組立 360,000 / 解体 240,000
        expect(result.groups[0].rows[0].outsourcingEquivalent).toBe(360_000); // 組立は自社人工2のうち2
        expect(result.groups[0].rows[1].outsourcingEquivalent).toBe(240_000); // 解体は自社人工1のうち1
    });

    it('組立・解体以外の種別で登録も無ければ null（0と決めつけない）', () => {
        const rows = [
            labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', type: '養生', workerCount: 2, cost: 36000 }),
            labor({ id: 'a2', date: '2026-08-04', foremanId: 'f1', type: null, workerCount: 1, cost: 18000 }),
        ];
        const p = project({ invoiceSubtotal: 1_000_000, laborCost: 54_000, totalCost: 154_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups[0].rows[0].outsourcingEquivalent).toBeNull();
        expect(result.groups[0].rows[1].outsourcingEquivalent).toBeNull();
        // null の行は合計に足さない
        expect(result.totals.outsourcingEquivalent).toBe(0);
    });

    it('売上が 0 なら自動計算できないので外注換算は null', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', type: '組立', workerCount: 2, cost: 36000 })];
        const p = project({ laborCost: 36_000, totalCost: 36_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups[0].rows[0].outsourcingEquivalent).toBeNull();
    });

    it('その種別の自社人工が 0（日報なし）なら外注換算は出さない', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', type: '組立', workerCount: 0, memberCount: 3, cost: 0 })];
        const p = project({ invoiceSubtotal: 1_000_000, laborCost: 0, totalCost: 100_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups[0].rows[0].outsourcingEquivalent).toBeNull();
    });
});

describe('lib/ownCrewVolume / フラグ', () => {
    it('常用（協力業者の人が自社班に入った行）に joyo を付ける。人数には入る', () => {
        const rows = [
            labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 3, workerIds: ['w1', 'w2', 'pm1'], cost: 54000 }),
            labor({ id: 'a2', date: '2026-08-04', foremanId: 'f1', workerCount: 2, workerIds: ['w1', 'w2'], cost: 36000 }),
        ];
        const p = project({ invoiceSubtotal: 1_000_000, laborCost: 90_000, totalCost: 200_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: ['pm1'], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups[0].rows[0].flags).toContain('joyo');
        expect(result.groups[0].rows[1].flags).not.toContain('joyo');
        expect(result.totals.manDays).toBe(5); // 常用の1名も人工に入る
    });

    it('外注中心の案件は outsourcing_heavy、人件費が上書きされた行は labor_override', () => {
        const rows = [labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 2, cost: 50000, override: 50000 })];
        const p = project({
            invoiceSubtotal: 1_000_000, laborCost: 50_000, subcontractorCost: 400_000, totalCost: 600_000, laborRows: rows,
        });
        const result = buildOwnCrewVolume({
            projects: [p], assignments: assignmentsOf(rows), partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        // 外注比率 = 400,000 ÷ 450,000 = 0.88 > 0.5
        expect(result.groups[0].rows[0].flags).toContain('outsourcing_heavy');
        expect(result.groups[0].rows[0].flags).toContain('labor_override');
    });
});

describe('lib/ownCrewVolume / グループと合計', () => {
    it('職長ごとにグループ化して小計と月合計を出し、指標を計算する', () => {
        const rows = [
            labor({ id: 'a1', date: '2026-08-05', foremanId: 'f2', type: '組立', workerCount: 2, cost: 36000 }),
            labor({ id: 'a2', date: '2026-08-03', foremanId: 'f1', type: '組立', workerCount: 3, cost: 54000 }),
            labor({ id: 'a3', date: '2026-08-04', foremanId: 'f1', type: '組立', workerCount: 1, cost: 18000 }),
        ];
        // V = 1,200,000 − (400,000 − 108,000) = 908,000、総人数6
        const p = project({
            invoiceSubtotal: 1_200_000, laborCost: 108_000, totalCost: 400_000, laborRows: rows,
            subcontractorCosts: [{ constructionTypeName: '組立', amount: 600_000 }],
        });
        const result = buildOwnCrewVolume({
            projects: [p],
            assignments: assignmentsOf(rows, { f1: 'あ職長', f2: 'い職長' }),
            partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });

        // グループ順は職長名の日本語順（あ → い）
        expect(result.groups.map(g => g.foremanName)).toEqual(['あ職長', 'い職長']);
        // グループ内は日付昇順
        expect(result.groups[0].rows.map(r => r.date)).toEqual(['2026-08-03', '2026-08-04']);

        // あ職長: 人工4、稼ぎ trunc(908000/6×3)=454000 + trunc(908000/6×1)=151333
        expect(result.groups[0].totals.manDays).toBe(4);
        expect(result.groups[0].totals.earnings).toBe(454_000 + 151_333);
        expect(result.groups[0].totals.laborCost).toBe(72_000);
        // 外注換算 600,000 ÷ 6 × (3+1) = 400,000
        expect(result.groups[0].totals.outsourcingEquivalent).toBe(400_000);
        expect(result.groups[0].totals.makeVsBuy).toBe(400_000 - 72_000);

        // 月合計 = 全行
        expect(result.totals.rowCount).toBe(3);
        expect(result.totals.manDays).toBe(6);
        expect(result.totals.laborCost).toBe(108_000);
        expect(result.totals.outsourcingEquivalent).toBe(600_000);
        expect(result.totals.perManday).toBe(Math.trunc(result.totals.earnings / 6));
        expect(result.totals.productivityRatio).toBeCloseTo(result.totals.earnings / 108_000, 6);
    });

    it('表示月の対象配置に無い labor 行（別の月・別の班）は行にしない', () => {
        const rows = [
            labor({ id: 'a1', date: '2026-08-03', foremanId: 'f1', workerCount: 3, cost: 54000 }),
            labor({ id: 'a2', date: '2026-09-01', foremanId: 'f1', workerCount: 2, cost: 36000 }),
        ];
        const p = project({ invoiceSubtotal: 1_000_000, laborCost: 90_000, totalCost: 200_000, laborRows: rows });
        const result = buildOwnCrewVolume({
            projects: [p],
            assignments: [{ assignmentId: 'a1', foremanId: 'f1', foremanName: '職長1' }],
            partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.totals.rowCount).toBe(1);
        // V = 1,000,000 − (200,000 − 90,000) = 890,000。分母（総人数）は全期間なので 5 のまま
        expect(result.groups[0].rows[0].earnings).toBe(Math.trunc(890_000 / 5 * 3));
    });

    it('対象が0件なら空の合計を返す', () => {
        const result = buildOwnCrewVolume({
            projects: [], assignments: [], partnerUserIds: [], rates: RATES, settings: SETTINGS,
        });
        expect(result.groups).toEqual([]);
        expect(result.totals).toEqual(emptyOwnCrewVolumeTotals());
    });
});
