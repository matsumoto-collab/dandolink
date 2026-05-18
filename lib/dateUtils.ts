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
