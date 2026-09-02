import { prisma } from '@/lib/prisma';

/**
 * 配置に紐づける電動工具の行（AssignmentTool）を組み立てる。
 *
 * 車両は「名前」で配置に持たせているが、工具は同じ名前の個体（例: インパクト #1 が2台）が
 * あり得るので Tool.id で持つ。toolName は当時の名前のスナップショット
 * （後で改名されても手配表・PDF の記録が変わらないようにするため）。
 * 存在しない ID・重複は捨てる。
 */
export async function buildAssignmentToolRows(
    toolIds: unknown
): Promise<{ toolId: string; toolName: string }[]> {
    const [rows] = await buildAssignmentToolRowsBatch([toolIds]);
    return rows;
}

/**
 * 複数の配置ぶんをまとめて組み立てる（一括作成で工具の SELECT が件数ぶん走らないように）。
 * 返り値は入力と同じ順・同じ長さ。
 */
export async function buildAssignmentToolRowsBatch(
    toolIdLists: unknown[]
): Promise<{ toolId: string; toolName: string }[][]> {
    const normalized = toolIdLists.map(normalizeToolIds);
    const allIds = [...new Set(normalized.flat())];
    if (allIds.length === 0) return normalized.map(() => []);

    const tools = await prisma.tool.findMany({
        where: { id: { in: allIds } },
        select: { id: true, name: true },
    });
    const nameById = new Map(tools.map((t) => [t.id, t.name]));

    return normalized.map((ids) =>
        ids.filter((id) => nameById.has(id)).map((id) => ({ toolId: id, toolName: nameById.get(id)! }))
    );
}

/** 入力（クライアント由来）を Tool.id の配列に正規化する。重複と空文字は落とす。 */
export function normalizeToolIds(toolIds: unknown): string[] {
    if (!Array.isArray(toolIds)) return [];
    return [...new Set(
        toolIds.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
    )];
}
