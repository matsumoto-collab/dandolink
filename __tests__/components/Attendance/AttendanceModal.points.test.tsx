/**
 * 「出勤簿入力」（AttendanceModal）に足した、評価ポイントのボタンのテスト。
 *
 * いちばん守りたい約束:
 *   A. 項目が無い・読み込みに失敗した・対象外の人 のときは、ポイントの部品を1つも出さない（出勤簿の画面は今までどおり）
 *   B. ポイントの読み込みが失敗しても、出勤簿の「保存」は今までどおり同じ中身を送る
 *   C. ボタンを押しても出勤簿の API（/api/attendance）を呼ばない。「保存」で送る中身も変わらない
 *
 * fetch はテストごとに差し替える（出勤簿の API は決まった答え。/api/evaluation-points/day はテストごとに答えを変え、
 * 答えを遅らせることもできる）。本物の DB・API にはつながない。
 */
import React from 'react';
import { render, screen, within, act, fireEvent, cleanup } from '@testing-library/react';
import toast from 'react-hot-toast';
import AttendanceModal from '@/components/Attendance/AttendanceModal';
import { useEvaluationPointDay } from '@/hooks/useEvaluationPointDay';
import * as broadcastChannel from '@/lib/broadcastChannel';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------- モック

interface SessionUser { id: string; role: string; name: string; username: string }
let mockSessionUser: SessionUser = { id: 'F1', role: 'foreman2', name: '職長1', username: 'f1' };
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: mockSessionUser }, status: 'authenticated' }),
}));

jest.mock('react-hot-toast', () => {
    const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
    return { __esModule: true, default: t };
});

jest.mock('@/lib/logger', () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// 本物の lib/broadcastChannel.ts と同じ3つの関数。Supabase へはつながず、テストから「知らせが届いた」ことにできる
jest.mock('@/lib/broadcastChannel', () => {
    const listeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
    const sent: { event: string; payload: Record<string, unknown> }[] = [];
    return {
        initBroadcastChannel: jest.fn(),
        sendBroadcast: (event: string, payload: Record<string, unknown> = {}) => { sent.push({ event, payload }); },
        onBroadcast: (event: string, callback: (payload: Record<string, unknown>) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(callback);
            return () => { listeners.get(event)?.delete(callback); };
        },
        __sent: sent,
        __emit: (event: string, payload: Record<string, unknown> = {}) => { listeners.get(event)?.forEach((fn) => fn(payload)); },
        __listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    };
});

const bc = broadcastChannel as unknown as {
    __sent: { event: string; payload: Record<string, unknown> }[];
    __emit: (event: string, payload?: Record<string, unknown>) => void;
    __listenerCount: (event: string) => number;
};
const toastMock = toast as unknown as jest.Mock & { success: jest.Mock; error: jest.Mock };
const confirmMock = jest.fn(() => true);

// ---------------------------------------------------------------- fetch の差し替え

interface Call {
    url: string;
    path: string;
    query: URLSearchParams;
    method: string;
    body: Record<string, unknown> | undefined;
    settle: (r: Reply) => void;
    settled: boolean;
}
type Reply = { kind: 'json'; status: number; data: unknown } | { kind: 'network-error' };
/** undefined を返した呼び出しは「まだ答えない」（あとで settle で答える） */
type Route = (call: Call) => Reply | undefined;

const ok = (data: unknown): Reply => ({ kind: 'json', status: 200, data });
const fail = (status: number, data: unknown = { error: `status ${status}` }): Reply => ({ kind: 'json', status, data });
const networkError: Reply = { kind: 'network-error' };

function installFetch(route: Route): Call[] {
    const calls: Call[] = [];
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const u = new URL(url, 'http://localhost');
        return new Promise<Response>((resolve, reject) => {
            const call: Call = {
                url,
                path: u.pathname,
                query: u.searchParams,
                method: init?.method ?? 'GET',
                body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
                settled: false,
                settle: (r: Reply) => {
                    if (call.settled) return;
                    call.settled = true;
                    if (r.kind === 'network-error') reject(new TypeError('Failed to fetch'));
                    else resolve({ ok: r.status < 400, status: r.status, json: async () => r.data } as Response);
                },
            };
            calls.push(call);
            const reply = route(call);
            if (reply) call.settle(reply);
        });
    }) as unknown as typeof fetch;
    return calls;
}

const flush = async () => {
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
};
const settle = async (call: Call, reply: Reply) => {
    await act(async () => { call.settle(reply); await Promise.resolve(); });
    await flush();
};

// ---------------------------------------------------------------- 出勤簿の側のデータ（どのテストも同じ）

const member = (id: string, displayName: string, role: string, dispatchSortOrder: number | null) => ({ id, displayName, role, dispatchSortOrder });
const membersByForeman: Record<string, ReturnType<typeof member>[]> = {
    F1: [member('F1', '職長1', 'FOREMAN2', 1), member('w1', '作業員1', 'WORKER', 2), member('w2', '作業員2', 'worker', 3), member('pm1', '協力メンバー', 'PARTNER_MEMBER', 4)],
    F2: [member('F2', '職長2', 'FOREMAN1', 1), member('w1', '作業員1', 'WORKER', 2)],
    admin1: [member('admin1', '管理者', 'ADMIN', null)],
};
const attendance = (userId: string, over: Record<string, unknown> = {}) =>
    ({ userId, earlyStartMinutes: 0, morningLoadingMinutes: 0, overtimeMinutes: 0, eveningLoadingMinutes: 0, earlyEndTime: null, ...over });
const attendanceByKey: Record<string, ReturnType<typeof attendance>[]> = {
    'F1|2026-09-30': [attendance('F1'), attendance('w1', { overtimeMinutes: 60, earlyEndTime: '16:30' }), attendance('w2', { morningLoadingMinutes: 30 })],
    'F1|2026-10-01': [attendance('F1', { eveningLoadingMinutes: 15 })],
};
const foremen = [member('F1', '職長1', 'FOREMAN2', 1), member('F2', '職長2', 'FOREMAN1', 2), member('admin1', '管理者', 'ADMIN', null)];

/** 出勤簿の API（今あるもの）の答え。評価ポイントの API は undefined を返して、テストごとの route に任せる */
function attendanceRoute(call: Call): Reply | undefined {
    if (call.path === '/api/dispatch/foremen') return ok(foremen);
    if (call.path === '/api/attendance/members') return ok(membersByForeman[call.query.get('foremanId') ?? ''] ?? []);
    if (call.path === '/api/attendance' && call.method === 'GET') return ok(attendanceByKey[`${call.query.get('foremanId')}|${call.query.get('date')}`] ?? []);
    if (call.path === '/api/attendance' && call.method === 'POST') return ok([]);
    return undefined;
}

/** F1・2026-09-30 で、職長1 の残業を 30分に変えて「保存」したときに送る中身（評価ポイントを足す前から変わらない形） */
const EXPECTED_SAVE_BODY = {
    foremanId: 'F1',
    date: '2026-09-30',
    items: [
        { userId: 'F1', earlyStartMinutes: 0, morningLoadingMinutes: 0, overtimeMinutes: 30, eveningLoadingMinutes: 0, earlyEndTime: null },
        { userId: 'w1', earlyStartMinutes: 0, morningLoadingMinutes: 0, overtimeMinutes: 60, eveningLoadingMinutes: 0, earlyEndTime: '16:30' },
        { userId: 'w2', earlyStartMinutes: 0, morningLoadingMinutes: 30, overtimeMinutes: 0, eveningLoadingMinutes: 0, earlyEndTime: null },
        { userId: 'pm1', earlyStartMinutes: 0, morningLoadingMinutes: 0, overtimeMinutes: 0, eveningLoadingMinutes: 0, earlyEndTime: null },
    ],
};

// ---------------------------------------------------------------- 評価ポイントの側のデータ

interface DayRecord { id: string; itemId: string; itemName: string; status: 'confirmed' | 'pending'; createdBy: string; createdByName: string; canRemove: boolean }
interface DayMember { userId: string; eligible: boolean; records: DayRecord[] }
interface DayItem { id: string; name: string; description: string | null }

const item = (id: string, name: string, description: string | null = null): DayItem => ({ id, name, description });
const dayRecord = (over: Partial<DayRecord> = {}): DayRecord =>
    ({ id: 'r1', itemId: 'wash', itemName: '洗車', status: 'confirmed', createdBy: 'F1', createdByName: '職長1', canRemove: true, ...over });
const dayMember = (userId: string, eligible = true, records: DayRecord[] = []): DayMember => ({ userId, eligible, records });
const dayResponse = (foremanId: string, date: string, items: DayItem[], members: DayMember[]) => ({ date, foremanId, items, members });

const isAttendanceCall = (c: Call) => c.path.startsWith('/api/attendance');
const isDayGet = (c: Call) => c.path === '/api/evaluation-points/day' && c.method === 'GET';
const isDayPut = (c: Call) => c.path === '/api/evaluation-points/day' && c.method === 'PUT';
const describeCall = (c: Call) => `${c.method} ${c.url}`;
const dayQuery = (c: Call) => ({ foremanId: c.query.get('foremanId') ?? '', date: c.query.get('date') ?? '' });

const ITEMS = [item('wash', '洗車', '現場の帰りに車を洗った'), item('help', 'ヘルプ'), item('extra', '追加の現場', '予定に無い現場へ行った')];
const F1_IDS = ['F1', 'w1', 'w2', 'pm1'];

/** 項目あり・だれも記録なし の GET /day */
const dayWithItems: Route = (c) => {
    if (!isDayGet(c)) return undefined;
    const { foremanId, date } = dayQuery(c);
    const ids = foremanId === 'F1' ? F1_IDS : foremanId === 'F2' ? ['F2', 'w1'] : [foremanId];
    return ok(dayResponse(foremanId, date, ITEMS, ids.map((id) => dayMember(id, id !== 'pm1'))));
};
/** 項目なし・だれも記録なし の GET /day */
const dayWithoutItems: Route = (c) => {
    if (!isDayGet(c)) return undefined;
    const { foremanId, date } = dayQuery(c);
    return ok(dayResponse(foremanId, date, [], F1_IDS.map((id) => dayMember(id, id !== 'pm1'))));
};

// ---------------------------------------------------------------- 画面の操作

const D930 = new Date(2026, 8, 30);
/** 今日（端末の日付）。AttendanceModal の formatDateKey と同じ出し方 */
const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface OpenProps { date?: Date; foremanId?: string; onSaved?: () => void; onClose?: () => void }
const modalElement = (isOpen: boolean, props: OpenProps = {}) => (
    <AttendanceModal
        isOpen={isOpen}
        onClose={props.onClose ?? (() => undefined)}
        initialDate={isOpen ? props.date ?? new Date(D930) : undefined}
        initialForemanId={isOpen ? props.foremanId ?? 'F1' : undefined}
        onSaved={props.onSaved}
    />
);

/** モーダルを F1・2026-09-30 で開く（AttendancePage と同じ: 閉じた状態で置いてあるものを、対象を入れて開く） */
async function open(route: Route, props: OpenProps = {}) {
    const calls = installFetch((c) => attendanceRoute(c) ?? route(c));
    const utils = render(modalElement(false));
    utils.rerender(modalElement(true, props));
    await flush();
    return { calls, ...utils };
}

const errors = () => toastMock.error.mock.calls.map((c) => c[0] as string);
/** toast('…')（エラーでも成功でもない、ふつうのトースト）で出した文言 */
const notices = () => toastMock.mock.calls.map((c) => c[0] as string);
const chipsOf = (userId: string) => screen.queryByTestId(`point-chips-${userId}`);
const chip = (userId: string, label: string) => within(screen.getByTestId(`point-chips-${userId}`)).getByText(label).closest('button') as HTMLButtonElement;
const saveButton = () => screen.getByText('保存').closest('button') as HTMLButtonElement;
/** メンバーのカードの中の選択欄（早出・朝積・残業・夕積・早終 が人数ぶん並ぶ）。「職長選択」の欄は数えない */
const cardSelects = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('select')).filter((el) => ['早出', '朝積', '残業', '夕積', '早終'].includes(el.previousElementSibling?.textContent ?? ''));
/** 評価ポイントの部品（ボタンの行・見出しの下の一文）が、画面に1つも無いこと */
const expectNoPointParts = (container: HTMLElement) => {
    expect(container.querySelectorAll('[data-testid^="point-"]').length).toBe(0);
    expect(container.textContent).not.toContain('ポイント');
};

beforeEach(() => {
    mockSessionUser = { id: 'F1', role: 'foreman2', name: '職長1', username: 'f1' };
    jest.clearAllMocks();
    bc.__sent.length = 0;
    confirmMock.mockImplementation(() => true);
    window.confirm = confirmMock;
});
afterEach(() => cleanup());

// =====================================================================================
describe('A. 項目が無い・読めない・対象外 のときは、ポイントの部品を出さない（出勤簿の画面は今までどおり）', () => {
    const cases: [string, Route][] = [
        ['項目が1つも無い（記録も無い）', dayWithoutItems],
        ['先の日付など（items も members も空）', (c) => (isDayGet(c) ? ok(dayResponse('F1', dayQuery(c).date, [], [])) : undefined)],
        ['読み込みの答えが返ってこない', () => undefined],
        ['読み込みが 500', (c) => (isDayGet(c) ? fail(500) : undefined)],
        ['読み込みが 403', (c) => (isDayGet(c) ? fail(403, { error: '権限がありません' }) : undefined)],
        ['読み込みがネットワークエラー', (c) => (isDayGet(c) ? networkError : undefined)],
    ];

    it.each(cases)('%s: 開いた直後・値を変えた後・コピーの後・全員定時の後・日付を切り替えた後 のどこでも出ない。トーストも出ない', async (_name, route) => {
        const { calls, container } = await open(route);
        expect(screen.queryAllByText('作業員1').length).toBe(1); // 出勤簿のメンバーは出ている
        expectNoPointParts(container);
        fireEvent.change(cardSelects(container)[0], { target: { value: '45' } }); // 早出を 45分に
        expectNoPointParts(container);
        fireEvent.click(screen.getByText('他のメンバーへコピー'));
        expectNoPointParts(container);
        fireEvent.click(screen.getByText('全員定時'));
        expectNoPointParts(container);
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        expectNoPointParts(container);
        expect(errors()).toEqual([]);
        expect(notices()).toEqual([]);

        // 出勤簿の API への通信（URL と順番）は、評価ポイントを足す前と同じ。
        // 開いた直後は、開く前の日付（今日）ぶんの読み込みが1回先に走る（評価ポイントを足す前からの動き）
        expect(calls.filter(isAttendanceCall).map(describeCall)).toEqual([
            `GET /api/attendance/members?foremanId=F1&date=${todayKey()}`,
            `GET /api/attendance?foremanId=F1&date=${todayKey()}`,
            'GET /api/attendance/members?foremanId=F1&date=2026-09-30',
            'GET /api/attendance?foremanId=F1&date=2026-09-30',
            'GET /api/attendance/members?foremanId=F1&date=2026-10-01',
            'GET /api/attendance?foremanId=F1&date=2026-10-01',
        ]);
        // 増える通信は GET /api/evaluation-points/day だけ
        expect(calls.filter((c) => !isAttendanceCall(c)).every(isDayGet)).toBe(true);
    });

    it('読み込みに失敗したことは logger.error にだけ出す', async () => {
        await open((c) => (isDayGet(c) ? fail(500) : undefined));
        expect((logger.error as jest.Mock).mock.calls.map((c) => c[0] as string)).toEqual(['評価ポイントの読み込みに失敗:']);
    });

    it('対象外の人（協力会社のメンバー）のカードには出さない。項目も記録も無い人にも出さない', async () => {
        const route: Route = (c) => (isDayGet(c)
            ? ok(dayResponse('F1', dayQuery(c).date, [], [dayMember('F1'), dayMember('w1', true, [dayRecord({ id: 'old', itemId: 'oldItem', itemName: '旧・運転' })]), dayMember('w2'), dayMember('pm1', false)]))
            : undefined);
        await open(route);
        expect(chipsOf('w1')).not.toBeNull(); // 記録のある人にだけ出る
        expect(chipsOf('F1')).toBeNull();
        expect(chipsOf('w2')).toBeNull();
        expect(chipsOf('pm1')).toBeNull();
    });
});

// =====================================================================================
describe('B. ポイントの読み込みが失敗しても、出勤簿の「保存」は今までどおり', () => {
    const cases: [string, Route][] = [
        ['項目あり（ふつうに読めた）', dayWithItems],
        ['500', (c) => (isDayGet(c) ? fail(500) : undefined)],
        ['ネットワークエラー', (c) => (isDayGet(c) ? networkError : undefined)],
        ['403', (c) => (isDayGet(c) ? fail(403, { error: '権限がありません' }) : undefined)],
        ['答えが返ってこない', () => undefined],
    ];

    it.each(cases)('%s: メンバーが出て、「保存」が同じ中身の POST /api/attendance を1回送る', async (_name, route) => {
        const onSaved = jest.fn();
        const onClose = jest.fn();
        const { calls, container } = await open(route, { onSaved, onClose });
        for (const name of ['職長1', '作業員1', '作業員2', '協力メンバー']) expect(screen.queryAllByText(name).length).toBeGreaterThan(0);
        fireEvent.change(cardSelects(container)[2], { target: { value: '30' } }); // 職長1 の残業を 30分に
        fireEvent.click(saveButton());
        await flush();

        const posts = calls.filter((c) => c.path === '/api/attendance' && c.method === 'POST');
        expect(posts.map((p) => p.body)).toEqual([EXPECTED_SAVE_BODY]);
        expect(toastMock.success.mock.calls.map((c) => c[0] as string)).toEqual(['保存しました']);
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        // 出勤簿の知らせも今までどおり。ポイントの知らせ・ポイントの保存は出ない
        expect(bc.__sent).toEqual([{ event: 'attendance_updated', payload: { foremanId: 'F1', date: '2026-09-30' } }]);
        expect(calls.filter(isDayPut).length).toBe(0);
        expect(errors()).toEqual([]);
    });
});

// =====================================================================================
describe('C. ボタンを押したとき', () => {
    it('PUT /day を1回だけ呼ぶ。/api/attendance への通信は起きない。入力中の値はそのまま。そのあとの「保存」で送る中身も同じ', async () => {
        const put: Route = (c) => (isDayPut(c)
            ? ok({ result: 'added', member: dayMember(String(c.body?.userId), true, [dayRecord({ id: 'new1', itemId: String(c.body?.itemId) })]) })
            : undefined);
        const { calls, container } = await open((c) => dayWithItems(c) ?? put(c));
        fireEvent.change(cardSelects(container)[2], { target: { value: '30' } }); // 職長1 の残業を 30分に
        const attendanceBefore = calls.filter(isAttendanceCall).length;

        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(chip('w1', '洗車'));
        await flush();

        expect(calls.filter(isDayPut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'wash', on: true }]);
        expect(calls.filter(isAttendanceCall).length).toBe(attendanceBefore); // 出勤簿の API は呼ばれていない
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        expect(chip('w1', '洗車').className).toContain('bg-teal-600');
        expect(bc.__sent).toEqual([{ event: 'evaluation_points_updated', payload: { date: '2026-09-30' } }]);
        expect(cardSelects(container)[2].value).toBe('30'); // 入力中の出勤簿の値は変わらない

        bc.__sent.length = 0;
        fireEvent.click(saveButton());
        await flush();
        const posts = calls.filter((c) => c.method === 'POST');
        expect(posts.map((p) => p.body)).toEqual([EXPECTED_SAVE_BODY]);
        expect(bc.__sent).toEqual([{ event: 'attendance_updated', payload: { foremanId: 'F1', date: '2026-09-30' } }]);
        expect(calls.filter(isDayPut).length).toBe(1); // 「保存」ではポイントを送らない
    });

    it('「キャンセル」「全員定時」「定時」「他のメンバーへコピー」は、ポイントの通信を起こさない', async () => {
        const { calls } = await open(dayWithItems);
        const before = calls.length;
        fireEvent.click(screen.getByText('全員定時'));
        fireEvent.click(screen.getAllByText('定時')[0]);
        fireEvent.click(screen.getByText('他のメンバーへコピー'));
        fireEvent.click(screen.getByText('キャンセル'));
        await flush();
        expect(calls.length).toBe(before);
    });
});

// =====================================================================================
describe('D. 古い読み込みの答えは、ボタンの表示に使わない', () => {
    it('開いた直後: 前の職長・日付ぶんの答えが後から届いても使わない', async () => {
        mockSessionUser = { id: 'admin1', role: 'admin', name: '管理者', username: 'admin' };
        const { calls } = await open(() => undefined);
        const gets = calls.filter(isDayGet);
        // 開いた直後は、前の職長（自分）・日付（今日）ぶんの読み込みが1回先に走る
        expect(gets.length).toBe(2);
        const stale = gets.find((g) => dayQuery(g).foremanId === 'admin1') as Call;
        const fresh = gets.find((g) => dayQuery(g).foremanId === 'F1' && dayQuery(g).date === '2026-09-30') as Call;
        // 新しいほう（F1・9/30）が先に届く: w1 に「洗車」が付いている
        await settle(fresh, ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord()]), dayMember('w2')])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        // 古いほうが後から届く: 項目が違い、w1 に何も付いていない
        await settle(stale, ok(dayResponse('admin1', dayQuery(stale).date, [item('zzz', '別の項目')], [dayMember('admin1'), dayMember('w1')])));
        expect(screen.queryByText('別の項目')).toBeNull();
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
    });

    it('日付を切り替えた直後: 新しい答えが届くまで出さない。前の日付の答えが後から届いても使わない', async () => {
        const { calls } = await open(() => undefined);
        const first = calls.filter(isDayGet).find((g) => dayQuery(g).date === '2026-09-30') as Call;
        fireEvent.click(screen.getByLabelText('翌日')); // 10/1 へ（9/30 の答えはまだ届いていない）
        await flush();
        const second = calls.filter(isDayGet).find((g) => dayQuery(g).date === '2026-10-01') as Call;
        expect(second).toBeTruthy();
        expect(chipsOf('w1')).toBeNull();
        await settle(second, ok(dayResponse('F1', '2026-10-01', ITEMS, [dayMember('F1'), dayMember('w1'), dayMember('w2')])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false');
        await settle(first, ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord()]), dayMember('w2')])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false'); // 9/30 の「付いている」は映らない
    });

    it('内容が出たあとで日付を切り替えた瞬間も、前の日付のボタンは残らない', async () => {
        const { calls } = await open((c) => (isDayGet(c) && dayQuery(c).date === '2026-09-30'
            ? ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord()])]))
            : undefined));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        // 出勤簿の読み込みが済んでメンバーが出たあとも、ポイントは 10/1 の答えが届くまで出ない
        expect(screen.queryByText('作業員1')).not.toBeNull();
        expect(chipsOf('w1')).toBeNull();
        expect(calls.filter(isDayGet).some((g) => dayQuery(g).date === '2026-10-01')).toBe(true);
    });

    it('日付を進めて、その答えが届く前に戻したときも、戻した日の新しい答えが届くまで出さない', async () => {
        let hold = false;
        const route: Route = (c) => {
            if (!isDayGet(c)) return undefined;
            return hold ? undefined : ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord()])]));
        };
        const { calls } = await open(route);
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        hold = true;
        fireEvent.click(screen.getByLabelText('翌日')); // 10/1 へ（答えは届かない）
        await flush();
        fireEvent.click(screen.getByLabelText('前日')); // 9/30 へ戻す（新しい答えは、まだ届かない）
        await flush();
        expect(screen.queryAllByText('作業員1').length).toBe(1); // 出勤簿のメンバーは出ている
        expect(chipsOf('w1')).toBeNull();                        // 前に読んだ 9/30 の内容は出さない
        const pending = calls.filter(isDayGet).filter((g) => !g.settled && dayQuery(g).date === '2026-09-30');
        expect(pending.length).toBe(1);
        await settle(pending[0], ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1')])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false');
    });

    it('閉じて、同じ職長・日付で開き直した直後は、前に開いたときの内容を出さない（新しい答えが届くまで）', async () => {
        let hold = false;
        const route: Route = (c) => {
            if (!isDayGet(c)) return undefined;
            return hold ? undefined : ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord()])]));
        };
        const calls = installFetch((c) => attendanceRoute(c) ?? route(c));
        const utils = render(modalElement(false));
        const sameDay = { date: new Date(D930) };
        utils.rerender(modalElement(true, sameDay));
        await flush();
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');

        utils.rerender(modalElement(false));
        await flush();
        hold = true; // 開き直したときの読み込みには、まだ答えない
        utils.rerender(modalElement(true, sameDay));
        await flush();
        expect(screen.queryAllByText('作業員1').length).toBe(1); // 出勤簿のメンバーは出ている
        expect(chipsOf('w1')).toBeNull();
        const pending = calls.filter(isDayGet).filter((g) => !g.settled && dayQuery(g).date === '2026-09-30');
        expect(pending.length).toBe(1);
        await settle(pending[0], ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1')])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false'); // 閉じているあいだに取り消されていた
    });

    it('送っている最中に日付を切り替えたら、PUT の応答の member は、新しい日付の表示に使わない', async () => {
        const { calls } = await open(dayWithItems);
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        const putCall = calls.filter(isDayPut)[0];
        expect(putCall.settled).toBe(false);
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false'); // 10/1 の表示
        // 10/1 の同じ人・同じ項目のボタンは、9/30 ぶんの送信が終わっていなくても押せる
        expect(chip('w1', '洗車').disabled).toBe(false);
        await settle(putCall, ok({ result: 'added', member: dayMember('w1', true, [dayRecord({ id: 'n' })]) }));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false'); // 9/30 の答えは 10/1 に映らない
        expect(chip('w1', '洗車').disabled).toBe(false);
        // 知らせの日付は、送ったときの日付
        expect(bc.__sent).toEqual([{ event: 'evaluation_points_updated', payload: { date: '2026-09-30' } }]);
    });

    it.each([
        ['rejected', 'この項目は、今は付けられません'],
        ['blocked', 'この記録は取り消せません'],
    ])('送っている最中に日付を切り替えたあとで %s が返ったら: 断られたことは知らせる。新しい日付の読み込みは乱さない', async (result, message) => {
        // GET は 9/30 だけすぐ答える。10/1 の答えはあとで返す
        const route: Route = (c) => (isDayGet(c) && dayQuery(c).date === '2026-09-30' ? dayWithItems(c) : undefined);
        const { calls } = await open(route);
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        const putCall = calls.filter(isDayPut)[0];
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        const nextDayGet = calls.filter(isDayGet).find((g) => dayQuery(g).date === '2026-10-01') as Call;
        expect(nextDayGet.settled).toBe(false);
        const dayGetsBefore = calls.filter(isDayGet).length;

        await settle(putCall, ok({ result, member: dayMember('w1') }));
        expect(errors()).toEqual([message]);                          // 保存されていないことは知らせる
        expect(calls.filter(isDayGet).length).toBe(dayGetsBefore);   // 前の日付を読み直さない
        expect(bc.__sent).toEqual([]);

        // 10/1 の答えが届いたら、ふつうに出る（前の日付の読み直しで、捨てられていない）
        await settle(nextDayGet, ok(dayResponse('F1', '2026-10-01', ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord({ id: 'd2' })])])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
    });
});

// =====================================================================================
describe('E. 連打・result・エラー', () => {
    it('同じ瞬間に続けて押しても PUT は1回。送っているあいだ、そのボタンだけ押せない', async () => {
        const { calls } = await open(dayWithItems);
        const b = chip('w1', '洗車');
        // 画面が描き直される前の2回目・3回目（1回の act の中で続けて押す）
        await act(async () => { b.click(); b.click(); b.click(); });
        await flush();
        expect(calls.filter(isDayPut).length).toBe(1);
        expect(chip('w1', '洗車').disabled).toBe(true);
        fireEvent.click(chip('w1', '洗車'));
        expect(calls.filter(isDayPut).length).toBe(1);
        // ほかのボタンは押せる
        expect(chip('w1', 'ヘルプ').disabled).toBe(false);
        expect(chip('w2', '洗車').disabled).toBe(false);
        fireEvent.click(chip('w2', '洗車'));
        await flush();
        expect(calls.filter(isDayPut).length).toBe(2);
        // 応答が返ったら、また押せる。色は応答で変わる
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false');
        await settle(calls.filter(isDayPut)[0], ok({ result: 'added', member: dayMember('w1', true, [dayRecord({ id: 'n1' })]) }));
        expect(chip('w1', '洗車').disabled).toBe(false);
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
    });

    const putReply = (reply: (c: Call) => Reply): Route => (c) => dayWithItems(c) ?? (isDayPut(c) ? reply(c) : undefined);

    it('unchanged: トーストなし・知らせなし。応答の member で表示を置き換える', async () => {
        // 別の端末（管理者）が先に付けていた → 職長には鍵つきで出る
        await open(putReply(() => ok({ result: 'unchanged', member: dayMember('w1', true, [dayRecord({ id: 'x', createdBy: 'admin1', createdByName: '管理者', canRemove: false })]) })));
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        expect(errors()).toEqual([]);
        expect(notices()).toEqual([]);
        expect(bc.__sent).toEqual([]);
        const b = chip('w1', '洗車');
        expect([b.getAttribute('aria-pressed'), b.disabled, b.getAttribute('aria-disabled'), b.title]).toEqual(['true', false, 'true', '管理者さんが付けました']);
    });

    it('blocked: 「この記録は取り消せません」。記録は残ったまま、鍵に変わる', async () => {
        const route: Route = (c) => {
            if (isDayGet(c)) return ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord({ id: 'r1', canRemove: true })])]));
            // 画面では取り消せるように見えていたが、サーバーでは取り消せなかった
            if (isDayPut(c)) return ok({ result: 'blocked', member: dayMember('w1', true, [dayRecord({ id: 'r1', canRemove: false })]) });
            return undefined;
        };
        const { calls } = await open(route);
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        expect(calls.filter(isDayPut)[0].body?.on).toBe(false);
        expect(errors()).toEqual(['この記録は取り消せません']);
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        expect([chip('w1', '洗車').disabled, chip('w1', '洗車').getAttribute('aria-disabled')]).toEqual([false, 'true']);
        expect(bc.__sent).toEqual([]);
    });

    it('rejected: 「この項目は、今は付けられません」を出して、読み直す', async () => {
        let rejected = false;
        const route: Route = (c) => {
            if (isDayGet(c)) {
                // 断られたあとの読み直しでは、「洗車」が「使わない」になっている
                const items = rejected ? ITEMS.filter((i) => i.id !== 'wash') : ITEMS;
                return ok(dayResponse('F1', dayQuery(c).date, items, [dayMember('F1'), dayMember('w1')]));
            }
            if (isDayPut(c)) { rejected = true; return ok({ result: 'rejected', member: dayMember('w1') }); }
            return undefined;
        };
        const { calls } = await open(route);
        const before = calls.filter(isDayGet).length;
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        expect(errors()).toEqual(['この項目は、今は付けられません']);
        expect(calls.filter(isDayGet).length).toBe(before + 1); // 読み直した
        expect(within(screen.getByTestId('point-chips-w1')).queryByText('洗車')).toBeNull();
        expect(within(screen.getByTestId('point-chips-w1')).queryByText('ヘルプ')).not.toBeNull();
        expect(bc.__sent).toEqual([]);
    });

    const errorCases: [string, Reply, string][] = [
        ['400（errorResponse の形 { error }）', fail(400, { error: 'この日の班のメンバーではありません' }), 'この日の班のメンバーではありません'],
        ['400（error が無く details に文言）', fail(400, { details: '先の日付には付けられません' }), '先の日付には付けられません'],
        ['403', fail(403, { error: '他の職長の班の評価ポイントは扱えません' }), '他の職長の班の評価ポイントは扱えません'],
        ['500', fail(500, { error: '評価ポイントの保存に失敗しました' }), '評価ポイントの保存に失敗しました'],
        ['401', fail(401, { error: '認証が必要です' }), '評価ポイントの保存に失敗しました'],
        ['ネットワークエラー', networkError, '評価ポイントの保存に失敗しました'],
    ];

    it.each(errorCases)('%s: トーストを出す。ボタンは変わらず、また押せる。そのあとの「保存」は今までどおり', async (_name, reply, message) => {
        const { calls, container } = await open(putReply(() => reply));
        fireEvent.change(cardSelects(container)[2], { target: { value: '30' } });
        const attendanceBefore = calls.filter(isAttendanceCall).length;
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        expect(errors()).toEqual([message]);
        const b = chip('w1', '洗車');
        expect([b.getAttribute('aria-pressed'), b.disabled]).toEqual(['false', false]);
        expect(bc.__sent).toEqual([]);
        expect(calls.filter(isAttendanceCall).length).toBe(attendanceBefore);
        fireEvent.click(saveButton());
        await flush();
        expect(calls.filter((c) => c.method === 'POST').map((p) => p.body)).toEqual([EXPECTED_SAVE_BODY]);
    });
});

// =====================================================================================
describe('F. 出すもの・ボタンの状態', () => {
    const OWN_CAPTION = '自分の分は申請になります。管理者・マネージャーが認めると数えられます。';
    const INFO_LABEL = '評価ポイントの項目の説明';

    it('ボタンは「早出・朝積・残業・夕積・早終」の行の下。見出しの下の一文と (i) は1つだけ。自分のカードにだけ「申請になります」', async () => {
        const { container } = await open(dayWithItems);
        expect(chipsOf('pm1')).toBeNull();
        const chips = chipsOf('w1') as HTMLElement;
        // カードの中で、選択欄の行のすぐ後ろにある
        const selectsRow = chips.previousElementSibling as HTMLElement;
        expect(selectsRow.querySelectorAll('select').length).toBe(5);
        expect(within(chips).getByText('ポイント')).toBeTruthy();
        // 並び順は API が返した順
        expect(Array.from(chips.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['洗車', 'ヘルプ', '追加の現場']);
        // 指で押せる高さ（32px 以上）のクラスが付いている
        expect(chip('w1', '洗車').className).toContain('min-h-[32px]');

        const noticesInDom = container.querySelectorAll('[data-testid="point-notice"]');
        expect(noticesInDom.length).toBe(1);
        expect(noticesInDom[0].textContent).toContain('ポイントは、押すとすぐ保存されます（下の『保存』とは別です）');
        // 見出しの行（見出しと「全員定時」が並ぶ行）のすぐ下。見出しの行そのものには何も足していない
        const headingRow = noticesInDom[0].previousElementSibling as HTMLElement;
        expect(headingRow.textContent).toBe('積込・残業・早終全員定時');
        expect(headingRow.querySelectorAll('button').length).toBe(1);

        const tips = screen.getAllByLabelText(INFO_LABEL);
        expect(tips.length).toBe(1);
        expect(noticesInDom[0].contains(tips[0])).toBe(true);
        fireEvent.click(tips[0]);
        expect(document.body.textContent).toContain('洗車：現場の帰りに車を洗った');
        expect(document.body.textContent).toContain('追加の現場：予定に無い現場へ行った');
        expect(document.body.textContent).not.toContain('ヘルプ：');

        expect(within(chipsOf('F1') as HTMLElement).queryByText(OWN_CAPTION)).not.toBeNull();
        expect(within(chips).queryByText(OWN_CAPTION)).toBeNull();
    });

    it('説明のある項目が1つも無ければ (i) は出さない（一文は出す）', async () => {
        await open((c) => (isDayGet(c) ? ok(dayResponse('F1', dayQuery(c).date, [item('help', 'ヘルプ')], [dayMember('F1'), dayMember('w1')])) : undefined));
        expect(screen.queryByLabelText(INFO_LABEL)).toBeNull();
        expect(screen.queryByTestId('point-notice')).not.toBeNull();
    });

    it('items が空でも、記録のある人には、記録に写した名前でボタンを出す。取り消すと、ボタンも見出しも消える', async () => {
        const route: Route = (c) => {
            if (isDayGet(c)) return ok(dayResponse('F1', dayQuery(c).date, [], [dayMember('F1'), dayMember('w1', true, [dayRecord({ id: 'old', itemId: 'oldItem', itemName: '旧・運転' })]), dayMember('w2')]));
            if (isDayPut(c)) return ok({ result: 'removed', member: dayMember('w1') });
            return undefined;
        };
        const { calls, container } = await open(route);
        const b = chip('w1', '旧・運転');
        expect(b.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(b);
        await flush();
        expect(calls.filter(isDayPut)[0].body).toEqual({ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'oldItem', on: false });
        expectNoPointParts(container);
    });

    it('使用中の項目のあとに、「使わない」にした項目の記録が並ぶ（使用中は今の項目名、「使わない」は記録に写した名前）', async () => {
        await open((c) => (isDayGet(c)
            ? ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('w1', true, [
                dayRecord({ id: 'o', itemId: 'oldItem', itemName: '旧・運転' }),
                dayRecord({ id: 'w', itemId: 'wash', itemName: '洗車（前の名前）' }),
            ])]))
            : undefined));
        const buttons = Array.from((chipsOf('w1') as HTMLElement).querySelectorAll('button'));
        expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
            ['洗車', 'true'], ['ヘルプ', 'false'], ['追加の現場', 'false'], ['旧・運転', 'true'],
        ]);
    });

    /** 職長1 が開いている。自分の行: 確認待ち（取り下げられる）と、認められた記録（鍵）。作業員1 の行: 本人の申請（鍵）と、管理者が付けた記録（鍵） */
    const lockedDay: Route = (c) => (isDayGet(c) ? ok(dayResponse('F1', dayQuery(c).date, ITEMS, [
        dayMember('F1', true, [
            dayRecord({ id: 'p1', itemId: 'wash', status: 'pending', canRemove: true }),
            dayRecord({ id: 'c1', itemId: 'help', itemName: 'ヘルプ', canRemove: false }),
        ]),
        dayMember('w1', true, [
            dayRecord({ id: 'p2', itemId: 'wash', status: 'pending', createdBy: 'w1', createdByName: '作業員1', canRemove: false }),
            dayRecord({ id: 'c2', itemId: 'extra', itemName: '追加の現場', createdBy: 'admin1', createdByName: '管理者', canRemove: false }),
        ]),
    ])) : undefined);
    const hasLock = (b: HTMLElement) => b.querySelector('[data-testid="icon-Lock"]') !== null;

    it('付いていない＝白／確定＝ティール／確認待ち＝黄色＋「確認待ち」。取り消せない記録は鍵つき（disabled ではなく aria-disabled・title つき）', async () => {
        await open(lockedDay);
        const off = chip('w1', 'ヘルプ');
        expect([off.className.includes('bg-white'), off.disabled, off.getAttribute('aria-disabled'), off.title, hasLock(off)]).toEqual([true, false, null, '', false]);
        const ownPending = chip('F1', '洗車');
        expect([ownPending.className.includes('border-amber-400'), ownPending.textContent, ownPending.disabled, ownPending.getAttribute('aria-disabled'), ownPending.title, hasLock(ownPending)])
            .toEqual([true, '洗車確認待ち', false, null, '', false]);
        const ownConfirmed = chip('F1', 'ヘルプ');
        expect([ownConfirmed.className.includes('bg-teal-600'), ownConfirmed.disabled, ownConfirmed.getAttribute('aria-disabled'), ownConfirmed.title, hasLock(ownConfirmed)])
            .toEqual([true, false, 'true', '自分の分の記録は、自分では取り消せません', true]);
        const othersPending = chip('w1', '洗車');
        expect([othersPending.className.includes('border-amber-400'), othersPending.textContent, othersPending.disabled, othersPending.getAttribute('aria-disabled'), othersPending.title, hasLock(othersPending)])
            .toEqual([true, '洗車確認待ち', false, 'true', '作業員1さんが付けました', true]);
    });

    it('鍵つきのボタンを押すと、理由のトーストが出る。通信も confirm も出ない', async () => {
        const { calls } = await open(lockedDay);
        const before = calls.length;
        fireEvent.click(chip('F1', 'ヘルプ'));     // 自分の行の、もう取り消せない記録
        fireEvent.click(chip('w1', '洗車'));        // ほかの人の行の記録（確認待ち）
        fireEvent.click(chip('w1', '追加の現場'));  // ほかの人の行の記録（確定）
        await flush();
        expect(notices()).toEqual([
            '自分の分の記録は、自分では取り消せません',
            '作業員1さんが付けた記録です（取り消せるのは、付けた人と管理者・マネージャーです）',
            '管理者さんが付けた記録です（取り消せるのは、付けた人と管理者・マネージャーです）',
        ]);
        expect(calls.length).toBe(before);
        expect(errors()).toEqual([]);
        expect(confirmMock).not.toHaveBeenCalled();
        expect(bc.__sent).toEqual([]);
        expect(chip('F1', 'ヘルプ').getAttribute('aria-pressed')).toBe('true');
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
    });

    it('自分の確認待ちは、confirm なしで取り下げられる', async () => {
        const { calls } = await open((c) => lockedDay(c) ?? (isDayPut(c)
            ? ok({ result: 'removed', member: dayMember('F1', true, [dayRecord({ id: 'c1', itemId: 'help', itemName: 'ヘルプ', canRemove: false })]) })
            : undefined));
        fireEvent.click(chip('F1', '洗車'));
        await flush();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(notices()).toEqual([]);
        expect(calls.filter(isDayPut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'F1', itemId: 'wash', on: false }]);
        expect(chip('F1', '洗車').getAttribute('aria-pressed')).toBe('false');
    });

    it('送っているあいだだけ disabled になる（鍵つきのボタンは、そのあいだも押せば理由が出る）', async () => {
        const { calls } = await open(lockedDay); // PUT には答えない＝送っている最中のまま
        fireEvent.click(chip('F1', '洗車'));
        await flush();
        expect(chip('F1', '洗車').disabled).toBe(true);
        expect(chip('F1', 'ヘルプ').disabled).toBe(false);
        fireEvent.click(chip('F1', 'ヘルプ'));
        expect(notices()).toEqual(['自分の分の記録は、自分では取り消せません']);
        expect(calls.filter(isDayPut).length).toBe(1);
    });

    it('管理者・マネージャーでも、自分の行にある「ほかの人が付けた確定の記録」は「自分では取り消せません」（付けた人の名前の文言にしない）', async () => {
        mockSessionUser = { id: 'admin1', role: 'admin', name: '管理者', username: 'admin' };
        const route: Route = (c) => (isDayGet(c) ? ok(dayResponse('admin1', dayQuery(c).date, ITEMS, [
            dayMember('admin1', true, [
                dayRecord({ id: 'a1', itemId: 'wash', createdBy: 'F1', createdByName: '職長1', canRemove: false }),
                dayRecord({ id: 'a2', itemId: 'help', itemName: 'ヘルプ', createdBy: 'mgr1', createdByName: 'マネージャー', canRemove: false }),
            ]),
        ])) : undefined);
        const { calls } = await open(route, { foremanId: 'admin1' });
        const before = calls.length;
        for (const label of ['洗車', 'ヘルプ']) {
            const b = chip('admin1', label);
            expect([label, b.disabled, b.getAttribute('aria-disabled'), b.title, hasLock(b)]).toEqual([label, false, 'true', '自分の分の記録は、自分では取り消せません', true]);
            fireEvent.click(b);
        }
        await flush();
        expect(notices()).toEqual(['自分の分の記録は、自分では取り消せません', '自分の分の記録は、自分では取り消せません']);
        expect(calls.length).toBe(before);
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('他の人が付けた記録を取り消すときは confirm を出す（いいえ なら送らない）。鍵にはならない', async () => {
        mockSessionUser = { id: 'admin1', role: 'admin', name: '管理者', username: 'admin' };
        const route: Route = (c) => {
            if (isDayGet(c) && dayQuery(c).foremanId === 'F1') return ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord({ id: 'r1', canRemove: true })])]));
            if (isDayGet(c)) return ok(dayResponse(dayQuery(c).foremanId, dayQuery(c).date, [], []));
            if (isDayPut(c)) return ok({ result: 'removed', member: dayMember('w1') });
            return undefined;
        };
        const { calls } = await open(route);
        const b = chip('w1', '洗車');
        expect([b.getAttribute('aria-disabled'), b.title, hasLock(b)]).toEqual([null, '', false]);
        confirmMock.mockImplementationOnce(() => false);
        fireEvent.click(b);
        await flush();
        expect(confirmMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['職長1さんが付けた記録です。取り消しますか？']);
        expect(calls.filter(isDayPut).length).toBe(0);
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        expect(calls.filter(isDayPut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'wash', on: false }]);
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false');
        expect(notices()).toEqual([]);
    });
});

// =====================================================================================
describe('G. 別の端末からの知らせ', () => {
    it('evaluation_points_updated を受けたら読み直す（日付の違う知らせでは読み直さない）。閉じたら聞くのをやめる', async () => {
        let version = 1;
        const route: Route = (c) => (isDayGet(c)
            ? ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1', true, version >= 2 ? [dayRecord({ id: 'x', createdBy: 'admin1', createdByName: '管理者', canRemove: false })] : [])]))
            : undefined);
        const calls = installFetch((c) => attendanceRoute(c) ?? route(c));
        const utils = render(modalElement(false));
        expect(bc.__listenerCount('evaluation_points_updated')).toBe(0);
        utils.rerender(modalElement(true));
        await flush();
        expect(bc.__listenerCount('evaluation_points_updated')).toBe(1);
        const before = calls.filter(isDayGet).length;

        await act(async () => { bc.__emit('evaluation_points_updated', { date: '2026-10-02' }); });
        await flush();
        expect(calls.filter(isDayGet).length).toBe(before); // 日付の違う知らせ

        version = 2;
        await act(async () => { bc.__emit('evaluation_points_updated', { date: '2026-09-30' }); });
        expect(chipsOf('w1')).not.toBeNull(); // 読み直しているあいだも、前の内容は出したまま
        await flush();
        expect(calls.filter(isDayGet).length).toBe(before + 1);
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');

        await act(async () => { bc.__emit('evaluation_points_updated', {}); }); // 日付の無い知らせ（「評価ポイント」の画面から）
        await flush();
        expect(calls.filter(isDayGet).length).toBe(before + 2);

        const attendanceCalls = calls.filter(isAttendanceCall).length;
        utils.rerender(modalElement(false));
        await flush();
        expect(bc.__listenerCount('evaluation_points_updated')).toBe(0);
        expect(calls.filter(isAttendanceCall).length).toBe(attendanceCalls); // 知らせで出勤簿は読み直さない
    });

    it('読み直しに失敗しても、前に読めた内容は出したまま（トーストも出さない）。押せば今までどおり送れる', async () => {
        let failNow = false;
        const route: Route = (c) => {
            if (isDayGet(c)) return failNow ? fail(500) : ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord()])]));
            if (isDayPut(c)) return ok({ result: 'removed', member: dayMember('w1') });
            return undefined;
        };
        const { calls } = await open(route);
        failNow = true;
        await act(async () => { bc.__emit('evaluation_points_updated', { date: '2026-09-30' }); });
        await flush();
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        expect(errors()).toEqual([]);
        expect((logger.error as jest.Mock).mock.calls.length).toBe(1);
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        expect(calls.filter(isDayPut).length).toBe(1);
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('false');
    });

    it('読み直しの途中で済んだ保存の表示が、保存より前に始まっていた読み直しの答えで巻き戻らない', async () => {
        let hold = false;
        const route: Route = (c) => {
            if (isDayGet(c)) return hold ? undefined : ok(dayResponse('F1', dayQuery(c).date, ITEMS, [dayMember('F1'), dayMember('w1')]));
            return undefined;
        };
        const { calls } = await open(route);
        hold = true;
        await act(async () => { bc.__emit('evaluation_points_updated', { date: '2026-09-30' }); }); // 読み直しが走り出す（答えはまだ）
        const reload = calls.filter(isDayGet).slice(-1)[0];
        expect(reload.settled).toBe(false);
        fireEvent.click(chip('w1', '洗車'));
        await flush();
        await settle(calls.filter(isDayPut)[0], ok({ result: 'added', member: dayMember('w1', true, [dayRecord({ id: 'n1' })]) }));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        // 保存より前に始まっていた読み直しの答え（まだ付いていない状態）が後から届く
        await settle(reload, ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1')])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        // 保存のあとで、追い越すための読み直しが1回走っている。その答え（別の端末が w2 にも付けていた）で最新になる
        const newer = calls.filter(isDayGet).slice(-1)[0];
        expect(newer).not.toBe(reload);
        await settle(newer, ok(dayResponse('F1', '2026-09-30', ITEMS, [dayMember('F1'), dayMember('w1', true, [dayRecord({ id: 'n1' })]), dayMember('w2', true, [dayRecord({ id: 'n2' })])])));
        expect(chip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        expect(chip('w2', '洗車').getAttribute('aria-pressed')).toBe('true');
    });
});

// =====================================================================================
describe('H. フックを直接確かめる（描画のたびの値）', () => {
    it('日付を切り替えた直後の最初の描画から、前の日付の内容を出さない', async () => {
        const seen: { dateKey: string; shows: boolean }[] = [];
        function Probe({ dateKey }: { dateKey: string }) {
            const pointDay = useEvaluationPointDay({ enabled: true, foremanId: 'F1', dateKey });
            seen.push({ dateKey, shows: pointDay.showsChips('w1') });
            return null;
        }
        // 9/30 だけすぐ答える。10/1 の答えは届かない
        installFetch((c) => (isDayGet(c) && dayQuery(c).date === '2026-09-30' ? dayWithItems(c) : undefined));
        const utils = render(<Probe dateKey="2026-09-30" />);
        await flush();
        expect(seen[seen.length - 1]).toEqual({ dateKey: '2026-09-30', shows: true });

        utils.rerender(<Probe dateKey="2026-10-01" />);
        await flush();
        // 10/1 に切り替えてからの描画は、1回目から全部「出さない」
        const after = seen.filter((x) => x.dateKey === '2026-10-01');
        expect(after.length).toBeGreaterThan(0);
        expect(after.map((x) => x.shows)).toEqual(after.map(() => false));
    });
});
