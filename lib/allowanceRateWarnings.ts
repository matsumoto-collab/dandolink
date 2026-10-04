/**
 * 設定 ＞「手当」タブの「金額を変える」で、送る前の確認のモーダルに出す注意を決める（docs/指示書_大規模手当.md の 7-1 の 3）。
 *
 * React にも Prisma にも依存しない純粋関数。金額を足してよいか（締めた月・始まりの日）はサーバーが決めるので、
 * ここで決めるのは「打ちまちがいかもしれない」と知らせる注意だけ（当たっても、送るのは止めない）。
 *
 * 注意の種類（当たったものを、下の順で全部返す）:
 *   ① starts_on_or_before_today … 適用開始日が今日（日本時間）以前
 *        - 適用開始日が今日ちょうども当たる（今日の記録から新しい金額になるため）。
 *        - 日付は 'YYYY-MM-DD' の文字列のまま比べる（同じ形なら、文字の順＝日付の順）。
 *   ② foreman_below_member … 職長の金額が、職長以外の金額より小さい
 *        - 同じ金額は当たらない（「小さい」だけ）。
 *   ③ far_from_current … 職長・職長以外のどちらかが、今の金額の3倍以上 または 3分の1以下
 *        - ちょうど3倍・ちょうど3分の1も当たる（「以上」「以下」）。割り算をせず、整数のかけ算で比べる
 *          （新しい金額 ≧ 今の金額 × 3、または 新しい金額 × 3 ≦ 今の金額）。
 *        - 今の金額が null（今日に使う金額が無い）のときは、比べる相手が無いので当たらない。
 *        - 今の金額が 0 のときは、倍率が決まらないので、その区分は比べない（0円から上げるのは、ふつうの変更として扱う）。
 *        - 新しい金額が 0 で、今の金額が 1円以上なら、3分の1以下として当たる（④ にも当たる）。
 *   ④ zero … 職長・職長以外のどちらかが 0円
 */

export type AllowanceRateWarningCode =
    | 'starts_on_or_before_today'
    | 'foreman_below_member'
    | 'far_from_current'
    | 'zero';

export interface AllowanceRateWarning {
    code: AllowanceRateWarningCode;
    message: string;
}

export interface AllowanceRateWarningInput {
    /** 新しい職長の金額（0〜100,000 の整数として確かめたあとの値） */
    foremanAmount: number;
    /** 新しい職長以外の金額 */
    memberAmount: number;
    /** 今の金額（GET /api/allowances/items の current）。無ければ null */
    current: { foremanAmount: number; memberAmount: number } | null;
    /** 適用開始日 'YYYY-MM-DD' */
    effectiveFrom: string;
    /** 今日（日本時間）'YYYY-MM-DD' */
    today: string;
}

/** 画面の文言（docs/指示書_大規模手当.md の 7-1 の 3 のとおり） */
export const ALLOWANCE_RATE_WARNING_MESSAGES: Record<AllowanceRateWarningCode, string> = {
    starts_on_or_before_today:
        '適用開始日が今日以前です。この日からあとの、すでに付いている記録（締めていない月）の金額も、新しい金額に変わります。',
    foreman_below_member: '職長の金額が、職長以外の金額より小さくなっています',
    far_from_current: '今の金額の3倍以上（または3分の1以下）です。桁をまちがえていませんか',
    zero: '0円になっています',
};

/** 新しい金額が、今の金額の3倍以上 または 3分の1以下か（今の金額が 0 のときは比べない＝false） */
function isFarFrom(next: number, current: number): boolean {
    if (current <= 0) return false;
    return next >= current * 3 || next * 3 <= current;
}

/** 当たった注意を、①〜④ の順で返す。何も当たらなければ空の配列 */
export function allowanceRateWarnings(input: AllowanceRateWarningInput): AllowanceRateWarning[] {
    const codes: AllowanceRateWarningCode[] = [];

    if (input.effectiveFrom <= input.today) codes.push('starts_on_or_before_today');

    if (input.foremanAmount < input.memberAmount) codes.push('foreman_below_member');

    if (
        input.current
        && (isFarFrom(input.foremanAmount, input.current.foremanAmount)
            || isFarFrom(input.memberAmount, input.current.memberAmount))
    ) {
        codes.push('far_from_current');
    }

    if (input.foremanAmount === 0 || input.memberAmount === 0) codes.push('zero');

    return codes.map((code) => ({ code, message: ALLOWANCE_RATE_WARNING_MESSAGES[code] }));
}
