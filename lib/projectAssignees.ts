import type { ProjectMaster } from '@/types/calendar';

/**
 * 案件マスタの `createdBy` を案件担当者の User ID 配列に正規化する。
 * - 配列ならそのまま
 * - JSON 文字列（["id1","id2"]）なら parse
 * - 単独文字列なら 1 要素配列
 * - null / undefined / 不正値は空配列
 *
 * 経緯: MEMORY.md「ProjectMaster 担当者フィールドの落とし穴」。
 * 案件担当者は `createdBy` に JSON 配列で保存され、`managerIds` は死蔵で常に空。
 * 担当者を読む側は `createdBy` を唯一のソースとして集約すること。
 */
export function extractAssigneeIds(createdBy: ProjectMaster['createdBy']): string[] {
    if (!createdBy) return [];
    if (Array.isArray(createdBy)) return createdBy.filter(Boolean);
    if (typeof createdBy === 'string') {
        const trimmed = createdBy.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed];
            } catch {
                return [trimmed];
            }
        }
        return [trimmed];
    }
    return [];
}
