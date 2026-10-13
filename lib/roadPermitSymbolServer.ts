/**
 * 道路申請の記号（RoadPermitSymbol）のサーバー側の読み書きと DTO 変換（docs/指示書_道路申請_Phase2b_記号.md §3）。
 *
 * - DB の geometry（JSON）は信用せず、必ず normalizeRoadPermitSymbolGeometry を通して返す
 * - 形（geometry・大きさ・取り込み元）は登録のときだけ書く。変更（update）では書かない
 * - 並び順は分類ごと。登録したものはその分類の最後に付く
 */
import type { Prisma, RoadPermitSymbol } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    normalizeRoadPermitSymbolCategory,
    normalizeRoadPermitSymbolGeometry,
    sortRoadPermitSymbols,
} from '@/lib/roadPermit/symbols/normalize';
import type { RoadPermitSymbolCategory, RoadPermitSymbolDto } from '@/types/roadPermitSymbol';
import type { RoadPermitSymbolCreateInput, RoadPermitSymbolUpdateInput } from '@/lib/validations/roadPermitSymbol';

type Db = Prisma.TransactionClient;

const finiteOr = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** DB の行 → 画面に渡す形 */
export function toRoadPermitSymbolDto(row: RoadPermitSymbol): RoadPermitSymbolDto {
    return {
        id: row.id,
        name: row.name,
        category: normalizeRoadPermitSymbolCategory(row.category),
        countLabel: row.countLabel ?? '',
        countUnit: row.countUnit ?? '',
        countNote: row.countNote ?? '',
        geometry: normalizeRoadPermitSymbolGeometry(row.geometry),
        lengthMm: finiteOr(row.lengthMm, 0),
        widthMm: finiteOr(row.widthMm, 0),
        barPitchMm: row.barPitchMm != null && row.barPitchMm > 0 ? row.barPitchMm : null,
        sourceFile: row.sourceFile ?? '',
        sourceBlock: row.sourceBlock ?? '',
        sourceNote: row.sourceNote ?? '',
        sortOrder: row.sortOrder,
        isActive: row.isActive,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/** 記号を全部（使わないものも含む・形も入れる）。並びは 分類 → 並び順 → 名前 */
export async function loadRoadPermitSymbols(db: Db = prisma): Promise<RoadPermitSymbolDto[]> {
    const rows = await db.roadPermitSymbol.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
    return sortRoadPermitSymbols(rows.map(toRoadPermitSymbolDto));
}

/** その分類の最後の並び順＋1（無ければ 0） */
async function nextSortOrder(category: RoadPermitSymbolCategory, db: Db): Promise<number> {
    const agg = await db.roadPermitSymbol.aggregate({ where: { category }, _max: { sortOrder: true } });
    const max = agg?._max?.sortOrder;
    return typeof max === 'number' ? max + 1 : 0;
}

/** 1 件登録（並び順はその分類の最後） */
export async function createRoadPermitSymbol(
    payload: RoadPermitSymbolCreateInput,
    userId: string,
    db: Db = prisma,
): Promise<RoadPermitSymbolDto> {
    const sortOrder = await nextSortOrder(payload.category, db);
    const row = await db.roadPermitSymbol.create({
        data: {
            name: payload.name,
            category: payload.category,
            countLabel: payload.countLabel,
            countUnit: payload.countUnit,
            countNote: payload.countNote,
            geometry: normalizeRoadPermitSymbolGeometry(payload.geometry) as unknown as Prisma.InputJsonValue,
            lengthMm: payload.lengthMm,
            widthMm: payload.widthMm,
            barPitchMm: payload.barPitchMm,
            sourceFile: payload.sourceFile,
            sourceBlock: payload.sourceBlock,
            sourceNote: payload.sourceNote,
            sortOrder,
            isActive: payload.isActive ?? true,
            createdBy: userId,
            updatedBy: userId,
        },
    });
    return toRoadPermitSymbolDto(row);
}

/**
 * 変更（名前・分類・数量の数え方・コーンバーの間隔・出どころ・並び順・使う／使わない）。形は変えない。
 * 無ければ null（ルートが 404 にする）。分類を変えて並び順の指定が無ければ、新しい分類の最後に付ける。
 */
export async function updateRoadPermitSymbol(
    id: string,
    patch: RoadPermitSymbolUpdateInput,
    userId: string,
    db: Db = prisma,
): Promise<RoadPermitSymbolDto | null> {
    const current = await db.roadPermitSymbol.findUnique({ where: { id }, select: { id: true, category: true } });
    if (!current) return null;

    const data: Prisma.RoadPermitSymbolUpdateInput = { updatedBy: userId };
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.category !== undefined) data.category = patch.category;
    if (patch.countLabel !== undefined) data.countLabel = patch.countLabel;
    if (patch.countUnit !== undefined) data.countUnit = patch.countUnit;
    if (patch.countNote !== undefined) data.countNote = patch.countNote;
    if (patch.barPitchMm !== undefined) data.barPitchMm = patch.barPitchMm;
    if (patch.sourceNote !== undefined) data.sourceNote = patch.sourceNote;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.sortOrder !== undefined) {
        data.sortOrder = patch.sortOrder;
    } else if (patch.category !== undefined && patch.category !== normalizeRoadPermitSymbolCategory(current.category)) {
        data.sortOrder = await nextSortOrder(patch.category, db);
    }

    const row = await db.roadPermitSymbol.update({ where: { id }, data });
    return toRoadPermitSymbolDto(row);
}
