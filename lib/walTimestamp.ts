/**
 * Supabase Realtime(WAL) の timestamp 列の文字列を Date にパースする。
 *
 * Postgres の timestamp(without time zone) 列は「2026-07-07T15:00:00」のように
 * タイムゾーン表記なしの UTC 値で届く。素の new Date() は ES 仕様でこれを
 * 「端末ローカル時刻」として解釈するため、JST 環境では9時間＝日付判定で1日ズレる
 * （ProjectAssignment.date は JST 0時＝UTC 前日15時で保存されているため常に前日に化ける）。
 * タイムゾーン表記が無い場合は UTC として明示的にパースする。
 */
export function parseWalTimestamp(raw: string): Date {
    const iso = !raw.includes('T') && raw.includes(' ') ? raw.replace(' ', 'T') : raw;
    // 日付のみ（時刻部なし）は ES 仕様で UTC 解釈されるのでそのまま
    if (!iso.includes('T')) return new Date(iso);
    // Z か ±hh / ±hhmm / ±hh:mm のオフセット付きはそのまま、無ければ UTC を明示
    return new Date(/([zZ]|[+-]\d{2}(:?\d{2})?)$/.test(iso) ? iso : `${iso}Z`);
}
