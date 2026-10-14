/**
 * 道路申請の既定値の組み立てと正規化（lib/roadPermit/defaults.ts）。
 * 自動入力の決まり（指示書 §7）: 申請者=自社情報／現場・期間=案件／担当者・現場責任者・文言=前回の申請。
 * 担当者・現場責任者の既定値（指示書_道路申請_担当者の選択と住所 §3.4）: 担当者=前回→候補の 1 人目→空／
 * 現場責任者の氏名・電話=前回→（前回が空なら）担当者と同じ／住所=前回→（前回が空なら）自社情報の住所。
 */
import {
    buildCopiedRoadPermitDocuments,
    buildCopiedRoadPermitValues,
    buildDefaultRoadPermitDocuments,
    buildDefaultRoadPermitTitle,
    buildDefaultRoadPermitValues,
    emptyRoadPermitValues,
    enabledFormIdsOf,
    latestExpiryOf,
    normalizeRoadPermitDocuments,
    normalizeRoadPermitStatus,
    normalizeRoadPermitValues,
    projectLocationOf,
} from '@/lib/roadPermit/defaults';
import { ROAD_PERMIT_FORMS } from '@/lib/roadPermit/forms';
import { ROAD_PERMIT_FILE_MAX_BYTES, permitFileExtension, withPermitFilesFrom } from '@/lib/roadPermit/permitFiles';
import type {
    RoadPermitCompanyDefaults,
    RoadPermitContactPreset,
    RoadPermitDocuments,
    RoadPermitPermitFile,
    RoadPermitProjectSource,
    RoadPermitValues,
} from '@/types/roadPermit';

const company: RoadPermitCompanyDefaults = {
    postalCode: '790-0001',
    address: '愛媛県松山市一番町1-1-1',
    name: '株式会社テスト足場',
    representativeTitle: '代表取締役',
    representative: '山田　太郎',
    tel: '089-000-0000',
    contactPerson: '鈴木',
};

const project: RoadPermitProjectSource = {
    id: 'pm1',
    title: '北井門様邸 足場工事',
    location: '松山市北井門1丁目1-1',
    prefecture: '愛媛県',
    city: '松山市',
    scheduledStartDate: '2026-09-05',
    scheduledEndDate: '2026-10-04',
};

const otherProject: RoadPermitProjectSource = {
    id: 'pm2',
    title: '別の現場',
    location: '松山市南町2-2',
    prefecture: null,
    city: null,
    scheduledStartDate: '2026-11-01',
    scheduledEndDate: '2026-11-30',
};

/** 前回の申請（担当者・現場責任者・文言を直してある） */
function previousValues(): RoadPermitValues {
    const v = buildDefaultRoadPermitValues({ company, project, previous: null });
    return {
        ...v,
        contact: { name: '前回の担当', phone: '090-1111-2222' },
        siteManager: { address: '松山市東町3-3', name: '前回の責任者', phone: '090-3333-4444' },
        occupancy: { ...v.occupancy, purpose: '外壁塗装に伴う足場設置', name: '単管足場', structure: '単管', quantity: '0.9486' },
        police: {
            ...v.police,
            applicationDate: '2026-09-01',
            stationName: '松山南警察署長',
            purpose: '足場の設置',
            method: '歩道上に足場を設置',
        },
        matsuyama: { ...v.matsuyama, applicationDate: '2026-09-01', mayorName: '松山市長　別の人' },
    };
}

describe('projectLocationOf', () => {
    it('location があればそれ、無ければ 都道府県＋市区町村', () => {
        expect(projectLocationOf(project)).toBe('松山市北井門1丁目1-1');
        expect(projectLocationOf({ ...project, location: '  ' })).toBe('愛媛県松山市');
        expect(projectLocationOf({ ...project, location: null, prefecture: null })).toBe('松山市');
        expect(projectLocationOf(null)).toBe('');
    });
});

describe('buildDefaultRoadPermitValues', () => {
    it('申請者は自社情報、現場・期間・警察の「場所又は区間」は案件から入る', () => {
        const v = buildDefaultRoadPermitValues({ company, project, previous: null });
        expect(v.applicant).toEqual({
            postalCode: '790-0001',
            address: '愛媛県松山市一番町1-1-1',
            companyName: '株式会社テスト足場',
            representativeTitle: '代表取締役',
            representativeName: '山田　太郎',
            tel: '089-000-0000',
        });
        expect(v.site).toEqual({ location: '松山市北井門1丁目1-1', projectName: '北井門様邸 足場工事' });
        expect(v.period).toEqual({
            workFrom: '2026-09-05',
            workTo: '2026-10-04',
            useFrom: '2026-09-05',
            useTo: '2026-10-04',
            timeFrom: '09:00',
            timeTo: '17:00',
            dayCount: null,
        });
        expect(v.police.section).toBe('松山市北井門1丁目1-1');
        expect(v.road).toEqual({ routeName: '', part: '', surface: '', mapPage: '' });
    });

    it('前回も候補も無ければ 担当者は空（自社情報の contactPerson は使わない）、現場責任者は氏名・電話が空で住所は自社情報、文言は既定', () => {
        const v = buildDefaultRoadPermitValues({ company, project, previous: null });
        expect(v.contact).toEqual({ name: '', phone: '' });
        expect(v.siteManager).toEqual({ address: '愛媛県松山市一番町1-1-1', name: '', phone: '' });
        expect(v.occupancy).toMatchObject({
            purpose: '建物改修工事に伴う足場設置',
            name: '足場',
            structure: '鋼製足場',
            constructionMethod: '請負',
            quantity: '',
            areaApprox: null,
        });
        expect(v.police).toMatchObject({
            applicationDate: '',
            stationName: '松山東警察署長',
            attachments: '位置図・現地写真・平面図（保安図）',
            conditionText: '別紙の通り',
        });
        expect(v.matsuyama).toMatchObject({
            applicationDate: '',
            mayorName: '松山市長　野志　克仁',
            kind: 'permit',
            newOrChange: 'new',
            article: '32',
            attachments: 'ア.警察署長の道路使用許可書の写　イ.位置図・平面図・断面図・立面図・外　ウ.着工前写真',
        });
    });

    it('自社情報も案件も無ければ空で作れる（落ちない）', () => {
        const v = buildDefaultRoadPermitValues({ company: null, project: null, previous: null });
        expect(v.applicant.companyName).toBe('');
        expect(v.contact).toEqual({ name: '', phone: '' });
        expect(v.siteManager).toEqual({ address: '', name: '', phone: '' });
        expect(v.site.location).toBe('');
        expect(v.period.useFrom).toBe('');
    });

    it('前回があれば 担当者・現場責任者・占用物件・警察の文言・市長名を引き継ぎ、申請日は空', () => {
        const v = buildDefaultRoadPermitValues({ company, project: otherProject, previous: previousValues() });
        expect(v.contact).toEqual({ name: '前回の担当', phone: '090-1111-2222' });
        expect(v.siteManager).toEqual({ address: '松山市東町3-3', name: '前回の責任者', phone: '090-3333-4444' });
        expect(v.occupancy).toMatchObject({ purpose: '外壁塗装に伴う足場設置', name: '単管足場', structure: '単管' });
        // 数量は現場ごとに違うので引き継がない
        expect(v.occupancy.quantity).toBe('');
        expect(v.police).toMatchObject({
            applicationDate: '',
            stationName: '松山南警察署長',
            purpose: '足場の設置',
            method: '歩道上に足場を設置',
            // 場所又は区間は今回の案件から
            section: '松山市南町2-2',
        });
        expect(v.matsuyama.mayorName).toBe('松山市長　別の人');
        expect(v.matsuyama.applicationDate).toBe('');
        // 現場・期間は前回ではなく今回の案件から
        expect(v.site.location).toBe('松山市南町2-2');
        expect(v.period.useFrom).toBe('2026-11-01');
    });

    it('前回の文言が空なら既定に戻す（空のまま印刷しない）', () => {
        const prev = previousValues();
        prev.police.stationName = '';
        prev.occupancy.purpose = '  ';
        const v = buildDefaultRoadPermitValues({ company, project, previous: prev });
        expect(v.police.stationName).toBe('松山東警察署長');
        expect(v.occupancy.purpose).toBe('建物改修工事に伴う足場設置');
    });
});

describe('buildDefaultRoadPermitValues: 担当者・現場責任者（担当者の選択と住所 §3.4）', () => {
    const contacts: RoadPermitContactPreset[] = [
        { name: '候補　一郎', phone: '089-000-1111' },
        { name: '候補　二郎', phone: '090-000-2222' },
    ];

    it('前回が無く候補があれば 担当者=候補の 1 人目。現場責任者の氏名・電話は担当者と同じ、住所は自社情報の住所', () => {
        const v = buildDefaultRoadPermitValues({ company, project, previous: null, contacts });
        expect(v.contact).toEqual({ name: '候補　一郎', phone: '089-000-1111' });
        expect(v.siteManager).toEqual({ address: '愛媛県松山市一番町1-1-1', name: '候補　一郎', phone: '089-000-1111' });
    });

    it('前回があれば 担当者・現場責任者とも前回の値（候補より前回を優先）', () => {
        const v = buildDefaultRoadPermitValues({ company, project, previous: previousValues(), contacts });
        expect(v.contact).toEqual({ name: '前回の担当', phone: '090-1111-2222' });
        expect(v.siteManager).toEqual({ address: '松山市東町3-3', name: '前回の責任者', phone: '090-3333-4444' });
    });

    it('前回の担当者が空（空白だけ）なら候補の 1 人目。候補も無ければ空', () => {
        const prev = previousValues();
        prev.contact = { name: ' ', phone: '' };
        expect(buildDefaultRoadPermitValues({ company, project, previous: prev, contacts }).contact).toEqual({
            name: '候補　一郎',
            phone: '089-000-1111',
        });
        expect(buildDefaultRoadPermitValues({ company, project, previous: prev, contacts: [] }).contact).toEqual({ name: '', phone: '' });
        expect(buildDefaultRoadPermitValues({ company, project, previous: prev }).contact).toEqual({ name: '', phone: '' });
    });

    it('前回の現場責任者が空なら 氏名・電話は担当者と同じ、住所は自社情報の住所（完了の条件 3）', () => {
        const prev = previousValues();
        prev.siteManager = { address: '', name: '', phone: '' };
        const v = buildDefaultRoadPermitValues({ company, project, previous: prev, contacts });
        expect(v.siteManager).toEqual({ address: '愛媛県松山市一番町1-1-1', name: '前回の担当', phone: '090-1111-2222' });
    });

    it('前回の担当者も現場責任者も空なら 現場責任者の氏名・電話は候補の 1 人目（＝担当者と同じ）', () => {
        const prev = previousValues();
        prev.contact = { name: '', phone: '' };
        prev.siteManager = { address: '', name: '', phone: '' };
        const v = buildDefaultRoadPermitValues({ company, project, previous: prev, contacts });
        expect(v.contact).toEqual({ name: '候補　一郎', phone: '089-000-1111' });
        expect(v.siteManager).toEqual({ address: '愛媛県松山市一番町1-1-1', name: '候補　一郎', phone: '089-000-1111' });
    });

    it('前回の現場責任者の住所だけ空なら 住所は自社情報、氏名・電話は前回のまま', () => {
        const prev = previousValues();
        prev.siteManager = { address: '  ', name: '前回の責任者', phone: '090-3333-4444' };
        const v = buildDefaultRoadPermitValues({ company, project, previous: prev, contacts });
        expect(v.siteManager).toEqual({ address: '愛媛県松山市一番町1-1-1', name: '前回の責任者', phone: '090-3333-4444' });
    });

    it('前回の現場責任者の氏名だけあれば（電話が空でも）前回のまま＝担当者の電話は混ぜない', () => {
        const prev = previousValues();
        prev.siteManager = { address: '松山市東町3-3', name: '前回の責任者', phone: '' };
        const v = buildDefaultRoadPermitValues({ company, project, previous: prev, contacts });
        expect(v.siteManager).toEqual({ address: '松山市東町3-3', name: '前回の責任者', phone: '' });
    });

    it('自社情報が無ければ 現場責任者の住所は空（コードに住所を書かない）', () => {
        const v = buildDefaultRoadPermitValues({ company: null, project, previous: null, contacts });
        expect(v.siteManager).toEqual({ address: '', name: '候補　一郎', phone: '089-000-1111' });
    });

    it('「コピーして作る」は候補に関係なく コピー元の担当者・現場責任者をそのまま写す', () => {
        const src = previousValues();
        const v = buildCopiedRoadPermitValues({ source: src, project, sameProject: true });
        expect(v.contact).toEqual(src.contact);
        expect(v.siteManager).toEqual(src.siteManager);
    });
});

describe('buildDefaultRoadPermitTitle', () => {
    it('案件名。無ければ「道路申請」', () => {
        expect(buildDefaultRoadPermitTitle(project)).toBe('北井門様邸 足場工事');
        expect(buildDefaultRoadPermitTitle(null)).toBe('道路申請');
        expect(buildDefaultRoadPermitTitle({ ...project, title: '  ' })).toBe('道路申請');
    });
});

describe('buildCopiedRoadPermitValues', () => {
    const source = (): RoadPermitValues => {
        const p = previousValues();
        return { ...p, period: { ...p.period, dayCount: 30 }, road: { routeName: '南北66号線', part: 'sidewalk', surface: 'paved', mapPage: '12' } };
    };

    it('同じ案件なら現場・期間もそのまま写し、申請日だけ空に戻す', () => {
        const src = source();
        const v = buildCopiedRoadPermitValues({ source: src, project, sameProject: true });
        expect(v.site).toEqual(src.site);
        expect(v.period).toEqual(src.period);
        expect(v.road).toEqual(src.road);
        expect(v.contact).toEqual(src.contact);
        expect(v.police.applicationDate).toBe('');
        expect(v.matsuyama.applicationDate).toBe('');
        expect(v.police.stationName).toBe('松山南警察署長');
    });

    it('違う案件なら 現場・期間・警察の「場所又は区間」は案件から入れ直す', () => {
        const v = buildCopiedRoadPermitValues({ source: source(), project: otherProject, sameProject: false });
        expect(v.site).toEqual({ location: '松山市南町2-2', projectName: '別の現場' });
        expect(v.period).toMatchObject({ useFrom: '2026-11-01', useTo: '2026-11-30', dayCount: null });
        expect(v.police.section).toBe('松山市南町2-2');
        // それ以外はコピー元のまま
        expect(v.road.routeName).toBe('南北66号線');
        expect(v.police.method).toBe('歩道上に足場を設置');
        expect(v.police.applicationDate).toBe('');
    });

    it('コピー元を書き換えない', () => {
        const src = source();
        buildCopiedRoadPermitValues({ source: src, project: otherProject, sameProject: false });
        expect(src.police.applicationDate).toBe('2026-09-01');
    });
});

describe('documents の既定値とコピー', () => {
    it('buildDefaultRoadPermitDocuments: 3 様式・全部出す・チェックリストはカタログどおりで未チェック', () => {
        const d = buildDefaultRoadPermitDocuments();
        expect(d.forms.map((f) => f.formId)).toEqual(['police-road-use', 'matsuyama-occupancy-apply', 'matsuyama-occupancy-reply']);
        expect(d.forms.every((f) => f.enabled)).toBe(true);
        for (const f of d.forms) {
            const def = ROAD_PERMIT_FORMS.find((x) => x.id === f.formId)!;
            expect(f.attachmentChecks).toEqual(def.attachmentChecklist.map((label) => ({ label, done: false })));
            expect(f).toMatchObject({ submittedDate: '', permittedDate: '', permitNo: '', expiryDate: '' });
        }
    });

    it('buildCopiedRoadPermitDocuments: 出す様式の選択だけ写し、日付・番号・チェックは空に戻す', () => {
        const src = buildDefaultRoadPermitDocuments(['police-road-use']);
        src.forms[0] = {
            ...src.forms[0],
            submittedDate: '2026-09-01',
            permittedDate: '2026-09-03',
            permitNo: '第123号',
            expiryDate: '2026-10-04',
            attachmentChecks: src.forms[0].attachmentChecks.map((c) => ({ ...c, done: true })),
        };
        const d = buildCopiedRoadPermitDocuments(src);
        expect(d.forms.map((f) => [f.formId, f.enabled])).toEqual([
            ['police-road-use', true],
            ['matsuyama-occupancy-apply', false],
            ['matsuyama-occupancy-reply', false],
        ]);
        expect(d.forms[0]).toMatchObject({ submittedDate: '', permittedDate: '', permitNo: '', expiryDate: '' });
        expect(d.forms[0].attachmentChecks.every((c) => !c.done)).toBe(true);
    });
});

describe('normalizeRoadPermitValues', () => {
    it('欠けた欄は空で埋まる（古い行・壊れた JSON でも落ちない）', () => {
        expect(normalizeRoadPermitValues(null)).toEqual(emptyRoadPermitValues());
        expect(normalizeRoadPermitValues('壊れた')).toEqual(emptyRoadPermitValues());
        const v = normalizeRoadPermitValues({ applicant: { companyName: '株式会社A' }, period: { useFrom: '2026-09-05' } });
        expect(v.applicant).toEqual({ ...emptyRoadPermitValues().applicant, companyName: '株式会社A' });
        expect(v.period.useFrom).toBe('2026-09-05');
        expect(v.period.useTo).toBe('');
        expect(v.occupancy.areaApprox).toBeNull();
    });

    it('不正な選択肢は既定に戻す・日数は 0 以上の整数だけ', () => {
        const v = normalizeRoadPermitValues({
            road: { part: 'highway', surface: 'paved' },
            matsuyama: { kind: 'xxx', newOrChange: 'change', article: '99' },
            period: { dayCount: -3 },
        });
        expect(v.road.part).toBe('');
        expect(v.road.surface).toBe('paved');
        expect(v.matsuyama).toMatchObject({ kind: 'permit', newOrChange: 'change', article: '32' });
        expect(v.period.dayCount).toBeNull();
        expect(normalizeRoadPermitValues({ period: { dayCount: 12.7 } }).period.dayCount).toBe(12);
        expect(normalizeRoadPermitValues({ period: { dayCount: '12' } }).period.dayCount).toBeNull();
    });

    it('正しい値はそのまま通る', () => {
        const v = previousValues();
        expect(normalizeRoadPermitValues(JSON.parse(JSON.stringify(v)))).toEqual(v);
    });
});

describe('normalizeRoadPermitDocuments', () => {
    it('未知の様式は落ち、無い様式は「出さない」で足され、カタログ順に並ぶ', () => {
        const d = normalizeRoadPermitDocuments({
            forms: [
                { formId: 'unknown-form', enabled: true },
                { formId: 'matsuyama-occupancy-apply', enabled: true, permitNo: '第1号' },
            ],
        });
        expect(d.forms.map((f) => [f.formId, f.enabled])).toEqual([
            ['police-road-use', false],
            ['matsuyama-occupancy-apply', true],
            ['matsuyama-occupancy-reply', false],
        ]);
        expect(d.forms[1].permitNo).toBe('第1号');
        expect(normalizeRoadPermitDocuments(null).forms).toHaveLength(3);
    });

    it('チェックは保存してある一覧をそのまま使う（カタログに項目を足しても既にある申請は変わらない・済みは true だけ）', () => {
        const d = normalizeRoadPermitDocuments({
            forms: [
                {
                    formId: 'police-road-use',
                    enabled: true,
                    attachmentChecks: [
                        { label: '位置図', done: true },
                        { label: '昔の書類', done: true },
                        { label: '現地写真', done: 'yes' },
                        { label: '', done: true },
                        'broken',
                    ],
                },
            ],
        });
        expect(d.forms[0].attachmentChecks).toEqual([
            { label: '位置図', done: true },
            { label: '昔の書類', done: true },
            { label: '現地写真', done: false },
        ]);
    });

    it('一覧が保存されていない（古い行）ときだけカタログの文言で作る', () => {
        const d = normalizeRoadPermitDocuments({ forms: [{ formId: 'police-road-use', enabled: true }] });
        expect(d.forms[0].attachmentChecks).toEqual([
            { label: '位置図', done: false },
            { label: '現地写真', done: false },
            { label: '平面図（保安図）', done: false },
        ]);
    });

    it('四国ガスの協議: 新しく作る松山市の申請のチェックに出る・既にある申請（6 項目で保存）には足さない', () => {
        const fresh = buildDefaultRoadPermitDocuments().forms.find((f) => f.formId === 'matsuyama-occupancy-apply')!;
        expect(fresh.attachmentChecks.map((c) => c.label)).toEqual([
            'ア. 警察署長の道路使用許可書の写',
            'イ. 位置図',
            'イ. 平面図',
            'イ. 断面図',
            'イ. 立面図',
            'ウ. 着工前写真',
            '四国ガスの協議（協議済の印をもらう）',
        ]);
        const old = ['ア. 警察署長の道路使用許可書の写', 'イ. 位置図', 'イ. 平面図', 'イ. 断面図', 'イ. 立面図', 'ウ. 着工前写真'].map((label, i) => ({
            label,
            done: i < 2,
        }));
        const d = normalizeRoadPermitDocuments({ forms: [{ formId: 'matsuyama-occupancy-apply', enabled: true, attachmentChecks: old }] });
        expect(d.forms.find((f) => f.formId === 'matsuyama-occupancy-apply')!.attachmentChecks).toEqual(old);
    });
});

describe('normalizeRoadPermitStatus', () => {
    it('知らない状態は下書き', () => {
        expect(normalizeRoadPermitStatus('permitted')).toBe('permitted');
        expect(normalizeRoadPermitStatus('???')).toBe('draft');
        expect(normalizeRoadPermitStatus(null)).toBe('draft');
    });
});

describe('enabledFormIdsOf・latestExpiryOf', () => {
    const docs = (): RoadPermitDocuments => {
        const d = buildDefaultRoadPermitDocuments(['matsuyama-occupancy-reply', 'police-road-use']);
        d.forms[0].expiryDate = '2026-10-04';
        d.forms[1].expiryDate = '2026-12-31'; // 出さない様式の期限は数えない
        d.forms[2].expiryDate = '2026-11-15';
        return d;
    };

    it('enabledFormIdsOf: 出す様式だけ・カタログ順', () => {
        expect(enabledFormIdsOf(docs())).toEqual(['police-road-use', 'matsuyama-occupancy-reply']);
    });

    it('latestExpiryOf: 出す様式のうちいちばん遅い期限。無ければ null', () => {
        expect(latestExpiryOf(docs())).toBe('2026-11-15');
        expect(latestExpiryOf(buildDefaultRoadPermitDocuments())).toBeNull();
    });
});

describe('許可書（スキャン）の一覧 permitFiles', () => {
    const file = (over: Partial<RoadPermitPermitFile> = {}): RoadPermitPermitFile => ({
        id: 'f1',
        fileName: '許可書.pdf',
        storagePath: 'road-permits/rp1/f1.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        uploadedAt: '2026-10-14T01:00:00.000Z',
        uploadedBy: 'u1',
        uploadedByName: '担当A',
        ...over,
    });

    it('normalizeRoadPermitDocuments: 保存してある一覧を読む。壊れた 1 件は落とし、無ければ []', () => {
        const raw = {
            forms: [
                {
                    formId: 'police-road-use',
                    enabled: true,
                    permitFiles: [
                        file(),
                        file({ id: '' }), // id が空
                        { ...file({ id: 'f3' }), storagePath: 'other/rp1/f3.pdf' }, // 置き場所が違う
                        { ...file({ id: 'f4' }), size: 'abc' }, // 大きさが数でない
                        { ...file({ id: 'f5' }), uploadedBy: 5 }, // 付けた人が文字でも null でもない
                        file({ id: 'f6', size: 10.6, uploadedBy: null }),
                    ],
                },
                { formId: 'matsuyama-occupancy-apply', enabled: true }, // 古いデータ（一覧が無い）
            ],
        };
        const docs = normalizeRoadPermitDocuments(raw);
        const police = docs.forms.find((f) => f.formId === 'police-road-use')!;
        expect(police.permitFiles.map((f) => f.id)).toEqual(['f1', 'f6']);
        expect(police.permitFiles[1]).toMatchObject({ size: 11, uploadedBy: null });
        expect(docs.forms.find((f) => f.formId === 'matsuyama-occupancy-apply')!.permitFiles).toEqual([]);
        // DB に無い様式・正規化前の空の値も []
        expect(docs.forms.find((f) => f.formId === 'matsuyama-occupancy-reply')!.permitFiles).toEqual([]);
        expect(normalizeRoadPermitDocuments(null).forms.every((f) => f.permitFiles.length === 0)).toBe(true);
    });

    it('buildCopiedRoadPermitDocuments: コピーすると一覧は空になる', () => {
        const src = buildDefaultRoadPermitDocuments();
        src.forms[0].permitFiles = [file()];
        const copied = buildCopiedRoadPermitDocuments(src);
        expect(copied.forms.every((f) => f.permitFiles.length === 0)).toBe(true);
    });

    it('withPermitFilesFrom: 様式ごとの一覧を DB の値で置き換える（入力中の値は残す・next に無い様式は足さない）', () => {
        const next = buildDefaultRoadPermitDocuments();
        next.forms[0].submittedDate = '2026-10-01';
        next.forms[0].permitFiles = [file({ id: 'from-screen' })];
        const onlyTwo: RoadPermitDocuments = { forms: next.forms.slice(0, 2) };

        const existing = buildDefaultRoadPermitDocuments();
        existing.forms[0].permitFiles = [file({ id: 'db1' })];
        existing.forms[2].permitFiles = [file({ id: 'db3' })];

        const out = withPermitFilesFrom(onlyTwo, existing);
        expect(out.forms).toHaveLength(2);
        expect(out.forms[0].submittedDate).toBe('2026-10-01');
        expect(out.forms[0].permitFiles.map((f) => f.id)).toEqual(['db1']);
        expect(out.forms[1].permitFiles).toEqual([]);
        // 元の値は変えない
        expect(next.forms[0].permitFiles[0].id).toBe('from-screen');
    });

    it('permitFileExtension: PDF と画像だけ拡張子を返す。上限は 20MB', () => {
        expect(permitFileExtension('application/pdf')).toBe('pdf');
        expect(permitFileExtension('image/jpeg')).toBe('jpg');
        expect(permitFileExtension('image/png')).toBe('png');
        expect(permitFileExtension('image/webp')).toBe('webp');
        expect(permitFileExtension('image/gif')).toBe('gif');
        expect(permitFileExtension('image/heic')).toBe('heic');
        expect(permitFileExtension('image/heif')).toBe('heif');
        expect(permitFileExtension('text/plain')).toBeNull();
        expect(permitFileExtension('')).toBeNull();
        expect(ROAD_PERMIT_FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
    });
});
