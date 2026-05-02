/**
 * チャットメンショントークン仕様（保存形式・後方互換性のため変更困難）
 *   ユーザー: @[表示名](userId)
 *   案件:    #[案件名](projectMasterId)
 *   ロール:  @[role:ラベル](admin)  / @[role:ラベル](admin,manager)
 *
 * 表示時はチップに変換。送信時は本文＋mentions[]（DB MessageMention）を併せて保存。
 */

export type MentionTargetType = 'user' | 'project' | 'role';

export interface MentionToken {
    type: MentionTargetType;
    label: string;
    targetId: string;
}

export type MessagePart =
    | { kind: 'text'; text: string }
    | { kind: 'mention'; token: MentionToken };

const TOKEN_REGEX = /(@\[role:([^\]]+)\]\(([^)]+)\))|(@\[([^\]]+)\]\(([^)]+)\))|(#\[([^\]]+)\]\(([^)]+)\))/g;

/** 本文文字列をテキスト/メンションパーツ配列に分解 */
export function parseMessageParts(body: string): MessagePart[] {
    const parts: MessagePart[] = [];
    let lastIndex = 0;
    body.replace(TOKEN_REGEX, (match, ...rest) => {
        const offset = rest[rest.length - 2] as number;
        if (offset > lastIndex) {
            parts.push({ kind: 'text', text: body.slice(lastIndex, offset) });
        }
        // ロール
        if (rest[0]) {
            parts.push({
                kind: 'mention',
                token: {
                    type: 'role',
                    label: rest[1] as string,
                    targetId: rest[2] as string,
                },
            });
        } else if (rest[3]) {
            parts.push({
                kind: 'mention',
                token: {
                    type: 'user',
                    label: rest[4] as string,
                    targetId: rest[5] as string,
                },
            });
        } else if (rest[6]) {
            parts.push({
                kind: 'mention',
                token: {
                    type: 'project',
                    label: rest[7] as string,
                    targetId: rest[8] as string,
                },
            });
        }
        lastIndex = offset + match.length;
        return match;
    });
    if (lastIndex < body.length) {
        parts.push({ kind: 'text', text: body.slice(lastIndex) });
    }
    return parts;
}

/** トークン文字列を生成（送信前にcomposerで挿入する） */
export function formatMentionToken(token: MentionToken): string {
    if (token.type === 'role') {
        return `@[role:${token.label}](${token.targetId})`;
    }
    if (token.type === 'project') {
        return `#[${token.label}](${token.targetId})`;
    }
    return `@[${token.label}](${token.targetId})`;
}

/** 本文からメンション情報を抽出（API送信時にmentions[]として渡す） */
export function extractMentions(body: string): { targetType: MentionTargetType; targetId: string }[] {
    const parts = parseMessageParts(body);
    const seen = new Set<string>();
    const out: { targetType: MentionTargetType; targetId: string }[] = [];
    for (const p of parts) {
        if (p.kind !== 'mention') continue;
        const key = `${p.token.type}:${p.token.targetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ targetType: p.token.type, targetId: p.token.targetId });
    }
    return out;
}

/**
 * Composer 入力中のカーソル位置から、現在のメンション候補トリガを判定。
 *   "...@yam"     → { trigger: '@', query: 'yam', startIdx, endIdx }
 *   "...#案件A"   → { trigger: '#', query: '案件A', ... }
 *   トリガが無い場合は null
 */
export interface MentionTriggerState {
    trigger: '@' | '#';
    query: string;
    startIdx: number;
    endIdx: number;
}

export function detectMentionTrigger(
    text: string,
    cursorIdx: number
): MentionTriggerState | null {
    if (cursorIdx <= 0 || cursorIdx > text.length) return null;
    const before = text.slice(0, cursorIdx);
    const m = /([@#])([^\s@#\[\]()]{0,30})$/.exec(before);
    if (!m) return null;
    const trigger = m[1] as '@' | '#';
    const query = m[2];
    const startIdx = before.length - m[0].length;
    return { trigger, query, startIdx, endIdx: cursorIdx };
}

/** カーソル位置のトリガをトークン文字列で置換 */
export function replaceTriggerWithToken(
    text: string,
    state: MentionTriggerState,
    token: MentionToken
): { newText: string; newCursor: number } {
    const tokenStr = formatMentionToken(token) + ' ';
    const newText = text.slice(0, state.startIdx) + tokenStr + text.slice(state.endIdx);
    const newCursor = state.startIdx + tokenStr.length;
    return { newText, newCursor };
}
