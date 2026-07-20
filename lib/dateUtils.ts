/**
 * 日付ユーティリティ
 *
 * 本番（Vercel）のサーバーは UTC で動作するため、`new Date(x).setHours(0,0,0,0)`
 * のような「サーバーローカルTZ依存」の日付丸めは JST のカレンダー日と1日ズレる。
 * 配置(ProjectAssignment.date)はクライアントが `.toISOString()` で送るため、
 * JST 0時の配置は DB 上 `…T15:00:00.000Z`（= 前日UTC）として保存される。
 * これを UTC で丸めると前日になってしまう。
 *
 * 下記ヘルパは入力を JST(UTC+9) に直し、その JST の年月日で UTC 00:00 の
 * Date を返すことで、TZ非依存に「JSTカレンダー日」へ正規化する。
 * （`roundToNearestQuarterHourJst` と同じ「JSTに直して年月日を取り出す」イディオム）
 */
export function toJstDateOnly(input: string | Date): Date {
    const d = input instanceof Date ? input : new Date(input);
    // JST(UTC+9)上の年月日を取り出す
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return new Date(
        Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0, 0),
    );
}

/**
 * 「JSTのその日の0時」を表す実際の UTC 時刻を返す（= 前日 15:00Z）。
 *
 * toJstDateOnly は JSTカレンダー日を「UTC 0時の印」として返すため、
 * 実時刻が入った列（ProjectAssignment.date は正規化されておらず時分秒を含む）と
 * 範囲比較すると 9 時間ずれる（2026-07-20 の実害: AI照会の残り人数が1人ずれた）。
 * 日付範囲クエリの境界には必ずこちらを使うこと。
 */
export function jstDayStartUtc(input: string | Date): Date {
    return new Date(toJstDateOnly(input).getTime() - 9 * 60 * 60 * 1000);
}
