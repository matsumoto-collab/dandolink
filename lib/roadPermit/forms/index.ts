/**
 * 様式（書類）のカタログ。1 様式 1 ファイル。
 * 様式を足すときは、ファイルを 1 つ足してここの一覧に並べる（types/roadPermit.ts の RoadPermitFormId にも id を足す）。
 */
import type { RoadPermitFormId } from '@/types/roadPermit';
import type { RoadPermitFormDef } from './types';
import { policeRoadUseForm } from './policeRoadUse';
import { matsuyamaOccupancyApplyForm } from './matsuyamaOccupancyApply';
import { matsuyamaOccupancyReplyForm } from './matsuyamaOccupancyReply';

export type { RoadPermitFormDef } from './types';
export { MATSUYAMA_MAYOR_DEFAULT } from './matsuyamaOccupancyApply';

/** 並び順（sortOrder）どおりの一覧 */
export const ROAD_PERMIT_FORMS: readonly RoadPermitFormDef[] = [
    policeRoadUseForm,
    matsuyamaOccupancyApplyForm,
    matsuyamaOccupancyReplyForm,
].sort((a, b) => a.sortOrder - b.sortOrder);

const BY_ID: ReadonlyMap<RoadPermitFormId, RoadPermitFormDef> = new Map(ROAD_PERMIT_FORMS.map((f) => [f.id, f]));

export function getRoadPermitForm(id: RoadPermitFormId): RoadPermitFormDef {
    const def = BY_ID.get(id);
    if (!def) throw new Error(`未知の様式です: ${id}`);
    return def;
}

export function isRoadPermitFormId(value: unknown): value is RoadPermitFormId {
    return typeof value === 'string' && BY_ID.has(value as RoadPermitFormId);
}

/** 様式の id の並びを、カタログの並び順（sortOrder）に直す（重複・未知の id は落とす） */
export function sortFormIds(ids: readonly RoadPermitFormId[]): RoadPermitFormId[] {
    const set = new Set(ids);
    return ROAD_PERMIT_FORMS.filter((f) => set.has(f.id)).map((f) => f.id);
}

/** 申請先の短い表記の一覧（重複なし・カタログ順）。一覧の「申請先」列に「松山東署＋松山市」のように出す */
export function authoritiesOf(ids: readonly RoadPermitFormId[]): string[] {
    const out: string[] = [];
    for (const id of sortFormIds(ids)) {
        const short = getRoadPermitForm(id).authorityShort;
        if (!out.includes(short)) out.push(short);
    }
    return out;
}
