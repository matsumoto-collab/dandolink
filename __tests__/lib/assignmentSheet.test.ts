import {
    buildAssignmentSheetRows,
    getSheetManagers,
    type AssignmentSheetProject,
    type WorkerNameInfo,
} from '@/lib/assignmentSheet';

const DATE_KEY = '2026-04-24';
const onDate = new Date(2026, 3, 24); // 2026-04-24 (local)
const otherDate = new Date(2026, 3, 25);

const workerNameMap = new Map<string, WorkerNameInfo>([
    ['w1', { displayName: '和馬', isPartner: false, companyDisplayName: null, role: 'worker' }],
    ['w2', { displayName: '浮穴', isPartner: false, companyDisplayName: null, role: 'worker' }],
    // 協力会社の代表者（自分自身が会社）
    ['p1', { displayName: '龍成工業', isPartner: false, companyDisplayName: null, role: 'partner' }],
    // 協力会社のメンバー（親会社=建芯）
    ['pm1', { displayName: 'リザル', isPartner: true, companyDisplayName: '建芯', role: 'partner_member' }],
]);

const vehicleNameMap = new Map<string, string>([
    ['v1', '24-88'],
    ['v2', '2tリース'],
]);

const toolNameMap = new Map<string, string>([
    ['t1', 'インパクト #1'],
    ['t2', '発電機 A'],
]);

const managerMap = new Map<string, string>([
    ['mgrA', '今井 太郎'],
    ['mgrB', '三生 次郎'],
]);

const ctMap = new Map<string, { name: string; color: string }>([
    ['ctA', { name: '組立', color: '#111111' }],
    ['ctD', { name: '解体', color: '#dc2626' }],
]);

const displayedForemanIds = ['f1', 'f2'];
const allForemen = [
    { id: 'f1', displayName: '東本' },
    { id: 'f2', displayName: '田畑' },
    { id: 'p1', displayName: '龍成工業' },
];

const projects: AssignmentSheetProject[] = [
    {
        id: 'A',
        startDate: onDate,
        title: 'A現場',
        customer: 'アレスホーム',
        assignedEmployeeId: 'f1',
        constructionType: 'ctA',
        sortOrder: 2,
        createdBy: 'mgrA',
        confirmedWorkerIds: ['f1', 'w1', 'w2'], // f1=職長は名簿から除外
        confirmedVehicleIds: ['v1', 'v2'],
        tools: ['t2'],
        confirmedToolIds: ['t1'],
        memberCount: 3,
        isDispatchConfirmed: true,
    },
    {
        id: 'B',
        startDate: onDate,
        title: 'B現場',
        customer: 'アレス',
        assignedEmployeeId: 'f1',
        constructionType: 'ctA',
        sortOrder: 1,
        createdBy: ['mgrA', 'mgrB'],
        workers: ['w1'],
        memberCount: 2,
    },
    {
        id: 'C',
        startDate: onDate,
        title: 'C現場',
        customer: '建芯',
        assignedEmployeeId: 'f2',
        constructionType: 'ctD',
        sortOrder: 1,
        createdBy: 'mgrB',
        confirmedWorkerIds: ['pm1'],
        memberCount: 4,
    },
    {
        id: 'D',
        startDate: onDate,
        title: 'D現場',
        assignedEmployeeId: 'p1', // 協力業者が班長（表示順に無い → 末尾）
        sortOrder: 1,
        createdBy: [], // 担当者未設定
        memberCount: 0,
    },
    {
        id: 'E',
        startDate: otherDate, // 対象日外 → 除外
        title: 'E現場',
        assignedEmployeeId: 'f1',
        sortOrder: 0,
    },
];

function build(overrides?: Partial<Parameters<typeof buildAssignmentSheetRows>[0]>) {
    return buildAssignmentSheetRows({
        projects,
        dateKey: DATE_KEY,
        displayedForemanIds,
        allForemen,
        workerNameMap,
        vehicleNameMap,
        toolNameMap,
        managerMap,
        ctMap,
        isNamesLoaded: true,
        ...overrides,
    });
}

describe('buildAssignmentSheetRows', () => {
    it('対象日の案件のみを職長順→sortOrder順で並べる', () => {
        const rows = build();
        // 別日のEは除外。順番は f1(sortOrder昇順: B,A) → f2(C) → 表示順外のp1(D)
        expect(rows.map((r) => r.projectId)).toEqual(['B', 'A', 'C', 'D']);
    });

    it('電動工具は確定分を優先し、マスタで名前に解決する', () => {
        const rows = build();
        const a = rows.find((r) => r.projectId === 'A')!;
        expect(a.toolNames).toEqual(['インパクト #1']);
    });

    it('手配確定の工具が無ければ予定の工具を出す', () => {
        const rows = build({
            projects: projects.map((p) => (p.id === 'A' ? { ...p, confirmedToolIds: [] } : p)),
        });
        const a = rows.find((r) => r.projectId === 'A')!;
        expect(a.toolNames).toEqual(['発電機 A']);
    });

    it('工具を選んでいない案件の toolNames は空配列', () => {
        const rows = build();
        const b = rows.find((r) => r.projectId === 'B')!;
        expect(b.toolNames).toEqual([]);
    });

    it('職長グループ内の順番(orderInGroup)と〃判定', () => {
        const rows = build();
        const [b, a, c, d] = rows;

        // B: f1グループ先頭
        expect(b.orderInGroup).toBe(1);
        expect(b.sameForemanAsAbove).toBe(false);
        expect(b.foremanChanged).toBe(false); // 先頭は境界扱いしない
        expect(b.foremanName).toBe('東本');

        // A: 同じf1の2件目 → 〃
        expect(a.orderInGroup).toBe(2);
        expect(a.sameForemanAsAbove).toBe(true);
        expect(a.foremanChanged).toBe(false);

        // C: f2に変わる → グループ境界・順番リセット
        expect(c.orderInGroup).toBe(1);
        expect(c.sameForemanAsAbove).toBe(false);
        expect(c.foremanChanged).toBe(true);
        expect(c.foremanName).toBe('田畑');

        // D: p1に変わる
        expect(d.orderInGroup).toBe(1);
        expect(d.foremanChanged).toBe(true);
        expect(d.foremanName).toBe('龍成工業');
    });

    it('担当(案件担当者)は姓のみ・複数は「・」連結、未設定はnull＋isUnassigned', () => {
        const [b, a, , d] = build();
        expect(b.managerLabel).toBe('今井・三生'); // 複数担当
        expect(a.managerLabel).toBe('今井'); // 単独
        expect(d.managerLabel).toBeNull();
        expect(d.isUnassigned).toBe(true);
        expect(b.isUnassigned).toBe(false);
    });

    it('作業員名簿は職長を除外し、確定があれば確定・協力業者は会社名付き', () => {
        const [b, a, c] = build();
        // B: 未確定 workers=['w1'] → 和馬
        expect(b.memberNames).toEqual(['和馬']);
        // A: 確定 confirmedWorkerIds=['f1','w1','w2'] → 職長f1除外 → 和馬,浮穴
        expect(a.memberNames).toEqual(['和馬', '浮穴']);
        // C: 協力会社メンバー → 「建芯 リザル」
        expect(c.memberNames).toEqual(['建芯 リザル']);
    });

    it('車両は確定があれば確定、なければ予定', () => {
        const [b, a] = build();
        expect(a.vehicleNames).toEqual(['24-88', '2tリース']); // 確定
        expect(b.vehicleNames).toEqual([]); // どちらも空
    });

    it('工事種別カラーを採用する', () => {
        const [b, , c] = build();
        expect(b.color).toBe('#111111'); // 組立
        expect(c.color).toBe('#dc2626'); // 解体
    });

    it('isNamesLoaded=false の間は名簿・車両を空にする', () => {
        const rows = build({ isNamesLoaded: false });
        expect(rows.every((r) => r.memberNames.length === 0)).toBe(true);
        expect(rows.every((r) => r.vehicleNames.length === 0)).toBe(true);
    });

    it('hidePartnerLedTeams=true で協力業者が班長の班を丸ごと除外', () => {
        const rows = build({ hidePartnerLedTeams: true });
        // p1(協力業者代表)が班長のDが消える
        expect(rows.map((r) => r.projectId)).toEqual(['B', 'A', 'C']);
    });
});

describe('getSheetManagers', () => {
    it('行の出現順に重複なく担当者(姓)を返す', () => {
        const rows = build();
        expect(getSheetManagers(rows, managerMap)).toEqual(['今井', '三生']);
    });
});
