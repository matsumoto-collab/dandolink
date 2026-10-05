/**
 * utils/joyoStatementPdf.tsx の props 作り（発行済みの写しから）のテスト。
 *
 * 本人の画面は buildIssuedJoyoStatementPdfProps を、管理者の画面は buildJoyoStatementPdfProps を呼ぶ。
 * 発行済みの作り方を1か所にしたので、どちらから作っても同じ props になること（＝管理者の画面の PDF が変わらないこと）を見る。
 * react-pdf の描画はしない（props を作るだけ）ので、@react-pdf/renderer と PDF の部品は差し替える。
 */
import {
    buildIssuedJoyoStatementPdfProps,
    buildJoyoStatementPdfProps,
} from '@/utils/joyoStatementPdf';
import type { JoyoIssuedSnapshot, JoyoStatementDto, JoyoStatementRow } from '@/types/joyoStatement';

jest.mock('@react-pdf/renderer', () => ({
    pdf: jest.fn(),
    StyleSheet: { create: (s: unknown) => s },
    Font: { register: jest.fn(), registerHyphenationCallback: jest.fn() },
    Document: () => null,
    Page: () => null,
    Text: () => null,
    View: () => null,
    Image: () => null,
}));
jest.mock('@/components/pdf/styles', () => ({}));
jest.mock('@/components/pdf/JoyoStatementPDF', () => ({ JoyoStatementPDF: () => null }));
jest.mock('@/utils/saveBlobWithShare', () => ({ saveBlobWithShare: jest.fn(), sanitizeFileName: (s: string) => s }));
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const snap: JoyoIssuedSnapshot = {
    title: '支払明細書（発行時）',
    footerNote: '振込手数料は当社負担',
    recipient: { name: '山田工業', honorific: '御中', postalCode: '7900001', address: '愛媛県松山市1-1', registrationNumber: null },
    issuer: {
        name: '株式会社テスト足場',
        postalCode: '7900002',
        address: '愛媛県松山市2-2',
        tel: '089-000-0000',
        fax: null,
        registrationNumber: 'T1234567890123',
    },
    attendanceUserName: '山田 太郎（発行時）',
    attendanceRecords: [
        {
            userId: 'u-1',
            date: '2026-08-03T00:00:00.000Z',
            status: 'present',
            earlyStartMinutes: 0,
            morningLoadingMinutes: 0,
            overtimeMinutes: 0,
            eveningLoadingMinutes: 0,
            earlyEndTime: null,
            note: null,
        },
        {
            userId: 'u-1',
            date: '2026-08-04T00:00:00.000Z',
            status: 'present',
            earlyStartMinutes: 30,
            morningLoadingMinutes: 0,
            overtimeMinutes: 60,
            eveningLoadingMinutes: 0,
            earlyEndTime: null,
            note: 'メモ',
        },
    ] as JoyoIssuedSnapshot['attendanceRecords'],
};

const issuedStatement = (overrides: Partial<JoyoStatementDto> = {}): JoyoStatementDto => ({
    id: 's-1',
    contractorId: 'c-1',
    year: 2026,
    month: 8,
    status: 'issued',
    statementNo: '202608-01',
    issueDate: '2026-08-31',
    paymentDate: '2026-09-10',
    subject: '令和8年8月分 常用代金',
    // 保存してある金額（式で出し直すと違う値になるようにしておく＝保存してある値をそのまま使うことを見る）
    items: [
        { kind: 'full', name: '常用（全日）', quantity: 2, unit: '日', unitPrice: 20000, amount: 39999, note: '' },
        { kind: 'manual', name: '交通費', quantity: 1, unit: '式', unitPrice: 1500, amount: 1500, note: '高速' },
    ],
    total: 41499,
    tax: 3772,
    includeAttendance: true,
    attendanceCounts: { present: 2, holidayWork: 0, nightShift: 0 },
    issuedSnapshot: snap,
    issuedAt: '2026-08-31T03:00:00.000Z',
    paymentScheduleId: 'ps-1',
    notes: '社内メモ',
    updatedAt: '2026-08-31T03:00:00.000Z',
    ...overrides,
});

const rowOf = (statement: JoyoStatementDto): JoyoStatementRow =>
    ({
        contractor: {
            id: 'c-1',
            userId: 'u-1',
            // 今の値（発行後に直した）。発行済みの PDF には出ないこと
            userDisplayName: '山田 太郎（今）',
            code: 1,
            recipientName: '山田工業（今）',
            honorific: '様',
            postalCode: null,
            address: null,
            registrationNumber: null,
            unitPrice: 25000,
            payeeId: null,
            payee: null,
            sortOrder: 1,
            isActive: true,
            notes: null,
        },
        attendance: {
            counts: { present: 0, holidayWork: 0, nightShift: 0, holiday: 0, absent: 0, paidLeave: 0, compensatoryHoliday: 0 },
            records: [],
        },
        statement,
        attendanceChanged: false,
        paymentSchedule: null,
    }) as unknown as JoyoStatementRow;

const settingsNow = { title: '支払明細書（今）', footerNote: '今の注記' };
const issuerNow = { name: '今の会社', postalCode: '', address: '', tel: '', fax: null, registrationNumber: null };

describe('buildIssuedJoyoStatementPdfProps', () => {
    it('写しと保存してある金額から作る（計算し直さない）', () => {
        const s = issuedStatement();
        const props = buildIssuedJoyoStatementPdfProps({ userId: 'u-1', statement: { ...s, issuedSnapshot: snap } });
        expect(props).toMatchObject({
            title: '支払明細書（発行時）',
            statementNo: '202608-01',
            issueDate: '2026-08-31',
            paymentDate: '2026-09-10',
            year: 2026,
            month: 8,
            subject: '令和8年8月分 常用代金',
            recipient: snap.recipient,
            issuer: snap.issuer,
            total: 41499,
            tax: 3772,
            footerNote: '振込手数料は当社負担',
        });
        expect(props.items).toEqual([
            { name: '常用（全日）', quantity: 2, unit: '日', unitPrice: 20000, amount: 39999, note: '' },
            { name: '交通費', quantity: 1, unit: '式', unitPrice: 1500, amount: 1500, note: '高速' },
        ]);
        expect(props.attendance).not.toBeNull();
        expect(props.attendance).toMatchObject({ year: 2026, month: 8, userName: '山田 太郎（発行時）' });
    });

    it('出勤簿を付けない明細は attendance が null・空の注記は null', () => {
        const s = issuedStatement({ includeAttendance: false });
        const props = buildIssuedJoyoStatementPdfProps({
            userId: 'u-1',
            statement: { ...s, issuedSnapshot: { ...snap, footerNote: '' } },
        });
        expect(props.attendance).toBeNull();
        expect(props.footerNote).toBeNull();
    });
});

describe('buildJoyoStatementPdfProps（発行済みの枝）は buildIssuedJoyoStatementPdfProps と同じ props を返す', () => {
    const cases: [string, JoyoStatementDto][] = [
        ['出勤簿あり', issuedStatement()],
        ['出勤簿なし', issuedStatement({ includeAttendance: false })],
        ['注記が空', issuedStatement({ issuedSnapshot: { ...snap, footerNote: '' } })],
        ['書類番号なし', issuedStatement({ statementNo: null })],
    ];

    it.each(cases)('%s', (_label, s) => {
        const fromAdmin = buildJoyoStatementPdfProps({ year: 2026, month: 8, row: rowOf(s), settings: settingsNow, issuer: issuerNow });
        const fromMember = buildIssuedJoyoStatementPdfProps({
            userId: 'u-1',
            statement: { ...s, issuedSnapshot: s.issuedSnapshot as JoyoIssuedSnapshot },
        });
        expect(fromAdmin).toEqual(fromMember);
        // 今の設定・自社情報・対象者の値は使わない
        expect(fromAdmin.title).toBe(s.issuedSnapshot?.title);
        expect(fromAdmin.issuer).toEqual(snap.issuer);
        expect(fromAdmin.recipient).toEqual(snap.recipient);
    });

    it('draft を渡しても、発行済みなら写しから作る（今までどおり）', () => {
        const s = issuedStatement();
        const fromAdmin = buildJoyoStatementPdfProps({
            year: 2026,
            month: 8,
            row: rowOf(s),
            settings: settingsNow,
            issuer: issuerNow,
            draft: { issueDate: '2026-01-01', paymentDate: '2026-01-10', subject: '別', items: [], includeAttendance: false },
        });
        expect(fromAdmin).toEqual(buildIssuedJoyoStatementPdfProps({ userId: 'u-1', statement: { ...s, issuedSnapshot: snap } }));
    });
});
