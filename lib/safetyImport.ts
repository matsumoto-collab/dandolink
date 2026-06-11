import { toIsoDateString } from '@/lib/safetyDocuments';

/**
 * Excelインポート（FR-5）のセル値正規化と列マッピング定義。
 * パースはクライアントサイドで完結し、サーバーへはマッピング済みJSONのみ送る（FR-5-2）。
 *
 * ⚠️ 法令上の禁止（要件§7.4）: 健康保険の記号・番号、基礎年金番号、マイナンバーは
 *    マッピング先（IMPORT_FIELDS）に追加してはならない（FR-5-4）。
 */

export type ImportFieldKind = 'string' | 'date' | 'number' | 'boolean';

export interface ImportFieldDef {
    /** プロフィールのフィールド名。'name' のみ特別（対象の氏名解決用） */
    value: string;
    label: string;
    kind: ImportFieldKind;
    /** 列ヘッダーの自動推測に使う部分一致ワード */
    hints: string[];
}

export const IMPORT_NAME_FIELD = 'name';

export const IMPORT_FIELDS: ImportFieldDef[] = [
    { value: 'name', label: '氏名（必須）', kind: 'string', hints: ['氏名', '名前', '氏　名'] },
    { value: 'furigana', label: 'ふりがな', kind: 'string', hints: ['ふりがな', 'フリガナ', 'よみ'] },
    { value: 'birthDate', label: '生年月日', kind: 'date', hints: ['生年月日'] },
    { value: 'gender', label: '性別', kind: 'string', hints: ['性別'] },
    { value: 'jobType', label: '職種', kind: 'string', hints: ['職種'] },
    { value: 'hireDate', label: '雇入年月日', kind: 'date', hints: ['雇入', '雇用年月日'] },
    { value: 'experienceYears', label: '経験年数', kind: 'number', hints: ['経験'] },
    { value: 'workerCategory', label: '区分（労働者/一人親方等）', kind: 'string', hints: ['一人親方'] },
    { value: 'address', label: '現住所', kind: 'string', hints: ['住所'] },
    { value: 'tel', label: '本人TEL', kind: 'string', hints: ['電話', 'TEL', 'ＴＥＬ', '連絡先'] },
    { value: 'familyContact', label: '家族連絡先（緊急連絡先）', kind: 'string', hints: ['家族', '緊急'] },
    { value: 'familyTel', label: '家族TEL', kind: 'string', hints: ['家族電話'] },
    { value: 'healthCheckDate', label: '健康診断日', kind: 'date', hints: ['健康診断'] },
    { value: 'bloodPressure', label: '血圧', kind: 'string', hints: ['血圧'] },
    { value: 'bloodType', label: '血液型', kind: 'string', hints: ['血液型'] },
    { value: 'specialHealthCheckDate', label: '特殊健康診断日', kind: 'date', hints: ['特殊健康診断日', '特殊健診'] },
    { value: 'specialHealthCheckType', label: '特殊健康診断の種類', kind: 'string', hints: ['特殊健康診断の種類', '種類'] },
    { value: 'healthInsurance', label: '健康保険（区分）', kind: 'string', hints: ['健康保険'] },
    { value: 'pensionInsurance', label: '年金保険（区分）', kind: 'string', hints: ['年金'] },
    { value: 'employmentInsurance', label: '雇用保険（区分）', kind: 'string', hints: ['雇用保険'] },
    { value: 'employmentInsuranceLast4', label: '雇用保険 被保険者番号 下4桁', kind: 'string', hints: ['下4桁', '下４桁', '被保険者番号'] },
    { value: 'rosaiSpecialInsurance', label: '労災特別加入', kind: 'boolean', hints: ['労災特別', '特別加入'] },
    { value: 'kentaikyo', label: '建退共', kind: 'boolean', hints: ['建退共'] },
    { value: 'chutaikyo', label: '中退共', kind: 'boolean', hints: ['中退共'] },
    { value: 'kentaikyoTechou', label: '建退共手帳の所有', kind: 'boolean', hints: ['手帳'] },
    { value: 'ccusId', label: 'CCUS技能者ID', kind: 'string', hints: ['CCUS', '技能者ID'] },
    { value: 'notes', label: '備考', kind: 'string', hints: ['備考'] },
];

/** Excel のシリアル日付値 → Date（1900年起点。cellDates:false で数値のまま来た場合の保険） */
function excelSerialToDate(serial: number): Date | null {
    if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return null; // ~9999-12-31
    return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

/** 文字列の日付表現 → YYYY-MM-DD。対応: 2020-01-02 / 2020/1/2 / 2020年1月2日 / 令和2年1月2日 等 */
export function parseDateText(text: string): string | null {
    const s = text.trim();
    if (!s) return null;

    // 西暦（区切り: - / 年月日）
    const seireki = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
    if (seireki) {
        const [, y, m, d] = seireki;
        return buildIsoDate(Number(y), Number(m), Number(d));
    }

    // 和暦（令和/平成/昭和 + R/H/S 略記）
    const wareki = s.match(/^(令和|平成|昭和|[RHS])\s*(\d{1,2}|元)\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?$/i);
    if (wareki) {
        const eraBase: Record<string, number> = {
            令和: 2018, R: 2018, r: 2018,
            平成: 1988, H: 1988, h: 1988,
            昭和: 1925, S: 1925, s: 1925,
        };
        const base = eraBase[wareki[1]];
        if (base !== undefined) {
            const eraYear = wareki[2] === '元' ? 1 : Number(wareki[2]);
            return buildIsoDate(base + eraYear, Number(wareki[3]), Number(wareki[4]));
        }
    }

    return null;
}

function buildIsoDate(year: number, month: number, day: number): string | null {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
}

const BOOLEAN_TRUE = ['有', '○', '◯', '〇', '加入', '済', '1', 'true', 'はい', 'あり', 'yes'];
const BOOLEAN_FALSE = ['無', '×', '✕', '✗', '未加入', '0', 'false', 'いいえ', 'なし', 'no', '適用除外'];

/** セル生値 → フィールド種別に応じた値（取り込めない値は null = 未設定） */
export function normalizeCellValue(raw: unknown, kind: ImportFieldKind): string | number | boolean | null {
    if (raw === null || raw === undefined) return null;

    switch (kind) {
        case 'date': {
            if (raw instanceof Date) return toIsoDateString(raw);
            if (typeof raw === 'number') {
                const date = excelSerialToDate(raw);
                return date ? toIsoDateString(date) : null;
            }
            return parseDateText(String(raw));
        }
        case 'boolean': {
            const s = String(raw).trim().toLowerCase();
            if (!s) return null;
            if (BOOLEAN_TRUE.some((v) => s === v || s.includes(v))) return true;
            if (BOOLEAN_FALSE.some((v) => s === v || s.includes(v))) return false;
            return null;
        }
        case 'number': {
            const cleaned = String(raw).replace(/[^\d.-]/g, '');
            if (!cleaned) return null; // 数字を含まない文字列が Number('') === 0 に化けるのを防ぐ
            const n = Number(cleaned);
            return Number.isFinite(n) ? Math.trunc(n) : null;
        }
        case 'string':
        default: {
            const s = String(raw).trim();
            return s === '' ? null : s;
        }
    }
}

/**
 * フィールド固有の後処理。
 * - employmentInsuranceLast4: 数字のみ抽出し、4桁を超える場合は**末尾4桁に切り詰める**
 *   （誤って全番号が入った Excel を取り込んでも下4桁しか保持しない = §7.4 の安全側動作）
 * - ccusId: 数字のみ抽出（14桁超は不正値として捨てる）
 */
export function postProcessFieldValue(field: string, value: string | number | boolean | null): string | number | boolean | null {
    if (value === null) return null;
    if (field === 'employmentInsuranceLast4') {
        const digits = String(value).replace(/\D/g, '');
        if (!digits) return null;
        return digits.length > 4 ? digits.slice(-4) : digits.length === 4 ? digits : null;
    }
    if (field === 'ccusId') {
        const digits = String(value).replace(/\D/g, '');
        return digits && digits.length <= 14 ? digits : null;
    }
    if (field === 'experienceYears' && typeof value === 'number') {
        return value >= 0 && value <= 80 ? value : null;
    }
    return value;
}

/** 列ヘッダーのテキストからマッピング先フィールドを推測（完全一致 > hints 部分一致） */
export function guessFieldForHeader(headerText: string): string | null {
    const text = headerText.trim();
    if (!text) return null;
    for (const field of IMPORT_FIELDS) {
        if (field.label === text) return field.value;
    }
    for (const field of IMPORT_FIELDS) {
        if (field.hints.some((hint) => text.includes(hint))) return field.value;
    }
    return null;
}

/** 氏名一致判定用の正規化（全半角スペース除去） */
export function normalizeNameForMatch(name: string): string {
    return name.replace(/[\s　]/g, '');
}

/**
 * データ行 + 列マッピング → import API の1行ぶんの profile を構築。
 * mapping: 列index → フィールド名（'' = 取り込まない）
 */
export function buildProfileFromRow(
    row: unknown[],
    mapping: Record<number, string>
): { name: string | null; profile: Record<string, string | number | boolean | null> } {
    let name: string | null = null;
    const profile: Record<string, string | number | boolean | null> = {};

    for (const [colIndexStr, field] of Object.entries(mapping)) {
        if (!field) continue;
        const colIndex = Number(colIndexStr);
        const def = IMPORT_FIELDS.find((f) => f.value === field);
        if (!def) continue;
        const value = postProcessFieldValue(field, normalizeCellValue(row[colIndex], def.kind));
        if (field === IMPORT_NAME_FIELD) {
            name = typeof value === 'string' ? value : null;
        } else if (value !== null) {
            profile[field] = value;
        }
    }

    return { name, profile };
}
