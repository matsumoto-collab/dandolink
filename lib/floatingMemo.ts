import { prisma } from '@/lib/prisma';

/**
 * 浮きレーンの日メモ（週間カレンダー最下部「浮いている」レーンのセルごとのメモ）を
 * サーバー側で読み書きする純粋関数。クライアントからは import しない（prisma 直叩き）。
 *
 * 浮きレーンのメモは職長行のセルメモと同じ CellRemark テーブルを流用し、
 * foremanId='unassigned' 固定・dateKey で1日1件に絞る（専用テーブル不要＝マイグレ不要）。
 * cellRemarkSchema の foremanId は min(1) だけなので 'unassigned' をそのまま鍵に使える。
 *
 * AI照会（lib/availabilityAssistant.ts）が「浮きに残しておいて」等の明示指示で追記するために
 * 切り出してある。書けるのはこのメモだけで、予定・案件・班へは一切書き込まない。
 */

// CellRemark.text の運用上限（lib/validations/calendar.ts の cellRemarkSchema と揃える）
const MAX_MEMO_LENGTH = 500;

// 浮きレーンのメモは職長ではないので固定の擬似 foremanId を鍵にする
const FLOATING_FOREMAN_ID = 'unassigned';

/** dateKey は必ず YYYY-MM-DD（既存ツールと同じ作法）。不正なら投げて呼び出し側で弾く */
function assertDateKey(dateKey: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        throw new Error(`dateKey は YYYY-MM-DD 形式で指定してください: ${dateKey}`);
    }
}

/** その日の浮きメモの現在値（無ければ ''）。二重書きを避けるため書く前に読める。 */
export async function getFloatingMemo(dateKey: string): Promise<string> {
    assertDateKey(dateKey);
    const remark = await prisma.cellRemark.findUnique({
        where: { foremanId_dateKey: { foremanId: FLOATING_FOREMAN_ID, dateKey } },
        select: { text: true },
    });
    return remark?.text ?? '';
}

export interface AppendFloatingMemoResult {
    dateKey: string;
    /** 追記後（または追記できなかったときは現在値）の全文 */
    text: string;
    /** 500文字上限を超えて入りきらず追記しなかった場合 true（呼び出し側で AI に伝える） */
    tooLong?: boolean;
}

/**
 * その日の浮きメモへ追記する。既存メモがあれば改行で連結し、上書きはしない。
 * 追記後に 500 文字を超える場合は「入りきらない」と返し、丸めずに追記を拒否する
 * （text は現在値のまま・tooLong=true）。
 *
 * 出所印（「AI照会より」等）は付けない＝人が手で書くメモと同じ素のテキストにする方針。
 * updatedBy は監査目的で受け取るが、CellRemark に該当列が無いため現状は永続化しない。
 */
export async function appendFloatingMemo(
    dateKey: string,
    text: string,
    updatedBy?: string
): Promise<AppendFloatingMemoResult> {
    assertDateKey(dateKey);
    // CellRemark に更新者列が無いため現状は永続化しない（監査列を足す時の受け皿として受け取る）
    void updatedBy;

    const addition = text.trim();
    const current = await getFloatingMemo(dateKey);
    // 追記内容が空なら現在値を返すだけ（メモは変更しない）
    if (!addition) return { dateKey, text: current };

    const next = current ? `${current}\n${addition}` : addition;
    if (next.length > MAX_MEMO_LENGTH) {
        return { dateKey, text: current, tooLong: true };
    }

    await prisma.cellRemark.upsert({
        where: { foremanId_dateKey: { foremanId: FLOATING_FOREMAN_ID, dateKey } },
        update: { text: next },
        create: { foremanId: FLOATING_FOREMAN_ID, dateKey, text: next },
    });
    return { dateKey, text: next };
}
