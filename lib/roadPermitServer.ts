/**
 * 道路申請のサーバー側の読み込みと変換（docs/指示書_道路申請_Phase1.md §5・§7）。
 *
 * - DB を読むのはここだけ。既定値の組み立て・JSON の正規化（純粋な部分）は lib/roadPermit/defaults.ts に任せる。
 * - values / documents は DB の JSON をそのまま信用せず、必ず normalize を通してから画面へ返す
 *   （あとで欄が増えても、古い行に欠けている欄が空で埋まる）。
 */
import type { Prisma, RoadPermit } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authoritiesOf } from '@/lib/roadPermit/forms';
import {
    enabledFormIdsOf,
    latestExpiryOf,
    normalizeRoadPermitDocuments,
    normalizeRoadPermitStatus,
    normalizeRoadPermitValues,
} from '@/lib/roadPermit/defaults';
import { normalizeRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import type {
    RoadPermitCompanyDefaults,
    RoadPermitDto,
    RoadPermitListItem,
    RoadPermitProjectSource,
    RoadPermitValues,
} from '@/types/roadPermit';

type Db = Prisma.TransactionClient;

/** 案件から既定値を作るのに読む列（projectSourceOf に渡す） */
export const ROAD_PERMIT_PROJECT_SELECT = {
    id: true,
    title: true,
    location: true,
    prefecture: true,
    city: true,
    scheduledStartDate: true,
    scheduledEndDate: true,
} as const satisfies Prisma.ProjectMasterSelect;

/** 申請の行と一緒に読む案件名（一覧・1 件とも。案件が消えていれば null） */
export const ROAD_PERMIT_ROW_INCLUDE = {
    projectMaster: { select: { title: true } },
} as const satisfies Prisma.RoadPermitInclude;

/** findMany / findUnique / create / update に ROAD_PERMIT_ROW_INCLUDE を付けて読んだ行 */
export type RoadPermitRow = RoadPermit & { projectMaster: { title: string } | null };

export type RoadPermitProjectRow = {
    id: string;
    title: string;
    location: string | null;
    prefecture: string | null;
    city: string | null;
    scheduledStartDate: Date | null;
    scheduledEndDate: Date | null;
};

// ---------------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------------

/**
 * 自社情報（申請者の欄の初期値）。lib/joyoStatementServer.ts の loadJoyoIssuer と同じく id='default' の 1 行。
 * representativeTitle / contactPerson は String? なので null は '' にそろえる（画面の入力欄は空文字で扱う）。
 */
export async function loadRoadPermitCompanyDefaults(db: Db = prisma): Promise<RoadPermitCompanyDefaults | null> {
    const row = await db.companyInfo.findFirst({
        where: { id: 'default' },
        select: {
            postalCode: true,
            address: true,
            name: true,
            representativeTitle: true,
            representative: true,
            tel: true,
            contactPerson: true,
        },
    });
    if (!row) return null;
    return {
        postalCode: row.postalCode ?? '',
        address: row.address ?? '',
        name: row.name ?? '',
        representativeTitle: row.representativeTitle ?? '',
        representative: row.representative ?? '',
        tel: row.tel ?? '',
        contactPerson: row.contactPerson ?? '',
    };
}

/**
 * 前回の申請（消していないもののうち、いちばん新しく作ったもの）の入力値。
 * 担当者・現場責任者・占用物件などの文言を引き継ぐのに使う。excludeId は「その申請自身を前回に数えない」ため。
 */
export async function loadPreviousRoadPermitValues(db: Db = prisma, excludeId?: string): Promise<RoadPermitValues | null> {
    const row = await db.roadPermit.findFirst({
        where: { deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
        orderBy: { createdAt: 'desc' },
        select: { values: true },
    });
    if (!row) return null;
    return normalizeRoadPermitValues(row.values);
}

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------

const jstYmdFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' });

/** Date → JST の 'YYYY-MM-DD'（予定日は JST 0 時＝UTC 前日 15 時で入っているので、UTC で切ると 1 日ずれる） */
function toJstYmd(date: Date | null | undefined): string | null {
    if (!date || Number.isNaN(date.getTime())) return null;
    return jstYmdFormatter.format(date);
}

/** ProjectMaster（ROAD_PERMIT_PROJECT_SELECT）→ 既定値の元 */
export function projectSourceOf(row: RoadPermitProjectRow): RoadPermitProjectSource {
    return {
        id: row.id,
        title: row.title,
        location: row.location ?? null,
        prefecture: row.prefecture ?? null,
        city: row.city ?? null,
        scheduledStartDate: toJstYmd(row.scheduledStartDate),
        scheduledEndDate: toJstYmd(row.scheduledEndDate),
    };
}

/** 申請 1 件（編集画面用） */
export function toRoadPermitDto(row: RoadPermitRow): RoadPermitDto {
    return {
        id: row.id,
        projectMasterId: row.projectMasterId ?? null,
        projectTitle: row.projectMaster?.title ?? null,
        title: row.title,
        status: normalizeRoadPermitStatus(row.status),
        values: normalizeRoadPermitValues(row.values),
        documents: normalizeRoadPermitDocuments(row.documents),
        // 図面は描いていなければ null（JSON が入っていれば正規化して返す）
        drawing: row.drawing == null ? null : normalizeRoadPermitDrawing(row.drawing),
        createdBy: row.createdBy ?? null,
        updatedBy: row.updatedBy ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/** 一覧の 1 行（申請先は出す様式から・許可期限は出す様式のうちいちばん遅い日） */
export function toRoadPermitListItem(row: RoadPermitRow): RoadPermitListItem {
    const values = normalizeRoadPermitValues(row.values);
    const documents = normalizeRoadPermitDocuments(row.documents);
    return {
        id: row.id,
        projectMasterId: row.projectMasterId ?? null,
        projectTitle: row.projectMaster?.title ?? null,
        title: row.title,
        status: normalizeRoadPermitStatus(row.status),
        authorities: authoritiesOf(enabledFormIdsOf(documents)),
        useFrom: values.period.useFrom,
        useTo: values.period.useTo,
        expiryDate: latestExpiryOf(documents),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
