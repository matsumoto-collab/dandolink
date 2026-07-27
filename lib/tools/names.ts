import { prisma } from '@/lib/prisma';

/**
 * 工具の持出し先・持出者の表示名を ID から引くヘルパー。
 * 一覧では毎回ここで解決する（スナップショットを持たないので案件名・氏名の変更に追従する）。
 * 履歴（ToolCheckoutLog）だけは当時の記録として名前を保存するため、書き込み時にもこれを使う。
 */

/** 案件ID → 表示名（name＝短縮名を優先し、無ければ合成済みの title） */
export async function resolveProjectNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
    if (unique.length === 0) return new Map();

    const projects = await prisma.projectMaster.findMany({
        where: { id: { in: unique } },
        select: { id: true, name: true, title: true },
    });
    return new Map(projects.map((p) => [p.id, p.name || p.title || '']));
}

/** ユーザーID → 表示名 */
export async function resolveUserNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
    if (unique.length === 0) return new Map();

    const users = await prisma.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName || '']));
}
