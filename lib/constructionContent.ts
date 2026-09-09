/**
 * 案件マスタの「工事内容」(ProjectMaster.constructionContent) の正規化。
 *
 * 工事内容は設定 > 工事内容マスタ(ConstructionContent)の **名前(文字列)** で保存されている
 * （ID ではない）。ただし本番には enum で持っていた頃の旧値が残っており
 * （renovation 36件 / new_construction 13件 / large_scale 5件 / other 1件・2026-09-10 時点）、
 * 素の値で突き合わせると同じ工事内容が2つに割れる。表示・絞り込みの前に必ずここを通す。
 */

const LEGACY_CONTENT_LABELS: Record<string, string> = {
    new_construction: '新築',
    renovation: '改修',
    large_scale: '大規模',
    other: 'その他',
};

/** 旧enum値を現在のマスタ名に寄せる。未設定(null/空文字)は null。 */
export function normalizeConstructionContent(content?: string | null): string | null {
    if (!content) return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    return LEGACY_CONTENT_LABELS[trimmed] ?? trimmed;
}

/** 表示用ラベル。未設定は '-'。 */
export function getConstructionContentLabel(content?: string | null): string {
    return normalizeConstructionContent(content) ?? '-';
}
