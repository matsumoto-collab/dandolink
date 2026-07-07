// 現金出納帳の表示順ロジック（サーバー/クライアント共有・prisma 非依存）。
// 月別表示・差引残高の基準は「清算日（settledAt）があればその日、なければ取引日（date）」。
// 同一表示日内は sortOrder（上下移動ボタンで隣接行との中間値を設定）→ seq（登録順）で安定させる。

interface SortableCashbookEntry {
    date: Date | string;
    settledAt: Date | string | null;
    sortOrder: number | string | null;
    seq: number;
}

/** 表示日（settledAt ?? date）のエポックms。月別の振り分け・残高計算の並びに使う */
export const cashbookDisplayDate = (e: Pick<SortableCashbookEntry, 'date' | 'settledAt'>): number =>
    new Date(e.settledAt ?? e.date).getTime();

/** 同一表示日内の並びキー。sortOrder 未設定の行は seq（登録順） */
export const cashbookSortKey = (e: Pick<SortableCashbookEntry, 'sortOrder' | 'seq'>): number =>
    e.sortOrder != null ? Number(e.sortOrder) : e.seq;

/** 表示日 asc → sortKey asc → seq asc で並べた新しい配列を返す */
export function sortCashbookEntries<T extends SortableCashbookEntry>(rows: T[]): T[] {
    return [...rows].sort((a, b) => {
        const da = cashbookDisplayDate(a);
        const db = cashbookDisplayDate(b);
        if (da !== db) return da - db;
        const ka = cashbookSortKey(a);
        const kb = cashbookSortKey(b);
        if (ka !== kb) return ka - kb;
        return a.seq - b.seq;
    });
}
