/**
 * 案件一覧のステータス（表示・絞り込み用の派生値）。
 *
 * DB の ProjectMaster.status は 'active' | 'completed' | 'cancelled' の3値だが、
 * 一覧では「進行中（カレンダーに配置がある）」と「未着工（案件はあるが配置が無い）」を
 * 区別したい。未着工は保存された値ではなく assignmentCount から導出する
 * ＝カレンダーに配置を入れた瞬間に自動で「進行中」に変わる（手作業での付け替えは不要）。
 */

/** 一覧に出す派生ステータス。 */
export type ProjectListStatus = 'active' | 'unstarted' | 'completed' | 'cancelled';

/**
 * 絞り込みセレクトの値。
 * - 'open' = 進行中/未着工（＝まだ完了していない案件。一覧の既定値）
 * - 'all'  = 全てのステータス
 */
export type ProjectListStatusFilter = ProjectListStatus | 'open' | 'all';

/** 一覧の絞り込みセレクトに出す選択肢（表示順）。 */
export const PROJECT_LIST_STATUS_OPTIONS: Array<{ value: ProjectListStatusFilter; label: string }> = [
    { value: 'open', label: '進行中/未着工' },
    { value: 'active', label: '進行中' },
    { value: 'unstarted', label: '未着工' },
    { value: 'completed', label: '完了' },
    { value: 'all', label: '全てのステータス' },
];

/** 一覧の絞り込みの既定値（進行中と未着工をまとめて表示する）。 */
export const DEFAULT_PROJECT_LIST_STATUS_FILTER: ProjectListStatusFilter = 'open';

export const PROJECT_LIST_STATUS_LABEL: Record<ProjectListStatus, string> = {
    active: '進行中',
    unstarted: '未着工',
    completed: '完了',
    cancelled: 'キャンセル',
};

/**
 * 案件の派生ステータスを返す。
 * 完了/キャンセルは保存値をそのまま使う（配置の有無より明示的な指定を優先する）。
 * それ以外は配置件数で 進行中 / 未着工 を分ける。
 */
export function resolveProjectListStatus(pm: {
    status?: string | null;
    assignmentCount?: number | null;
}): ProjectListStatus {
    if (pm.status === 'completed') return 'completed';
    if (pm.status === 'cancelled') return 'cancelled';
    return (pm.assignmentCount ?? 0) > 0 ? 'active' : 'unstarted';
}

/** 絞り込みセレクトの値に一致するか。'all' は常に true、'open' は 進行中 と 未着工 の両方。 */
export function matchesProjectListStatus(
    pm: { status?: string | null; assignmentCount?: number | null },
    filter: string,
): boolean {
    if (filter === 'all') return true;
    const resolved = resolveProjectListStatus(pm);
    if (filter === 'open') return resolved === 'active' || resolved === 'unstarted';
    return resolved === filter;
}
