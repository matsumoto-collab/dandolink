/**
 * 案件一覧の CSV 出力（Excel での集計用）。
 *
 * 方針:
 * - 画面で絞り込んだ結果（filteredMasters）をそのまま・同じ並びで出す。
 * - 金額列は admin/manager のときだけ「列ごと」出す（他ロールは空欄ではなく列自体を出さない）。
 * - 金額は桁区切りなしの整数文字列＝Excel が数値として扱える形にする。
 * - 日付は JST の yyyy-mm-dd（ProjectAssignment.date は JST0時＝UTC前日15時保存のため必ず JST に直す）。
 * - 原価・売上は案件マスタの予定単価ではなく、原価エンジン `computeProjectCosts` の実計上額
 *   （`/api/project-masters/export-costs` 経由）を ctx.costById で受け取って出す。
 */

import type { ProjectMaster, ProjectWorkHistoryItem } from '@/types/calendar';
import { LEGACY_CONSTRUCTION_CONTENT_LABELS } from '@/types/calendar';
import { PROJECT_LIST_STATUS_LABEL, resolveProjectListStatus } from '@/lib/projectMasterStatus';
import { filterWorkHistory, hasWorkHistoryFilter, workDateToJstYmd, type WorkHistoryFilter } from '@/lib/projectWorkHistory';
import type { BillingStatus } from '@/lib/billing/billingStatus';
import { BILLING_STATUS_META } from '@/lib/billing/billingStatusMeta';
import {
    VALUE_ADDED_FLAG_LABELS,
    VALUE_ADDED_JUDGEMENT_LABELS,
    type ValueAddedResult,
} from '@/lib/valueAdded';

export interface ProjectCsvContext {
    /** 金額列を出すか（admin / manager のみ true）。 */
    canSeeFinancials: boolean;
    /** userId → 表示名（案件担当者・職長の両方をこの1つで引く）。 */
    managerMap: Record<string, string>;
    /** constructionSuffixId → 工事名称。 */
    suffixMap: Record<string, string>;
    /** 工事種別ID → 名称（マスタ未登録のレガシー値も解決できる関数）。 */
    resolveCtypeName: (ctypeId: string | null) => string;
    /** 請求ステータス判定の基準額（税抜）。 */
    resolveBillingBasis: (pm: ProjectMaster) => { amount: number | null; source: 'picked' | 'single' | 'contract' | 'none' };
    /** 案件ID → 請求済み合計（税抜）。 */
    invoicedByProject: Record<string, number>;
    /** 案件ID → 見積件数。 */
    estimateCountByProject: Record<string, number>;
    /** 請求ステータス（手動上書きを含む画面と同じ判定）。 */
    resolveBillingStatus: (pm: ProjectMaster) => BillingStatus;
    /** 画面の作業履歴絞り込み（未指定なら全件を対象にする）。 */
    workFilter: WorkHistoryFilter;
    /**
     * 案件ID → 原価エンジン（computeProjectCosts）の実計上額。
     * `/api/project-masters/export-costs` の戻り値をそのまま Record 化したもの。
     * 未取得（非 admin/manager）や API に返らなかった案件は該当セルを空文字にする。
     */
    costById?: Record<string, ProjectCostExportRow>;
}

/**
 * 案件CSVの原価・売上ブロック1案件ぶん（`/api/project-masters/export-costs` のレスポンス行）。
 * 金額はすべて税抜・整数。
 */
export interface ProjectCostExportRow {
    id: string;
    /** 売上（税抜）。revenueSource が 'none' のときは 0。 */
    revenue: number;
    /** 売上の出どころ。手動上書き → 請求済み → 契約金額 → 見積 の順（案件CSV固有の順番）。 */
    revenueSource: 'override' | 'invoice' | 'contract' | 'estimate' | 'none';
    subcontractorCost: number;
    materialCost: number;
    loadingCost: number;
    laborCost: number;
    vehicleCost: number;
    otherExpenses: number;
    totalCost: number;
    /** 実績人時＝Σ(配置の作業時間 × 原価計上した人数)。 */
    laborHours: number;
    /** 実績人日＝Σ(原価計上した人数)＝延べ人日。 */
    laborManDays: number;
    /**
     * 人工あたり加工高。売上は **確定請求(税抜)のみ**で、上の revenue（契約額などへ
     * フォールバックする案件CSV固有の値）とは別物。権限が無いユーザーには API が返さない。
     */
    valueAdded?: ValueAddedResult;
}

/** 売上の区分（revenueSource）の日本語表記。'none' は空欄（売上が決まっていない案件）。 */
const REVENUE_SOURCE_LABEL: Record<ProjectCostExportRow['revenueSource'], string> = {
    override: '手動上書き',
    invoice: '請求済み',
    contract: '契約金額',
    estimate: '見積',
    none: '',
};

/** 見積金額の根拠（resolveBillingBasis の source）の日本語表記。 */
const BILLING_BASIS_SOURCE_LABEL: Record<'picked' | 'single' | 'contract' | 'none', string> = {
    picked: '選択した見積',
    single: '見積1件',
    contract: '契約金額',
    none: '',
};

/** ISO 文字列 / Date を JST の yyyy-mm-dd にする（不正値は空文字）。 */
export function formatYmdJst(iso: string | Date | undefined | null): string {
    if (iso === undefined || iso === null || iso === '') return '';
    const d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return '';
    return workDateToJstYmd(d.toISOString());
}

/**
 * 金額セル。null/undefined/数値化できない値は空文字にする。
 * 桁区切りを付けない＝Excel 側で数値として集計できるようにするため。
 */
export function toAmountCell(v: unknown): string {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    return String(Math.round(n));
}

/** 工事内容の表示名（旧 enum 値は日本語へ、マスタ由来の値はそのまま）。 */
function constructionContentLabel(content: string | undefined | null): string {
    if (!content) return '';
    return LEGACY_CONSTRUCTION_CONTENT_LABELS[content] ?? content;
}

/** 案件担当者（createdBy の JSON 配列）を名前の「、」結合にする。画面の getManagersLabel と同じ規則。 */
function managersLabel(pm: ProjectMaster, managerMap: Record<string, string>): string {
    const ids = Array.isArray(pm.createdBy) ? pm.createdBy : pm.createdBy ? [pm.createdBy] : [];
    if (ids.length === 0) return '';
    return ids.filter(Boolean).map((id) => managerMap[id] || '...').join('、');
}

/** 案件1件ぶんの作業履歴の集約（初回/最終/延べ人数/組立日/解体日/職長）。 */
function summarizeWorkHistory(
    items: ProjectWorkHistoryItem[],
    ctx: Pick<ProjectCsvContext, 'managerMap' | 'resolveCtypeName'>,
) {
    const ymds: string[] = [];
    let members = 0;
    const assemblyDays: string[] = [];
    const demolitionDays: string[] = [];
    const foremen: string[] = [];
    for (const w of items) {
        const ymd = workDateToJstYmd(w.date);
        if (ymd) ymds.push(ymd);
        members += Number(w.memberCount) || 0;
        const ctype = ctx.resolveCtypeName(w.constructionType);
        if (ymd && ctype === '組立') assemblyDays.push(ymd);
        if (ymd && ctype === '解体') demolitionDays.push(ymd);
        const foreman = w.foremanId ? ctx.managerMap[w.foremanId] || '' : '';
        if (foreman && !foremen.includes(foreman)) foremen.push(foreman);
    }
    const sorted = [...ymds].sort();
    return {
        first: sorted[0] ?? '',
        last: sorted.length > 0 ? sorted[sorted.length - 1] : '',
        members,
        assemblyDays: assemblyDays.join('、'),
        demolitionDays: demolitionDays.join('、'),
        foremen: foremen.join('、'),
    };
}

/** 案件CSV（1案件＝1行）。先頭はヘッダ行。 */
export function buildProjectCsvRows(pms: ProjectMaster[], ctx: ProjectCsvContext): string[][] {
    const header = [
        '現場名', '正式名称', '敬称', '工事名称', '場所メモ', '元請会社', '元請略称', '工事内容', 'ステータス', '担当者',
        '郵便番号', '都道府県', '市区町村', '住所', '面積(m2)', '面積備考', '予定組立人工', '予定解体人工',
        '配置件数', '初回作業日', '最終作業日', '延べ人数', '組立日', '解体日', '職長',
    ];
    if (ctx.canSeeFinancials) {
        header.push(
            '契約金額(税抜)', '見積金額(税抜)', '見積金額の根拠', '見積件数', '請求済み金額(税抜)', '請求残(税抜)',
            '請求ステータス', '請求ステータス手動',
            // ここから下は原価エンジン（computeProjectCosts）の実計上額。案件マスタの予定単価ではない。
            '売上(税抜)', '売上の区分',
            '外注費', '材料費', '積込費', '人件費', '車両費', 'その他経費', '原価合計', '粗利',
            '実績人時', '実績人日',
            // 人工あたり加工高（加工高＝確定請求の売上 − 人件費以外の原価。人件費は引かない）
            '加工高', '人工あたり加工高', '労働生産性倍率', '労務の外注比率(%)', '人工判定', '人工の注記',
            '見積有無', '請求有無',
        );
    }
    header.push('備考', '説明', '登録日', '更新日');

    const rows: string[][] = [header];

    for (const pm of pms) {
        // 集約は絞り込み条件に関係なく全履歴で行う（案件全体の実績を出すため）
        const history = pm.workHistory ?? [];
        const s = summarizeWorkHistory(history, ctx);

        const row: string[] = [
            pm.name || pm.title || '',
            pm.title || '',
            pm.honorific || '',
            (pm.constructionSuffixId ? ctx.suffixMap[pm.constructionSuffixId] : '') || '',
            pm.siteShortName || '',
            pm.customerName || '',
            pm.customerShortName || '',
            constructionContentLabel(pm.constructionContent),
            PROJECT_LIST_STATUS_LABEL[resolveProjectListStatus(pm)],
            managersLabel(pm, ctx.managerMap),
            pm.postalCode || '',
            pm.prefecture || '',
            pm.city || '',
            pm.location || '',
            pm.area === null || pm.area === undefined ? '' : String(pm.area),
            pm.areaRemarks || '',
            pm.estimatedAssemblyWorkers === null || pm.estimatedAssemblyWorkers === undefined ? '' : String(pm.estimatedAssemblyWorkers),
            pm.estimatedDemolitionWorkers === null || pm.estimatedDemolitionWorkers === undefined ? '' : String(pm.estimatedDemolitionWorkers),
            String(pm.assignmentCount ?? history.length),
            s.first,
            s.last,
            String(s.members),
            s.assemblyDays,
            s.demolitionDays,
            s.foremen,
        ];

        if (ctx.canSeeFinancials) {
            const basis = ctx.resolveBillingBasis(pm);
            const invoiced = ctx.invoicedByProject[pm.id] ?? 0;
            // 原価・売上は API（原価エンジン）の値。未取得の案件はこのブロックを空欄にする。
            const cost = ctx.costById?.[pm.id];
            const va = cost?.valueAdded;
            row.push(
                toAmountCell(pm.contractAmount),
                toAmountCell(basis.amount),
                BILLING_BASIS_SOURCE_LABEL[basis.source],
                String(ctx.estimateCountByProject[pm.id] ?? 0),
                toAmountCell(invoiced),
                basis.amount === null ? '' : toAmountCell(basis.amount - invoiced),
                BILLING_STATUS_META[ctx.resolveBillingStatus(pm)].short,
                pm.billingStatusOverride ? '手動' : '',
                cost ? toAmountCell(cost.revenue) : '',
                cost ? REVENUE_SOURCE_LABEL[cost.revenueSource] : '',
                cost ? toAmountCell(cost.subcontractorCost) : '',
                cost ? toAmountCell(cost.materialCost) : '',
                cost ? toAmountCell(cost.loadingCost) : '',
                cost ? toAmountCell(cost.laborCost) : '',
                cost ? toAmountCell(cost.vehicleCost) : '',
                cost ? toAmountCell(cost.otherExpenses) : '',
                cost ? toAmountCell(cost.totalCost) : '',
                // 売上が決まっていない（区分 none）案件は粗利を出さない＝原価だけのマイナスを利益に見せない
                cost && cost.revenueSource !== 'none' ? toAmountCell(cost.revenue - cost.totalCost) : '',
                cost ? String(cost.laborHours) : '',
                cost ? String(cost.laborManDays) : '',
                // 人工あたり加工高。算出できない案件（未請求・原価未入力・自社人工なし）は空欄にし、
                // 理由を「人工の注記」に出す
                va ? toAmountCell(va.valueAdded) : '',
                va?.perManday != null ? toAmountCell(va.perManday) : '',
                va?.productivityRatio != null ? va.productivityRatio.toFixed(2) : '',
                va?.laborOutsourcingRatio != null ? String(Math.round(va.laborOutsourcingRatio * 100)) : '',
                va && va.judgement !== 'unknown' ? VALUE_ADDED_JUDGEMENT_LABELS[va.judgement] : '',
                va ? va.flags.map(f => VALUE_ADDED_FLAG_LABELS[f]).join(' / ') : '',
                pm.hasEstimate ? '有' : '無',
                pm.hasInvoice ? '有' : '無',
            );
        }

        row.push(
            pm.remarks || '',
            pm.description || '',
            formatYmdJst(pm.createdAt),
            formatYmdJst(pm.updatedAt),
        );

        rows.push(row);
    }

    return rows;
}

/** 作業履歴CSV（作業履歴1件＝1行）。先頭はヘッダ行。 */
export function buildWorkHistoryCsvRows(pms: ProjectMaster[], ctx: ProjectCsvContext): string[][] {
    const header = [
        '作業日', '現場名', '正式名称', '元請会社', '工事種別', '職長', '人数', '担当者', 'ステータス', '工事内容', '市区町村', '住所',
    ];
    const rows: string[][] = [header];

    // 画面が絞り込み中は該当した作業履歴だけを出す（一覧の表示と同じ内容にする）
    const useFilter = hasWorkHistoryFilter(ctx.workFilter);

    // 作業日の昇順（同日は pms の並び＝画面の表示順）で安定ソートする
    const entries: Array<{ ymd: string; order: number; pm: ProjectMaster; w: ProjectWorkHistoryItem }> = [];
    pms.forEach((pm, order) => {
        const all = pm.workHistory ?? [];
        const items = useFilter ? filterWorkHistory(all, ctx.workFilter, ctx.resolveCtypeName) : all;
        for (const w of items) {
            entries.push({ ymd: workDateToJstYmd(w.date), order, pm, w });
        }
    });
    entries.sort((a, b) => (a.ymd === b.ymd ? a.order - b.order : a.ymd < b.ymd ? -1 : 1));

    for (const { ymd, pm, w } of entries) {
        rows.push([
            ymd,
            pm.name || pm.title || '',
            pm.title || '',
            pm.customerName || '',
            ctx.resolveCtypeName(w.constructionType),
            w.foremanId ? ctx.managerMap[w.foremanId] || '' : '',
            String(Number(w.memberCount) || 0),
            managersLabel(pm, ctx.managerMap),
            PROJECT_LIST_STATUS_LABEL[resolveProjectListStatus(pm)],
            constructionContentLabel(pm.constructionContent),
            pm.city || '',
            pm.location || '',
        ]);
    }

    return rows;
}
