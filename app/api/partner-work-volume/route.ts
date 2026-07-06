import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    serverErrorResponse,
    validationErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';

const ADMIN_ROLES = ['admin', 'manager'];
// 閲覧のみ許可するロールを含む（税理士は GET だけ。POST/削除/公開は ADMIN_ROLES のまま）
const VIEWER_ROLES = ['admin', 'manager', 'accountant'];

export type PartnerWorkVolumeRowStatus = 'draft' | 'completed';
/** 行の費目区分。'work' = 作業費、'transport' = 運搬費、'joyo' = 常用（自社メンバーが他職長班に応援で入った分）。 */
export type PartnerWorkVolumeRowType = 'work' | 'transport' | 'joyo';

export interface PartnerWorkVolumeRow {
    /** DB id（保存済み行のみ）。未保存の自動生成行は null */
    id: string | null;
    partnerCompanyId: string;
    date: string; // YYYY-MM-DD (JST)
    customerName: string | null;
    projectMasterId: string | null;
    projectTitle: string;
    managerName: string | null;
    constructionContent: string | null;
    amount: number;
    sourceAssignmentId: string | null;
    /** 同じ配置に対する作業費の行/運搬費の行を区別するキー */
    rowType: PartnerWorkVolumeRowType;
    isManual: boolean;
    sortOrder: number;
    notes: string | null;
    /** 行ごとの完了ステータス。未保存 auto 行は常に 'draft' */
    status: PartnerWorkVolumeRowStatus;
    /** 自動生成由来か（保存済みでも sourceAssignmentId があれば true） */
    isAuto: boolean;
    /** 論理削除日時。null = 削除されていない。値あり = tombstone（GET 通常モードでは返らない） */
    deletedAt: string | null;
    /** ユーザーが明示的に amount を入力したか。true のとき amount=0 でも案件マスタから再算出されない */
    amountOverridden: boolean;
}

interface MonthRange {
    /** 公開状態 (PartnerWorkVolumeMonth) の照合に使う年月 */
    year: number;
    month: number;
    /** PartnerWorkVolume(@db.Date) 用。DATE は時刻を持たないため UTC 00:00 基準で比較する。 */
    start: Date;
    end: Date;
    /**
     * ProjectAssignment(DateTime) 用の JST 日境界。
     * 配置の date は実時刻入り（作成時刻が混入し 00:00 とは限らない）で、表示は jstDateKey（JST 日付）で行う。
     * そのため月内判定も JST 日境界（= UTC では前日 15:00）で行わないと、表示日と取得範囲がズレて
     * 隣月の日付が混入する（例: 2026-05-31T23:59Z は JST 6/1 → 5月表示で 6/1 が出る／
     * 2026-04-30T21:00Z は JST 5/1 → 5月から漏れて 4/30 側に出る）。
     */
    jstStart: Date;
    jstEnd: Date;
}

function parseYearMonth(year: string | null, month: string | null): MonthRange | null {
    if (!year || !month) return null;
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
    // @db.Date 列の比較は UTC 00:00 基準で行う（DATE は時刻を持たないため）
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    // JST 0時 = UTC 前日 15時。JST 月初/翌月初を UTC 瞬間で表したもの。
    const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const jstStart = new Date(start.getTime() - JST_OFFSET_MS);
    const jstEnd = new Date(end.getTime() - JST_OFFSET_MS);
    return { year: y, month: m, start, end, jstStart, jstEnd };
}

function jstDateKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function jstDateOnly(s: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    // @db.Date 列に保存するため UTC 00:00 で固定（時刻を持たない DATE 型はタイムゾーンの影響を受けないようにする）
    return new Date(Date.UTC(y, m - 1, d));
}

function clampInt(value: unknown, max = 100_000_000): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    // マイナス入力（値引き・調整など）を許容するため [-max, max] でクランプする
    return Math.max(-max, Math.min(max, Math.round(n)));
}

function clampSortOrder(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-1_000_000, Math.min(1_000_000, Math.round(n)));
}

function normalizeStatus(value: unknown): PartnerWorkVolumeRowStatus {
    return value === 'completed' ? 'completed' : 'draft';
}

/**
 * GET /api/partner-work-volume?companyId=&year=YYYY&month=MM&includeDeleted=0|1
 * 配置から自動生成された候補行と DB 保存済み行をマージして返す。
 * 月の monthStatus は「全行 completed && 行数 > 0」のときだけ 'completed'、それ以外は 'draft'。
 * partner は「monthStatus === 'completed' かつ 管理者が公開済み
 * (PartnerWorkVolumeMonth.status === 'published')」のときのみ rows を取得できる。
 * 全行完了だけでは公開されない（公開は POST /api/partner-work-volume/publish、kei 決定 2026-06-10）。
 *
 * includeDeleted=1 を渡すと、論理削除済みの行も rows に含めて返す（admin/manager 限定）。
 * 通常モードでは deletedAt != null の行は rows から除外されるが、usedAutoKeys には登録される
 * ため、同じ (assignmentId, rowType) の auto 行は再生成されない。
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        const userId = session!.user.id as string;

        const url = new URL(req.url);
        const queryCompanyId = url.searchParams.get('companyId');
        const range = parseYearMonth(url.searchParams.get('year'), url.searchParams.get('month'));
        if (!range) return validationErrorResponse('year/month が不正です');
        // partner viewer は常に削除済みを見せない。admin/manager のみ ?includeDeleted=1 で削除済みも返す
        const includeDeletedParam = url.searchParams.get('includeDeleted') === '1';

        // 対象会社 ID を決定
        // 閲覧可能ロール: admin / manager / accountant(税理士・閲覧のみ) / partner (= 協力会社アカウント本体のみ)
        let partnerCompanyId: string | null = null;
        if (VIEWER_ROLES.includes(role)) {
            if (!queryCompanyId) return validationErrorResponse('companyId が必要です');
            partnerCompanyId = queryCompanyId;
        } else if (role === 'partner') {
            partnerCompanyId = userId;
        } else {
            return errorResponse('権限がありません', 403);
        }
        if (!partnerCompanyId) return errorResponse('協力会社が特定できません', 400);

        const partnerCompany = await prisma.user.findUnique({
            where: { id: partnerCompanyId },
            select: { id: true, role: true, displayName: true, partnerTaxMode: true },
        });
        if (!partnerCompany || partnerCompany.role.toLowerCase() !== 'partner') {
            return errorResponse('協力会社が見つかりません', 404);
        }
        const taxMode: 'exclusive' | 'inclusive' =
            partnerCompany.partnerTaxMode === 'inclusive' ? 'inclusive' : 'exclusive';

        const isPartnerViewer = role === 'partner';

        // 会社所属メンバー
        const members = await prisma.user.findMany({
            where: { companyId: partnerCompanyId },
            select: { id: true, displayName: true },
        });
        const memberIds = new Set<string>(members.map((m) => m.id));
        memberIds.add(partnerCompanyId);
        // メンバー id → 表示名（常用行の「（北野）」表記に使う）。会社本体 id も自分の表示名で引けるようにする。
        const nameById = new Map<string, string>(members.map((m) => [m.id, m.displayName]));
        nameById.set(partnerCompanyId, partnerCompany.displayName);

        // 月内の配置を取得（配置は実時刻入り DateTime で表示は JST 日付 → JST 日境界で絞る）
        const assignments = await prisma.projectAssignment.findMany({
            where: { date: { gte: range.jstStart, lt: range.jstEnd } },
            select: {
                id: true,
                date: true,
                assignedEmployeeId: true,
                confirmedWorkerIds: true,
                constructionType: true,
                isDispatchConfirmed: true,
                subcontractorCostOverride: true,
                projectMaster: {
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        honorific: true,
                        customerShortName: true,
                        customerName: true,
                        createdBy: true,
                        managerIds: true,
                        subcontractorCosts: {
                            select: { constructionTypeId: true, amount: true, transportCost: true },
                        },
                    },
                },
            },
            orderBy: [{ date: 'asc' }],
        });

        // 案件担当者 (createdBy: JSON 配列) と managerIds の両方を解決対象に
        const managerIdSet = new Set<string>();
        const createdByByPm = new Map<string, string[]>();
        for (const a of assignments) {
            const pm = a.projectMaster;
            const ids = parseJsonField<string[]>(pm.createdBy, []);
            createdByByPm.set(pm.id, ids);
            for (const id of ids) managerIdSet.add(id);
            for (const mid of pm.managerIds ?? []) managerIdSet.add(mid);
        }
        const managerUsers = await prisma.user.findMany({
            where: { id: { in: Array.from(managerIdSet) } },
            select: { id: true, displayName: true },
        });
        const managerMap = new Map(managerUsers.map((u) => [u.id, u.displayName]));

        // 工事種別マスタは isActive=false（非表示済み）も含めて id→name を引けるようにする。
        // 同名で別UUIDの行が混在しているケース（重複マスタ）や、案件マスタの協力業者費が
        // 非アクティブな種別UUIDで保存されているケースでも、名称ベースで照合できるようにするため。
        const constructionTypes = await prisma.constructionType.findMany({
            select: { id: true, name: true },
        });
        const constructionTypeMap = new Map(constructionTypes.map((c) => [c.id, c.name]));

        // 協力会社が関与する配置を「自社班」と「常用（他職長班への応援）」に分ける。
        // - 自社班: assignedEmployeeId が協力会社自身 → 従来どおり案件単位で作業費/運搬費の行を生成。
        // - 常用  : 別の職長班の配置に自社メンバー (confirmedWorkerIds) が含まれる
        //           → (日付 × 職長) でまとめて 1 行の常用行を生成。
        const ownTeamAssignments = assignments.filter(
            (a) => a.assignedEmployeeId === partnerCompanyId,
        );
        const joyoAssignments = assignments.filter((a) => {
            if (a.assignedEmployeeId === partnerCompanyId) return false;
            const confirmed = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            return confirmed.some((id) => memberIds.has(id));
        });
        const joyoAssignmentIdSet = new Set(joyoAssignments.map((a) => a.id));

        // 常用行の現場名「{職長名}班（…）」用に、職長 (assignedEmployeeId) の表示名を引く。
        const joyoForemanIds = Array.from(new Set(joyoAssignments.map((a) => a.assignedEmployeeId)));
        const foremen = await prisma.user.findMany({
            where: { id: { in: joyoForemanIds } },
            select: { id: true, displayName: true },
        });
        const foremanNameById = new Map(foremen.map((f) => [f.id, f.displayName]));

        // 案件マスタ単位で「工事種別ID → 金額」と「工事種別名 → 金額」の両方のマップを
        // 「作業費」と「運搬費」それぞれ作る。フォールバック照合用に名前マップも持つ。
        // 自社班の配置だけでなく、当月の全配置の案件マスタを対象にしておく
        // （保存済み行の再算出時、その配置が対象配置から外れていても引けるように）。
        type AmountMaps = {
            workById: Map<string, number>;
            workByName: Map<string, number>;
            transportById: Map<string, number>;
            transportByName: Map<string, number>;
        };
        const subcontractorAmountByPm = new Map<string, AmountMaps>();
        for (const a of assignments) {
            const pm = a.projectMaster;
            if (subcontractorAmountByPm.has(pm.id)) continue;
            const workById = new Map<string, number>();
            const workByName = new Map<string, number>();
            const transportById = new Map<string, number>();
            const transportByName = new Map<string, number>();
            for (const c of pm.subcontractorCosts) {
                const work = Math.round(Number(c.amount));
                workById.set(c.constructionTypeId, work);
                const name = constructionTypeMap.get(c.constructionTypeId);
                if (name && !workByName.has(name)) workByName.set(name, work);
                const transport = c.transportCost != null
                    ? Math.round(Number(c.transportCost))
                    : 0;
                if (transport > 0) {
                    transportById.set(c.constructionTypeId, transport);
                    if (name && !transportByName.has(name)) transportByName.set(name, transport);
                }
            }
            subcontractorAmountByPm.set(pm.id, { workById, workByName, transportById, transportByName });
        }

        // 指定した費目区分 (work / transport) で、配置の constructionType から金額を解決する。
        // a.constructionType が UUID → byId、ヒットしなければ名称 byName でフォールバック。
        // 運搬費が設定されていない場合は 0。
        const autoSubcontractorAmount = (
            pmId: string,
            constructionType: string | null,
            kind: 'work' | 'transport',
        ): number => {
            if (!constructionType) return 0;
            const maps = subcontractorAmountByPm.get(pmId);
            if (!maps) return 0;
            const byId = kind === 'work' ? maps.workById : maps.transportById;
            const byName = kind === 'work' ? maps.workByName : maps.transportByName;
            const hit = byId.get(constructionType);
            if (hit != null) return hit;
            const name = constructionTypeMap.get(constructionType);
            if (name) {
                const nameHit = byName.get(name);
                if (nameHit != null) return nameHit;
            }
            return 0;
        };

        // 原価(computeProjectCosts)と出来高の合計を一致させるための重複排除。
        // 原価は「案件×工事種別ごと1回・手配確定済みのみ」で外注費を計上する。出来高の自動単価も
        // (案件×工事種別) ごとに最初の手配確定済み配置 1 件だけが持ち、残りの配置は 0 にする
        // （行自体は日々の worklog として残す）。
        const claimKey = (pmId: string, type: string | null) => `${pmId}::${type ?? ''}`;
        const claimAssignmentByType = new Map<string, string>();
        for (const a of ownTeamAssignments) {
            if (!a.isDispatchConfirmed || !a.constructionType) continue;
            const work = autoSubcontractorAmount(a.projectMaster.id, a.constructionType, 'work');
            const transport = autoSubcontractorAmount(a.projectMaster.id, a.constructionType, 'transport');
            if (work <= 0 && transport <= 0) continue; // 単価未設定の種別は代表を立てない
            const k = claimKey(a.projectMaster.id, a.constructionType);
            if (!claimAssignmentByType.has(k)) claimAssignmentByType.set(k, a.id);
        }
        // 手配確定済み & その (案件×種別) の代表配置のときだけ自動単価を返す（それ以外は 0）。上書きは含めない。
        const dedupedAutoAmount = (
            a: { id: string; isDispatchConfirmed: boolean; constructionType: string | null; projectMaster: { id: string } },
            kind: 'work' | 'transport',
        ): number => {
            if (!a.isDispatchConfirmed || !a.constructionType) return 0;
            if (claimAssignmentByType.get(claimKey(a.projectMaster.id, a.constructionType)) !== a.id) return 0;
            return autoSubcontractorAmount(a.projectMaster.id, a.constructionType, kind);
        };

        // 自動生成 auto row 候補
        // 1 配置に対して「作業費の行」と「運搬費の行（運搬費 > 0 のときのみ）」を生成する。
        // キーは `${assignmentId}:${rowType}` の形式。
        const autoRowKey = (assignmentId: string, rowType: PartnerWorkVolumeRowType): string =>
            `${assignmentId}:${rowType}`;

        const autoRows = new Map<string, PartnerWorkVolumeRow>();
        for (const a of ownTeamAssignments) {
            const pm = a.projectMaster;
            const projectTitle = pm.name ? `${pm.name}${pm.honorific ?? ''}` : pm.title;
            const customerName = pm.customerShortName || pm.customerName || null;
            const createdByIds = createdByByPm.get(pm.id) ?? [];
            const managerSourceIds = createdByIds.length > 0 ? createdByIds : (pm.managerIds ?? []);
            const managerName = managerSourceIds
                .map((id) => managerMap.get(id))
                .filter(Boolean)
                .join('、') || null;
            const baseContent = a.constructionType
                ? constructionTypeMap.get(a.constructionType) ?? null
                : null;

            // 作業費の行。上書き=外注費の総額（運搬費込み）。自動単価は (案件×種別) の代表配置のみ。
            const override = a.subcontractorCostOverride;
            const workAmount = override != null ? override : dedupedAutoAmount(a, 'work');
            // 手配確定済み、または上書きのある配置だけ作業費の行を出す（未確定は原価0なので出さない）。
            if (a.isDispatchConfirmed || override != null) {
                autoRows.set(autoRowKey(a.id, 'work'), {
                    id: null,
                    partnerCompanyId,
                    date: jstDateKey(a.date),
                    customerName,
                    projectMasterId: pm.id,
                    projectTitle,
                    managerName,
                    constructionContent: baseContent,
                    amount: workAmount,
                    sourceAssignmentId: a.id,
                    rowType: 'work',
                    isManual: false,
                    sortOrder: 0,
                    notes: null,
                    status: 'draft',
                    isAuto: true,
                    deletedAt: null,
                    amountOverridden: false,
                });
            }

            // 運搬費の行（上書き時は総額に含むため別出ししない。代表配置 & 運搬費>0 のときのみ）
            const transportAmount = override != null ? 0 : dedupedAutoAmount(a, 'transport');
            if (transportAmount > 0) {
                autoRows.set(autoRowKey(a.id, 'transport'), {
                    id: null,
                    partnerCompanyId,
                    date: jstDateKey(a.date),
                    customerName,
                    projectMasterId: pm.id,
                    projectTitle,
                    managerName,
                    constructionContent: baseContent ? `${baseContent}（運搬費）` : '運搬費',
                    amount: transportAmount,
                    sourceAssignmentId: a.id,
                    rowType: 'transport',
                    isManual: false,
                    sortOrder: 0,
                    notes: null,
                    status: 'draft',
                    isAuto: true,
                    deletedAt: null,
                    amountOverridden: false,
                });
            }
        }

        // 常用 (joyo) 行: 自社メンバーが他職長班に入った配置を (日付 × 職長) でまとめて 1 行にする。
        // 同じ職長班が同日に複数現場へ行っても 1 行。現場名 = 「{職長名}班（{メンバー名…}）」。
        // 元請会社・担当者・案件は持たず、作業内容 = 「常用」、金額は初期 0（手入力で編集可）。
        const joyoGroups = new Map<
            string,
            { date: string; foremanId: string; members: Set<string> }
        >();
        for (const a of joyoAssignments) {
            const dateKey = jstDateKey(a.date);
            const groupKey = `${dateKey}__${a.assignedEmployeeId}`;
            let g = joyoGroups.get(groupKey);
            if (!g) {
                g = { date: dateKey, foremanId: a.assignedEmployeeId, members: new Set<string>() };
                joyoGroups.set(groupKey, g);
            }
            const confirmed = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            for (const id of confirmed) {
                if (memberIds.has(id)) g.members.add(id);
            }
        }
        for (const g of joyoGroups.values()) {
            const foremanName = foremanNameById.get(g.foremanId) ?? '不明';
            const memberNames = Array.from(g.members).map((id) => nameById.get(id) ?? '不明');
            // 会社を含めグローバル一意な合成キー（@@unique([sourceAssignmentId, rowType]) は全社横断のため）。
            const syntheticId = `joyo:${partnerCompanyId}:${g.foremanId}:${g.date}`;
            autoRows.set(autoRowKey(syntheticId, 'joyo'), {
                id: null,
                partnerCompanyId,
                date: g.date,
                customerName: null,
                projectMasterId: null,
                projectTitle: `${foremanName}班（${memberNames.join('、')}）`,
                managerName: null,
                constructionContent: '常用',
                amount: 0,
                sourceAssignmentId: syntheticId,
                rowType: 'joyo',
                isManual: false,
                sortOrder: 0,
                notes: null,
                status: 'draft',
                isAuto: true,
                deletedAt: null,
                amountOverridden: false,
            });
        }

        // 保存済み行
        const saved = await prisma.partnerWorkVolume.findMany({
            where: {
                partnerCompanyId,
                date: { gte: range.start, lt: range.end },
            },
        });

        const merged: PartnerWorkVolumeRow[] = [];
        // 同じ配置 (sourceAssignmentId) でも rowType が異なれば別行なので、
        // 「保存済み」判定は (sourceAssignmentId, rowType) のペアで行う。
        // 削除済み (deletedAt != null) の行も usedAutoKeys に含めて auto 行の再生成を抑止する。
        const usedAutoKeys = new Set<string>();
        // 削除済み行を rows に含めるかは admin/manager + ?includeDeleted=1 のときのみ
        // （partner はもちろん、閲覧のみの accountant にも見せない）
        const includeDeleted = includeDeletedParam && ADMIN_ROLES.includes(role);
        let latestCompletedAt: Date | null = null;
        for (const row of saved) {
            const savedRowType: PartnerWorkVolumeRowType =
                row.rowType === 'transport'
                    ? 'transport'
                    : row.rowType === 'joyo'
                        ? 'joyo'
                        : 'work';
            if (row.sourceAssignmentId) {
                // 削除済みでも auto 再生成抑止のため記録
                usedAutoKeys.add(autoRowKey(row.sourceAssignmentId, savedRowType));
            }
            // 削除済み行は通常モードでは rows に含めない（partner viewer も含めない）
            if (row.deletedAt && !includeDeleted) continue;
            // 本改修前に「他班配置（常用）」が通常 work/transport 行として保存された残骸は表示しない
            // （現在はグループ化した joyo 行で表すため）。usedAutoKeys へは上で登録済みなので再生成もされない。
            if (
                savedRowType !== 'joyo' &&
                row.sourceAssignmentId &&
                joyoAssignmentIdSet.has(row.sourceAssignmentId)
            ) {
                continue;
            }
            if (row.completedAt && (!latestCompletedAt || row.completedAt > latestCompletedAt)) {
                latestCompletedAt = row.completedAt;
            }
            // 自動行（配置由来）で保存済み金額が 0 のときは、最新の配置・案件マスタから再算出する。
            // 想定シナリオ: 配置自動行が amount=0 のまま保存（例: 完了操作）された後に
            // 案件マスタの「協力業者費（予定）」を変更したケース。
            // 再算出は必ず amount=0 の場合のみ行うため、ユーザーが画面で明示的に入力した
            // 金額（>0）は上書きしない。
            // ユーザーが意図的に 0 を入力したケース（amountOverridden=true）も再算出しない。
            // subcontractorCostOverride は『作業費の行』だけに適用する（運搬費は別建て）。
            // 常用 (joyo) 行は協力業者費からの再算出対象外（金額は手入力値を保持）。
            // savedRowType !== 'joyo' で型も 'work' | 'transport' に絞られる。
            let effectiveAmount = row.amount;
            if (
                effectiveAmount === 0 &&
                row.sourceAssignmentId &&
                !row.amountOverridden &&
                savedRowType !== 'joyo'
            ) {
                const sourceAssignment = assignments.find((x) => x.id === row.sourceAssignmentId);
                if (sourceAssignment) {
                    const srcOverride = sourceAssignment.subcontractorCostOverride;
                    if (savedRowType === 'work' && srcOverride != null) {
                        effectiveAmount = srcOverride;
                    } else if (srcOverride != null) {
                        // 上書きは外注費の総額を作業費側に集約するため、運搬費の行は 0
                        effectiveAmount = 0;
                    } else {
                        // 原価と一致させるため重複排除（手配確定済み & 案件×種別の代表配置のみ単価）
                        effectiveAmount = dedupedAutoAmount(sourceAssignment, savedRowType);
                    }
                }
            }
            merged.push({
                id: row.id,
                partnerCompanyId: row.partnerCompanyId,
                date: jstDateKey(row.date),
                customerName: row.customerName,
                projectMasterId: row.projectMasterId,
                projectTitle: row.projectTitle,
                managerName: row.managerName,
                constructionContent: row.constructionContent,
                amount: effectiveAmount,
                sourceAssignmentId: row.sourceAssignmentId,
                rowType: savedRowType,
                isManual: row.isManual,
                sortOrder: row.sortOrder,
                notes: row.notes,
                status: normalizeStatus(row.status),
                isAuto: !!row.sourceAssignmentId,
                deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
                amountOverridden: row.amountOverridden,
            });
        }
        // まだ保存されていない自動行（削除済みで usedAutoKeys に登録された分は除外される）
        for (const [key, row] of autoRows) {
            if (usedAutoKeys.has(key)) continue;
            merged.push(row);
        }

        // 月の完了判定: 削除済み行を除外した「有効行」が 1 件以上あり、全て completed のときだけ 'completed'
        // includeDeleted=1 のときも monthStatus は有効行ベースで計算する。
        const activeRows = merged.filter((r) => !r.deletedAt);
        const totalRows = activeRows.length;
        const completedCount = activeRows.filter((r) => r.status === 'completed').length;
        const monthStatus: PartnerWorkVolumeRowStatus =
            totalRows > 0 && completedCount === totalRows ? 'completed' : 'draft';

        // 月の公開状態。PartnerWorkVolumeMonth を公開フラグの置き場として利用する
        // （status='published' = 公開済み、completedAt/completedBy = 公開日時/公開者に転用）。
        const monthRecord = await prisma.partnerWorkVolumeMonth.findUnique({
            where: {
                partnerCompanyId_year_month: {
                    partnerCompanyId,
                    year: range.year,
                    month: range.month,
                },
            },
        });
        const published = monthRecord?.status === 'published';
        const publishedAt =
            published && monthRecord?.completedAt ? monthRecord.completedAt.toISOString() : null;

        // partner は「全行完了 && 管理者が公開済み」の AND を満たすときのみ閲覧可。
        // 公開後に行追加・完了解除で全行完了が崩れた場合もここで自動的に非表示へ戻る
        // （公開フラグは保持され、再び全行完了になれば再公開される）。
        if (isPartnerViewer && !(monthStatus === 'completed' && published)) {
            return NextResponse.json(
                {
                    partnerCompany: { id: partnerCompany.id, displayName: partnerCompany.displayName, taxMode },
                    rows: [],
                    monthStatus,
                    completedAt: null,
                    published,
                    publishedAt: null,
                    totalRows,
                    completedCount,
                },
                { headers: { 'Cache-Control': 'no-store' } }
            );
        }

        // 並び替え: 日付昇順 → sortOrder → 自動行を先に
        merged.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            if (!!a.sourceAssignmentId !== !!b.sourceAssignmentId) {
                return a.sourceAssignmentId ? -1 : 1;
            }
            return 0;
        });

        // 自動行 (配置由来) は元々 sortOrder=0 で生成されるため、同日に複数あると
        // 全て同値となり、行間挿入 (上に追加/下に追加) で bisect ができず
        // フォールバックでクラスタ末尾に追加されてしまう。
        // ここで表示順を保ったまま、日付グループごとに自動行へ一意な sortOrder
        // (0, 10, 20, ...) を割り振り、クライアントの挿入処理を機能させる。
        // 通常の手動行は「行追加」が maxSort + 100 を使うため 100 以上、
        // 「上に挿入」フォールバックが row - 100 を使うため負値か > 30 で衝突しにくい。
        const autoSeqByDate = new Map<string, number>();
        const AUTO_STEP = 10;
        for (const r of merged) {
            if (!r.sourceAssignmentId) continue;
            const i = autoSeqByDate.get(r.date) ?? 0;
            r.sortOrder = i * AUTO_STEP;
            autoSeqByDate.set(r.date, i + 1);
        }
        // sortOrder が変わったので再ソート
        merged.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            if (!!a.sourceAssignmentId !== !!b.sourceAssignmentId) {
                return a.sourceAssignmentId ? -1 : 1;
            }
            return 0;
        });

        return NextResponse.json(
            {
                partnerCompany: { id: partnerCompany.id, displayName: partnerCompany.displayName, taxMode },
                rows: merged,
                monthStatus,
                completedAt:
                    monthStatus === 'completed' && latestCompletedAt
                        ? latestCompletedAt.toISOString()
                        : null,
                published,
                publishedAt,
                totalRows,
                completedCount,
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (err) {
        return serverErrorResponse('協力会社出来高取得', err);
    }
}

interface UpsertBody {
    id?: string | null;
    partnerCompanyId: string;
    date: string; // YYYY-MM-DD
    customerName?: string | null;
    projectMasterId?: string | null;
    projectTitle: string;
    managerName?: string | null;
    constructionContent?: string | null;
    amount?: number;
    sourceAssignmentId?: string | null;
    rowType?: PartnerWorkVolumeRowType;
    isManual?: boolean;
    sortOrder?: number;
    notes?: string | null;
    status?: PartnerWorkVolumeRowStatus;
    /**
     * 論理削除 / 復元の明示指定。
     * - true  → 墓標化（deletedAt=now, deletedBy=自分）。未保存 auto 行の tombstone 化にも使う。
     * - false → 復元（deletedAt=null, deletedBy=null）。
     * - undefined → 削除フィールドに触れない（既存の編集挙動を維持）。
     */
    deleted?: boolean;
    /**
     * ユーザーが amount を明示的に変更したか。
     * - true  → amount フィールドが画面で直接編集された（amountOverridden=true をセット）。
     * - undefined → amount フィールドに触れていない（amountOverridden を変更しない）。
     * クライアントは「金額セルを編集した保存」のときだけ true を渡す。完了トグル等では渡さない。
     */
    amountOverridden?: boolean;
}

/**
 * POST /api/partner-work-volume
 * 1行を upsert（admin / manager のみ）
 * - id がある場合 → update
 * - sourceAssignmentId がある場合 → そのキーで upsert
 * - どちらもない場合 → 新規作成（手動行）
 *
 * status を含めると、completedAt/completedBy も併せて更新される。
 * deleted を含めると deletedAt/deletedBy も併せて更新される（true=削除 / false=復元）。
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!ADMIN_ROLES.includes(role)) {
            return errorResponse('管理者またはマネージャー権限が必要です', 403);
        }

        const body = (await req.json()) as UpsertBody;
        if (!body || !body.partnerCompanyId || !body.date || !body.projectTitle) {
            return validationErrorResponse('partnerCompanyId / date / projectTitle が必要です');
        }
        const dateOnly = jstDateOnly(body.date);
        if (!dateOnly) return validationErrorResponse('date が不正です（YYYY-MM-DD）');

        const userId = session!.user.id as string;
        const now = new Date();
        const statusUpdate = body.status !== undefined
            ? {
                  status: normalizeStatus(body.status),
                  completedAt: normalizeStatus(body.status) === 'completed' ? now : null,
                  completedBy: normalizeStatus(body.status) === 'completed' ? userId : null,
              }
            : {};
        // deleted: true → 墓標化 / false → 復元 / undefined → 触らない
        const deletedUpdate = body.deleted !== undefined
            ? {
                  deletedAt: body.deleted ? now : null,
                  deletedBy: body.deleted ? userId : null,
              }
            : {};
        // amountOverridden: true → ユーザーが金額セルを明示編集した / undefined → 触らない
        const amountOverriddenUpdate = body.amountOverridden === true
            ? { amountOverridden: true }
            : {};

        const rowType: PartnerWorkVolumeRowType =
            body.rowType === 'transport'
                ? 'transport'
                : body.rowType === 'joyo'
                    ? 'joyo'
                    : 'work';

        const data = {
            partnerCompanyId: body.partnerCompanyId,
            date: dateOnly,
            customerName: body.customerName?.trim() || null,
            projectMasterId: body.projectMasterId ?? null,
            projectTitle: body.projectTitle.trim(),
            managerName: body.managerName?.trim() || null,
            constructionContent: body.constructionContent?.trim() || null,
            amount: clampInt(body.amount),
            rowType,
            sortOrder: clampSortOrder(body.sortOrder),
            notes: body.notes?.trim() || null,
            updatedBy: userId,
            ...statusUpdate,
            ...deletedUpdate,
            ...amountOverriddenUpdate,
        };

        let saved;
        if (body.id) {
            saved = await prisma.partnerWorkVolume.update({
                where: { id: body.id },
                data,
            });
        } else if (body.sourceAssignmentId) {
            // (sourceAssignmentId, rowType) の複合キーで upsert
            saved = await prisma.partnerWorkVolume.upsert({
                where: {
                    sourceAssignmentId_rowType: {
                        sourceAssignmentId: body.sourceAssignmentId,
                        rowType,
                    },
                },
                update: data,
                create: {
                    ...data,
                    sourceAssignmentId: body.sourceAssignmentId,
                    isManual: false,
                },
            });
        } else {
            saved = await prisma.partnerWorkVolume.create({
                data: {
                    ...data,
                    isManual: true,
                },
            });
        }

        return NextResponse.json(saved, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        return serverErrorResponse('協力会社出来高保存', err);
    }
}
