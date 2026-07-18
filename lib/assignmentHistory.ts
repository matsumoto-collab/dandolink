import { parseJsonField } from '@/lib/json-utils';

/**
 * 配置（ProjectAssignment）の変更履歴の記録ルールと表示ラベル。
 *
 * ScheduleChangeHistory は汎用の changeType / previousValue / newValue 文字列列。
 * 「誰が・いつ・何を変えたか」を残す（kei要望 2026-07-18: 登録した人・車両を
 * 変更した人などが分かるように）。
 *
 * 保存形式の方針:
 * - date / foreman / dateStatus は既存の保存形式（ISO / UserID / 生値）を維持し、
 *   表示側で整形・名前解決する（履歴パネルの「元に戻す」互換のため）。
 * - それ以外の新規フィールドは保存時に人間が読める文字列へ整形する。
 * - sortOrder（セル内の表示順）と workers（人数のダミー配列）は雑音になるため記録しない。
 */

export const ASSIGNMENT_CHANGE_LABELS: Record<string, string> = {
    created: '登録',
    date: '日付',
    foreman: '職長',
    dateStatus: '日付確度',
    confirmDueDate: '確認予定日',
    memberCount: '人数',
    vehicles: '車両',
    meetingTime: '集合時間',
    remarks: '備考',
    dispatchRemark: '手配備考',
    estimatedHours: '予定時間',
    constructionType: '工事種別',
    dispatch: '手配確定',
    restored: '復元',
    delete: '削除',
};

export const DATE_STATUS_VALUE_LABELS: Record<string, string> = {
    confirmed: '確定',
    tentative: '仮',
};

export const HISTORY_EMPTY_LABEL = '(なし)';

/** 単独イベント（→ 表記にしない changeType） */
export const STANDALONE_CHANGE_TYPES = new Set(['created', 'restored', 'delete']);

export interface HistoryEntryInput {
    changeType: string;
    previousValue: string;
    newValue: string;
}

interface CurrentAssignmentShape {
    date: Date;
    assignedEmployeeId: string;
    dateStatus: string;
    confirmDueDate: Date | null;
    memberCount: number;
    vehicles: string | null;
    meetingTime: string | null;
    remarks: string | null;
    dispatchRemark: string | null;
    estimatedHours: number | null;
    constructionType: string | null;
    isDispatchConfirmed: boolean;
    confirmedWorkerIds: string | null;
    confirmedVehicleIds: string | null;
}

export interface HistoryNameMaps {
    /** 確定メンバー（confirmedWorkerIds）の ID → 表示名 */
    users: Map<string, string>;
    /** 確定車両（confirmedVehicleIds）の ID → 車両名 */
    vehicles: Map<string, string>;
    /** 工事種別の ID → 名前 */
    constructionTypes: Map<string, string>;
}

/** 履歴記録の対象になり得る body のキー（willRecordHistory 判定用） */
export const HISTORY_TRACKED_KEYS = [
    'date',
    'assignedEmployeeId',
    'dateStatus',
    'confirmDueDate',
    'memberCount',
    'vehicles',
    'meetingTime',
    'remarks',
    'dispatchRemark',
    'estimatedHours',
    'constructionType',
    'isDispatchConfirmed',
    'confirmedWorkerIds',
    'confirmedVehicleIds',
] as const;

const fmtOrEmpty = (v: string | null | undefined): string => {
    const s = (v ?? '').trim();
    return s === '' ? HISTORY_EMPTY_LABEL : s;
};

const joinOrEmpty = (list: string[]): string => (list.length ? list.join(', ') : HISTORY_EMPTY_LABEL);

/** JST の YYYY-MM-DD（confirmDueDate の保存形式） */
export function jstYmd(d: Date | null | undefined): string {
    if (!d) return HISTORY_EMPTY_LABEL;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

function resolveNames(ids: string[], map: Map<string, string>): string[] {
    return ids.map((id) => map.get(id) ?? id);
}

/** 手配確定の状態を1つの読みやすい文字列に（未確定 / 確定（A, B｜3t）） */
function dispatchStateLabel(
    confirmed: boolean,
    workerIds: string[],
    vehicleIds: string[],
    maps: HistoryNameMaps
): string {
    if (!confirmed) return '未確定';
    const members = joinOrEmpty(resolveNames(workerIds, maps.users));
    const vehicles = joinOrEmpty(resolveNames(vehicleIds, maps.vehicles));
    return `確定（${members}｜${vehicles}）`;
}

/**
 * PATCH の受信値（適用されるフィールドのみに絞った body）と現在値を比較し、
 * 記録すべき履歴エントリを生成する（純粋関数・prisma 非依存）。
 */
export function buildAssignmentHistoryEntries(params: {
    current: CurrentAssignmentShape;
    body: Record<string, unknown>;
    nameMaps: HistoryNameMaps;
}): HistoryEntryInput[] {
    const { current, body, nameMaps } = params;
    const entries: HistoryEntryInput[] = [];

    // 日付（既存互換: ISO で保存）
    if (body.date !== undefined) {
        const prevIso = current.date.toISOString();
        const newIso = new Date(body.date as string).toISOString();
        if (prevIso !== newIso) {
            entries.push({ changeType: 'date', previousValue: prevIso, newValue: newIso });
        }
    }

    // 職長（既存互換: UserID で保存。表示側で名前解決）
    if (body.assignedEmployeeId !== undefined && body.assignedEmployeeId !== current.assignedEmployeeId) {
        entries.push({
            changeType: 'foreman',
            previousValue: current.assignedEmployeeId,
            newValue: String(body.assignedEmployeeId),
        });
    }

    // 日付確度（既存互換: 生値で保存。表示側で 確定/仮 にラベル化）
    if (body.dateStatus !== undefined && body.dateStatus !== current.dateStatus) {
        entries.push({ changeType: 'dateStatus', previousValue: current.dateStatus, newValue: String(body.dateStatus) });
    }

    // 確認予定日（JST YYYY-MM-DD で保存）
    if (body.confirmDueDate !== undefined) {
        const prev = jstYmd(current.confirmDueDate);
        const next = body.confirmDueDate ? jstYmd(new Date(body.confirmDueDate as string)) : HISTORY_EMPTY_LABEL;
        if (prev !== next) {
            entries.push({ changeType: 'confirmDueDate', previousValue: prev, newValue: next });
        }
    }

    // 人数
    if (body.memberCount !== undefined && Number(body.memberCount) !== current.memberCount) {
        entries.push({
            changeType: 'memberCount',
            previousValue: `${current.memberCount}人`,
            newValue: `${Number(body.memberCount)}人`,
        });
    }

    // 車両（予定車両。名前文字列の配列）
    if (body.vehicles !== undefined) {
        const prev = joinOrEmpty(parseJsonField<string[]>(current.vehicles, []));
        const next = joinOrEmpty(Array.isArray(body.vehicles) ? (body.vehicles as string[]) : []);
        if (prev !== next) {
            entries.push({ changeType: 'vehicles', previousValue: prev, newValue: next });
        }
    }

    // 集合時間
    if (body.meetingTime !== undefined) {
        const prev = fmtOrEmpty(current.meetingTime);
        const next = fmtOrEmpty(body.meetingTime as string | null);
        if (prev !== next) {
            entries.push({ changeType: 'meetingTime', previousValue: prev, newValue: next });
        }
    }

    // 備考 / 手配備考
    if (body.remarks !== undefined) {
        const prev = fmtOrEmpty(current.remarks);
        const next = fmtOrEmpty(body.remarks as string | null);
        if (prev !== next) {
            entries.push({ changeType: 'remarks', previousValue: prev, newValue: next });
        }
    }
    if (body.dispatchRemark !== undefined) {
        const prev = fmtOrEmpty(current.dispatchRemark);
        const next = fmtOrEmpty(body.dispatchRemark as string | null);
        if (prev !== next) {
            entries.push({ changeType: 'dispatchRemark', previousValue: prev, newValue: next });
        }
    }

    // 予定時間
    if (body.estimatedHours !== undefined && Number(body.estimatedHours) !== (current.estimatedHours ?? 8)) {
        entries.push({
            changeType: 'estimatedHours',
            previousValue: `${current.estimatedHours ?? 8}時間`,
            newValue: `${Number(body.estimatedHours)}時間`,
        });
    }

    // 工事種別（UUIDマスタ→名前で保存。旧データの名前直入りはそのまま）
    if (body.constructionType !== undefined && (body.constructionType ?? null) !== current.constructionType) {
        const resolve = (v: string | null) =>
            v ? nameMaps.constructionTypes.get(v) ?? v : HISTORY_EMPTY_LABEL;
        entries.push({
            changeType: 'constructionType',
            previousValue: resolve(current.constructionType),
            newValue: resolve((body.constructionType as string) ?? null),
        });
    }

    // 手配確定（確定フラグ・確定メンバー・確定車両を1エントリに統合）
    if (
        body.isDispatchConfirmed !== undefined ||
        body.confirmedWorkerIds !== undefined ||
        body.confirmedVehicleIds !== undefined
    ) {
        const prevLabel = dispatchStateLabel(
            current.isDispatchConfirmed,
            parseJsonField<string[]>(current.confirmedWorkerIds, []),
            parseJsonField<string[]>(current.confirmedVehicleIds, []),
            nameMaps
        );
        const nextConfirmed =
            body.isDispatchConfirmed !== undefined ? Boolean(body.isDispatchConfirmed) : current.isDispatchConfirmed;
        const nextWorkers =
            body.confirmedWorkerIds !== undefined
                ? (Array.isArray(body.confirmedWorkerIds) ? (body.confirmedWorkerIds as string[]) : [])
                : parseJsonField<string[]>(current.confirmedWorkerIds, []);
        const nextVehicles =
            body.confirmedVehicleIds !== undefined
                ? (Array.isArray(body.confirmedVehicleIds) ? (body.confirmedVehicleIds as string[]) : [])
                : parseJsonField<string[]>(current.confirmedVehicleIds, []);
        const nextLabel = dispatchStateLabel(nextConfirmed, nextWorkers, nextVehicles, nameMaps);
        if (prevLabel !== nextLabel) {
            entries.push({ changeType: 'dispatch', previousValue: prevLabel, newValue: nextLabel });
        }
    }

    return entries;
}

/**
 * 名前解決が必要な ID を body / current から収集する（PATCH 側が in 句でまとめて引くため）。
 */
export function collectHistoryResolutionIds(params: {
    current: CurrentAssignmentShape;
    body: Record<string, unknown>;
}): { userIds: string[]; vehicleIds: string[]; constructionTypeIds: string[] } {
    const { current, body } = params;
    const userIds = new Set<string>();
    const vehicleIds = new Set<string>();
    const constructionTypeIds = new Set<string>();

    if (
        body.isDispatchConfirmed !== undefined ||
        body.confirmedWorkerIds !== undefined ||
        body.confirmedVehicleIds !== undefined
    ) {
        parseJsonField<string[]>(current.confirmedWorkerIds, []).forEach((id) => userIds.add(id));
        parseJsonField<string[]>(current.confirmedVehicleIds, []).forEach((id) => vehicleIds.add(id));
        if (Array.isArray(body.confirmedWorkerIds)) (body.confirmedWorkerIds as string[]).forEach((id) => userIds.add(id));
        if (Array.isArray(body.confirmedVehicleIds)) (body.confirmedVehicleIds as string[]).forEach((id) => vehicleIds.add(id));
    }
    if (body.constructionType !== undefined) {
        if (current.constructionType) constructionTypeIds.add(current.constructionType);
        if (body.constructionType) constructionTypeIds.add(String(body.constructionType));
    }

    return {
        userIds: Array.from(userIds),
        vehicleIds: Array.from(vehicleIds),
        constructionTypeIds: Array.from(constructionTypeIds),
    };
}
