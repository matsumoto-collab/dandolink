/**
 * 完了報告の写真（ProjectMasterFile）から「工事種別名」を推測する。
 *
 * 写真は案件(projectMasterId)に紐づくが、配置(ProjectAssignment)への参照を持たない。
 * 完了報告の写真は「その配置の職長/メンバーが、作業完了の頃に保存する」運用なので、
 *   - 保存者(uploadedBy) が配置の職長(assignedEmployeeId) か確定メンバー(workerIds) に含まれる
 *   - 保存日時(createdAt) が作業日(date)と同じ（JST）
 *   - 作業時刻(workEndedAt → workStartedAt → date) が最も近い
 * を手がかりに対応する配置を1件選び、その constructionType(マスタID) を名前へ変換する。
 *
 * 完全な紐付けではなく推測のため、候補が見つからなければ null（見出しに工種を出さない）。
 */

export interface AssignmentForMatch {
    /** 作業日 (ISO) */
    date: string;
    /** 担当職長の User.id */
    assignedEmployeeId: string;
    /** 確定メンバーの User.id 配列（confirmedWorkerIds を parse 済み） */
    workerIds: string[];
    workStartedAt: string | null;
    workEndedAt: string | null;
    /** ConstructionType.id（未設定なら null） */
    constructionType: string | null;
}

export interface FileForMatch {
    uploadedBy: string | null;
    /** 保存日時 (ISO) */
    createdAt: string;
}

/** ISO 文字列を JST の yyyy-mm-dd に変換する */
function jstDateKey(iso: string): string {
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

/**
 * 写真1枚に対応する配置の工事種別名を推測して返す（見つからなければ null）。
 * @param file 写真（保存者・保存日時）
 * @param assignments その案件の配置一覧（照合候補）
 * @param ctNameById ConstructionType.id → 名前
 */
export function resolveConstructionTypeForFile(
    file: FileForMatch,
    assignments: AssignmentForMatch[],
    ctNameById: Map<string, string>,
): string | null {
    const uid = file.uploadedBy;
    if (!uid) return null;

    // 保存者が職長 or 確定メンバーに含まれる配置だけを候補にする
    const candidates = assignments.filter(
        (a) => a.assignedEmployeeId === uid || a.workerIds.includes(uid),
    );
    if (candidates.length === 0) return null;

    // 同じ日(JST)の配置があればそれを優先（後日まとめ保存などの誤爆を抑える）
    const fileDay = jstDateKey(file.createdAt);
    const sameDay = candidates.filter((a) => jstDateKey(a.date) === fileDay);
    const pool = sameDay.length > 0 ? sameDay : candidates;

    // 作業時刻が保存時刻に最も近い配置を選ぶ
    const fileMs = new Date(file.createdAt).getTime();
    const refMs = (a: AssignmentForMatch) =>
        new Date(a.workEndedAt ?? a.workStartedAt ?? a.date).getTime();

    let best = pool[0];
    let bestDiff = Math.abs(refMs(best) - fileMs);
    for (let i = 1; i < pool.length; i++) {
        const diff = Math.abs(refMs(pool[i]) - fileMs);
        if (diff < bestDiff) {
            best = pool[i];
            bestDiff = diff;
        }
    }

    if (!best.constructionType) return null;
    return ctNameById.get(best.constructionType) ?? null;
}
