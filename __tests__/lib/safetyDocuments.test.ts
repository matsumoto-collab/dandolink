import {
    calcAgeAt,
    chunkMeiboWorkers,
    getMachineMissingFields,
    getMeiboMissingFields,
    getSafetyDocumentTargetCount,
    getSafetyTargetGroup,
    getVehicleTodokeMissingFields,
    isExpiredOn,
    isoDateToReiwa,
    toIsoDateString,
    MEIBO_WORKERS_PER_PAGE,
    type MachineSnapshot,
    type MeiboWorkerSnapshot,
    type SafetyProfileSnapshot,
    type TodokeVehicleSnapshot,
} from '@/lib/safetyDocuments';

const baseProfile: SafetyProfileSnapshot = {
    furigana: 'やまだ たろう',
    birthDate: '1980-05-01',
    gender: '男',
    jobType: 'とび・足場',
    attributes: ['職'],
    hireDate: '2010-04-01',
    experienceYears: 15,
    workerCategory: '労働者',
    address: '東京都新宿区1-1-1',
    tel: '090-0000-0000',
    familyContact: '山田花子（妻）',
    familyTel: '090-1111-1111',
    healthCheckDate: '2026-01-15',
    bloodPressure: '120-80',
    bloodType: 'A',
    specialHealthCheckDate: null,
    specialHealthCheckType: null,
    healthInsurance: '協会けんぽ',
    pensionInsurance: '厚生年金',
    employmentInsurance: '雇用保険',
    employmentInsuranceLast4: '1234',
    rosaiSpecialInsurance: null,
    kentaikyo: true,
    chutaikyo: false,
    kentaikyoTechou: true,
    ccusId: '12345678901234',
    notes: null,
    qualifications: [],
};

describe('calcAgeAt（FR-3-7: 提出日基準の年齢）', () => {
    it('誕生日当日は加算後の年齢になる', () => {
        expect(calcAgeAt('1980-05-01', '2026-05-01')).toBe(46);
    });

    it('誕生日前日はまだ前の年齢', () => {
        expect(calcAgeAt('1980-05-01', '2026-04-30')).toBe(45);
    });

    it('誕生日翌日は加算後の年齢', () => {
        expect(calcAgeAt('1980-05-01', '2026-05-02')).toBe(46);
    });

    it('同じ生年月日でも提出日が違えば年齢が変わる（決定性は提出日で担保）', () => {
        expect(calcAgeAt('1980-05-01', '2025-06-11')).toBe(45);
        expect(calcAgeAt('1980-05-01', '2026-06-11')).toBe(46);
    });

    it('生年月日なし・不正値は null', () => {
        expect(calcAgeAt(null, '2026-06-11')).toBeNull();
        expect(calcAgeAt(undefined, '2026-06-11')).toBeNull();
        expect(calcAgeAt('invalid', '2026-06-11')).toBeNull();
        expect(calcAgeAt('1980-05-01', 'invalid')).toBeNull();
    });

    it('基準日より未来の生年月日は null（負の年齢を返さない）', () => {
        expect(calcAgeAt('2030-01-01', '2026-06-11')).toBeNull();
    });
});

describe('chunkMeiboWorkers（FR-3-3: 1ページ10名で改ページ）', () => {
    const makeWorkers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

    it('0名でも1ページ（空の名簿）を返す', () => {
        expect(chunkMeiboWorkers([])).toEqual([[]]);
    });

    it('10名はちょうど1ページ', () => {
        const pages = chunkMeiboWorkers(makeWorkers(10));
        expect(pages).toHaveLength(1);
        expect(pages[0]).toHaveLength(10);
    });

    it('11名で2ページ目が生まれる（受け入れ基準3）', () => {
        const pages = chunkMeiboWorkers(makeWorkers(11));
        expect(pages).toHaveLength(2);
        expect(pages[0]).toHaveLength(MEIBO_WORKERS_PER_PAGE);
        expect(pages[1]).toHaveLength(1);
    });

    it('25名は 10/10/5 の3ページ', () => {
        const pages = chunkMeiboWorkers(makeWorkers(25));
        expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    });

    it('順序を保持する', () => {
        const pages = chunkMeiboWorkers(makeWorkers(12));
        expect(pages[1][0]).toEqual({ id: 10 });
    });
});

describe('toIsoDateString / isoDateToReiwa', () => {
    it('Date / ISO文字列を YYYY-MM-DD に正規化する', () => {
        expect(toIsoDateString(new Date('1980-05-01T00:00:00.000Z'))).toBe('1980-05-01');
        expect(toIsoDateString('2026-01-15T00:00:00.000Z')).toBe('2026-01-15');
        expect(toIsoDateString(null)).toBeNull();
        expect(toIsoDateString('invalid')).toBeNull();
    });

    it('令和・平成・昭和に変換する', () => {
        expect(isoDateToReiwa('2026-06-11')).toBe('令和8年6月11日');
        expect(isoDateToReiwa('2019-05-01')).toBe('令和1年5月1日');
        expect(isoDateToReiwa('1990-01-02')).toBe('平成2年1月2日');
        expect(isoDateToReiwa('1980-05-01')).toBe('昭和55年5月1日');
        expect(isoDateToReiwa(null)).toBe('');
    });
});

describe('getMeiboMissingFields（FR-2-4: 警告のみ・ブロックしない）', () => {
    const worker = (profile: SafetyProfileSnapshot | null): MeiboWorkerSnapshot => ({
        key: 'worker:w1',
        source: 'worker',
        sourceId: 'w1',
        name: '山田太郎',
        profile,
    });

    it('プロフィール未登録は専用メッセージ', () => {
        expect(getMeiboMissingFields(worker(null))).toEqual(['安全情報が未登録']);
    });

    it('主要項目が埋まっていれば警告なし', () => {
        expect(getMeiboMissingFields(worker(baseProfile))).toEqual([]);
    });

    it('欠落項目を列挙する', () => {
        const missing = getMeiboMissingFields(
            worker({ ...baseProfile, birthDate: null, healthCheckDate: null, healthInsurance: null })
        );
        expect(missing).toEqual(expect.arrayContaining(['生年月日', '健康診断日', '健康保険']));
        expect(missing).not.toContain('現住所');
    });
});

describe('Phase2: 車両届・機械届', () => {
    const baseVehicle: TodokeVehicleSnapshot = {
        vehicleId: 'v1',
        name: '2tダンプ',
        driverName: '山田太郎',
        profile: {
            vehicleType: '2tダンプ',
            registrationNumber: '名古屋 100 あ 12-34',
            usage: '工事用',
            inspectionExpiry: '2027-01-31',
            jibaisekiCompany: '○○損保',
            jibaisekiExpiry: '2027-01-31',
            insuranceCompany: '○○損保',
            insuranceExpiry: '2027-01-31',
            insurancePersonal: '無制限',
            insuranceObjective: '無制限',
            insurancePassenger: null,
            notes: null,
        },
    };

    const baseMachine: MachineSnapshot = {
        machineId: 'm1',
        name: 'ユニック',
        category: 'crane',
        operatorName: '佐藤次郎',
        model: 'UR-290',
        serialNumber: 'SN-001',
        maker: '古河ユニック',
        capacity: '2.93t吊',
        ownerName: '自社',
        inspectionDate: '2026-01-15',
        inspectionExpiry: '2027-01-31',
        certificateNumber: 'K-123',
        notes: null,
    };

    it('getVehicleTodokeMissingFields: 全部入りは警告なし・欠落を列挙', () => {
        expect(getVehicleTodokeMissingFields(baseVehicle)).toEqual([]);
        expect(getVehicleTodokeMissingFields({ ...baseVehicle, profile: null })).toEqual(['車両安全情報が未登録']);
        const missing = getVehicleTodokeMissingFields({
            ...baseVehicle,
            driverName: '',
            profile: { ...baseVehicle.profile!, registrationNumber: null, inspectionExpiry: null },
        });
        expect(missing).toEqual(expect.arrayContaining(['登録番号', '車検満了日', '運転者']));
    });

    it('getMachineMissingFields: crane は検査証も必須扱い', () => {
        expect(getMachineMissingFields(baseMachine)).toEqual([]);
        const generalMissing = getMachineMissingFields({
            ...baseMachine,
            category: 'general',
            certificateNumber: null,
            inspectionExpiry: null,
        });
        expect(generalMissing).toEqual([]); // 一般区分は検査証不要
        const craneMissing = getMachineMissingFields({
            ...baseMachine,
            certificateNumber: null,
            inspectionExpiry: null,
        });
        expect(craneMissing).toEqual(expect.arrayContaining(['検査証番号', '検査証有効期限']));
    });

    it('isExpiredOn: 基準日より前の期限を期限切れと判定', () => {
        expect(isExpiredOn('2026-06-10', '2026-06-11')).toBe(true);
        expect(isExpiredOn('2026-06-11', '2026-06-11')).toBe(false);
        expect(isExpiredOn(null, '2026-06-11')).toBe(false);
    });

    it('getSafetyDocumentTargetCount: 種別ごとに対象数を返す', () => {
        const header = {
            primeContractor: '', primeSiteManager: '', siteName: '', tier: '',
            submitDate: '2026-06-11', companyName: '', companyRepresentative: '', companyAddress: '',
        };
        expect(
            getSafetyDocumentTargetCount('sagyoin_meibo', { header, workers: [{ key: 'w', source: 'worker', sourceId: 'w', name: 'x', profile: null }] })
        ).toBe(1);
        expect(
            getSafetyDocumentTargetCount('vehicle_todoke', { header, periodFrom: null, periodTo: null, vehicles: [baseVehicle, baseVehicle] })
        ).toBe(2);
        expect(
            getSafetyDocumentTargetCount('crane_todoke', { header, periodFrom: null, periodTo: null, machines: [baseMachine] })
        ).toBe(1);
    });
});

describe('getSafetyTargetGroup（FR-1-0b: PARTNER 含む統合一覧のグループ分け）', () => {
    it('Worker は職方グループ', () => {
        expect(getSafetyTargetGroup('worker', null)).toBe('worker');
    });

    it('User の通常ロールは自社社員', () => {
        expect(getSafetyTargetGroup('user', 'admin')).toBe('employee');
        expect(getSafetyTargetGroup('user', 'foreman1')).toBe('employee');
        expect(getSafetyTargetGroup('user', 'support')).toBe('employee');
    });

    it('PARTNER 系は大文字小文字を問わず協力会社グループ（DBのrole生値は大文字混在）', () => {
        expect(getSafetyTargetGroup('user', 'PARTNER')).toBe('partner');
        expect(getSafetyTargetGroup('user', 'partner')).toBe('partner');
        expect(getSafetyTargetGroup('user', 'partner_member')).toBe('partner');
    });
});
