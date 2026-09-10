/**
 * 日本の祝日（国民の祝日に関する法律）を計算で求める。
 *
 * 以前は utils/dateUtils.ts に 2024〜2026 年ぶんを手書きしたテーブルを持っていたが、
 * 週間カレンダーは半年先まで入力するので年が変わると祝日が出なくなる。
 * ここは年に依存しない計算に置き換える（テーブルは特例年の上書きだけに使う）。
 *
 * 実装する規則:
 *   ・日付固定の祝日（元日・建国記念の日・天皇誕生日 …）
 *   ・ハッピーマンデー（成人の日=1月第2月曜 ほか）
 *   ・春分の日・秋分の日（1980〜2099 年で有効な近似式）
 *   ・振替休日（祝日が日曜なら、その後で最初の「祝日でない日」）
 *   ・国民の休日（前後を祝日に挟まれた平日。9月の敬老の日〜秋分の日で発生する）
 *
 * 2020・2021 年は五輪特措法で海の日・スポーツの日・山の日が動いた。過去日はカレンダーで
 * 遡れる範囲（3ヶ月前まで）を超えるが、年をまたいだ比較で誤らないよう特例として持っておく。
 */

/** 'YYYY-MM-DD'（ローカル日付） */
export function toHolidayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** その年の month 月・n 番目の weekday(0=日) の日 */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
    const first = new Date(year, month - 1, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** 春分の日（1980〜2099） */
function vernalEquinoxDay(year: number): number {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 秋分の日（1980〜2099） */
function autumnalEquinoxDay(year: number): number {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/**
 * 特例で移動した年の上書き。キーは 'YYYY-M月の祝日名' ではなく
 * 「その年のこの祝日は何月何日か」を [month, day] で持つ。
 */
const SPECIAL_MOVES: Record<number, Record<string, [number, number]>> = {
    // 東京五輪（2020は開催延期で2021へ）
    2020: { '海の日': [7, 23], 'スポーツの日': [7, 24], '山の日': [8, 10] },
    2021: { '海の日': [7, 22], 'スポーツの日': [7, 23], '山の日': [8, 8] },
};

/** 天皇誕生日は代替わりで変わる（平成 12/23 → 令和 2/23。2019年は無し） */
function emperorBirthday(year: number): [number, number] | null {
    if (year >= 2020) return [2, 23];
    if (year <= 2018) return [12, 23];
    return null; // 2019年（改元の年）は天皇誕生日なし
}

/** その年の祝日（振替休日・国民の休日を含む）を 'YYYY-MM-DD' → 名前 で返す */
export function getHolidaysOfYear(year: number): Map<string, string> {
    const base: [number, number, string][] = [];
    const push = (month: number, day: number, name: string) => base.push([month, day, name]);
    const moved = SPECIAL_MOVES[year] ?? {};
    const at = (name: string, fallback: [number, number]): [number, number] => moved[name] ?? fallback;

    push(1, 1, '元日');
    push(1, nthWeekday(year, 1, 1, 2), '成人の日');
    push(2, 11, '建国記念の日');
    const birthday = emperorBirthday(year);
    if (birthday) push(birthday[0], birthday[1], '天皇誕生日');
    push(3, vernalEquinoxDay(year), '春分の日');
    push(4, 29, year >= 2007 ? '昭和の日' : 'みどりの日');
    push(5, 3, '憲法記念日');
    push(5, 4, year >= 2007 ? 'みどりの日' : '国民の休日');
    push(5, 5, 'こどもの日');
    {
        const [m, d] = at('海の日', [7, nthWeekday(year, 7, 1, 3)]);
        push(m, d, '海の日');
    }
    if (year >= 2016) {
        const [m, d] = at('山の日', [8, 11]);
        push(m, d, '山の日');
    }
    push(9, nthWeekday(year, 9, 1, 3), '敬老の日');
    push(9, autumnalEquinoxDay(year), '秋分の日');
    {
        // 2020年に「体育の日」から改称
        const [m, d] = at('スポーツの日', [10, nthWeekday(year, 10, 1, 2)]);
        push(m, d, year >= 2020 ? 'スポーツの日' : '体育の日');
    }
    push(11, 3, '文化の日');
    push(11, 23, '勤労感謝の日');

    const holidays = new Map<string, string>();
    for (const [month, day, name] of base) {
        holidays.set(toHolidayKey(new Date(year, month - 1, day)), name);
    }

    // 振替休日: 祝日が日曜なら、その後で最初の「祝日でない日」を休日にする
    const substitutes: [string, string][] = [];
    for (const [key] of holidays) {
        const date = new Date(`${key}T00:00:00`);
        if (date.getDay() !== 0) continue;
        const next = new Date(date);
        do {
            next.setDate(next.getDate() + 1);
        } while (holidays.has(toHolidayKey(next)));
        substitutes.push([toHolidayKey(next), '振替休日']);
    }
    for (const [key, name] of substitutes) holidays.set(key, name);

    // 国民の休日: 前後を祝日に挟まれた平日（日曜・振替休日は対象外）
    // 実際に起きるのは9月の敬老の日〜秋分の日のあいだだけなので、その範囲だけ見る
    for (let day = 1; day <= 30; day += 1) {
        const date = new Date(year, 8, day); // 9月
        const key = toHolidayKey(date);
        if (holidays.has(key) || date.getDay() === 0) continue;
        const prev = new Date(date);
        prev.setDate(prev.getDate() - 1);
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        if (holidays.has(toHolidayKey(prev)) && holidays.has(toHolidayKey(next))) {
            holidays.set(key, '国民の休日');
        }
    }

    return holidays;
}

// 年ごとの計算結果は使い回す（週表示のたびに7回計算するのを避ける）
const cache = new Map<number, Map<string, string>>();

function holidaysFor(year: number): Map<string, string> {
    let found = cache.get(year);
    if (!found) {
        found = getHolidaysOfYear(year);
        cache.set(year, found);
    }
    return found;
}

/** 祝日名。祝日でなければ null */
export function getJapaneseHolidayName(date: Date): string | null {
    return holidaysFor(date.getFullYear()).get(toHolidayKey(date)) ?? null;
}

/** 祝日かどうか（土日は含まない） */
export function isJapaneseHoliday(date: Date): boolean {
    return holidaysFor(date.getFullYear()).has(toHolidayKey(date));
}
