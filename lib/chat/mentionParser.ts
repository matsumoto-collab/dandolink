/**
 * チャットメンション仕様（v2: 見える本文 + mentions[] を独立保持）
 *
 * - Composer の本文（textarea）には人間が読める形式のみを表示
 *     ユーザー: @表示名
 *     ロール:   @ロールラベル（管理者・マネージャーなど）
 *     案件:    #顧客略称 案件名
 * - 内部では選択時に mentions[] にメタを保持し、API送信時に body + mentions
 *   を別フィールドで投げる。サーバ側 MessageMention テーブルで targetId を保存。
 * - 表示時は受信した body と message.mentions[] を突合してチップ化。
 *   突合は body 内に登場するラベルの先頭一致でマッチング（出現順）。
 *
 * ※ 過去（v1）の `@[name](id)` トークン形式も後方互換でパースする。
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

/** Composer内で選択中のメンション（送信時 mentions[] になる） */
export interface SelectedMention extends MentionToken {
    /** 挿入時のラベルprefix付き表示 (`@山田太郎` / `#A様邸`) */
    visible: string;
}

/** トリガ位置情報（@ や # を打った時の位置） */
export interface MentionTriggerState {
    trigger: '@' | '#';
    query: string;
    startIdx: number;
    endIdx: number;
}

/** カーソル位置から @/# のトリガを検出 */
export function detectMentionTrigger(
    text: string,
    cursorIdx: number
): MentionTriggerState | null {
    if (cursorIdx <= 0 || cursorIdx > text.length) return null;
    const before = text.slice(0, cursorIdx);
    // 直前30文字以内に空白を挟まない @xxx / #xxx を検出
    const m = /([@#])([^\s@#\[\]()]{0,30})$/.exec(before);
    if (!m) return null;
    const trigger = m[1] as '@' | '#';
    const query = m[2];
    const startIdx = before.length - m[0].length;
    return { trigger, query, startIdx, endIdx: cursorIdx };
}

/** 選択時: トリガを「見える表示」（@表示名 / #顧客略称 案件名）で置換し空白付与 */
export function replaceTriggerWithVisible(
    text: string,
    state: MentionTriggerState,
    token: MentionToken
): { newText: string; newCursor: number; visible: string } {
    const prefix = token.type === 'project' ? '#' : '@';
    const visible = `${prefix}${token.label}`;
    const insert = `${visible} `;
    const newText = text.slice(0, state.startIdx) + insert + text.slice(state.endIdx);
    const newCursor = state.startIdx + insert.length;
    return { newText, newCursor, visible };
}

/** 送信時: 本文に含まれていない mention は除外（編集で消えたものを除く） */
export function filterActiveMentions(
    body: string,
    mentions: SelectedMention[]
): SelectedMention[] {
    return mentions.filter((m) => body.includes(m.visible));
}

/**
 * 表示時: 本文 + 受信した mentions 配列をパースし、テキスト/チップに分割。
 *
 * - 送信側で挿入されたラベル(@表示名 / #顧客略称 案件名)を本文中に検索し、
 *   出現順に mentions と対応付けてチップ化。
 * - v1 トークン `@[name](id)` も検出してチップ化する（過去ログ互換）。
 */
export function parseMessageParts(
    body: string,
    mentions: { targetType: MentionTargetType | string; targetId: string }[] = []
): MessagePart[] {
    const parts: MessagePart[] = [];

    // ステップ1: v1 トークンを先にスキャン → segments に分割
    const v1Regex = /(@\[role:([^\]]+)\]\(([^)]+)\))|(@\[([^\]]+)\]\(([^)]+)\))|(#\[([^\]]+)\]\(([^)]+)\))/g;
    type Hit = { start: number; end: number; token: MentionToken };
    const hits: Hit[] = [];
    let m: RegExpExecArray | null;
    while ((m = v1Regex.exec(body)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (m[1]) {
            hits.push({ start, end, token: { type: 'role', label: m[2], targetId: m[3] } });
        } else if (m[4]) {
            hits.push({ start, end, token: { type: 'user', label: m[5], targetId: m[6] } });
        } else if (m[7]) {
            hits.push({ start, end, token: { type: 'project', label: m[8], targetId: m[9] } });
        }
    }

    // v1 hit を順番に挿入。間のテキストは v2 ラベルマッチも適用
    let cursor = 0;
    const segments: { text: string; tokens: Hit[] } = { text: body, tokens: hits };

    if (segments.tokens.length === 0) {
        // v2 のみ: ラベルで突合
        return matchByLabels(body, mentions);
    }

    // v1 と v2 を混在させる
    for (const h of hits) {
        if (h.start > cursor) {
            const slice = body.slice(cursor, h.start);
            parts.push(...matchByLabels(slice, mentions));
        }
        parts.push({ kind: 'mention', token: h.token });
        cursor = h.end;
    }
    if (cursor < body.length) {
        parts.push(...matchByLabels(body.slice(cursor), mentions));
    }
    return parts;
}

/** 本文ラベルマッチ（v2）: mentions の visible（@/#付き）を本文中で順次検索 */
function matchByLabels(
    body: string,
    mentions: { targetType: MentionTargetType | string; targetId: string; label?: string }[]
): MessagePart[] {
    if (!body) return [];
    if (mentions.length === 0) return [{ kind: 'text', text: body }];

    // ラベル長の長い順に検索（前方一致衝突を避ける）
    type Entry = { visible: string; type: MentionTargetType; targetId: string; label: string };
    const labelEntries: Entry[] = mentions
        .filter((mm): mm is { targetType: MentionTargetType; targetId: string; label: string } =>
            !!(mm as { label?: string }).label && (mm.targetType === 'user' || mm.targetType === 'project' || mm.targetType === 'role')
        )
        .map((mm) => ({
            visible: (mm.targetType === 'project' ? '#' : '@') + mm.label,
            type: mm.targetType,
            targetId: mm.targetId,
            label: mm.label,
        }))
        .sort((a, b) => b.visible.length - a.visible.length);

    if (labelEntries.length === 0) return [{ kind: 'text', text: body }];

    const out: MessagePart[] = [];
    let i = 0;
    while (i < body.length) {
        let matched: Entry | null = null;
        for (const e of labelEntries) {
            if (body.startsWith(e.visible, i)) {
                matched = e;
                break;
            }
        }
        if (matched) {
            out.push({
                kind: 'mention',
                token: { type: matched.type, label: matched.label, targetId: matched.targetId },
            });
            i += matched.visible.length;
        } else {
            // テキストとして1文字進める（連続テキストは結合）
            const last = out[out.length - 1];
            if (last && last.kind === 'text') {
                last.text += body[i];
            } else {
                out.push({ kind: 'text', text: body[i] });
            }
            i++;
        }
    }
    return out;
}
