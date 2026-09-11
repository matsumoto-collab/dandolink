/**
 * 過去データの名前（職長・顧客）を既存のマスタへ照合する。純粋関数。
 *
 * 一致しなかった名前はマスタを増やさず、名前の文字だけを持つ（顧客マスタに 186 社・
 * ユーザーに外注先を勝手に足すと、請求書の宛名選びや手配の職長選びに紛れ込むため）。
 */

/** 法人格（株式会社・(株) など）と空白を取り除いた比較用の名前 */
export function normalizeCompanyName(name: string): string {
    return name
        .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人/g, '')
        .replace(/[（(]\s*[株有合]\s*[）)]|㈱|㈲/g, '')
        .replace(/[\s　]/g, '');
}

/** 空白を取り除いた比較用の人名 */
function normalizePersonName(name: string): string {
    return name.replace(/[\s　]/g, '');
}

export interface ForemanCandidate {
    id: string;
    displayName: string;
    isActive?: boolean;
}

/**
 * 職長名 → ユーザーID の照合を作る。
 *
 * 1. 空白を除いた表示名が完全一致するユーザー（有効なユーザーを優先）
 * 2. 無ければ、表示名が職長名で始まるユーザーがちょうど 1 人いればそのユーザー
 *    （日報では「龍成」「修栄」「開成」と略して書かれている外注先を「龍成工業」等に寄せる）
 * 3. どれも無ければ null（「全員」「八田or和馬」「一工業①」など）
 */
export function buildForemanMatcher(users: ForemanCandidate[]): (name: string) => string | null {
    const cache = new Map<string, string | null>();
    const normalized = users
        .filter((u) => u.displayName)
        .map((u) => ({ ...u, key: normalizePersonName(u.displayName) }));

    return (name: string) => {
        const key = normalizePersonName(name);
        if (!key) return null;
        if (cache.has(key)) return cache.get(key)!;

        const exact = normalized.filter((u) => u.key === key);
        let found: string | null = null;
        if (exact.length > 0) {
            found = (exact.find((u) => u.isActive !== false) ?? exact[0]).id;
        } else if (key.length >= 2) {
            const prefix = normalized.filter((u) => u.key.startsWith(key));
            if (prefix.length === 1) found = prefix[0].id;
        }
        cache.set(key, found);
        return found;
    };
}

export interface CustomerCandidate {
    id: string;
    name: string;
    shortName?: string | null;
}

/**
 * 顧客名 → 顧客マスタの照合を作る。法人格と空白を除いた名前の完全一致だけで寄せる
 * （あいまい一致は「菊池塗装／菊地塗装」のような別会社を取り違えるおそれがあるのでしない）。
 * 同じ名前に複数の顧客がいるときは取り違えを避けて一致なし扱いにする。
 */
export function buildCustomerMatcher(customers: CustomerCandidate[]): (name: string) => CustomerCandidate | null {
    const byKey = new Map<string, CustomerCandidate[]>();
    const add = (key: string, c: CustomerCandidate) => {
        if (!key) return;
        const list = byKey.get(key) ?? [];
        if (!list.some((x) => x.id === c.id)) list.push(c);
        byKey.set(key, list);
    };
    for (const c of customers) {
        add(normalizeCompanyName(c.name), c);
        if (c.shortName) add(normalizeCompanyName(c.shortName), c);
    }
    return (name: string) => {
        const list = byKey.get(normalizeCompanyName(name));
        return list && list.length === 1 ? list[0] : null;
    };
}
