/**
 * 「出勤簿入力」（AttendanceModal）に足した、手当のボタンのテスト。
 *
 * 対象:
 *   - hooks/useAllowanceDay.ts（読み込み・保存・エラーの扱い）
 *   - components/Attendance/AttendanceAllowanceChips.tsx（ボタンの見た目と、見出しの下の一文）
 *   - components/Attendance/AttendanceModal.tsx に足した5行（import 2行・フックの呼び出し・一文・ボタン）
 *
 * いちばん守りたい約束:
 *   A. 付けられる手当が無い・読み込みに失敗した・対象外の人 のときは、手当の部品を1つも出さない（出勤簿の画面は今までどおり）
 *   B. だれに・どの区分（職長／職長以外）・いくらで付けられるかは、API の答え（members[].offers）のとおりに出す
 *      （画面では決めない。その日の手配で決まる）。記録があるボタンは、記録に入っている金額
 *   C. ボタンを押しても出勤簿の API（/api/attendance）を呼ばない。「保存」で送る中身も変わらない
 *   D. 古い答え（前の日付・前の職長・保存より前の状態・あとから別の保存に追い越された応答）を、ボタンの表示に使わない
 *      保存の応答の「締めてあるか」が、画面に出している内容と違っていたら、読み直す
 *   F. 評価ポイントのボタンと、たがいに邪魔をしない（通信も知らせも別々）
 *
 * fetch はテストごとに差し替える（出勤簿の API は決まった答え。/api/allowances/day はテストごとに答えを変え、
 * 答えを遅らせることもできる）。本物の DB・API にはつながない。
 * 同じ画面が同時に読む評価ポイントの API（/api/evaluation-points/day）には、ことわりが無ければ「項目なし」を返す。
 * 「今日」は 2026-10-02 に固定する（開いた直後に、開く前の日付＝今日ぶんの読み込みが1回走るので、本物の時計に頼らない）。
 */
import React from 'react';
import { render, screen, within, act, fireEvent, cleanup } from '@testing-library/react';
import toast from 'react-hot-toast';
import AttendanceModal from '@/components/Attendance/AttendanceModal';
import {
    useAllowanceDay,
    type AllowanceDay,
    type AllowanceDayItem,
    type AllowanceDayMember,
    type AllowanceDayOffer,
    type AllowanceDayRecord,
} from '@/hooks/useAllowanceDay';
import * as broadcastChannel from '@/lib/broadcastChannel';
import { ALLOWANCE_NO_RATE_MESSAGE } from '@/lib/allowances';
import { logger } from '@/lib/logger';

// ---------------------------------------------------------------- モック

interface SessionUser { id: string; role: string; name: string; username: string }
const FOREMAN_F1: SessionUser = { id: 'F1', role: 'foreman2', name: '職長1', username: 'f1' };
const ADMIN: SessionUser = { id: 'admin1', role: 'admin', name: '管理者', username: 'admin' };
let mockSessionUser: SessionUser = FOREMAN_F1;
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
    initBroadcastChannel: jest.Mock;
    __sent: { event: string; payload: Record<string, unknown> }[];
    __emit: (event: string, payload?: Record<string, unknown>) => void;
    __listenerCount: (event: string) => number;
};
const toastMock = toast as unknown as jest.Mock & { success: jest.Mock; error: jest.Mock };
const confirmMock = jest.fn(() => true);

/** 手当の知らせ（broadcast）の名前。評価ポイントの知らせ（evaluation_points_updated）とは別 */
const ALLOWANCE_EVENT = 'allowances_updated';
const POINT_EVENT = 'evaluation_points_updated';

// ---------------------------------------------------------------- 時計

/** 端末の「今日」。開いた直後に、この日付ぶんの読み込みが1回先に走る */
const TODAY = '2026-10-02';
/** 「今」を固定する（Date だけを差し替える。タイマーや Promise の動きは本物のまま）。戻すのは jest.useRealTimers() */
const freezeNow = () =>
    jest.useFakeTimers({
        now: new Date(2026, 9, 2, 10, 0, 0),
        doNotFake: [
            'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
            'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
            'setTimeout', 'clearTimeout',
        ],
    });

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
type Reply =
    | { kind: 'json'; status: number; data: unknown }
    | { kind: 'not-json'; status: number }
    | { kind: 'network-error' };
/** undefined を返した呼び出しは「まだ答えない」（あとで settle で答える） */
type Route = (call: Call) => Reply | undefined;

const ok = (data: unknown): Reply => ({ kind: 'json', status: 200, data });
const fail = (status: number, data: unknown = { error: `status ${status}` }): Reply => ({ kind: 'json', status, data });
/** 答えが JSON でない（ログイン画面や、サーバーの手前のエラーページが返ったとき） */
const notJson = (status: number): Reply => ({ kind: 'not-json', status });
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
                    if (r.kind === 'network-error') {
                        reject(new TypeError('Failed to fetch'));
                        return;
                    }
                    const data = r.kind === 'json' ? r.data : undefined;
                    const broken = r.kind === 'not-json';
                    resolve({
                        ok: r.status < 400,
                        status: r.status,
                        json: async () => {
                            if (broken) throw new SyntaxError('Unexpected token < in JSON at position 0');
                            return data;
                        },
                    } as Response);
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
    // 職長2 の班: 役職が職長の「職長1」が、この日は班の1人として入っている
    F2: [member('F2', '職長2', 'FOREMAN1', 1), member('w1', '作業員1', 'WORKER', 2), member('F1', '職長1', 'FOREMAN2', 3)],
    admin1: [member('admin1', '管理者', 'ADMIN', null)],
};
const attendance = (userId: string, over: Record<string, unknown> = {}) =>
    ({ userId, earlyStartMinutes: 0, morningLoadingMinutes: 0, overtimeMinutes: 0, eveningLoadingMinutes: 0, earlyEndTime: null, ...over });
const attendanceByKey: Record<string, ReturnType<typeof attendance>[]> = {
    'F1|2026-09-30': [attendance('F1'), attendance('w1', { overtimeMinutes: 60, earlyEndTime: '16:30' }), attendance('w2', { morningLoadingMinutes: 30 })],
    'F1|2026-10-01': [attendance('F1', { eveningLoadingMinutes: 15 })],
};
const foremen = [member('F1', '職長1', 'FOREMAN2', 1), member('F2', '職長2', 'FOREMAN1', 2), member('admin1', '管理者', 'ADMIN', null)];

/** 出勤簿の API（今あるもの）の答え。手当・評価ポイントの API は undefined を返して、テストごとの route に任せる */
function attendanceRoute(call: Call): Reply | undefined {
    if (call.path === '/api/dispatch/foremen') return ok(foremen);
    if (call.path === '/api/attendance/members') return ok(membersByForeman[call.query.get('foremanId') ?? ''] ?? []);
    if (call.path === '/api/attendance' && call.method === 'GET') return ok(attendanceByKey[`${call.query.get('foremanId')}|${call.query.get('date')}`] ?? []);
    if (call.path === '/api/attendance' && call.method === 'POST') return ok([]);
    return undefined;
}

/** F1・2026-09-30 で、職長1 の残業を 30分に変えて「保存」したときに送る中身（手当・評価ポイントを足す前から変わらない形） */
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

const isAttendanceCall = (c: Call) => c.path.startsWith('/api/attendance');
const isAllowanceGet = (c: Call) => c.path === '/api/allowances/day' && c.method === 'GET';
const isAllowancePut = (c: Call) => c.path === '/api/allowances/day' && c.method === 'PUT';
const isPointGet = (c: Call) => c.path === '/api/evaluation-points/day' && c.method === 'GET';
const isPointPut = (c: Call) => c.path === '/api/evaluation-points/day' && c.method === 'PUT';
const describeCall = (c: Call) => `${c.method} ${c.url}`;
const dayQuery = (c: Call) => ({ foremanId: c.query.get('foremanId') ?? '', date: c.query.get('date') ?? '' });
const crewIds = (foremanId: string) => (membersByForeman[foremanId] ?? []).map((m) => m.id);

// ---------------------------------------------------------------- 手当の側のデータ

/** 大規模手当: その日の班の職長 1,500円・職長以外 200円 */
const LARGE: AllowanceDayItem = { id: 'large', name: '大規模手当', description: '工事内容が「大規模」の現場に入った日', foremanAmount: 1500, memberAmount: 200 };
/** 2つめの手当（説明なし）: 職長 800円・職長以外 500円 */
const FAR: AllowanceDayItem = { id: 'far', name: '遠方手当', description: null, foremanAmount: 800, memberAmount: 500 };

/** 記録の1件。何も指定しなければ「職長1 が、ほかの人に付けた大規模手当（職長以外・200円・確定・取り消せる）」 */
const rec = (over: Partial<AllowanceDayRecord> = {}): AllowanceDayRecord => ({
    id: 'r1', itemId: 'large', itemName: '大規模手当', payRole: 'member', amount: 200,
    status: 'confirmed', createdBy: 'F1', createdByName: '職長1', canRemove: true, ...over,
});
/** その人に付けられる手当（offers）。本物の API と同じく、区分が職長なら職長の金額・職長以外なら職長以外の金額 */
const offersOf = (payRole: 'foreman' | 'member', items: AllowanceDayItem[]): AllowanceDayOffer[] =>
    items.map((i) => ({ itemId: i.id, payRole, amount: payRole === 'foreman' ? i.foremanAmount : i.memberAmount }));
/**
 * GET の members の1人ぶん。items = その人に付けられる手当（省くと「大規模手当」だけ。締めた月・付けられない日は [] を渡す）。
 * この見本では、班の全員が対象の現場の手配に入っていて、職長本人だけ区分が foreman。協力メンバーは対象外（付けられる手当も無い）
 */
const allowanceMember = (foremanId: string, userId: string, records: AllowanceDayRecord[] = [], items: AllowanceDayItem[] = [LARGE]): AllowanceDayMember =>
    ({ userId, eligible: userId !== 'pm1', offers: userId === 'pm1' ? [] : offersOf(userId === foremanId ? 'foreman' : 'member', items), records });
type RecordsByUser = Record<string, AllowanceDayRecord[]>;
/** その職長の班の全員ぶん（records = 人ごとの記録。items = 付けられる手当） */
const crew = (foremanId: string, records: RecordsByUser = {}, items: AllowanceDayItem[] = [LARGE]): AllowanceDayMember[] =>
    crewIds(foremanId).map((id) => allowanceMember(foremanId, id, records[id] ?? [], items));
const allowanceResponse = (foremanId: string, date: string, items: AllowanceDayItem[], members: AllowanceDayMember[], monthClosed = false) =>
    ({ date, foremanId, monthClosed, items, members });

/** 手当の GET /day にだけ、決めた答えを返す（undefined なら、まだ答えない） */
const onAllowanceGet = (reply: (c: Call) => Reply | undefined): Route => (c) => (isAllowanceGet(c) ? reply(c) : undefined);
/** 手当の GET /day に、聞かれた職長の班の全員ぶんを返す。items を省くと「大規模手当」だけ */
const allowanceGet = (records: RecordsByUser = {}, items: AllowanceDayItem[] = [LARGE], monthClosed = false): Route =>
    onAllowanceGet((c) => ok(allowanceResponse(dayQuery(c).foremanId, dayQuery(c).date, items, crew(dayQuery(c).foremanId, records, items), monthClosed)));
/** PUT /day の応答の member: その人の、保存のあとの記録だけ（本物の API は、ボタン＝offers・eligible を返さない） */
const putMember = (updated: AllowanceDayMember) => ({ userId: updated.userId, records: updated.records });
/** PUT /day の応答 */
const putResult = (result: string, updated: AllowanceDayMember, monthClosed = false): Reply => ok({ result, monthClosed, member: putMember(updated) });

// ---------------------------------------------------------------- 評価ポイントの側のデータ（同じ画面が同時に読む）

interface PointItem { id: string; name: string; description: string | null }
interface PointRecord { id: string; itemId: string; itemName: string; status: 'confirmed' | 'pending'; createdBy: string; createdByName: string; canRemove: boolean }
const pointRecord = (over: Partial<PointRecord> = {}): PointRecord =>
    ({ id: 'p1', itemId: 'wash', itemName: '洗車', status: 'confirmed', createdBy: 'F1', createdByName: '職長1', canRemove: true, ...over });
const pointMember = (userId: string, records: PointRecord[] = []) => ({ userId, eligible: userId !== 'pm1', records });
const pointsGet = (items: PointItem[]): Route => (c) => {
    if (!isPointGet(c)) return undefined;
    const { foremanId, date } = dayQuery(c);
    return ok({ date, foremanId, items, members: crewIds(foremanId).map((id) => pointMember(id)) });
};
const POINT_ITEMS: PointItem[] = [{ id: 'wash', name: '洗車', description: '現場の帰りに車を洗った' }, { id: 'help', name: 'ヘルプ', description: null }];
/** 評価ポイント: 項目なし（評価ポイントの部品は出ない） */
const pointsWithoutItems = pointsGet([]);
/** 評価ポイント: 項目あり・だれも記録なし */
const pointsWithItems = pointsGet(POINT_ITEMS);
/** 評価ポイント: 答えを返さない */
const pointsSilent: Route = () => undefined;

// ---------------------------------------------------------------- 画面の操作

const D930 = new Date(2026, 8, 30);

interface OpenProps { date?: Date; foremanId?: string; onSaved?: () => void; onClose?: () => void; points?: Route }
const modalElement = (isOpen: boolean, props: OpenProps = {}) => (
    <AttendanceModal
        isOpen={isOpen}
        onClose={props.onClose ?? (() => undefined)}
        initialDate={isOpen ? props.date ?? new Date(D930) : undefined}
        initialForemanId={isOpen ? props.foremanId ?? 'F1' : undefined}
        onSaved={props.onSaved}
    />
);

/** 答えを探す順: 出勤簿（決まった答え）→ テストごとの route → 評価ポイント（ことわりが無ければ「項目なし」） */
const routeOf = (route: Route, points: Route = pointsWithoutItems): Route => (c) => attendanceRoute(c) ?? route(c) ?? points(c);

/** モーダルを F1・2026-09-30 で開く（AttendancePage と同じ: 閉じた状態で置いてあるものを、対象を入れて開く） */
async function open(route: Route, props: OpenProps = {}) {
    const calls = installFetch(routeOf(route, props.points));
    const utils = render(modalElement(false));
    utils.rerender(modalElement(true, props));
    await flush();
    return { calls, ...utils };
}

const errors = () => toastMock.error.mock.calls.map((c) => c[0] as string);
/** toast('…')（エラーでも成功でもない、ふつうのトースト）で出した文言 */
const notices = () => toastMock.mock.calls.map((c) => c[0] as string);
const successes = () => toastMock.success.mock.calls.map((c) => c[0] as string);
const logged = () => (logger.error as jest.Mock).mock.calls.map((c) => c[0] as string);

const chipsOf = (userId: string) => screen.queryByTestId(`allowance-chips-${userId}`);
const chip = (userId: string, label: string) => within(screen.getByTestId(`allowance-chips-${userId}`)).getByText(label).closest('button') as HTMLButtonElement;
/** その人のカードに並んでいる手当のボタンの文字（左から）。手当の部品が出ていなければ null */
const chipTexts = (userId: string) => {
    const el = chipsOf(userId);
    return el ? Array.from(el.querySelectorAll('button')).map((b) => b.textContent) : null;
};
const pointChipsOf = (userId: string) => screen.queryByTestId(`point-chips-${userId}`);
const pointChip = (userId: string, label: string) => within(screen.getByTestId(`point-chips-${userId}`)).getByText(label).closest('button') as HTMLButtonElement;
const saveButton = () => screen.getByText('保存').closest('button') as HTMLButtonElement;

/** ボタンの色（className に入っている Tailwind のクラス）: 付いていない＝白／確定＝ティール／確認待ち＝黄色 */
const TONE_OFF = 'bg-white';
const TONE_CONFIRMED = 'bg-teal-600';
const TONE_PENDING = 'border-amber-400';
const hasLock = (b: HTMLElement) => b.querySelector('[data-testid="icon-Lock"]') !== null;
/** ボタン1つの状態を、見比べやすい形にする */
const look = (b: HTMLButtonElement) => ({
    text: b.textContent,
    pressed: b.getAttribute('aria-pressed'),
    tone: [TONE_OFF, TONE_CONFIRMED, TONE_PENDING].filter((t) => b.className.split(' ').includes(t)).join(' '),
    disabled: b.disabled,
    ariaDisabled: b.getAttribute('aria-disabled'),
    title: b.title,
    lock: hasLock(b),
});
/** 送っているあいだの見た目（押せない・うすい色）か */
const isSending = (b: HTMLButtonElement) => [b.disabled, b.className.split(' ').includes('opacity-60')];

/** メンバーのカードの中の選択欄（早出・朝積・残業・夕積・早終 が人数ぶん並ぶ）。「職長選択」の欄は数えない */
const cardSelects = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('select')).filter((el) => ['早出', '朝積', '残業', '夕積', '早終'].includes(el.previousElementSibling?.textContent ?? ''));
/** メンバーのカード（1人ぶんの枠）。「早出」の選択欄から上へたどる: 選択欄 → ラベルつきの枠 → 選択欄の行 → カード */
const cardsOf = (container: HTMLElement) =>
    cardSelects(container)
        .filter((el) => el.previousElementSibling?.textContent === '早出')
        .map((el) => el.parentElement?.parentElement?.parentElement as HTMLElement);
/** 「職長選択」の欄（管理者・マネージャーにだけ出る） */
const foremanSelect = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('select')).find((el) => el.previousElementSibling?.textContent === '職長選択') as HTMLSelectElement;

/** 手当の部品（ボタンの行・見出しの下の一文・説明の吹き出し）が、画面に1つも無いこと */
const expectNoAllowanceParts = () => {
    expect(document.querySelectorAll('[data-testid^="allowance-"]').length).toBe(0);
    expect(document.body.textContent).not.toContain('手当');
};
/**
 * 出勤簿の画面が、手当を足す前と同じ並びであること（評価ポイントの部品も出ていないとき用）:
 * 手当の部品が1つも無く、カードの中は「名前の行」と「選択欄の行」だけ。見出しの行のすぐ下が、カードの並び
 */
const expectAsBefore = (container: HTMLElement) => {
    expectNoAllowanceParts();
    const cards = cardsOf(container);
    expect(cards.map((card) => card.children.length)).toEqual([2, 2, 2, 2]);
    expect(cards[0].parentElement?.previousElementSibling?.textContent).toBe('積込・残業・早終全員定時');
};

const OWN_CAPTION = '自分の手当は確認待ちになります。管理者・マネージャーが認めると、手当に入ります。';
/** 保存を断られたときの文言（result ごと） */
const INACTIVE_TOAST = 'この手当は「使わない」になっています';
const NOT_TARGET_TOAST = 'この人は、この日、この班の「手当の対象の現場」の手配に入っていません';
const NOT_FOUND_TOAST = 'この手当は見つかりません';
const CLOSED_REASON = 'この月の手当は締めてあります';
const NOTICE = '手当は、押すとすぐ保存されます（下の『保存』とは別です）';
const INFO_LABEL = '手当の説明';

beforeEach(() => {
    freezeNow();
    mockSessionUser = FOREMAN_F1;
    jest.clearAllMocks();
    bc.__sent.length = 0;
    confirmMock.mockImplementation(() => true);
    window.confirm = confirmMock;
});
afterEach(() => {
    cleanup();
    jest.useRealTimers();
});

// =====================================================================================
describe('A. 出す条件に合わないときは、手当の部品を1つも出さない（出勤簿の画面は今までどおり）', () => {
    const allowanceCases: [string, Route][] = [
        ['その日に付けられる手当が無い（items が空で、記録も無い）', allowanceGet({}, [])],
        ['先の日付など（items も members も空）', onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [], [])))],
        ['手当はあるが、班の人が1人も返ってこない', onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], [])))],
        ['手当はあるが、班の全員が対象外', onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], crew('F1').map((m) => ({ ...m, eligible: false })))))],
        ['手当はあるが、だれにも付けられない（全員の offers が空で、記録も無い）', onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], crew('F1', {}, []))))],
        ['対象かどうか（eligible）が入っていない人ばかり', onAllowanceGet((c) => ok({
            date: dayQuery(c).date, foremanId: 'F1', monthClosed: false, items: [LARGE],
            members: crew('F1').map(({ userId, offers, records }) => ({ userId, offers, records })),
        }))],
        ['答えに items も members も入っていない', onAllowanceGet(() => ok({}))],
        ['読み込みの答えが返ってこない', () => undefined],
        ['読み込みが 500', onAllowanceGet(() => fail(500))],
        ['読み込みが 403', onAllowanceGet(() => fail(403, { error: '権限がありません' }))],
        ['読み込みがネットワークエラー', onAllowanceGet(() => networkError)],
        ['読み込みの答えが JSON でない', onAllowanceGet(() => notJson(200))],
    ];
    const pointCases: [string, Route][] = [['項目なし', pointsWithoutItems], ['答えが返ってこない', pointsSilent]];
    const cases = allowanceCases.flatMap(([name, route]) =>
        pointCases.map(([pointName, points]): [string, string, Route, Route] => [name, pointName, route, points]));

    it.each(cases)('%s（評価ポイントは「%s」）: 開いた直後・値を変えた後・コピーの後・全員定時の後・日付を切り替えた後 のどこでも出ない。トーストも出ない', async (_name, _pointName, route, points) => {
        const { calls, container } = await open(route, { points });
        expect(screen.queryAllByText('作業員1').length).toBe(1); // 出勤簿のメンバーは出ている
        expectAsBefore(container);
        fireEvent.change(cardSelects(container)[0], { target: { value: '45' } }); // 早出を 45分に
        expectAsBefore(container);
        fireEvent.click(screen.getByText('他のメンバーへコピー'));
        expectAsBefore(container);
        fireEvent.click(screen.getByText('全員定時'));
        expectAsBefore(container);
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        expectAsBefore(container);
        expect([errors(), notices()]).toEqual([[], []]);
        expect(successes()).toEqual(['他のメンバーへコピーしました']); // 出勤簿の、今までどおりのトーストだけ

        // 出勤簿の API への通信（URL と順番）は、手当を足す前と同じ。
        // 開いた直後は、開く前の日付（今日）ぶんの読み込みが1回先に走る（手当を足す前からの動き）
        expect(calls.filter(isAttendanceCall).map(describeCall)).toEqual([
            `GET /api/attendance/members?foremanId=F1&date=${TODAY}`,
            `GET /api/attendance?foremanId=F1&date=${TODAY}`,
            'GET /api/attendance/members?foremanId=F1&date=2026-09-30',
            'GET /api/attendance?foremanId=F1&date=2026-09-30',
            'GET /api/attendance/members?foremanId=F1&date=2026-10-01',
            'GET /api/attendance?foremanId=F1&date=2026-10-01',
        ]);
        // 増える通信は、評価ポイントと手当の GET /day だけ。手当は、日付ごとに1回ずつ
        expect(calls.filter((c) => !isAttendanceCall(c)).every((c) => isPointGet(c) || isAllowanceGet(c))).toBe(true);
        expect(calls.filter(isAllowanceGet).map(describeCall)).toEqual([
            `GET /api/allowances/day?foremanId=F1&date=${TODAY}`,
            'GET /api/allowances/day?foremanId=F1&date=2026-09-30',
            'GET /api/allowances/day?foremanId=F1&date=2026-10-01',
        ]);
    });

    const failures: [string, Reply][] = [
        ['500', fail(500)],
        ['403', fail(403, { error: '権限がありません' })],
        ['ネットワークエラー', networkError],
        ['JSON でない答え', notJson(200)],
    ];
    it.each(failures)('読み込みが %s: 失敗したことは logger.error にだけ出す（文言は「手当の読み込みに失敗:」）', async (_name, reply) => {
        await open(onAllowanceGet(() => reply));
        // 開いた直後に先に走った、前の日付（今日）ぶんの読み込みの失敗は、古い答えなので出さない
        expect(logged()).toEqual(['手当の読み込みに失敗:']);
        expect((logger.error as jest.Mock).mock.calls[0][1]).toBeInstanceOf(Error);
        expect([errors(), notices(), successes()]).toEqual([[], [], []]);
    });

    it('班の全員が対象の現場の手配に入っているとき: 対象の人の全員のカードに出る。対象外の人（協力会社のメンバー）のカードには出ない', async () => {
        const { container } = await open(allowanceGet());
        expect([chipTexts('F1'), chipTexts('w1'), chipTexts('w2')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円']]);
        expect(chipTexts('pm1')).toBeNull();
        // 対象外の人のカードは、今までどおり（名前の行と選択欄の行だけ）
        expect(cardsOf(container).map((card) => card.children.length)).toEqual([3, 3, 3, 2]);
    });

    it('同じ班の中で、付けられる人（offers がある）と付けられない人（offers が空）が混ざるとき: 付けられる人のカードにだけ出る。offers も記録も無い人のカードには、何も足さない', async () => {
        // 作業員2 は、この職長の「対象でない現場」にだけ入っている（API は offers を空で返す）
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], [
            allowanceMember('F1', 'F1'), allowanceMember('F1', 'w1'), allowanceMember('F1', 'w2', [], []), allowanceMember('F1', 'pm1'),
        ])));
        const { container } = await open(route);
        expect([chipTexts('F1'), chipTexts('w1')]).toEqual([['大規模手当1,500円'], ['大規模手当200円']]);
        expect([chipTexts('w2'), chipTexts('pm1')]).toEqual([null, null]);
        expect(cardsOf(container).map((card) => card.children.length)).toEqual([3, 3, 2, 2]);
        // 見出しの下の一文は、だれか1人にでも出ていれば出す
        expect(screen.getByTestId('allowance-notice').textContent).toBe(NOTICE);
    });

    it('職長本人でも、offers が無ければ、自分のカードには出ない（ほかの人にだけ付けられる日）。「自分の手当は確認待ちになります…」も出さない', async () => {
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], [
            allowanceMember('F1', 'F1', [], []), allowanceMember('F1', 'w1'), allowanceMember('F1', 'w2'), allowanceMember('F1', 'pm1'),
        ])));
        await open(route);
        expect(chipTexts('F1')).toBeNull();
        expect([chipTexts('w1'), chipTexts('w2')]).toEqual([['大規模手当200円'], ['大規模手当200円']]);
        expect(screen.queryByText(OWN_CAPTION)).toBeNull();
    });

    it('offers・records が入っていない古い形の答え（members[].payRole だけ）でも落ちない。ボタンは、記録のある人に、記録の分だけ出る', async () => {
        const route = onAllowanceGet((c) => ok({
            date: dayQuery(c).date, foremanId: 'F1', monthClosed: false, items: [LARGE],
            members: [
                { userId: 'F1', eligible: true, payRole: 'foreman' },
                { userId: 'w1', eligible: true, payRole: 'member', records: [rec({ id: 'old1', amount: 150 })] },
                { userId: 'w2', eligible: true, payRole: 'member', records: [] },
            ],
        }));
        await open(route);
        expect(chipTexts('w1')).toEqual(['大規模手当150円']);
        expect([chipTexts('F1'), chipTexts('w2'), chipTexts('pm1')]).toEqual([null, null, null]);
        expect([errors(), notices(), logged()]).toEqual([[], [], []]);
    });

    it('付けられる手当が無い日（items が空）: 記録だけある人には、その記録のボタンだけ出る。手当も記録も無い人・対象外の人（記録があっても）には出さない', async () => {
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [], crew('F1', {
            w1: [rec({ id: 'old', itemId: 'oldItem', itemName: '旧・遠方手当', amount: 300 })],
            pm1: [rec({ id: 'pm' })],
        }, []))));
        await open(route);
        expect(chipTexts('w1')).toEqual(['旧・遠方手当300円']);
        expect([chipTexts('F1'), chipTexts('w2'), chipTexts('pm1')]).toEqual([null, null, null]);
        // 見出しの下の一文は、その日に付けられる手当があるときだけ
        expect(screen.queryByTestId('allowance-notice')).toBeNull();
    });

    it('手当の答えの members に入っていない人のカードには出さない', async () => {
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], [allowanceMember('F1', 'F1'), allowanceMember('F1', 'w1')])));
        await open(route);
        expect([chipTexts('F1'), chipTexts('w1')]).toEqual([['大規模手当1,500円'], ['大規模手当200円']]);
        expect([chipTexts('w2'), chipTexts('pm1')]).toEqual([null, null]);
    });

    it('手当の答えの members・records の並びが、出勤簿の並びと違っていても、それぞれの人のカードに、その人の内容が出る', async () => {
        // API は members・records の順番を決めていない（画面は userId・itemId で突き合わせる）
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE, FAR], [
            allowanceMember('F1', 'pm1', [], [LARGE, FAR]),
            allowanceMember('F1', 'w2', [rec({ id: 'b', itemId: 'far', itemName: '遠方手当', amount: 500 }), rec({ id: 'a' })], [LARGE, FAR]),
            allowanceMember('F1', 'F1', [], [LARGE, FAR]),
            allowanceMember('F1', 'w1', [], [LARGE, FAR]),
        ])));
        await open(route);
        const state = (userId: string) => Array.from((chipsOf(userId) as HTMLElement).querySelectorAll('button')).map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
        expect(state('F1')).toEqual([['大規模手当1,500円', 'false'], ['遠方手当800円', 'false']]);
        expect(state('w1')).toEqual([['大規模手当200円', 'false'], ['遠方手当500円', 'false']]);
        expect(state('w2')).toEqual([['大規模手当200円', 'true'], ['遠方手当500円', 'true']]); // ボタンの並びは offers の順（records の順ではない）
        expect(chipTexts('pm1')).toBeNull();
    });

    it('閉じているあいだは、手当を読まない・知らせも聞かない。開いたら読んで、聞きはじめる', async () => {
        const calls = installFetch(routeOf(allowanceGet()));
        const utils = render(modalElement(false));
        await flush();
        expect(calls.length).toBe(0);
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(0);
        utils.rerender(modalElement(true));
        await flush();
        expect(calls.filter(isAllowanceGet).length).toBeGreaterThan(0);
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(1);
    });

    it('職長が選ばれていないときは、手当を読まない・知らせも聞かない', async () => {
        mockSessionUser = { id: '', role: '', name: '', username: '' };
        const { calls } = await open(allowanceGet(), { foremanId: '' });
        expect(screen.queryByText('職長を選択してください')).not.toBeNull();
        expect(calls.length).toBe(0);
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(0);
        expectNoAllowanceParts();
    });
});

// =====================================================================================
describe('B. 見た目（ボタンの文字・金額・色・鍵・一文）', () => {
    it('見出し「手当」つきで、「早出・朝積・残業・夕積・早終」の行の下に出る。ボタンの文字は「手当の名前＋金額」。職長本人のカードは職長の金額（1,500円）、ほかの人のカードは職長以外の金額（200円）', async () => {
        await open(allowanceGet());
        expect(chipTexts('F1')).toEqual(['大規模手当1,500円']);
        expect(chipTexts('w1')).toEqual(['大規模手当200円']);
        expect(chipTexts('w2')).toEqual(['大規模手当200円']);

        const chips = chipsOf('w1') as HTMLElement;
        expect(within(chips).getByText('手当')).toBeTruthy();
        // カードの中で、選択欄の行のすぐ後ろ（評価ポイントのボタンが出ていないとき）
        expect((chips.previousElementSibling as HTMLElement).querySelectorAll('select').length).toBe(5);
        // 付いていないボタンは白。指で押せる高さ（32px 以上）のクラスが付いている
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'false', tone: TONE_OFF, disabled: false, ariaDisabled: null, title: '', lock: false });
        expect(chip('w1', '大規模手当').className).toContain('min-h-[32px]');
    });

    it('金額は、答えの offers のとおり（だれが開いても同じ）。管理者が開いても、職長本人のカードだけ 1,500円', async () => {
        mockSessionUser = ADMIN;
        await open(allowanceGet());
        expect([chipTexts('F1'), chipTexts('w1'), chipTexts('w2')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円']]);
    });

    it('画面は、職長か職長以外かを自分では決めない: 班のメンバーでも offers の区分が foreman（＝自分の班の職長でもある人）なら職長の金額。金額は offers の amount をそのまま出す', async () => {
        const offer = (payRole: 'foreman' | 'member', amount: number): AllowanceDayOffer[] => [{ itemId: 'large', payRole, amount }];
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], [
            // 職長本人だが、区分は職長以外（画面が「職長本人だから 1,500円」と決めていないことを見る）
            { userId: 'F1', eligible: true, offers: offer('member', 200), records: [] },
            // 班のメンバーだが、同じ日に自分の班（対象の現場）の職長でもある人
            { userId: 'w1', eligible: true, offers: offer('foreman', 1500), records: [] },
            // 金額は、items の金額ではなく、offers の amount を出す
            { userId: 'w2', eligible: true, offers: offer('member', 777), records: [] },
        ])));
        await open(route);
        expect([chipTexts('F1'), chipTexts('w1'), chipTexts('w2')]).toEqual([['大規模手当200円'], ['大規模手当1,500円'], ['大規模手当777円']]);
    });

    it('ボタンの並びは offers の順（items の順と違っていても）。offers にあるのに items に無い手当（名前が分からない）は出さない。その手当の記録があれば、記録に写した名前で出す', async () => {
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, [LARGE, FAR], [
            { userId: 'w1', eligible: true, records: [], offers: [
                { itemId: 'far', payRole: 'member', amount: 500 }, { itemId: 'ghost', payRole: 'member', amount: 999 }, { itemId: 'large', payRole: 'member', amount: 200 },
            ] },
            { userId: 'w2', eligible: true, offers: [{ itemId: 'ghost', payRole: 'member', amount: 999 }],
                records: [rec({ id: 'g', itemId: 'ghost', itemName: '名前の消えた手当', amount: 321 })] },
            // 名前の分からない手当しか無い人には、何も出さない
            { userId: 'F1', eligible: true, records: [], offers: [{ itemId: 'ghost', payRole: 'foreman', amount: 999 }] },
        ])));
        const { container } = await open(route);
        expect(chipTexts('w1')).toEqual(['遠方手当500円', '大規模手当200円']);
        expect(chipTexts('w2')).toEqual(['名前の消えた手当321円']);
        expect(chipTexts('F1')).toBeNull();
        expect(cardsOf(container)[0].children.length).toBe(2); // 職長1 のカードには、見出し「手当」も足さない
    });

    it('役職が職長の人でも、ほかの人の班に入っただけの日（offers の区分が member）は、職長以外の金額', async () => {
        mockSessionUser = ADMIN;
        // 職長2 の班: 職長2（職長本人）・作業員1・職長1（役職は職長だが、この日は班の1人）
        await open(allowanceGet(), { foremanId: 'F2' });
        expect([chipTexts('F2'), chipTexts('w1'), chipTexts('F1')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円']]);
    });

    it('管理者が自分の班を開いたとき、自分のカード（その日の班の職長）は職長の金額', async () => {
        mockSessionUser = ADMIN;
        await open(allowanceGet(), { foremanId: 'admin1' });
        expect(chipTexts('admin1')).toEqual(['大規模手当1,500円']);
    });

    it('記録があるボタンは、記録に写してある金額を出す（今の金額と違っていても。付けたときの「職長／職長以外」が今と違っていても）', async () => {
        await open(allowanceGet({
            F1: [rec({ id: 'a', payRole: 'foreman', amount: 1000, status: 'pending' })], // 金額を変える前に付けた分
            w1: [rec({ id: 'b', amount: 150 })],                                         // 金額を変える前に付けた分
            w2: [rec({ id: 'c', payRole: 'foreman', amount: 1500, createdBy: 'admin1', createdByName: '管理者', canRemove: false })], // 職長として付いた分
        }));
        expect(chipTexts('F1')).toEqual(['大規模手当1,000円確認待ち']);
        expect(chipTexts('w1')).toEqual(['大規模手当150円']);
        expect(chipTexts('w2')).toEqual(['大規模手当1,500円']);
    });

    it('金額は3けたごとに区切る（100,000円）。0円も出す', async () => {
        const special: AllowanceDayItem = { id: 'special', name: '特別手当', description: null, foremanAmount: 100000, memberAmount: 0 };
        await open(allowanceGet({}, [special]));
        expect([chipTexts('F1'), chipTexts('w1')]).toEqual([['特別手当100,000円'], ['特別手当0円']]);
    });

    it('付けられる手当（API が返した順）のあとに、今は付けられない手当の記録が並ぶ（付けられる手当は今の名前、そうでない記録は記録に写した名前と金額）', async () => {
        await open(allowanceGet({
            w1: [
                rec({ id: 'o', itemId: 'oldItem', itemName: '旧・夜間手当', amount: 300 }),
                rec({ id: 'l', itemId: 'large', itemName: '大規模手当（前の名前）', amount: 180 }),
            ],
        }, [FAR, LARGE]));
        const buttons = Array.from((chipsOf('w1') as HTMLElement).querySelectorAll('button'));
        expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
            ['遠方手当500円', 'false'], ['大規模手当180円', 'true'], ['旧・夜間手当300円', 'true'],
        ]);
        // 記録の無い人のカードには、付けられる手当だけ
        expect(chipTexts('w2')).toEqual(['遠方手当500円', '大規模手当200円']);
    });

    /**
     * 職長1 が開いている（付けられる手当は2つ）。
     *   自分のカード:      大規模手当＝確認待ち（取り下げられる）／遠方手当＝認められた記録（鍵）
     *   作業員1 のカード:  大規模手当＝本人が付けた確認待ち（鍵）／遠方手当＝管理者が付けた記録（鍵）
     *   作業員2 のカード:  どちらも付いていない
     */
    const lockedDay = allowanceGet({
        F1: [
            rec({ id: 'p1', payRole: 'foreman', amount: 1500, status: 'pending', canRemove: true }),
            rec({ id: 'c1', itemId: 'far', itemName: '遠方手当', payRole: 'foreman', amount: 800, canRemove: false }),
        ],
        w1: [
            rec({ id: 'p2', status: 'pending', createdBy: 'w1', createdByName: '作業員1', canRemove: false }),
            rec({ id: 'c2', itemId: 'far', itemName: '遠方手当', amount: 500, createdBy: 'admin1', createdByName: '管理者', canRemove: false }),
        ],
    }, [LARGE, FAR]);

    it('付いていない＝白／確定＝ティール（bg-teal-600）／確認待ち＝黄色（border-amber-400）＋「確認待ち」の文字。取り消せない記録は鍵つき（disabled ではなく aria-disabled。title に理由）', async () => {
        await open(lockedDay);
        expect(look(chip('w2', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'false', tone: TONE_OFF, disabled: false, ariaDisabled: null, title: '', lock: false });
        expect(look(chip('F1', '大規模手当'))).toEqual({ text: '大規模手当1,500円確認待ち', pressed: 'true', tone: TONE_PENDING, disabled: false, ariaDisabled: null, title: '', lock: false });
        expect(look(chip('F1', '遠方手当'))).toEqual({ text: '遠方手当800円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: 'true', title: '自分の分の記録は、自分では取り消せません', lock: true });
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円確認待ち', pressed: 'true', tone: TONE_PENDING, disabled: false, ariaDisabled: 'true', title: '作業員1さんが付けました', lock: true });
        expect(look(chip('w1', '遠方手当'))).toEqual({ text: '遠方手当500円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: 'true', title: '管理者さんが付けました', lock: true });
    });

    it('鍵つきのボタンを押すと、理由のトーストが出る。通信も confirm も出ない・ボタンは変わらない', async () => {
        const { calls } = await open(lockedDay);
        const before = calls.length;
        fireEvent.click(chip('F1', '遠方手当'));     // 自分のカードの、もう取り消せない記録
        fireEvent.click(chip('w1', '大規模手当'));   // ほかの人のカードの記録（確認待ち）
        fireEvent.click(chip('w1', '遠方手当'));     // ほかの人のカードの記録（確定）
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
        expect([chip('F1', '遠方手当'), chip('w1', '大規模手当'), chip('w1', '遠方手当')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
    });

    it('管理者・マネージャーでも、自分のカードにある「ほかの人が付けた確定の記録」は「自分では取り消せません」（付けた人の名前の文言にしない）', async () => {
        mockSessionUser = ADMIN;
        const route = allowanceGet({
            admin1: [
                rec({ id: 'a1', payRole: 'foreman', amount: 1500, createdBy: 'F1', createdByName: '職長1', canRemove: false }),
                rec({ id: 'a2', itemId: 'far', itemName: '遠方手当', payRole: 'foreman', amount: 800, createdBy: 'mgr1', createdByName: 'マネージャー', canRemove: false }),
            ],
        }, [LARGE, FAR]);
        const { calls } = await open(route, { foremanId: 'admin1' });
        const before = calls.length;
        for (const label of ['大規模手当', '遠方手当']) {
            expect(look(chip('admin1', label))).toMatchObject({ disabled: false, ariaDisabled: 'true', title: '自分の分の記録は、自分では取り消せません', lock: true });
            fireEvent.click(chip('admin1', label));
        }
        await flush();
        expect(notices()).toEqual(['自分の分の記録は、自分では取り消せません', '自分の分の記録は、自分では取り消せません']);
        expect(calls.length).toBe(before);
        expect(confirmMock).not.toHaveBeenCalled();
    });

    /** 締めた月: 付けられる手当は返ってこない（items が空）。付いている記録は、どれも取り消せない */
    const closedDay = allowanceGet({
        F1: [rec({ id: 'k1', payRole: 'foreman', amount: 1500, canRemove: false })],
        w1: [rec({ id: 'k2', canRemove: false })],
    }, [], true);

    it('締めた月（monthClosed）: 記録のある人にだけ、記録の名前と金額で、鍵つきで出る。理由は、自分のカードでもほかの人のカードでも「この月の手当は締めてあります」', async () => {
        const { calls } = await open(closedDay);
        expect(look(chip('F1', '大規模手当'))).toEqual({ text: '大規模手当1,500円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: 'true', title: CLOSED_REASON, lock: true });
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: 'true', title: CLOSED_REASON, lock: true });
        expect([chipTexts('w2'), chipTexts('pm1')]).toEqual([null, null]);

        const before = calls.length;
        fireEvent.click(chip('F1', '大規模手当'));
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(notices()).toEqual([CLOSED_REASON, CLOSED_REASON]);
        expect(calls.length).toBe(before);
        expect([errors(), confirmMock.mock.calls.length]).toEqual([[], 0]);
    });

    it('締めた月: カードの下の文は「この月の手当は締めてあります」（「自分の手当は確認待ちになります…」の代わり）。見出しの下の一文は出さない', async () => {
        await open(closedDay);
        expect(within(chipsOf('F1') as HTMLElement).queryByText(CLOSED_REASON)).not.toBeNull();
        expect(within(chipsOf('w1') as HTMLElement).queryByText(CLOSED_REASON)).not.toBeNull();
        expect(screen.queryByText(OWN_CAPTION)).toBeNull();
        expect(screen.queryByTestId('allowance-notice')).toBeNull();
        expect(screen.queryByLabelText(INFO_LABEL)).toBeNull();
    });

    it('自分のカードにボタンが出ているときだけ「自分の手当は確認待ちになります。管理者・マネージャーが認めると、手当に入ります。」を出す（ほかの人のカードには出さない）', async () => {
        await open(allowanceGet());
        expect(within(chipsOf('F1') as HTMLElement).queryByText(OWN_CAPTION)).not.toBeNull();
        expect(screen.queryAllByText(OWN_CAPTION).length).toBe(1);
        expect(screen.queryByText(CLOSED_REASON)).toBeNull(); // 締めていない月には出さない
    });

    it('自分のカードにボタンが出ていなければ、「自分の手当は確認待ちになります…」はどこにも出さない', async () => {
        // 付けられる手当は無く、作業員1 にだけ記録がある（自分＝職長1 のカードには、手当の部品が無い）
        await open(allowanceGet({ w1: [rec()] }, []));
        expect(chipTexts('w1')).toEqual(['大規模手当200円']);
        expect(screen.queryByText(OWN_CAPTION)).toBeNull();
        cleanup();

        // 管理者が、自分のいない班を開いたとき
        mockSessionUser = ADMIN;
        await open(allowanceGet());
        expect(chipTexts('F1')).toEqual(['大規模手当1,500円']);
        expect(screen.queryByText(OWN_CAPTION)).toBeNull();
    });

    it('答えに monthClosed が入っていなければ、締めていない月として扱う', async () => {
        const route = onAllowanceGet((c) => ok({ date: dayQuery(c).date, foremanId: 'F1', items: [LARGE], members: crew('F1', { w1: [rec({ canRemove: false, createdBy: 'admin1', createdByName: '管理者' })] }) }));
        await open(route);
        expect(chip('w1', '大規模手当').title).toBe('管理者さんが付けました');
        expect(screen.queryByText(CLOSED_REASON)).toBeNull();
        expect(screen.queryAllByText(OWN_CAPTION).length).toBe(1);
        expect(screen.queryByTestId('allowance-notice')).not.toBeNull();
    });

    it('見出しの下の一文は1つだけ。(i) を押すと「名前：職長 ◯円・職長以外 ◯円」と、説明があれば「（説明）」が並ぶ', async () => {
        const { container } = await open(allowanceGet({}, [LARGE, FAR]));
        const noticesInDom = container.querySelectorAll('[data-testid="allowance-notice"]');
        expect(noticesInDom.length).toBe(1);
        expect(noticesInDom[0].textContent).toBe(NOTICE);
        // 見出しの行（見出しと「全員定時」が並ぶ行）のすぐ下で、カードの並びのすぐ上。見出しの行そのものには何も足していない
        const headingRow = noticesInDom[0].previousElementSibling as HTMLElement;
        expect(headingRow.textContent).toBe('積込・残業・早終全員定時');
        expect(headingRow.querySelectorAll('button').length).toBe(1);
        expect(noticesInDom[0].nextElementSibling).toBe(cardsOf(container)[0].parentElement);

        const tips = screen.getAllByLabelText(INFO_LABEL);
        expect(tips.length).toBe(1);
        expect(noticesInDom[0].contains(tips[0])).toBe(true);
        expect(screen.queryByRole('tooltip')).toBeNull();
        fireEvent.click(tips[0]);
        const tip = screen.getByRole('tooltip');
        expect(within(tip).getByText('手当')).toBeTruthy(); // 吹き出しの見出し
        expect(Array.from(tip.querySelectorAll('span')).map((s) => s.textContent)).toEqual([
            '大規模手当：職長 1,500円・職長以外 200円（工事内容が「大規模」の現場に入った日）',
            '遠方手当：職長 800円・職長以外 500円', // 説明が無い手当には、かっこを付けない
        ]);
    });

    it('説明のある手当が1つも無くても、(i) は出す（金額を見るため）', async () => {
        await open(allowanceGet({}, [FAR]));
        expect(screen.getByTestId('allowance-notice').textContent).toBe(NOTICE);
        fireEvent.click(screen.getByLabelText(INFO_LABEL));
        expect(Array.from(screen.getByRole('tooltip').querySelectorAll('span')).map((s) => s.textContent)).toEqual(['遠方手当：職長 800円・職長以外 500円']);
    });

    it('items が空で、記録だけが出ているときは、見出しの下の一文を出さない。その記録を取り消すと、ボタンも見出しも消える', async () => {
        const route: Route = (c) => {
            if (isAllowanceGet(c)) return ok(allowanceResponse('F1', dayQuery(c).date, [], crew('F1', { w1: [rec({ id: 'old', itemId: 'oldItem', itemName: '旧・遠方手当', amount: 300 })] }, [])));
            if (isAllowancePut(c)) return putResult('removed', allowanceMember('F1', 'w1'));
            return undefined;
        };
        const { calls, container } = await open(route);
        expect(screen.queryByTestId('allowance-notice')).toBeNull();
        const b = chip('w1', '旧・遠方手当');
        expect(b.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(b);
        await flush();
        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'oldItem', on: false }]);
        expectAsBefore(container);
    });
});

// =====================================================================================
describe('C. ボタンを押したとき', () => {
    it('付いていないボタンを押す → on: true の PUT を1回。色は応答（added）で変わる（押した瞬間には変わらない）。知らせは allowances_updated を { date } 付きで。出勤簿の API は呼ばない。そのあとの「保存」で送る中身も同じ', async () => {
        const { calls, container } = await open(allowanceGet()); // PUT には、あとで答える
        fireEvent.change(cardSelects(container)[2], { target: { value: '30' } }); // 職長1 の残業を 30分に
        const attendanceBefore = calls.filter(isAttendanceCall).length;
        const getsBefore = calls.filter(isAllowanceGet).length;

        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        const puts = calls.filter(isAllowancePut);
        expect(puts.map(describeCall)).toEqual(['PUT /api/allowances/day']);
        expect(puts.map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: true }]);
        // 応答が届くまでは、色を変えない（押せなくするだけ）。知らせも、まだ送らない
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ text: '大規模手当200円', pressed: 'false', tone: TONE_OFF, disabled: true });
        expect(bc.__sent).toEqual([]);

        await settle(puts[0], putResult('added', allowanceMember('F1', 'w1', [rec({ id: 'new1' })])));
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: null, title: '', lock: false });
        expect(bc.__sent).toEqual([{ event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } }]);
        // ほかの人のボタンは変わらない
        expect([chip('F1', '大規模手当'), chip('w2', '大規模手当')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
        expect(calls.filter(isAttendanceCall).length).toBe(attendanceBefore); // 出勤簿の API は呼ばれていない
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore);          // 付いただけでは、読み直さない
        expect(cardSelects(container)[2].value).toBe('30');                      // 入力中の出勤簿の値は変わらない
        expect([errors(), notices(), successes()]).toEqual([[], [], []]);

        bc.__sent.length = 0;
        fireEvent.click(saveButton());
        await flush();
        expect(calls.filter((c) => c.method === 'POST').map((p) => p.body)).toEqual([EXPECTED_SAVE_BODY]);
        expect(bc.__sent).toEqual([{ event: 'attendance_updated', payload: { foremanId: 'F1', date: '2026-09-30' } }]);
        expect(calls.filter(isAllowancePut).length).toBe(1); // 「保存」では手当を送らない
    });

    it('付いているボタンを押す → on: false の PUT。応答（removed）で外れる。自分が付けた記録なので confirm は出ない', async () => {
        const { calls } = await open(allowanceGet({ w1: [rec()] }));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        const puts = calls.filter(isAllowancePut);
        expect(puts.map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: false }]);
        expect(confirmMock).not.toHaveBeenCalled();
        // 応答が届くまでは、付いた色のまま
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', tone: TONE_CONFIRMED, disabled: true });

        await settle(puts[0], putResult('removed', allowanceMember('F1', 'w1')));
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'false', tone: TONE_OFF, disabled: false, ariaDisabled: null, title: '', lock: false });
        expect(bc.__sent).toEqual([{ event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } }]);
        expect([errors(), notices()]).toEqual([[], []]);
    });

    it('自分のカード: 押すと「確認待ち」で付く（職長の金額）。自分の確認待ちは、confirm なしで取り下げられる', async () => {
        const pending = rec({ id: 'own1', payRole: 'foreman', amount: 1500, status: 'pending', createdBy: 'F1', createdByName: '職長1', canRemove: true });
        const route: Route = (c) => allowanceGet()(c) ?? (isAllowancePut(c)
            ? (c.body?.on ? putResult('added', allowanceMember('F1', 'F1', [pending])) : putResult('removed', allowanceMember('F1', 'F1')))
            : undefined);
        const { calls } = await open(route);
        fireEvent.click(chip('F1', '大規模手当'));
        await flush();
        expect(look(chip('F1', '大規模手当'))).toEqual({ text: '大規模手当1,500円確認待ち', pressed: 'true', tone: TONE_PENDING, disabled: false, ariaDisabled: null, title: '', lock: false });

        fireEvent.click(chip('F1', '大規模手当'));
        await flush();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(notices()).toEqual([]);
        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([
            { foremanId: 'F1', date: '2026-09-30', userId: 'F1', itemId: 'large', on: true },
            { foremanId: 'F1', date: '2026-09-30', userId: 'F1', itemId: 'large', on: false },
        ]);
        expect(look(chip('F1', '大規模手当'))).toMatchObject({ text: '大規模手当1,500円', pressed: 'false', tone: TONE_OFF });
    });

    it('ほかの人が付けた記録を取り消すときは confirm を出す（いいえ なら送らない）。鍵にはならない', async () => {
        mockSessionUser = ADMIN;
        const route: Route = (c) => allowanceGet({ w1: [rec({ id: 'r1', createdBy: 'F1', createdByName: '職長1', canRemove: true })] })(c)
            ?? (isAllowancePut(c) ? putResult('removed', allowanceMember('F1', 'w1')) : undefined);
        const { calls } = await open(route);
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', ariaDisabled: null, title: '', lock: false });
        confirmMock.mockImplementationOnce(() => false);
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(confirmMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['職長1さんが付けた記録です。取り消しますか？']);
        expect(calls.filter(isAllowancePut).length).toBe(0);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(chip('w1', '大規模手当')); // こんどは「はい」
        await flush();
        expect(confirmMock).toHaveBeenCalledTimes(2);
        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: false }]);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false');
        expect(notices()).toEqual([]);
    });

    it('付けるとき・自分が付けた記録を取り消すときは、管理者でも confirm を出さない', async () => {
        mockSessionUser = ADMIN;
        const mine = rec({ id: 'm1', createdBy: 'admin1', createdByName: '管理者', canRemove: true });
        const route: Route = (c) => allowanceGet({ w2: [mine] })(c)
            ?? (isAllowancePut(c) ? putResult(c.body?.on ? 'added' : 'removed', allowanceMember('F1', String(c.body?.userId), c.body?.on ? [mine] : [])) : undefined);
        const { calls } = await open(route);
        fireEvent.click(chip('w1', '大規模手当')); // 付ける
        fireEvent.click(chip('w2', '大規模手当')); // 自分が付けた記録を取り消す
        await flush();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(calls.filter(isAllowancePut).map((p) => [p.body?.userId, p.body?.on])).toEqual([['w1', true], ['w2', false]]);
    });

    it('同じ瞬間に続けて押しても PUT は1回。送っているあいだ、そのボタンだけ押せない（disabled・うすい色）。応答が返ったら、また押せる', async () => {
        const { calls } = await open(allowanceGet({}, [LARGE, FAR]));
        const getsBefore = calls.filter(isAllowanceGet).length;
        const b = chip('w1', '大規模手当');
        // 画面が描き直される前の2回目・3回目（1回の act の中で続けて押す）
        await act(async () => { b.click(); b.click(); b.click(); });
        await flush();
        expect(calls.filter(isAllowancePut).length).toBe(1);
        expect(isSending(chip('w1', '大規模手当'))).toEqual([true, true]);
        fireEvent.click(chip('w1', '大規模手当'));
        expect(calls.filter(isAllowancePut).length).toBe(1);
        // ほかのボタン（同じ人の別の手当・別の人の同じ手当）は押せる
        for (const other of [chip('w1', '遠方手当'), chip('w2', '大規模手当'), chip('F1', '大規模手当')]) expect(isSending(other)).toEqual([false, false]);
        fireEvent.click(chip('w2', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).length).toBe(2);
        // 応答が返ったら、また押せる。色は応答で変わる
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false');
        await settle(calls.filter(isAllowancePut)[0], putResult('added', allowanceMember('F1', 'w1', [rec({ id: 'n1' })])));
        expect(isSending(chip('w1', '大規模手当'))).toEqual([false, false]);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        expect(isSending(chip('w2', '大規模手当'))).toEqual([true, true]); // こちらは、まだ送っている最中

        // 連打で止めた2回目・3回目は「同じ人の保存が重なった」に数えない: 応答のあとも、そのあとで押し直したときも、読み直さない
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        const puts = calls.filter(isAllowancePut);
        expect(puts.map((p) => [p.body?.userId, p.body?.on])).toEqual([['w1', true], ['w2', true], ['w1', false]]);
        await settle(puts[2], putResult('removed', allowanceMember('F1', 'w1')));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false');
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore);
    });

    it('送っているあいだも、鍵つきのボタンは押せば理由が出る（disabled になるのは、送っているボタンだけ）', async () => {
        const route = allowanceGet({
            F1: [
                rec({ id: 'p1', payRole: 'foreman', amount: 1500, status: 'pending', canRemove: true }),
                rec({ id: 'c1', itemId: 'far', itemName: '遠方手当', payRole: 'foreman', amount: 800, canRemove: false }),
            ],
        }, [LARGE, FAR]);
        const { calls } = await open(route); // PUT には答えない＝送っている最中のまま
        fireEvent.click(chip('F1', '大規模手当'));
        await flush();
        expect(chip('F1', '大規模手当').disabled).toBe(true);
        expect(chip('F1', '遠方手当').disabled).toBe(false);
        fireEvent.click(chip('F1', '遠方手当'));
        expect(notices()).toEqual(['自分の分の記録は、自分では取り消せません']);
        expect(calls.filter(isAllowancePut).length).toBe(1);
    });

    const putReply = (reply: (c: Call) => Reply, get: Route = allowanceGet()): Route => (c) => get(c) ?? (isAllowancePut(c) ? reply(c) : undefined);

    it('unchanged（別の端末が先に付けていた など）: トーストなし・知らせなし。応答の member の記録で、その人の記録を置き換える', async () => {
        // 別の端末（管理者）が先に付けていた → 職長には鍵つきで出る
        const { calls } = await open(putReply(() => putResult('unchanged', allowanceMember('F1', 'w1', [rec({ id: 'x', createdBy: 'admin1', createdByName: '管理者', canRemove: false })]))));
        const getsBefore = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect([errors(), notices(), bc.__sent]).toEqual([[], [], []]);
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: 'true', title: '管理者さんが付けました', lock: true });
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore); // 読み直さない
    });

    it('応答に member が入っていなければ、表示は変えない（失敗のトーストは出さない・また押せる）', async () => {
        const { calls } = await open(putReply(() => ok({ result: 'added', monthClosed: false })));
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).length).toBe(1);
        expect([errors(), notices(), logged()]).toEqual([[], [], []]);
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'false', tone: TONE_OFF, disabled: false });
        expect(bc.__sent).toEqual([{ event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } }]);
    });

    it('保存の応答で入れ替えるのは、その人の記録だけ。ボタン（offers）と「対象の人か」は、前に読んだまま（応答に入っていても使わない）＝保存のあとも、ボタンは消えない・金額も変わらない', async () => {
        // 作業員1 は、自分の班（対象の現場）の職長でもある人（職長の金額）。作業員2 は職長以外
        const route: Route = (c) => {
            if (isAllowanceGet(c)) {
                return ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], [
                    allowanceMember('F1', 'F1'),
                    { userId: 'w1', eligible: true, offers: offersOf('foreman', [LARGE]), records: [] },
                    allowanceMember('F1', 'w2'),
                ]));
            }
            if (!isAllowancePut(c)) return undefined;
            const added = rec({ id: 'n1', payRole: 'foreman', amount: 1500 });
            // 本物の API は返さないが、もし eligible・offers が入っていても、画面は使わない
            if (c.body?.userId === 'w1') return ok({ result: c.body?.on ? 'added' : 'removed', monthClosed: false, member: { userId: 'w1', eligible: false, offers: [], records: c.body?.on ? [added] : [] } });
            return ok({ result: 'added', monthClosed: false, member: { userId: 'w2', records: [rec({ id: 'n2' })] } });
        };
        const { calls } = await open(route);
        const getsBefore = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ text: '大規模手当1,500円', pressed: 'true', tone: TONE_CONFIRMED });
        fireEvent.click(chip('w1', '大規模手当')); // 取り消す
        await flush();
        // 記録が無くなっても、ボタンは残る。金額は、前に読んだ offers の金額（職長の金額）のまま
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ text: '大規模手当1,500円', pressed: 'false', tone: TONE_OFF, disabled: false });
        fireEvent.click(chip('w2', '大規模手当'));
        await flush();
        expect(look(chip('w2', '大規模手当'))).toMatchObject({ text: '大規模手当200円', pressed: 'true' });
        expect(chipTexts('F1')).toEqual(['大規模手当1,500円']);
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore); // 読み直していない
    });

    it('応答の member に records が入っていなければ、その人の記録は「無し」として映す。member が班にいない人なら、何も変えない', async () => {
        const route: Route = (c) => {
            if (isAllowanceGet(c)) return allowanceGet({ w1: [rec()] })(c);
            if (!isAllowancePut(c)) return undefined;
            return c.body?.userId === 'w1'
                ? ok({ result: 'removed', monthClosed: false, member: { userId: 'w1' } })
                : ok({ result: 'added', monthClosed: false, member: { userId: 'だれか', records: [rec({ id: 'zz' })] } });
        };
        await open(route);
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ text: '大規模手当200円', pressed: 'false', tone: TONE_OFF });
        fireEvent.click(chip('w2', '大規模手当'));
        await flush();
        expect([chip('F1', '大規模手当'), chip('w1', '大規模手当'), chip('w2', '大規模手当')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
        expect(chipsOf('だれか')).toBeNull();
        expect([errors(), notices(), logged()]).toEqual([[], [], []]);
    });

    it('blocked: 「この記録は取り消せません」。知らせなし。記録は残ったまま、鍵に変わる', async () => {
        // 画面では取り消せるように見えていたが、サーバーでは取り消せなかった
        const { calls } = await open(putReply(
            () => putResult('blocked', allowanceMember('F1', 'w1', [rec({ id: 'r1', canRemove: false })])),
            allowanceGet({ w1: [rec({ id: 'r1', canRemove: true })] }),
        ));
        const getsBefore = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut)[0].body?.on).toBe(false);
        expect(errors()).toEqual(['この記録は取り消せません']);
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', disabled: false, ariaDisabled: 'true', lock: true });
        expect(bc.__sent).toEqual([]);
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore); // 読み直さない
    });

    it.each([
        ['inactive（手当が「使わない」になった）', 'inactive', INACTIVE_TOAST],
        ['not_target（手配が変わって、この班の対象の現場の手配に入っていない）', 'not_target', NOT_TARGET_TOAST],
        ['not_found（手当が無い）', 'not_found', NOT_FOUND_TOAST],
    ])('%s: 理由の文言を出して、ボタンの一覧から読み直す。知らせは送らない', async (_name, result, message) => {
        let rejected = false;
        const route: Route = (c) => {
            // 断られたあとの読み直しでは、「大規模手当」が付けられる手当から外れている
            if (isAllowanceGet(c)) return ok(allowanceResponse('F1', dayQuery(c).date, rejected ? [FAR] : [LARGE, FAR], crew('F1', {}, rejected ? [FAR] : [LARGE, FAR])));
            if (isAllowancePut(c)) { rejected = true; return putResult(result, allowanceMember('F1', 'w1')); }
            return undefined;
        };
        const { calls } = await open(route);
        const before = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(errors()).toEqual([message]);
        expect(calls.filter(isAllowanceGet).slice(before).map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F1&date=2026-09-30']); // 読み直した
        expect(chipTexts('w1')).toEqual(['遠方手当500円']);
        expect(bc.__sent).toEqual([]);
        expect(notices()).toEqual([]);
    });

    it.each([
        ['付けようとした', 'w1', true],
        ['取り消そうとした', 'w2', false],
    ])('closed（押すまでのあいだに、月が締められていた。%s とき）: 「この月の手当は締めてあります」を出して、読み直す（締めた月の表示になる）', async (_name, userId, on) => {
        let closed = false;
        const route: Route = (c) => {
            // 締めたあとの読み直しでは、付けられる手当が無くなり、作業員2 の記録は取り消せなくなっている
            if (isAllowanceGet(c)) return ok(allowanceResponse('F1', dayQuery(c).date, closed ? [] : [LARGE], crew('F1', { w2: [rec({ id: 'k', canRemove: !closed })] }, closed ? [] : [LARGE]), closed));
            if (isAllowancePut(c)) {
                closed = true;
                return putResult('closed', allowanceMember('F1', String(c.body?.userId), c.body?.userId === 'w2' ? [rec({ id: 'k', canRemove: false })] : []), true);
            }
            return undefined;
        };
        const { calls } = await open(route);
        const before = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip(userId, '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId, itemId: 'large', on }]);
        expect(errors()).toEqual([CLOSED_REASON]);
        expect(calls.filter(isAllowanceGet).slice(before).map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F1&date=2026-09-30']); // 読み直した
        expect(bc.__sent).toEqual([]);
        // 読み直したあと: 付けられるボタンは消える。付いている記録は鍵つきで残る。見出しの下の一文も消える
        expect([chipTexts('F1'), chipTexts('w1')]).toEqual([null, null]);
        expect(look(chip('w2', '大規模手当'))).toMatchObject({ text: '大規模手当200円', pressed: 'true', ariaDisabled: 'true', title: CLOSED_REASON, lock: true });
        expect(screen.queryByTestId('allowance-notice')).toBeNull();
    });

    it('応答が unchanged でも、そのあいだに月が締められていたら（応答の monthClosed が、画面に出している内容と違う）、読み直して、締めた月の表示になる', async () => {
        // 職長が開いているあいだに、管理者が作業員1 に付けて、月を締めた（知らせは届かなかった）。そのあとで、職長が作業員1 のボタンを押す
        const byAdmin = rec({ id: 'x', createdBy: 'admin1', createdByName: '管理者', canRemove: false });
        let closed = false;
        const route: Route = (c) => {
            if (isAllowanceGet(c)) return ok(allowanceResponse('F1', dayQuery(c).date, closed ? [] : [LARGE], crew('F1', closed ? { w1: [byAdmin] } : {}, closed ? [] : [LARGE]), closed));
            if (isAllowancePut(c)) { closed = true; return putResult('unchanged', allowanceMember('F1', 'w1', [byAdmin]), true); }
            return undefined;
        };
        const { calls } = await open(route);
        expect(screen.queryAllByText(OWN_CAPTION).length).toBe(1); // 押す前は、締めていない月の表示
        const before = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: true }]);
        expect(calls.filter(isAllowanceGet).slice(before).map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F1&date=2026-09-30']); // 1回だけ読み直した

        // 読み直したあとは、締めた月の表示: 付いている記録は鍵つき（理由は「締めてあります」）。付けられるボタン・見出しの下の一文は消える
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'true', tone: TONE_CONFIRMED, disabled: false, ariaDisabled: 'true', title: CLOSED_REASON, lock: true });
        expect(within(chipsOf('w1') as HTMLElement).queryByText(CLOSED_REASON)).not.toBeNull();
        expect([chipTexts('F1'), chipTexts('w2')]).toEqual([null, null]);
        expect(screen.queryByTestId('allowance-notice')).toBeNull();
        expect(screen.queryByText(OWN_CAPTION)).toBeNull();
        // unchanged なので、トーストも知らせも出さない
        expect([errors(), notices(), bc.__sent]).toEqual([[], [], []]);

        // 鍵つきのボタンを押したときの理由も「締めてあります」（通信はしない）
        fireEvent.click(chip('w1', '大規模手当'));
        expect(notices()).toEqual([CLOSED_REASON]);
        expect(calls.filter(isAllowancePut).length).toBe(1);
    });

    // 作業員1 は付いていない・作業員2 は職長1 が付けている日に、ボタンを1つ押す
    // [応答の result, 押すカードの人, 応答の member の記録, 月が締められていたときの読み直しで返る記録]
    const lockedByForeman = rec({ id: 'r2', canRemove: false });
    const lockedByAdmin = rec({ id: 'x', createdBy: 'admin1', createdByName: '管理者', canRemove: false });
    const resultCases: [string, string, AllowanceDayRecord[], RecordsByUser][] = [
        ['added', 'w1', [rec({ id: 'n1' })], { w1: [rec({ id: 'n1', canRemove: false })], w2: [lockedByForeman] }],
        ['removed', 'w2', [], {}],
        ['unchanged', 'w1', [lockedByAdmin], { w1: [lockedByAdmin], w2: [lockedByForeman] }],
        ['blocked', 'w2', [lockedByForeman], { w2: [lockedByForeman] }],
    ];
    // [応答の monthClosed の説明, 応答の monthClosed, 読み直す回数]
    const closedInReply: [string, boolean | undefined, number][] = [
        ['true（画面は「締めていない」＝そのあいだに月が締められていた）', true, 1],
        ['false（画面と同じ）', false, 0],
        ['入っていない', undefined, 0],
    ];
    const monthClosedCases = resultCases.flatMap(([result, userId, records, afterClose]) =>
        closedInReply.map(([label, monthClosed, reloads]): [string, string, string, AllowanceDayRecord[], RecordsByUser, boolean | undefined, number] =>
            [result, label, userId, records, afterClose, monthClosed, reloads]));

    it.each(monthClosedCases)('応答が %s で、応答の monthClosed が %s: 画面の内容と違うときだけ、1回読み直す', async (result, _label, userId, records, afterClose, monthClosed, reloads) => {
        let closed = false;
        const route: Route = (c) => {
            if (isAllowanceGet(c)) {
                return closed
                    ? ok(allowanceResponse('F1', dayQuery(c).date, [], crew('F1', afterClose, []), true))
                    : allowanceGet({ w2: [rec({ id: 'r2' })] })(c);
            }
            if (isAllowancePut(c)) {
                closed = monthClosed === true;
                const updated = putMember(allowanceMember('F1', userId, records));
                return ok(monthClosed === undefined ? { result, member: updated } : { result, monthClosed, member: updated });
            }
            return undefined;
        };
        const { calls } = await open(route);
        const before = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip(userId, '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).length).toBe(1);
        expect(calls.filter(isAllowanceGet).length - before).toBe(reloads);
        expect(errors()).toEqual(result === 'blocked' ? ['この記録は取り消せません'] : []);
        if (reloads === 1) {
            // 読み直したので、締めた月の表示（付けられるボタンと、見出しの下の一文が消える）
            expect([chipTexts('F1'), screen.queryByTestId('allowance-notice')]).toEqual([null, null]);
            expect(screen.queryByText(OWN_CAPTION)).toBeNull();
        } else {
            // 読み直していない。応答の member だけが映る（締めていない月の表示のまま）
            expect(chipTexts('F1')).toEqual(['大規模手当1,500円']);
            expect(screen.queryByTestId('allowance-notice')).not.toBeNull();
            expect(chip(userId, '大規模手当').getAttribute('aria-pressed')).toBe(records.length > 0 ? 'true' : 'false');
            expect(screen.queryByText(CLOSED_REASON)).toBeNull();
        }
    });

    it.each([
        ['入っていない', undefined],
        ['false（そのあいだに、締めが外されていた）', false],
    ])('closed の応答は、応答の monthClosed が %s ときも、トーストを出して読み直す（monthClosed の見比べに頼らない）', async (_label, monthClosed) => {
        const updated = putMember(allowanceMember('F1', 'w1'));
        const { calls } = await open(putReply(() => ok(monthClosed === undefined ? { result: 'closed', member: updated } : { result: 'closed', monthClosed, member: updated })));
        const before = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(errors()).toEqual([CLOSED_REASON]);
        expect(calls.filter(isAllowanceGet).slice(before).map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F1&date=2026-09-30']);
        expect(bc.__sent).toEqual([]);
    });

    const SAVE_FAILED = '手当の保存に失敗しました';
    // [名前, PUT の答え, トーストの文言, logger.error に出す文言]
    // 本物の errorResponse・validationErrorResponse は、どちらも文言を error に入れて返す（lib/api/utils.ts）
    const errorCases: [string, Reply, string, string[]][] = [
        ['400（errorResponse・validationErrorResponse の形 { error }）', fail(400, { error: 'この日の班のメンバーではありません' }), 'この日の班のメンバーではありません', []],
        ['400（手当が始まる前の日付だった・金額が無い。サーバーの長い文言も、そのまま出す）', fail(400, { error: ALLOWANCE_NO_RATE_MESSAGE }), 'この日付には、この手当の金額が設定されていません（手当が始まる前の日付には付けられません）', []],
        ['400（error と details の両方に文言。error のほうを出す）', fail(400, { error: '日付が不正です', details: 'date は YYYY-MM-DD' }), '日付が不正です', []],
        ['400（error が無く details に文言）', fail(400, { details: '先の日付には付けられません' }), '先の日付には付けられません', []],
        ['400（error も details も無い）', fail(400, {}), SAVE_FAILED, []],
        ['400（答えが JSON でない）', notJson(400), SAVE_FAILED, []],
        ['403', fail(403, { error: '他の職長の班の手当は扱えません' }), '他の職長の班の手当は扱えません', []],
        ['401（サーバーの文言は出さない）', fail(401, { error: '認証が必要です' }), SAVE_FAILED, []],
        ['500（サーバーの文言は出さない）', fail(500, { error: 'データベースエラーが発生しました' }), SAVE_FAILED, []],
        ['502（答えが JSON でない）', notJson(502), SAVE_FAILED, []],
        ['200 だが、答えが JSON でない', notJson(200), SAVE_FAILED, ['手当の保存に失敗:']],
        ['ネットワークエラー', networkError, SAVE_FAILED, ['手当の保存に失敗:']],
    ];

    it.each(errorCases)('%s: トーストを出す。ボタンの色は変わらず、また押せる。そのあとの「保存」は今までどおり', async (_name, reply, message, logs) => {
        const { calls, container } = await open(putReply(() => reply));
        fireEvent.change(cardSelects(container)[2], { target: { value: '30' } });
        const attendanceBefore = calls.filter(isAttendanceCall).length;
        const getsBefore = calls.filter(isAllowanceGet).length;
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(errors()).toEqual([message]);
        expect(logged()).toEqual(logs);
        expect(look(chip('w1', '大規模手当'))).toEqual({ text: '大規模手当200円', pressed: 'false', tone: TONE_OFF, disabled: false, ariaDisabled: null, title: '', lock: false });
        expect(isSending(chip('w1', '大規模手当'))).toEqual([false, false]);
        expect(bc.__sent).toEqual([]);
        expect(calls.filter(isAttendanceCall).length).toBe(attendanceBefore);
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore);

        // また押せる（もう一度送る）
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).length).toBe(2);

        fireEvent.click(saveButton());
        await flush();
        expect(calls.filter((c) => c.method === 'POST').map((p) => p.body)).toEqual([EXPECTED_SAVE_BODY]);
    });

    const saveCases: [string, Route][] = [
        ['手当あり（ふつうに読めた）', allowanceGet()],
        ['手当の記録あり', allowanceGet({ F1: [rec({ id: 'a', payRole: 'foreman', amount: 1500, status: 'pending' })], w1: [rec({ id: 'b' })] })],
        ['締めた月', allowanceGet({ w1: [rec({ id: 'k', canRemove: false })] }, [], true)],
        ['手当なし', allowanceGet({}, [])],
        ['500', onAllowanceGet(() => fail(500))],
        ['403', onAllowanceGet(() => fail(403, { error: '権限がありません' }))],
        ['ネットワークエラー', onAllowanceGet(() => networkError)],
        ['答えが返ってこない', () => undefined],
    ];
    it.each(saveCases)('手当の読み込みが「%s」でも、「保存」は今までどおり: 同じ中身の POST /api/attendance を1回送る。手当は送らない', async (_name, route) => {
        const onSaved = jest.fn();
        const onClose = jest.fn();
        const { calls, container } = await open(route, { onSaved, onClose });
        for (const name of ['職長1', '作業員1', '作業員2', '協力メンバー']) expect(screen.queryAllByText(name).length).toBeGreaterThan(0);
        fireEvent.change(cardSelects(container)[2], { target: { value: '30' } }); // 職長1 の残業を 30分に
        fireEvent.click(saveButton());
        await flush();

        expect(calls.filter((c) => c.method === 'POST').map((p) => [p.path, p.body])).toEqual([['/api/attendance', EXPECTED_SAVE_BODY]]);
        expect(successes()).toEqual(['保存しました']);
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        // 出勤簿の知らせも今までどおり。手当の知らせ・手当の保存は出ない
        expect(bc.__sent).toEqual([{ event: 'attendance_updated', payload: { foremanId: 'F1', date: '2026-09-30' } }]);
        expect(calls.filter(isAllowancePut).length).toBe(0);
        expect(errors()).toEqual([]);
    });

    it('「キャンセル」「全員定時」「定時」「他のメンバーへコピー」は、手当の通信を起こさない・ボタンの状態も変えない', async () => {
        const onClose = jest.fn();
        const { calls } = await open(allowanceGet({ w1: [rec()] }), { onClose });
        const before = calls.length;
        fireEvent.click(screen.getByText('全員定時'));
        fireEvent.click(screen.getAllByText('定時')[0]);
        fireEvent.click(screen.getByText('他のメンバーへコピー'));
        expect([chip('F1', '大規模手当'), chip('w1', '大規模手当'), chip('w2', '大規模手当')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
        fireEvent.click(screen.getByText('キャンセル'));
        await flush();
        expect(calls.length).toBe(before);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(bc.__sent).toEqual([]);
    });
});

// =====================================================================================
describe('D. 古い答えを使わない・切り替え', () => {
    it('開いた直後: 前の職長・日付ぶんの答えが後から届いても使わない', async () => {
        mockSessionUser = ADMIN;
        const { calls } = await open(() => undefined);
        const gets = calls.filter(isAllowanceGet);
        // 開いた直後は、前の職長（自分）・日付（今日）ぶんの読み込みが1回先に走る
        expect(gets.map(describeCall)).toEqual([
            `GET /api/allowances/day?foremanId=admin1&date=${TODAY}`,
            'GET /api/allowances/day?foremanId=F1&date=2026-09-30',
        ]);
        const [stale, fresh] = gets;
        // 新しいほう（F1・9/30）が先に届く: 作業員1 に「大規模手当」が付いている
        await settle(fresh, ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1', { w1: [rec()] }))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        // 古いほうが後から届く: 手当が違い、作業員1 に何も付いていない
        const other: AllowanceDayItem = { id: 'zzz', name: '別の手当', description: null, foremanAmount: 1, memberAmount: 1 };
        await settle(stale, ok(allowanceResponse('admin1', TODAY, [other], [allowanceMember('admin1', 'admin1', [], [other]), allowanceMember('admin1', 'w1', [], [other])])));
        expect(screen.queryByText('別の手当')).toBeNull();
        expect(chipTexts('w1')).toEqual(['大規模手当200円']);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
    });

    it('日付を切り替えた直後: 新しい答えが届くまで出さない。前の日付の答えが後から届いても使わない', async () => {
        const { calls } = await open(() => undefined);
        const first = calls.filter(isAllowanceGet).find((g) => dayQuery(g).date === '2026-09-30') as Call;
        fireEvent.click(screen.getByLabelText('翌日')); // 10/1 へ（9/30 の答えはまだ届いていない）
        await flush();
        const second = calls.filter(isAllowanceGet).find((g) => dayQuery(g).date === '2026-10-01') as Call;
        expect(second).toBeTruthy();
        expectNoAllowanceParts();
        await settle(second, ok(allowanceResponse('F1', '2026-10-01', [LARGE], crew('F1'))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false');
        await settle(first, ok(allowanceResponse('F1', '2026-09-30', [LARGE, FAR], crew('F1', { w1: [rec()] }, [LARGE, FAR]))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false'); // 9/30 の「付いている」は映らない
        expect(chipTexts('w1')).toEqual(['大規模手当200円']);                          // 9/30 の手当の一覧も映らない
    });

    it('内容が出たあとで日付を切り替えた瞬間も、前の日付のボタンは残らない', async () => {
        const { calls, container } = await open(onAllowanceGet((c) => (dayQuery(c).date === '2026-09-30'
            ? ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1', { w1: [rec()] })))
            : undefined)));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        // 出勤簿の読み込みが済んでメンバーが出たあとも、手当は 10/1 の答えが届くまで出ない
        expect(screen.queryByText('作業員1')).not.toBeNull();
        expectAsBefore(container);
        expect(calls.filter(isAllowanceGet).some((g) => dayQuery(g).date === '2026-10-01')).toBe(true);
    });

    it('日付を進めて、その答えが届く前に戻したときも、戻した日の新しい答えが届くまで出さない（前に読んだ古い内容を出さない）', async () => {
        let hold = false;
        const route = onAllowanceGet((c) => (hold ? undefined : ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], crew('F1', { w1: [rec()] })))));
        const { calls } = await open(route);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        hold = true;
        fireEvent.click(screen.getByLabelText('翌日')); // 10/1 へ（答えは届かない）
        await flush();
        fireEvent.click(screen.getByLabelText('前日')); // 9/30 へ戻す（新しい答えは、まだ届かない）
        await flush();
        expect(screen.queryAllByText('作業員1').length).toBe(1); // 出勤簿のメンバーは出ている
        expectNoAllowanceParts();                                // 前に読んだ 9/30 の内容は出さない
        const pending = calls.filter(isAllowanceGet).filter((g) => !g.settled && dayQuery(g).date === '2026-09-30');
        expect(pending.length).toBe(1);
        await settle(pending[0], ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1'))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false'); // そのあいだに取り消されていた
    });

    it('閉じて、同じ職長・日付で開き直すと、読み直す。新しい答えが届くまで、前に開いたときの内容を出さない', async () => {
        let hold = false;
        const route = onAllowanceGet((c) => (hold ? undefined : ok(allowanceResponse('F1', dayQuery(c).date, [LARGE], crew('F1', { w1: [rec()] })))));
        const calls = installFetch(routeOf(route));
        const utils = render(modalElement(false));
        const sameDay = { date: new Date(D930) };
        utils.rerender(modalElement(true, sameDay));
        await flush();
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');

        utils.rerender(modalElement(false));
        await flush();
        hold = true; // 開き直したときの読み込みには、まだ答えない
        const getsBefore = calls.filter(isAllowanceGet).length;
        utils.rerender(modalElement(true, sameDay));
        await flush();
        expect(screen.queryAllByText('作業員1').length).toBe(1); // 出勤簿のメンバーは出ている
        expectNoAllowanceParts();
        const reopened = calls.filter(isAllowanceGet).slice(getsBefore);
        expect(reopened.map((g) => [describeCall(g), g.settled])).toEqual([['GET /api/allowances/day?foremanId=F1&date=2026-09-30', false]]);
        await settle(reopened[0], ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1'))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false'); // 閉じているあいだに取り消されていた
    });

    it('職長を切り替えたら（管理者）、前の職長の班で読んだ内容は出さずに、新しい職長の班を読む', async () => {
        mockSessionUser = ADMIN;
        let hold = false;
        const route = onAllowanceGet((c) => (hold ? undefined : allowanceGet({ w1: [rec()] })(c)));
        const { calls, container } = await open(route);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        hold = true;
        fireEvent.change(foremanSelect(container), { target: { value: 'F2' } });
        await flush();
        expect(cardsOf(container).length).toBe(3); // 出勤簿は、職長2 の班（3人）に変わっている
        expectNoAllowanceParts();                  // 作業員1 は職長2 の班にもいるが、職長1 の班で読んだ内容は出さない
        const pending = calls.filter(isAllowanceGet).filter((g) => !g.settled);
        expect(pending.map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F2&date=2026-09-30']);
        await settle(pending[0], ok(allowanceResponse('F2', '2026-09-30', [LARGE], crew('F2'))));
        expect([chipTexts('F2'), chipTexts('w1'), chipTexts('F1')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円']]);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false');
    });

    it('送っている最中に日付を切り替えたら、PUT の応答の member は、新しい日付の表示に使わない。知らせは、送ったときの日付で送る', async () => {
        const { calls } = await open(allowanceGet());
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        const putCall = calls.filter(isAllowancePut)[0];
        expect(putCall.settled).toBe(false);
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false'); // 10/1 の表示
        // 10/1 の同じ人・同じ手当のボタンは、9/30 ぶんの送信が終わっていなくても押せる
        expect(isSending(chip('w1', '大規模手当'))).toEqual([false, false]);
        const getsBefore = calls.filter(isAllowanceGet).length;
        await settle(putCall, putResult('added', allowanceMember('F1', 'w1', [rec({ id: 'n' })])));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false'); // 9/30 の答えは 10/1 に映らない
        expect(isSending(chip('w1', '大規模手当'))).toEqual([false, false]);
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore);
        // 知らせの日付は、送ったときの日付
        expect(bc.__sent).toEqual([{ event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } }]);
    });

    // [名前, 応答の result, 応答の monthClosed, 出るトースト]
    const afterSwitchCases: [string, string, boolean, string[]][] = [
        ['inactive', 'inactive', false, [INACTIVE_TOAST]],
        ['not_target', 'not_target', false, [NOT_TARGET_TOAST]],
        ['not_found', 'not_found', false, [NOT_FOUND_TOAST]],
        ['blocked', 'blocked', false, ['この記録は取り消せません']],
        ['closed', 'closed', true, [CLOSED_REASON]],
        ['unchanged（月が締められていた＝monthClosed が、送ったときの画面と違う）', 'unchanged', true, []],
    ];
    it.each(afterSwitchCases)('送っている最中に日付を切り替えたあとで %s が返ったら: 断られたことは知らせる。前の日付を読み直さない・新しい日付の読み込みは乱さない', async (_name, result, monthClosed, toasts) => {
        // GET は 9/30 だけすぐ答える。10/1 の答えはあとで返す
        const route: Route = (c) => (isAllowanceGet(c) && dayQuery(c).date === '2026-09-30' ? allowanceGet()(c) : undefined);
        const { calls } = await open(route);
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        const putCall = calls.filter(isAllowancePut)[0];
        fireEvent.click(screen.getByLabelText('翌日'));
        await flush();
        const nextDayGet = calls.filter(isAllowanceGet).find((g) => dayQuery(g).date === '2026-10-01') as Call;
        expect(nextDayGet.settled).toBe(false);
        const getsBefore = calls.filter(isAllowanceGet).length;

        await settle(putCall, putResult(result, allowanceMember('F1', 'w1'), monthClosed));
        expect(errors()).toEqual(toasts);                                  // 保存されていないことは知らせる
        expect(calls.filter(isAllowanceGet).length).toBe(getsBefore);     // 前の日付を読み直さない
        expect(bc.__sent).toEqual([]);

        // 10/1 の答えが届いたら、ふつうに出る（前の日付の読み直しで、捨てられていない）
        await settle(nextDayGet, ok(allowanceResponse('F1', '2026-10-01', [LARGE], crew('F1', { w1: [rec({ id: 'd2' })] }))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
    });

    it('保存より前に始まっていた読み直しが、まだ走っているとき: 保存の表示は、その古い答えで巻き戻らない。保存のあとで、もう一度読み直す', async () => {
        let hold = false;
        const route = onAllowanceGet((c) => (hold ? undefined : allowanceGet()(c)));
        const { calls } = await open(route);
        hold = true;
        await act(async () => { bc.__emit(ALLOWANCE_EVENT, { date: '2026-09-30' }); }); // 読み直しが走り出す（答えはまだ）
        const reload = calls.filter(isAllowanceGet).slice(-1)[0];
        expect(reload.settled).toBe(false);
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        const getsBeforeSave = calls.filter(isAllowanceGet).length;
        await settle(calls.filter(isAllowancePut)[0], putResult('added', allowanceMember('F1', 'w1', [rec({ id: 'n1' })])));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        // 保存のあとで、追い越すための読み直しが1回走っている
        expect(calls.filter(isAllowanceGet).slice(getsBeforeSave).map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F1&date=2026-09-30']);
        const newer = calls.filter(isAllowanceGet).slice(-1)[0];
        expect(newer).not.toBe(reload);
        // 保存より前に始まっていた読み直しの答え（まだ付いていない状態）が後から届く
        await settle(reload, ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1'))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        // 新しいほうの答え（別の端末が、作業員2 にも付けていた）で最新になる
        await settle(newer, ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1', { w1: [rec({ id: 'n1' })], w2: [rec({ id: 'n2', createdBy: 'admin1', createdByName: '管理者', canRemove: false })] }))));
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        expect(chip('w2', '大規模手当').getAttribute('aria-pressed')).toBe('true');
    });

    describe('ボタンを続けて押したとき（手当が2つ出ている日）', () => {
        const largeRec = rec({ id: 'n1' });
        const farRec = rec({ id: 'n2', itemId: 'far', itemName: '遠方手当', amount: 500 });
        const byAdmin = rec({ id: 'n3', createdBy: 'admin1', createdByName: '管理者', canRemove: false });
        const TWO = [LARGE, FAR];
        const SAVE_FAILED = '手当の保存に失敗しました';
        /** その人のカードの [大規模手当, 遠方手当] が付いているか */
        const pressed = (userId: string) => [chip(userId, '大規模手当'), chip(userId, '遠方手当')].map((b) => b.getAttribute('aria-pressed'));
        /** 開いたあとに走った読み直し（手当の GET） */
        const reloadsAfter = (calls: Call[], before: number) => calls.filter(isAllowanceGet).slice(before);
        /** 開いたあとに走った読み直しを [URL, 答えが済んだか] の形で */
        const reloadStates = (calls: Call[], before: number) => reloadsAfter(calls, before).map((g) => [describeCall(g), g.settled]);
        const RELOAD = 'GET /api/allowances/day?foremanId=F1&date=2026-09-30';
        /** 読み直しの答え（9/30・手当2つ・人ごとの記録） */
        const dayOf = (records: RecordsByUser) => ok(allowanceResponse('F1', '2026-09-30', TWO, crew('F1', records, TWO)));
        /** 開くときの読み込みにだけすぐ答える。そのあとの PUT と読み直しには、テストの中で順番を決めて答える */
        const openTwoItems = async () => {
            let hold = false;
            const opened = await open(onAllowanceGet((c) => (hold ? undefined : allowanceGet({}, TWO)(c))));
            hold = true;
            return { ...opened, getsBefore: opened.calls.filter(isAllowanceGet).length };
        };
        const failures: [string, Reply][] = [['500', fail(500)], ['ネットワークエラー', networkError]];

        it('同じ人の2つのボタンを続けて押し、応答が逆の順に届いても、表示が古いほうに戻らない。どちらの応答のあとにも読み直し、最後の読み直しの答えが表示される', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);
            expect([putLarge.body?.itemId, putFar.body?.itemId]).toEqual(['large', 'far']);

            // あとに押した「遠方手当」の応答が先に届く（サーバーでは、もう両方付いている）
            // → いちばん新しい保存なので、表示に使う。同じ人の保存が重なっていたので、読み直しも始める
            await settle(putFar, putResult('added', allowanceMember('F1', 'w1', [largeRec, farRec])));
            expect(pressed('w1')).toEqual(['true', 'true']);
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false]]);

            // 先に押した「大規模手当」の応答（大規模手当だけが付いた、古い状態）が後から届く → 表示に使わない。もう一度読み直す
            await settle(putLarge, putResult('added', allowanceMember('F1', 'w1', [largeRec])));
            expect(pressed('w1')).toEqual(['true', 'true']); // 遠方手当が「付いていない」に戻らない
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false], [RELOAD, false]]);

            // 先に始めた読み直しの答え（大規模手当だけの、古い状態）は、あとの読み直しに追い越されているので使わない
            const [older, newer] = reloadsAfter(calls, getsBefore);
            await settle(older, dayOf({ w1: [largeRec] }));
            expect(pressed('w1')).toEqual(['true', 'true']);
            // 最後の読み直しの答えが表示される（別の端末が、作業員2 にも付けていた）
            await settle(newer, dayOf({ w1: [largeRec, farRec], w2: [byAdmin] }));
            expect([pressed('w1'), pressed('w2')]).toEqual([['true', 'true'], ['true', 'false']]);

            // どちらのボタンも、また押せる。知らせは、入った分だけ（2回）。トーストは出ない
            expect([isSending(chip('w1', '大規模手当')), isSending(chip('w1', '遠方手当'))]).toEqual([[false, false], [false, false]]);
            expect(bc.__sent).toEqual([
                { event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } },
                { event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } },
            ]);
            expect([errors(), notices()]).toEqual([[], []]);
        });

        it('同じ人の2つのボタンを続けて押し、応答が押した順に届いたとき: 先に押したほうの応答は表示に使わず読み直す。あとに押したほうの応答は表示に使い、そのあとでもう一度読み直す', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);

            // 先に押したほうの応答: あとから別の保存を送っているので、古いかもしれない → 表示に使わず、読み直しを始める
            await settle(putLarge, putResult('added', allowanceMember('F1', 'w1', [largeRec])));
            expect(pressed('w1')).toEqual(['false', 'false']);
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false]]);

            // あとに押したほうの応答: 表示に使う。重なっていたので、この応答のあとでも読み直す（走っていた読み直しは追い越す）
            await settle(putFar, putResult('added', allowanceMember('F1', 'w1', [largeRec, farRec])));
            expect(pressed('w1')).toEqual(['true', 'true']);
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false], [RELOAD, false]]);

            const [older, newer] = reloadsAfter(calls, getsBefore);
            await settle(older, dayOf({})); // 追い越された読み直しの答え（どちらも付く前の状態）は使わない
            expect(pressed('w1')).toEqual(['true', 'true']);
            await settle(newer, dayOf({ w1: [largeRec, farRec], w2: [byAdmin] })); // 最後の読み直しの答えが表示される
            expect([pressed('w1'), pressed('w2')]).toEqual([['true', 'true'], ['true', 'false']]);
        });

        it('サーバーが「あとに押したほう」を先に処理し、その応答（古い状態）がいちばん後に届いても、最後の読み直しで正しい状態になる', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);

            // サーバーは 遠方手当（あとに押した）→ 大規模手当（先に押した）の順に処理した。
            // 大規模手当の応答（両方付いた状態）が先に届く → あとから別の保存を送っているので表示に使わず、読み直す
            await settle(putLarge, putResult('added', allowanceMember('F1', 'w1', [largeRec, farRec])));
            expect(pressed('w1')).toEqual(['false', 'false']);
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false]]);
            await settle(reloadsAfter(calls, getsBefore)[0], dayOf({ w1: [largeRec, farRec] }));
            expect(pressed('w1')).toEqual(['true', 'true']);

            // 遠方手当の応答（遠方手当だけが付いた、古い状態）が、読み直しの答えよりも後に届く
            // → 同じ人の保存が重なっていたので、この応答のあとでも読み直す
            await settle(putFar, putResult('added', allowanceMember('F1', 'w1', [farRec])));
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, true], [RELOAD, false]]);
            // 最後に出るのは、読み直しの答え（両方付いた状態）
            await settle(reloadsAfter(calls, getsBefore)[1], dayOf({ w1: [largeRec, farRec] }));
            expect(pressed('w1')).toEqual(['true', 'true']);
            expect(reloadsAfter(calls, getsBefore).length).toBe(2);
        });

        it('あとに押したほうの保存が失敗しても、先に押したほうの保存は、読み直しで表示に映る', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);
            await settle(putFar, fail(500));
            expect(errors()).toEqual([SAVE_FAILED]);
            expect(reloadStates(calls, getsBefore)).toEqual([]); // 失敗しただけでは読み直さない
            await settle(putLarge, putResult('added', allowanceMember('F1', 'w1', [largeRec])));
            expect(pressed('w1')).toEqual(['false', 'false']); // 応答そのものは、表示に使わない
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false]]);
            await settle(reloadsAfter(calls, getsBefore)[0], dayOf({ w1: [largeRec] }));
            expect(pressed('w1')).toEqual(['true', 'false']);
        });

        it.each(failures)('1つ目を送っている最中に押した2つ目は、1つ目が %s で失敗しても「重なっていた」扱いで、応答のあとに読み直す。どちらも終わったあとに押した3つ目は、重なっていない扱い', async (_name, failure) => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);
            await settle(putLarge, failure);
            expect(errors()).toEqual([SAVE_FAILED]);
            expect(reloadStates(calls, getsBefore)).toEqual([]); // 失敗しただけでは読み直さない

            await settle(putFar, putResult('added', allowanceMember('F1', 'w1', [farRec])));
            expect(pressed('w1')).toEqual(['false', 'true']); // いちばん新しい保存の応答は、表示に使う
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false]]); // 重なっていたので、読み直す
            await settle(reloadsAfter(calls, getsBefore)[0], dayOf({ w1: [farRec] }));
            expect(pressed('w1')).toEqual(['false', 'true']);

            // どちらも終わったあとで「大規模手当」を押し直す → 送っている最中の保存は無いので、読み直さない
            fireEvent.click(chip('w1', '大規模手当'));
            await flush();
            await settle(calls.filter(isAllowancePut)[2], putResult('added', allowanceMember('F1', 'w1', [largeRec, farRec])));
            expect(pressed('w1')).toEqual(['true', 'true']);
            expect(reloadsAfter(calls, getsBefore).length).toBe(1);
        });

        it.each(failures)('1つ目が %s で失敗して終わったあとに押した2つ目は、重なっていない扱い（応答を表示に使う・読み直さない）', async (_name, failure) => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            await flush();
            await settle(calls.filter(isAllowancePut)[0], failure);
            expect(errors()).toEqual([SAVE_FAILED]);
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            await settle(calls.filter(isAllowancePut)[1], putResult('added', allowanceMember('F1', 'w1', [farRec])));
            expect(pressed('w1')).toEqual(['false', 'true']);
            expect(reloadStates(calls, getsBefore)).toEqual([]);
        });

        it('先に押したほうが断られた（not_target）ときも、断られたことは知らせる。その応答のあとの読み直しは1回だけ', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);
            await settle(putLarge, putResult('not_target', allowanceMember('F1', 'w1')));
            expect(errors()).toEqual([NOT_TARGET_TOAST]);
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false]]); // 「断られた」と「保存が重なっていた」が両方当てはまっても、1回
            await settle(putFar, putResult('added', allowanceMember('F1', 'w1', [farRec])));
            expect(pressed('w1')).toEqual(['false', 'true']);
            expect(reloadStates(calls, getsBefore)).toEqual([[RELOAD, false], [RELOAD, false]]);
            expect(bc.__sent).toEqual([{ event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } }]); // 入った分だけ
        });

        it('別の人のボタンを続けて押したときは、応答が逆の順に届いても、どちらの応答も表示に使う（読み直さない）', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w2', '遠方手当'));
            await flush();
            const [putW1, putW2] = calls.filter(isAllowancePut);
            expect([putW1.body?.userId, putW2.body?.userId]).toEqual(['w1', 'w2']);
            await settle(putW2, putResult('added', allowanceMember('F1', 'w2', [farRec])));
            await settle(putW1, putResult('added', allowanceMember('F1', 'w1', [largeRec])));
            expect([pressed('w1'), pressed('w2')]).toEqual([['true', 'false'], ['false', 'true']]);
            expect(reloadStates(calls, getsBefore)).toEqual([]);
        });

        it('同じ人でも、1つ目の応答が届いてから2つ目を押したときは、ふつうどおり（どちらの応答も表示に使う・読み直さない）', async () => {
            const { calls, getsBefore } = await openTwoItems();
            fireEvent.click(chip('w1', '大規模手当'));
            await flush();
            await settle(calls.filter(isAllowancePut)[0], putResult('added', allowanceMember('F1', 'w1', [largeRec])));
            expect(pressed('w1')).toEqual(['true', 'false']);
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            await settle(calls.filter(isAllowancePut)[1], putResult('added', allowanceMember('F1', 'w1', [largeRec, farRec])));
            expect(pressed('w1')).toEqual(['true', 'true']);
            // 同じボタンをもう一度（取り消す）
            fireEvent.click(chip('w1', '大規模手当'));
            await flush();
            await settle(calls.filter(isAllowancePut)[2], putResult('removed', allowanceMember('F1', 'w1', [farRec])));
            expect(pressed('w1')).toEqual(['false', 'true']);
            expect(reloadStates(calls, getsBefore)).toEqual([]);
        });

        it('送っている最中に日付を切り替えたら、同じ人の保存が重なっていても、前の日付を読み直さない（先に押したほう・あとに押したほうの、どちらの応答でも）', async () => {
            // GET は 9/30 だけすぐ答える。10/1 の答えはあとで返す
            const route: Route = (c) => (isAllowanceGet(c) && dayQuery(c).date === '2026-09-30' ? allowanceGet({}, TWO)(c) : undefined);
            const { calls } = await open(route);
            fireEvent.click(chip('w1', '大規模手当'));
            fireEvent.click(chip('w1', '遠方手当'));
            await flush();
            const [putLarge, putFar] = calls.filter(isAllowancePut);
            fireEvent.click(screen.getByLabelText('翌日'));
            await flush();
            const nextDayGet = calls.filter(isAllowanceGet).find((g) => dayQuery(g).date === '2026-10-01') as Call;
            expect(nextDayGet.settled).toBe(false);
            const getsBefore = calls.filter(isAllowanceGet).length;

            await settle(putLarge, putResult('added', allowanceMember('F1', 'w1', [largeRec])));          // 先に押したほう（追い越された応答）
            await settle(putFar, putResult('added', allowanceMember('F1', 'w1', [largeRec, farRec])));    // あとに押したほう（送っている最中に押した保存）
            expect(reloadStates(calls, getsBefore)).toEqual([]);
            // 知らせは、送ったときの日付で、入った分だけ送る
            expect(bc.__sent).toEqual([
                { event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } },
                { event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } },
            ]);

            await settle(nextDayGet, ok(allowanceResponse('F1', '2026-10-01', TWO, crew('F1', { w1: [rec({ id: 'd2' })] }, TWO))));
            expect(pressed('w1')).toEqual(['true', 'false']); // 10/1 の答えは、ふつうに出る
        });
    });
});

// =====================================================================================
describe('E. 別の端末からの知らせ', () => {
    it('allowances_updated を受けたら読み直す（日付の違う知らせでは読み直さない・日付の無い知らせでは読み直す）。読み直しているあいだも、前の内容は出したまま。閉じたら聞くのをやめる', async () => {
        let hold = false;
        const route = onAllowanceGet((c) => (hold ? undefined : allowanceGet()(c)));
        const calls = installFetch(routeOf(route));
        const utils = render(modalElement(false));
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(0);
        utils.rerender(modalElement(true));
        await flush();
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(1);
        const before = calls.filter(isAllowanceGet).length;

        await act(async () => { bc.__emit(ALLOWANCE_EVENT, { date: '2026-09-29' }); });
        await flush();
        expect(calls.filter(isAllowanceGet).length).toBe(before); // 日付の違う知らせ

        hold = true;
        await act(async () => { bc.__emit(ALLOWANCE_EVENT, { date: '2026-09-30' }); });
        await flush();
        const reload = calls.filter(isAllowanceGet).slice(before);
        expect(reload.map((g) => [describeCall(g), g.settled])).toEqual([['GET /api/allowances/day?foremanId=F1&date=2026-09-30', false]]);
        // 読み直しているあいだも、前の内容は出したまま（ボタンも一文も消えない・押せる）
        expect([chipTexts('F1'), chipTexts('w1'), chipTexts('w2')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円']]);
        expect(screen.queryByTestId('allowance-notice')).not.toBeNull();
        expect(isSending(chip('w1', '大規模手当'))).toEqual([false, false]);
        // 答えが届いたら映る（別の端末で、管理者が作業員1 に付けていた）
        await settle(reload[0], ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1', { w1: [rec({ id: 'x', createdBy: 'admin1', createdByName: '管理者', canRemove: false })] }))));
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', ariaDisabled: 'true', title: '管理者さんが付けました' });

        hold = false;
        await act(async () => { bc.__emit(ALLOWANCE_EVENT, {}); }); // 日付の無い知らせ（「手当」の画面・設定から）
        await flush();
        expect(calls.filter(isAllowanceGet).length).toBe(before + 2);

        const attendanceCalls = calls.filter(isAttendanceCall).length;
        utils.rerender(modalElement(false));
        await flush();
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(0);
        expect(calls.filter(isAttendanceCall).length).toBe(attendanceCalls); // 知らせで出勤簿は読み直さない

        // 閉じたあとの知らせでは、何も読まない
        const total = calls.length;
        await act(async () => { bc.__emit(ALLOWANCE_EVENT, {}); });
        await flush();
        expect(calls.length).toBe(total);
    });

    it('評価ポイントの知らせ（evaluation_points_updated）では、手当を読み直さない。手当の知らせ（allowances_updated）では、評価ポイントを読み直さない。出勤簿の知らせでは、どちらも読み直さない', async () => {
        const { calls } = await open(allowanceGet(), { points: pointsWithItems });
        const count = () => [calls.filter(isAllowanceGet).length, calls.filter(isPointGet).length, calls.filter(isAttendanceCall).length];
        const [allowanceGets, pointGets, attendanceCalls] = count();
        expect(bc.__listenerCount(POINT_EVENT)).toBe(1);

        await act(async () => { bc.__emit(POINT_EVENT, { date: '2026-09-30' }); });
        await flush();
        expect(count()).toEqual([allowanceGets, pointGets + 1, attendanceCalls]);

        await act(async () => { bc.__emit(POINT_EVENT, {}); });
        await flush();
        expect(count()).toEqual([allowanceGets, pointGets + 2, attendanceCalls]);

        await act(async () => { bc.__emit(ALLOWANCE_EVENT, { date: '2026-09-30' }); });
        await flush();
        expect(count()).toEqual([allowanceGets + 1, pointGets + 2, attendanceCalls]);

        await act(async () => { bc.__emit(ALLOWANCE_EVENT, {}); });
        await flush();
        expect(count()).toEqual([allowanceGets + 2, pointGets + 2, attendanceCalls]);

        await act(async () => { bc.__emit('attendance_updated', { foremanId: 'F1', date: '2026-09-30' }); });
        await flush();
        expect(count()).toEqual([allowanceGets + 2, pointGets + 2, attendanceCalls]);
    });

    it('読み直しに失敗しても、前に読めた内容は出したまま（トーストも出さない）。押せば今までどおり送れる', async () => {
        let failNow = false;
        const route: Route = (c) => {
            if (isAllowanceGet(c)) return failNow ? fail(500) : allowanceGet({ w1: [rec()] })(c);
            if (isAllowancePut(c)) return putResult('removed', allowanceMember('F1', 'w1'));
            return undefined;
        };
        const { calls } = await open(route);
        failNow = true;
        await act(async () => { bc.__emit(ALLOWANCE_EVENT, { date: '2026-09-30' }); });
        await flush();
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        expect(screen.queryByTestId('allowance-notice')).not.toBeNull();
        expect([errors(), notices()]).toEqual([[], []]);
        expect(logged()).toEqual(['手当の読み込みに失敗:']);
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).length).toBe(1);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('false');
    });

    it('別の端末で月が締められた知らせ（日付なし）を受けたら、読み直して、締めた月の表示になる', async () => {
        let closed = false;
        const route = onAllowanceGet((c) => ok(allowanceResponse('F1', dayQuery(c).date, closed ? [] : [LARGE], crew('F1', { w1: [rec({ canRemove: !closed })] }, closed ? [] : [LARGE]), closed)));
        await open(route);
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', ariaDisabled: null, lock: false });
        expect(chipTexts('w2')).toEqual(['大規模手当200円']);
        closed = true;
        await act(async () => { bc.__emit(ALLOWANCE_EVENT, {}); });
        await flush();
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', ariaDisabled: 'true', title: CLOSED_REASON, lock: true });
        expect([chipTexts('F1'), chipTexts('w2')]).toEqual([null, null]);
        expect(screen.queryByTestId('allowance-notice')).toBeNull();
    });
});

// =====================================================================================
describe('F. 評価ポイントと同時に出るとき、たがいに邪魔をしない', () => {
    const pointTexts = (userId: string) => Array.from((pointChipsOf(userId) as HTMLElement).querySelectorAll('button')).map((b) => b.textContent);

    it('両方のボタンが出る。カードの中の並びは、選択欄の行 → 評価ポイント → 手当。見出しの下の一文も、評価ポイント → 手当', async () => {
        const { container } = await open(allowanceGet(), { points: pointsWithItems });
        for (const id of ['F1', 'w1', 'w2']) {
            const points = pointChipsOf(id) as HTMLElement;
            const allowances = chipsOf(id) as HTMLElement;
            expect((points.previousElementSibling as HTMLElement).querySelectorAll('select').length).toBe(5);
            expect(points.nextElementSibling).toBe(allowances);
            expect(allowances.nextElementSibling).toBeNull(); // カードのいちばん下
        }
        expect([pointChipsOf('pm1'), chipsOf('pm1')]).toEqual([null, null]);
        // ボタンの中身は、それぞれのもの
        expect(pointTexts('w1')).toEqual(['洗車', 'ヘルプ']);
        expect(chipTexts('w1')).toEqual(['大規模手当200円']);

        const pointNotice = screen.getByTestId('point-notice');
        const allowanceNotice = screen.getByTestId('allowance-notice');
        expect(pointNotice.previousElementSibling?.textContent).toBe('積込・残業・早終全員定時');
        expect(pointNotice.nextElementSibling).toBe(allowanceNotice);
        expect(allowanceNotice.nextElementSibling).toBe(cardsOf(container)[0].parentElement);
        expect(allowanceNotice.textContent).toBe(NOTICE);
        // (i) は、それぞれの一文に1つずつ
        expect(pointNotice.contains(screen.getByLabelText('評価ポイントの項目の説明'))).toBe(true);
        expect(allowanceNotice.contains(screen.getByLabelText(INFO_LABEL))).toBe(true);
    });

    it('手当を押しても評価ポイントの PUT は飛ばない（逆も）。知らせも別々で、相手のボタンの色は変わらない・相手を読み直さない', async () => {
        const route: Route = (c) => allowanceGet()(c) ?? (isAllowancePut(c) ? putResult('added', allowanceMember('F1', 'w1', [rec({ id: 'a1' })])) : undefined);
        const points: Route = (c) => pointsWithItems(c) ?? (isPointPut(c) ? ok({ result: 'added', member: pointMember('w1', [pointRecord({ id: 'p1' })]) }) : undefined);
        const { calls } = await open(route, { points });
        const getsBefore = [calls.filter(isAllowanceGet).length, calls.filter(isPointGet).length];

        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: true }]);
        expect(calls.filter(isPointPut).length).toBe(0);
        expect(bc.__sent).toEqual([{ event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } }]);
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        expect([pointChip('w1', '洗車'), pointChip('w1', 'ヘルプ')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);

        bc.__sent.length = 0;
        fireEvent.click(pointChip('w1', '洗車'));
        await flush();
        expect(calls.filter(isPointPut).map((p) => p.body)).toEqual([{ foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'wash', on: true }]);
        expect(calls.filter(isAllowancePut).length).toBe(1);
        expect(bc.__sent).toEqual([{ event: POINT_EVENT, payload: { date: '2026-09-30' } }]);
        expect(pointChip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        expect(chip('w2', '大規模手当').getAttribute('aria-pressed')).toBe('false');
        expect([calls.filter(isAllowanceGet).length, calls.filter(isPointGet).length]).toEqual(getsBefore);
    });

    it('評価ポイントの項目と手当の id が同じでも、送っているあいだ押せなくなるのは、押したほうだけ', async () => {
        const sameIdPoints = pointsGet([{ id: 'large', name: '大きい現場', description: null }]);
        const { calls } = await open(allowanceGet(), { points: sameIdPoints }); // どちらの PUT にも答えない＝送っている最中のまま
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(isSending(chip('w1', '大規模手当'))).toEqual([true, true]);
        expect(pointChip('w1', '大きい現場').disabled).toBe(false);
        fireEvent.click(pointChip('w1', '大きい現場'));
        await flush();
        expect([calls.filter(isAllowancePut).length, calls.filter(isPointPut).length]).toEqual([1, 1]);
    });

    const brokenLoads: [string, Reply | undefined][] = [
        ['500', fail(500)],
        ['ネットワークエラー', networkError],
        ['答えが返ってこない', undefined],
    ];

    it.each(brokenLoads)('手当の読み込みが「%s」でも、評価ポイントのボタンは出る・押せる（手当の部品は出ない）', async (_name, reply) => {
        const points: Route = (c) => pointsWithItems(c) ?? (isPointPut(c) ? ok({ result: 'added', member: pointMember('w1', [pointRecord({ id: 'p1' })]) }) : undefined);
        const { calls } = await open(onAllowanceGet(() => reply), { points });
        expect(pointTexts('w1')).toEqual(['洗車', 'ヘルプ']);
        expect(screen.queryByTestId('point-notice')).not.toBeNull();
        expectNoAllowanceParts();
        fireEvent.click(pointChip('w1', '洗車'));
        await flush();
        expect(pointChip('w1', '洗車').getAttribute('aria-pressed')).toBe('true');
        expect(calls.filter(isAllowancePut).length).toBe(0);
        expect(errors()).toEqual([]);
        expect(logged()).toEqual(reply ? ['手当の読み込みに失敗:'] : []);
    });

    it.each(brokenLoads)('評価ポイントの読み込みが「%s」でも、手当のボタンは出る・押せる（評価ポイントの部品は出ない）', async (_name, reply) => {
        const route: Route = (c) => allowanceGet()(c) ?? (isAllowancePut(c) ? putResult('added', allowanceMember('F1', 'w1', [rec({ id: 'a1' })])) : undefined);
        const { calls, container } = await open(route, { points: (c) => (isPointGet(c) ? reply : undefined) });
        expect([chipTexts('F1'), chipTexts('w1'), chipTexts('w2')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円']]);
        expect(screen.getByTestId('allowance-notice').textContent).toBe(NOTICE);
        expect(container.querySelectorAll('[data-testid^="point-"]').length).toBe(0);
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(chip('w1', '大規模手当').getAttribute('aria-pressed')).toBe('true');
        expect(calls.filter(isPointPut).length).toBe(0);
        expect(errors()).toEqual([]);
        expect(logged()).toEqual(reply ? ['評価ポイントの読み込みに失敗:'] : []);
    });

    const pointModes: [string, Route][] = [['項目なし', pointsWithoutItems], ['答えが返ってこない', pointsSilent]];

    it.each(pointModes)('評価ポイントの読み込みが「%s」のとき: 手当は、出る → 押すと付く → もう一度押すと外れる、まで同じように動く。評価ポイントの部品は出ない', async (_name, points) => {
        let on = false;
        const route: Route = (c) => {
            if (isAllowanceGet(c)) return allowanceGet(on ? { w1: [rec({ id: 'n1' })] } : {})(c);
            if (isAllowancePut(c)) {
                on = c.body?.on === true;
                return putResult(on ? 'added' : 'removed', allowanceMember('F1', 'w1', on ? [rec({ id: 'n1' })] : []));
            }
            return undefined;
        };
        const { calls, container } = await open(route, { points });
        expect(container.querySelectorAll('[data-testid^="point-"]').length).toBe(0);
        expect(container.textContent).not.toContain('ポイント');
        // カードの中は、名前の行・選択欄の行・手当 の3つ（対象外の人は2つ）
        expect(cardsOf(container).map((card) => card.children.length)).toEqual([3, 3, 3, 2]);
        expect([chipTexts('F1'), chipTexts('w1'), chipTexts('w2'), chipTexts('pm1')]).toEqual([['大規模手当1,500円'], ['大規模手当200円'], ['大規模手当200円'], null]);
        expect(screen.getByTestId('allowance-notice').previousElementSibling?.textContent).toBe('積込・残業・早終全員定時');

        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'true', tone: TONE_CONFIRMED, disabled: false });
        fireEvent.click(chip('w1', '大規模手当'));
        await flush();
        expect(look(chip('w1', '大規模手当'))).toMatchObject({ pressed: 'false', tone: TONE_OFF, disabled: false });

        expect(calls.filter(isAllowancePut).map((p) => p.body)).toEqual([
            { foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: true },
            { foremanId: 'F1', date: '2026-09-30', userId: 'w1', itemId: 'large', on: false },
        ]);
        expect(bc.__sent).toEqual([
            { event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } },
            { event: ALLOWANCE_EVENT, payload: { date: '2026-09-30' } },
        ]);
        expect(calls.filter((c) => isPointPut(c) || isAttendanceCall(c) && c.method === 'POST').length).toBe(0);
        expect([errors(), notices(), logged()]).toEqual([[], [], []]);
    });
});

// =====================================================================================
describe('G. フックを直接確かめる（描画のたびの値）', () => {
    it('日付・職長を切り替えた直後の最初の描画から、前の日付・前の職長の内容を出さない', async () => {
        const seen: { key: string; ready: boolean; shows: boolean; items: number; hasMember: boolean }[] = [];
        function Probe({ foremanId, dateKey }: { foremanId: string; dateKey: string }) {
            const day = useAllowanceDay({ enabled: true, foremanId, dateKey });
            seen.push({ key: `${foremanId}|${dateKey}`, ready: day.ready, shows: day.showsChips('w1'), items: day.items.length, hasMember: day.memberOf('w1') !== undefined });
            return null;
        }
        const last = () => seen[seen.length - 1];
        // F1・9/30 だけすぐ答える。ほかの日付・ほかの職長の答えは届かない
        installFetch((c) => (isAllowanceGet(c) && dayQuery(c).foremanId === 'F1' && dayQuery(c).date === '2026-09-30' ? allowanceGet()(c) : undefined));
        const utils = render(<Probe foremanId="F1" dateKey="2026-09-30" />);
        await flush();
        expect(last()).toEqual({ key: 'F1|2026-09-30', ready: true, shows: true, items: 1, hasMember: true });

        // 日付を切り替える（10/1）→ 戻す（9/30。読み直して、また出る）→ 職長を切り替える（職長2。作業員1 は、どちらの班にもいる）
        utils.rerender(<Probe foremanId="F1" dateKey="2026-10-01" />);
        await flush();
        utils.rerender(<Probe foremanId="F1" dateKey="2026-09-30" />);
        await flush();
        expect(last()).toEqual({ key: 'F1|2026-09-30', ready: true, shows: true, items: 1, hasMember: true });
        utils.rerender(<Probe foremanId="F2" dateKey="2026-09-30" />);
        await flush();

        // 切り替えてからの描画は、1回目から全部「出さない」
        for (const key of ['F1|2026-10-01', 'F2|2026-09-30']) {
            const after = seen.filter((x) => x.key === key);
            expect(after.length).toBeGreaterThan(0);
            expect(after).toEqual(after.map(() => ({ key, ready: false, shows: false, items: 0, hasMember: false })));
        }
    });

    it('enabled が false のあいだ・職長が空のあいだは、読まない・聞かない・出さない。toggle を呼んでも送らない', async () => {
        const probe: { day?: AllowanceDay } = {};
        const seen: { enabled: boolean; foremanId: string; ready: boolean; shows: boolean }[] = [];
        function Probe({ enabled, foremanId }: { enabled: boolean; foremanId: string }) {
            probe.day = useAllowanceDay({ enabled, foremanId, dateKey: '2026-09-30' });
            seen.push({ enabled, foremanId, ready: probe.day.ready, shows: probe.day.showsChips('w1') });
            return null;
        }
        const calls = installFetch(allowanceGet());
        const utils = render(<Probe enabled={false} foremanId="F1" />);
        await flush();
        await act(async () => { await probe.day?.toggle('w1', 'large', true); });
        expect(calls.length).toBe(0);
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(0);
        expect(bc.initBroadcastChannel).not.toHaveBeenCalled();
        expect([probe.day?.ready, probe.day?.showsChips('w1')]).toEqual([false, false]);

        utils.rerender(<Probe enabled foremanId="" />);
        await flush();
        await act(async () => { await probe.day?.toggle('w1', 'large', true); });
        expect(calls.length).toBe(0);
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(0);
        expect(bc.initBroadcastChannel).not.toHaveBeenCalled();

        // 有効になったら: 読む・知らせの受け口を用意して聞く
        utils.rerender(<Probe enabled foremanId="F1" />);
        await flush();
        expect(calls.map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=F1&date=2026-09-30']);
        expect(bc.__listenerCount(ALLOWANCE_EVENT)).toBe(1);
        expect(bc.initBroadcastChannel).toHaveBeenCalled();
        expect([probe.day?.ready, probe.day?.showsChips('w1')]).toEqual([true, true]);

        // 無効に戻したら: 出さない・聞かない。toggle を呼んでも何も送らない
        utils.rerender(<Probe enabled={false} foremanId="F1" />);
        await flush();
        expect([probe.day?.ready, probe.day?.showsChips('w1'), probe.day?.items, bc.__listenerCount(ALLOWANCE_EVENT)]).toEqual([false, false, [], 0]);
        await act(async () => { await probe.day?.toggle('w1', 'large', true); });
        expect(calls.length).toBe(1);
        // 無効・職長が空のあいだの描画は、切り替えた直後の1回目から全部「出さない」
        const off = seen.filter((x) => !x.enabled || x.foremanId === '');
        expect(off.length).toBeGreaterThan(2);
        expect(off.every((x) => !x.ready && !x.shows)).toBe(true);
    });

    it('読み込みの途中で無効になった（閉じた）あとに届いた答えは使わない。同じ職長・日付で有効に戻した直後の描画にも出さない', async () => {
        const seen: { phase: string; ready: boolean; shows: boolean }[] = [];
        let phase = '開いた';
        function Probe({ enabled }: { enabled: boolean }) {
            const day = useAllowanceDay({ enabled, foremanId: 'F1', dateKey: '2026-09-30' });
            seen.push({ phase, ready: day.ready, shows: day.showsChips('w1') });
            return null;
        }
        const calls = installFetch(() => undefined); // どの読み込みにも、あとで答える
        const utils = render(<Probe enabled />);
        await flush();
        phase = '閉じた';
        utils.rerender(<Probe enabled={false} />); // 読み込みの途中で無効になる
        await flush();
        await settle(calls[0], ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1', { w1: [rec()] })))); // そのあとで、答えが届く
        phase = '開き直した';
        utils.rerender(<Probe enabled />); // 新しい読み込みの答えは、まだ届かない
        await flush();
        expect(calls.map(describeCall)).toEqual([
            'GET /api/allowances/day?foremanId=F1&date=2026-09-30',
            'GET /api/allowances/day?foremanId=F1&date=2026-09-30',
        ]);
        expect(seen.filter((x) => x.phase === '開き直した').length).toBeGreaterThan(0);
        expect(seen.filter((x) => x.ready || x.shows)).toEqual([]);

        // 開き直してからの読み込みの答えは使う
        await settle(calls[1], ok(allowanceResponse('F1', '2026-09-30', [LARGE], crew('F1'))));
        expect(seen[seen.length - 1]).toEqual({ phase: '開き直した', ready: true, shows: true });
    });

    it('ready・monthClosed・items・memberOf は、読めた答えのとおり。読めるまで・切り替えて読めなかったときは「出せない」', async () => {
        const probe: { day?: AllowanceDay } = {};
        const seen: { dateKey: string; ready: boolean; monthClosed: boolean; items: number }[] = [];
        function Probe({ dateKey }: { dateKey: string }) {
            probe.day = useAllowanceDay({ enabled: true, foremanId: 'F1', dateKey });
            seen.push({ dateKey, ready: probe.day.ready, monthClosed: probe.day.monthClosed, items: probe.day.items.length });
            return null;
        }
        const state = () => ({
            ready: probe.day?.ready,
            monthClosed: probe.day?.monthClosed,
            items: probe.day?.items.map((i) => i.id),
            w1: probe.day?.memberOf('w1')?.records.map((r) => r.id),
            w1Offers: probe.day?.memberOf('w1')?.offers,
            f1Offers: probe.day?.memberOf('F1')?.offers,
            shows: ['F1', 'w1', 'w2', 'pm1', 'だれか'].filter((id) => probe.day?.showsChips(id)),
        });
        const NOT_READY = { ready: false, monthClosed: false, items: [], w1: undefined, w1Offers: undefined, f1Offers: undefined, shows: [] };

        const calls = installFetch(() => undefined);
        const utils = render(<Probe dateKey="2026-09-30" />);
        await flush();
        expect(state()).toEqual(NOT_READY); // 答えが届くまで

        // 締めた月の答え: 付けられる手当は無く、作業員1 にだけ記録がある
        await settle(calls[0], ok(allowanceResponse('F1', '2026-09-30', [], crew('F1', { w1: [rec({ id: 'k', canRemove: false })], pm1: [rec({ id: 'pm' })] }, []), true)));
        expect(state()).toEqual({ ready: true, monthClosed: true, items: [], w1: ['k'], w1Offers: [], f1Offers: [], shows: ['w1'] });
        expect(probe.day?.memberOf('だれか')).toBeUndefined(); // 班にいない人

        // 10/1 へ: 締めていない月。手当が1つ
        utils.rerender(<Probe dateKey="2026-10-01" />);
        await flush();
        expect(state()).toEqual(NOT_READY);
        // 切り替えた直後の1回目の描画から、前の日付の「締めた月」を引きずらない
        expect(seen.filter((x) => x.dateKey === '2026-10-01')).toEqual(seen.filter((x) => x.dateKey === '2026-10-01').map(() => ({ dateKey: '2026-10-01', ready: false, monthClosed: false, items: 0 })));
        await settle(calls[1], ok(allowanceResponse('F1', '2026-10-01', [LARGE], crew('F1'))));
        expect(state()).toEqual({
            ready: true, monthClosed: false, items: ['large'], w1: [],
            w1Offers: [{ itemId: 'large', payRole: 'member', amount: 200 }],
            f1Offers: [{ itemId: 'large', payRole: 'foreman', amount: 1500 }],
            shows: ['F1', 'w1', 'w2'],
        });

        // 10/2 へ: 読み込みに失敗 → 何も出せない（前の日付の内容も出さない）
        utils.rerender(<Probe dateKey="2026-10-02" />);
        await flush();
        await settle(calls[2], fail(500));
        expect(state()).toEqual(NOT_READY);
        expect(logged()).toEqual(['手当の読み込みに失敗:']);
    });

    it('保存の応答の monthClosed は、どちら向きに違っていても読み直す: 画面が「締めた月」で、応答が「締めていない」（締めが外されていた）とき', async () => {
        const probe: { day?: AllowanceDay } = {};
        function Probe() {
            probe.day = useAllowanceDay({ enabled: true, foremanId: 'F1', dateKey: '2026-09-30' });
            return null;
        }
        const state = () => [probe.day?.monthClosed, probe.day?.items.map((i) => i.id), probe.day?.memberOf('w1')?.records.map((r) => r.canRemove)];
        // 締めた月として読めている。そのあとで管理者が締めを外した（知らせは届かなかった）
        let reopened = false;
        const calls = installFetch((c) => {
            if (isAllowanceGet(c)) {
                return ok(allowanceResponse('F1', '2026-09-30', reopened ? [LARGE] : [], crew('F1', { w1: [rec({ id: 'k', canRemove: reopened })] }, reopened ? [LARGE] : []), !reopened));
            }
            if (isAllowancePut(c)) return putResult('unchanged', allowanceMember('F1', 'w2'), !reopened);
            return undefined;
        });
        render(<Probe />);
        await flush();
        expect(state()).toEqual([true, [], [false]]);

        // 応答の monthClosed が、画面と同じ（締めたまま）なら読み直さない
        await act(async () => { await probe.day?.toggle('w2', 'large', false); });
        await flush();
        expect(calls.filter(isAllowanceGet).length).toBe(1);
        expect(state()).toEqual([true, [], [false]]);

        // 締めが外されたあと: 応答の monthClosed が false → 読み直して、締めていない月の内容になる
        reopened = true;
        await act(async () => { await probe.day?.toggle('w2', 'large', false); });
        await flush();
        expect(calls.filter(isAllowanceGet).length).toBe(2);
        expect(state()).toEqual([false, ['large'], [true]]);
    });

    it('保存の応答の member が、読めている班にいない人なら、その人を足さない（memberOf は undefined のまま・ほかの人も変わらない）', async () => {
        const probe: { day?: AllowanceDay } = {};
        function Probe() {
            probe.day = useAllowanceDay({ enabled: true, foremanId: 'F1', dateKey: '2026-09-30' });
            return null;
        }
        installFetch((c) => {
            if (isAllowanceGet(c)) return allowanceGet()(c);
            if (isAllowancePut(c)) return ok({ result: 'added', monthClosed: false, member: { userId: 'だれか', records: [rec({ id: 'zz' })] } });
            return undefined;
        });
        render(<Probe />);
        await flush();
        await act(async () => { await probe.day?.toggle('w2', 'large', true); });
        await flush();
        expect(probe.day?.memberOf('だれか')).toBeUndefined();
        expect(probe.day?.showsChips('だれか')).toBe(false);
        expect(probe.day?.memberOf('w2')).toEqual({ userId: 'w2', eligible: true, offers: [{ itemId: 'large', payRole: 'member', amount: 200 }], records: [] });
    });

    it('読み込みの URL は、職長・日付に記号が入っていても崩れない', async () => {
        function Probe() {
            useAllowanceDay({ enabled: true, foremanId: 'a&b=c d', dateKey: '2026-09-30' });
            return null;
        }
        const calls = installFetch(() => undefined);
        render(<Probe />);
        await flush();
        expect(calls.map(describeCall)).toEqual(['GET /api/allowances/day?foremanId=a%26b%3Dc%20d&date=2026-09-30']);
        expect(calls.map(dayQuery)).toEqual([{ foremanId: 'a&b=c d', date: '2026-09-30' }]);
    });
});
