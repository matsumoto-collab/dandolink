import {
    buildProfileFromRow,
    guessFieldForHeader,
    normalizeCellValue,
    normalizeNameForMatch,
    parseDateText,
    postProcessFieldValue,
    IMPORT_FIELDS,
} from '@/lib/safetyImport';

describe('parseDateText（Excel文字列セルの日付パース）', () => {
    it('西暦の各種区切りを受ける', () => {
        expect(parseDateText('2020-01-02')).toBe('2020-01-02');
        expect(parseDateText('2020/1/2')).toBe('2020-01-02');
        expect(parseDateText('2020年1月2日')).toBe('2020-01-02');
    });

    it('和暦（令和・平成・昭和・略記）を受ける', () => {
        expect(parseDateText('令和2年1月2日')).toBe('2020-01-02');
        expect(parseDateText('令和元年5月1日')).toBe('2019-05-01');
        expect(parseDateText('平成2年1月2日')).toBe('1990-01-02');
        expect(parseDateText('昭和55年5月1日')).toBe('1980-05-01');
        expect(parseDateText('S55.5.1')).toBe('1980-05-01');
        expect(parseDateText('H2/1/2')).toBe('1990-01-02');
        expect(parseDateText('R2.1.2')).toBe('2020-01-02');
    });

    it('不正な日付は null', () => {
        expect(parseDateText('')).toBeNull();
        expect(parseDateText('あいうえお')).toBeNull();
        expect(parseDateText('2020-13-01')).toBeNull();
        expect(parseDateText('2020-02-30')).toBeNull();
    });
});

describe('normalizeCellValue', () => {
    it('date: Date オブジェクト（cellDates:true）を ISO に', () => {
        expect(normalizeCellValue(new Date('1980-05-01T00:00:00.000Z'), 'date')).toBe('1980-05-01');
    });

    it('date: Excel シリアル値を変換する（保険）', () => {
        // 25569 = 1970-01-01
        expect(normalizeCellValue(25569, 'date')).toBe('1970-01-01');
        expect(normalizeCellValue(29342, 'date')).toBe('1980-05-01');
    });

    it('boolean: 有/○/加入 → true、無/×/適用除外 → false、不明 → null', () => {
        expect(normalizeCellValue('有', 'boolean')).toBe(true);
        expect(normalizeCellValue('○', 'boolean')).toBe(true);
        expect(normalizeCellValue('加入', 'boolean')).toBe(true);
        expect(normalizeCellValue('無', 'boolean')).toBe(false);
        expect(normalizeCellValue('×', 'boolean')).toBe(false);
        expect(normalizeCellValue('適用除外', 'boolean')).toBe(false);
        expect(normalizeCellValue('？？', 'boolean')).toBeNull();
        expect(normalizeCellValue('', 'boolean')).toBeNull();
    });

    it('number: 単位付き文字列から数値を抽出', () => {
        expect(normalizeCellValue('15年', 'number')).toBe(15);
        expect(normalizeCellValue(8, 'number')).toBe(8);
        expect(normalizeCellValue('abc', 'number')).toBeNull();
    });

    it('string: trim して空は null', () => {
        expect(normalizeCellValue('  とび・足場  ', 'string')).toBe('とび・足場');
        expect(normalizeCellValue('', 'string')).toBeNull();
        expect(normalizeCellValue(null, 'string')).toBeNull();
    });
});

describe('postProcessFieldValue（§7.4 の安全側動作）', () => {
    it('雇用保険: 4桁を超える番号は末尾4桁に切り詰める（全番号を保持しない）', () => {
        expect(postProcessFieldValue('employmentInsuranceLast4', '12345678901')).toBe('8901');
        expect(postProcessFieldValue('employmentInsuranceLast4', '1234')).toBe('1234');
        expect(postProcessFieldValue('employmentInsuranceLast4', '123')).toBeNull();
        expect(postProcessFieldValue('employmentInsuranceLast4', 'No.5678')).toBe('5678');
    });

    it('ccusId: 数字のみ抽出・14桁超は捨てる', () => {
        expect(postProcessFieldValue('ccusId', '1234-5678-9012-34')).toBe('12345678901234');
        expect(postProcessFieldValue('ccusId', '123456789012345')).toBeNull();
    });

    it('experienceYears: 0〜80 の範囲外は捨てる', () => {
        expect(postProcessFieldValue('experienceYears', 15)).toBe(15);
        expect(postProcessFieldValue('experienceYears', 999)).toBeNull();
    });
});

describe('guessFieldForHeader（列の自動推測）', () => {
    it('代表的な見出しを推測する', () => {
        expect(guessFieldForHeader('氏名')).toBe('name');
        expect(guessFieldForHeader('ふりがな')).toBe('furigana');
        expect(guessFieldForHeader('生年月日')).toBe('birthDate');
        expect(guessFieldForHeader('雇入年月日')).toBe('hireDate');
        expect(guessFieldForHeader('最近の健康診断日')).toBe('healthCheckDate');
        expect(guessFieldForHeader('建退共')).toBe('kentaikyo');
    });

    it('不明な見出しは null', () => {
        expect(guessFieldForHeader('印鑑')).toBeNull();
        expect(guessFieldForHeader('')).toBeNull();
    });
});

describe('IMPORT_FIELDS（FR-5-4: 禁止項目のマッピング先が存在しない）', () => {
    it('健康保険番号・基礎年金番号・マイナンバーに相当するフィールドが無い', () => {
        const values = IMPORT_FIELDS.map((f) => f.value.toLowerCase());
        expect(values).not.toContain('healthinsurancenumber');
        expect(values).not.toContain('pensionnumber');
        expect(values).not.toContain('mynumber');
        const labels = IMPORT_FIELDS.map((f) => f.label);
        expect(labels.some((l) => l.includes('基礎年金'))).toBe(false);
        expect(labels.some((l) => l.includes('マイナンバー'))).toBe(false);
        // 雇用保険のみ「下4桁」として存在する
        expect(values).toContain('employmentinsurancelast4');
    });
});

describe('normalizeNameForMatch / buildProfileFromRow', () => {
    it('氏名一致はスペース（全角含む）を無視する', () => {
        expect(normalizeNameForMatch('山田 太郎')).toBe('山田太郎');
        expect(normalizeNameForMatch('山田　太郎')).toBe('山田太郎');
    });

    it('行＋マッピングからプロフィールを構築する', () => {
        const row = ['山田 太郎', 'やまだ たろう', '昭和55年5月1日', '有', '15年'];
        const mapping = { 0: 'name', 1: 'furigana', 2: 'birthDate', 3: 'kentaikyo', 4: 'experienceYears' };
        const { name, profile } = buildProfileFromRow(row, mapping);
        expect(name).toBe('山田 太郎');
        expect(profile).toEqual({
            furigana: 'やまだ たろう',
            birthDate: '1980-05-01',
            kentaikyo: true,
            experienceYears: 15,
        });
    });

    it('空セルのフィールドは含めない（既存値を消さない）', () => {
        const row = ['山田太郎', null, ''];
        const mapping = { 0: 'name', 1: 'birthDate', 2: 'jobType' };
        const { profile } = buildProfileFromRow(row, mapping);
        expect(profile).toEqual({});
    });
});
