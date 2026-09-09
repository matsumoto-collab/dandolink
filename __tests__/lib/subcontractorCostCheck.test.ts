/**
 * @jest-environment node
 */
import {
    checkSubcontractorCostStale,
    revenueSourceLabel,
    type SubcontractorRates,
} from '@/lib/subcontractorCostCheck';

/** 既定の按分率（システム設定の初期値）。 */
const RATES: SubcontractorRates = { revenueRate: 60, assemblyRate: 60, demolitionRate: 40 };

const costs = (...amounts: number[]) =>
    amounts.map((amount, i) => ({ constructionTypeName: i === 0 ? '組立' : i === 1 ? '解体' : `その他${i}`, amount }));

describe('checkSubcontractorCostStale', () => {
    describe('期待値の式（自動計算と同一）', () => {
        it('新居浜スカイビルの例: 見積85万に下がったのに予定単価が100万時のまま', () => {
            const r = checkSubcontractorCostStale({
                revenue: 850000,
                rates: RATES,
                costs: costs(360000, 240000), // 見積100万時に自動計算した額
            });
            expect(r.expectedTotal).toBe(510000);
            expect(r.expectedAssembly).toBe(306000);
            expect(r.expectedDemolition).toBe(204000);
            expect(r.currentTotal).toBe(600000);
            expect(r.diff).toBe(90000);
            expect(r.status).toBe('stale');
        });

        it('自動計算直後は ok（売上100万 → 60万 = 組立36万＋解体24万）', () => {
            const r = checkSubcontractorCostStale({
                revenue: 1000000,
                rates: RATES,
                costs: costs(360000, 240000),
            });
            expect(r.expectedTotal).toBe(600000);
            expect(r.expectedAssembly).toBe(360000);
            expect(r.expectedDemolition).toBe(240000);
            expect(r.diff).toBe(0);
            expect(r.status).toBe('ok');
        });

        it('端数は組立・解体それぞれで四捨五入する', () => {
            const r = checkSubcontractorCostStale({
                revenue: 1234567,
                rates: RATES,
                costs: costs(444444, 296296),
            });
            expect(r.expectedTotal).toBeCloseTo(740740.2, 4);
            expect(r.expectedAssembly).toBe(444444); // 740740.2 * 60% = 444444.12
            expect(r.expectedDemolition).toBe(296296); // 740740.2 * 40% = 296296.08
            expect(r.status).toBe('ok');
        });

        it('組立・解体以外の種別も合計に含めて比較する', () => {
            const r = checkSubcontractorCostStale({
                revenue: 1000000,
                rates: RATES,
                costs: costs(360000, 0, 240000), // 解体0・別種別に24万
            });
            expect(r.currentTotal).toBe(600000);
            expect(r.status).toBe('ok');
        });
    });

    describe('閾値（1%または1,000円の大きい方を超えたら stale）', () => {
        it('目安が小さいとき（1%<1,000円）は1,000円が閾値: ちょうど1,000円のずれは ok', () => {
            // 売上10万 → 目安6万。1% = 600円 < 1,000円 なので許容は1,000円
            const r = checkSubcontractorCostStale({ revenue: 100000, rates: RATES, costs: costs(61000) });
            expect(r.expectedTotal).toBe(60000);
            expect(r.diff).toBe(1000);
            expect(r.status).toBe('ok');
        });

        it('同じ条件で1,001円ずれたら stale', () => {
            const r = checkSubcontractorCostStale({ revenue: 100000, rates: RATES, costs: costs(61001) });
            expect(r.diff).toBe(1001);
            expect(r.status).toBe('stale');
        });

        it('目安が大きいとき（1%>1,000円）は1%が閾値: ちょうど1%のずれは ok', () => {
            // 売上1000万 → 目安600万。1% = 6万
            const r = checkSubcontractorCostStale({ revenue: 10000000, rates: RATES, costs: costs(6060000) });
            expect(r.expectedTotal).toBe(6000000);
            expect(r.diff).toBe(60000);
            expect(r.status).toBe('ok');
        });

        it('同じ条件で1%を超えたら stale', () => {
            const r = checkSubcontractorCostStale({ revenue: 10000000, rates: RATES, costs: costs(6060001) });
            expect(r.status).toBe('stale');
        });

        it('少なすぎる側（マイナス方向のずれ）も stale', () => {
            const r = checkSubcontractorCostStale({ revenue: 1000000, rates: RATES, costs: costs(300000) });
            expect(r.diff).toBe(-300000);
            expect(r.status).toBe('stale');
        });
    });

    describe('none / unknown（警告しないケース）', () => {
        it('予定単価が1件も無ければ none', () => {
            const r = checkSubcontractorCostStale({ revenue: 1000000, rates: RATES, costs: [] });
            expect(r.status).toBe('none');
            expect(r.currentTotal).toBe(0);
            expect(r.expectedTotal).toBe(600000); // 目安自体は出せる
        });

        it('金額が0や空の行だけなら none', () => {
            const r = checkSubcontractorCostStale({
                revenue: 1000000,
                rates: RATES,
                costs: costs(0, Number.NaN),
            });
            expect(r.status).toBe('none');
            expect(r.currentTotal).toBe(0);
        });

        it('売上が0なら unknown（請求も見積も契約金額も無い案件）', () => {
            const r = checkSubcontractorCostStale({ revenue: 0, rates: RATES, costs: costs(360000) });
            expect(r.status).toBe('unknown');
            expect(r.expectedTotal).toBe(0);
            expect(r.currentTotal).toBe(360000);
            expect(r.diff).toBe(360000);
        });

        it('売上がマイナス・非数値でも unknown', () => {
            expect(checkSubcontractorCostStale({ revenue: -1, rates: RATES, costs: costs(1) }).status).toBe('unknown');
            expect(checkSubcontractorCostStale({ revenue: Number.NaN, rates: RATES, costs: costs(1) }).status).toBe('unknown');
        });

        it('按分率が取得できていなければ unknown', () => {
            const r = checkSubcontractorCostStale({
                revenue: 1000000,
                rates: { revenueRate: Number.NaN, assemblyRate: 60, demolitionRate: 40 },
                costs: costs(360000),
            });
            expect(r.status).toBe('unknown');
        });

        it('マイナス金額の行は0として扱う（入力途中で警告が暴れないように）', () => {
            const r = checkSubcontractorCostStale({
                revenue: 1000000,
                rates: RATES,
                costs: costs(600000, -100000),
            });
            expect(r.currentTotal).toBe(600000);
            expect(r.status).toBe('ok');
        });
    });
});

describe('revenueSourceLabel', () => {
    it('profit API の revenueSource を日本語ラベルにする', () => {
        expect(revenueSourceLabel('invoice')).toBe('請求済み');
        expect(revenueSourceLabel('estimate')).toBe('見積');
        expect(revenueSourceLabel('contract')).toBe('契約金額');
        expect(revenueSourceLabel('override')).toBe('手動上書き');
        expect(revenueSourceLabel('none')).toBe('売上');
        expect(revenueSourceLabel(undefined)).toBe('売上');
    });
});
