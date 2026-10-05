'use client';

/**
 * 「出勤簿入力」の中で、手当の読み込み・保存・エラーの扱いを全部受け持つフック。
 * 作りは、評価ポイントの hooks/useEvaluationPointDay.ts と同じ（別のフックにして、評価ポイントの動きを変えない）。
 *
 * 出勤簿のデータ・API には一切触らない（呼ぶのは /api/allowances/day だけ）。
 * 読み込みや保存が失敗しても、出勤簿の入力は今までどおりできる（失敗したらボタンを出さないだけ）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import { ALLOWANCES_UPDATED_EVENT, type AllowancePayRole, type AllowanceStatus } from '@/lib/allowances';

/** GET /api/allowances/day の items の1件（その日、この班のだれかに付けられる手当。名前と説明・金額の案内に使う） */
export interface AllowanceDayItem {
    id: string;
    name: string;
    description: string | null;
    /** その日に付けたときの金額（円） */
    foremanAmount: number;
    memberAmount: number;
}

/** その人・その日の記録の1件 */
export interface AllowanceDayRecord {
    id: string;
    itemId: string;
    /** 記録に写してある手当の名前 */
    itemName: string;
    payRole: AllowancePayRole;
    /** 記録に入っている金額（円） */
    amount: number;
    status: AllowanceStatus;
    createdBy: string;
    createdByName: string;
    /** 操作している人が取り消せるか（締めた月の記録は false） */
    canRemove: boolean;
    /** 管理者が金額を手で直した記録か（取り消せるのは、管理者・マネージャーだけ） */
    amountEdited: boolean;
}

/** その人に、この画面で付けられる手当（ボタン）の1つ */
export interface AllowanceDayOffer {
    itemId: string;
    /** 付けたときの区分（その日の手配で決まる。どの画面で押しても同じ） */
    payRole: AllowancePayRole;
    /** 付けたときの金額（円） */
    amount: number;
}

/** GET /api/allowances/day の members の1人ぶん */
export interface AllowanceDayMember {
    userId: string;
    /** 手当の対象の人か（協力会社のメンバーなどは false） */
    eligible: boolean;
    /** この画面で、この人に付けられる手当。対象の現場の手配に入っていない人・締めた月は空 */
    offers: AllowanceDayOffer[];
    records: AllowanceDayRecord[];
}

/** PUT の応答の result（'no_rate' は 400 で返るので、ここには無い） */
type DayToggleResult = 'added' | 'removed' | 'unchanged' | 'closed' | 'blocked' | 'not_found' | 'inactive' | 'not_target';

/** 保存されなかったときに出す文言（result ごと） */
const REFUSED_MESSAGES: Partial<Record<DayToggleResult, string>> = {
    blocked: 'この記録は取り消せません',
    closed: 'この月の手当は締めてあります',
    inactive: 'この手当は「使わない」になっています',
    not_target: 'この人は、この日、この班の「手当の対象の現場」の手配に入っていません',
    not_found: 'この手当は見つかりません',
};

/** 断られたあと、ボタンの一覧から読み直す result（手当が「使わない」になった・手配が変わった・月が締められた など） */
const RELOAD_RESULTS: readonly DayToggleResult[] = ['closed', 'inactive', 'not_target', 'not_found'];

/** いま開いている職長・日付 */
interface Target {
    foremanId: string;
    dateKey: string;
}

interface DayData extends Target {
    monthClosed: boolean;
    items: AllowanceDayItem[];
    members: Record<string, AllowanceDayMember>;
}

export interface AllowanceDay {
    /** 読み込みが済んで、今の職長・日付の中身を出せる状態か */
    ready: boolean;
    /** その日の月が締めてあるか（締めた月は、付いている記録を見せるだけ） */
    monthClosed: boolean;
    /** その日に出すボタン（手当）。ready でなければ空 */
    items: AllowanceDayItem[];
    /** その人の状態。読み込み前・失敗・班にいない人は undefined */
    memberOf: (userId: string) => AllowanceDayMember | undefined;
    /** その人のカードにボタンを出すか（対象の人で、付けられる手当が1つ以上あるか、その人に記録が1つ以上ある） */
    showsChips: (userId: string) => boolean;
    /** そのボタンを送っている最中か（送っているあいだは押せなくする） */
    isBusy: (userId: string, itemId: string) => boolean;
    /** ボタンを1つ押したとき。on = true で付ける・false で取り消す */
    toggle: (userId: string, itemId: string, on: boolean) => Promise<void>;
}

interface Args {
    /** モーダルが開いていて、職長が選ばれているときだけ true */
    enabled: boolean;
    foremanId: string;
    dateKey: string;
}

const sameTarget = (a: Target | null, b: Target | null): boolean =>
    !!a && !!b && a.foremanId === b.foremanId && a.dateKey === b.dateKey;

/** 「送っている最中のボタン」の鍵。職長・日付も入れる（日付を切り替えた先の、同じ人・同じ手当のボタンまで止めないため） */
const busyKeyOf = (target: Target, userId: string, itemId: string): string =>
    `${target.foremanId}|${target.dateKey}|${userId}|${itemId}`;

/** 400・403 のときにサーバーが返す文言。errorResponse / validationErrorResponse は文言を error に入れる */
function serverMessage(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as { error?: unknown; details?: unknown };
    if (typeof b.error === 'string' && b.error) return b.error;
    if (typeof b.details === 'string' && b.details) return b.details;
    return null;
}

export function useAllowanceDay({ enabled, foremanId, dateKey }: Args): AllowanceDay {
    const [data, setData] = useState<DayData | null>(null);
    const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());

    /** いま開いている職長・日付（無効のときは null）。答えが届いたとき「まだ同じ相手か」を見るのに使う */
    const targetRef = useRef<Target | null>(null);
    /** 読み込みの連番。いちばん新しい読み込みの答えだけを使う */
    const loadSeqRef = useRef(0);
    /** 走っている最中の読み込みの連番。0 = 走っていない */
    const loadingSeqRef = useRef(0);
    /**
     * 送っている最中のボタン。
     * state だけで持つと、画面が描き直される前の2回目の押下（連打）を止められないので、ref でも持つ。
     */
    const busyRef = useRef<Set<string>>(new Set());
    /**
     * 人ごとの「いちばん新しく送った保存」の連番。
     * 同じ人のボタンを続けて押して、応答が逆の順に届いたとき、古いほうの応答で表示を戻してしまわないために見る
     * （手当が2つ以上あるときだけ起きる）。
     */
    const userSeqRef = useRef<Map<string, number>>(new Map());
    /** 人ごとの「送っている最中の保存」の数。同じ人の保存が重なったかどうかを見る */
    const userInFlightRef = useRef<Map<string, number>>(new Map());
    /** いま画面に出している内容（保存の応答が届いたとき、「締めてあるか」が変わったかを見比べるのに使う） */
    const dataRef = useRef<DayData | null>(null);
    dataRef.current = data;

    /**
     * 読み込む。読めたら data を置き換えるだけで、読み込みを始めるときには data を消さない。
     *  - 同じ職長・日付の読み直し（知らせを受けたとき・断られたあと）→ 前の内容を出したまま
     *  - 開いたとき・職長や日付が変わったとき → 下の効果（useEffect）が data を捨ててから、これを呼ぶ
     */
    const load = useCallback(async (target: Target) => {
        const seq = ++loadSeqRef.current;
        loadingSeqRef.current = seq;
        const isStale = () => seq !== loadSeqRef.current || !sameTarget(target, targetRef.current);
        try {
            const res = await fetch(
                `/api/allowances/day?foremanId=${encodeURIComponent(target.foremanId)}&date=${encodeURIComponent(target.dateKey)}`,
                { cache: 'no-store' },
            );
            if (!res.ok) throw new Error(`status ${res.status}`);
            const json = (await res.json()) as { monthClosed?: boolean; items?: AllowanceDayItem[]; members?: AllowanceDayMember[] };
            // 古い読み込みの答えは捨てる（職長・日付を切り替えた後に届いた答え／後から始めた読み込みに追い越された答え）
            if (isStale()) return;
            const members: Record<string, AllowanceDayMember> = {};
            for (const m of json.members ?? []) {
                members[m.userId] = { userId: m.userId, eligible: m.eligible === true, offers: m.offers ?? [], records: m.records ?? [] };
            }
            setData({ ...target, monthClosed: json.monthClosed === true, items: json.items ?? [], members });
        } catch (err) {
            if (isStale()) return;
            // 失敗したら、新しい内容は出さない（開いた直後・切り替えた直後なら、ボタンは出ない）。
            // 出勤簿の入力のじゃまをしないよう、トーストは出さない。
            // 同じ職長・日付の読み直しの失敗なら、前に読めた内容は出したままにする
            logger.error('手当の読み込みに失敗:', err);
        } finally {
            if (loadingSeqRef.current === seq) loadingSeqRef.current = 0;
        }
    }, []);

    // enabled・foremanId・dateKey が変わるたびに読む
    useEffect(() => {
        // 開いた・閉じた・職長や日付が変わった: 前に読んだ内容は捨てて、新しい答えが届くまで何も出さない
        setData(null);
        if (!enabled || !foremanId) {
            targetRef.current = null;
            loadSeqRef.current += 1; // 走っている読み込みの答えを捨てる
            return;
        }
        const target: Target = { foremanId, dateKey };
        targetRef.current = target;
        void load(target);
    }, [enabled, foremanId, dateKey, load]);

    // 別の端末で付けた・取り消した・月を締めた分を映す
    useEffect(() => {
        if (!enabled || !foremanId) return;
        initBroadcastChannel(); // 何回呼んでも、初期化されるのは1回だけ
        const target: Target = { foremanId, dateKey };
        return onBroadcast(ALLOWANCES_UPDATED_EVENT, (payload) => {
            // 日付の付いた知らせ（出勤簿入力から）は、開いている日付のときだけ読み直す。
            // 日付の無い知らせ（「手当」の画面・設定から）は、いつも読み直す
            if (typeof payload.date === 'string' && payload.date !== dateKey) return;
            void load(target);
        });
    }, [enabled, foremanId, dateKey, load]);

    const toggle = useCallback(async (userId: string, itemId: string, on: boolean) => {
        const target = targetRef.current;
        if (!target) return;
        const busyKey = busyKeyOf(target, userId, itemId);
        if (busyRef.current.has(busyKey)) return; // 連打で二重に送らない
        busyRef.current.add(busyKey);
        setBusyKeys(new Set(busyRef.current));
        const userSeq = (userSeqRef.current.get(userId) ?? 0) + 1;
        userSeqRef.current.set(userId, userSeq);
        // この人の、別の保存を送っている最中に押された
        const startedDuringAnother = (userInFlightRef.current.get(userId) ?? 0) > 0;
        userInFlightRef.current.set(userId, (userInFlightRef.current.get(userId) ?? 0) + 1);
        try {
            const res = await fetch('/api/allowances/day', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ foremanId: target.foremanId, date: target.dateKey, userId, itemId, on }),
                cache: 'no-store',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                if (res.status === 400 || res.status === 403) {
                    toast.error(serverMessage(body) ?? '手当の保存に失敗しました');
                } else {
                    toast.error('手当の保存に失敗しました');
                }
                // ボタンの色は応答で変える（押した瞬間には変えない）ので、失敗のときは何も変えず、また押せるようにするだけ
                return;
            }
            // member は、その人の、保存のあとの記録（ボタン＝offers は入っていない。前に読んだものをそのまま使う）
            const json = (await res.json()) as { result: DayToggleResult; monthClosed?: boolean; member?: { userId: string; records?: AllowanceDayRecord[] } };
            // 実際に入った・消えたときだけ、ほかの端末へ知らせる（日付は、送ったときの日付）
            if (json.result === 'added' || json.result === 'removed') {
                sendBroadcast(ALLOWANCES_UPDATED_EVENT, { date: target.dateKey });
            }
            // 断られたこと（＝保存されていない）は、送っているあいだに職長・日付を切り替えていても知らせる
            const refused = REFUSED_MESSAGES[json.result];
            if (refused) toast.error(refused);
            // 送っているあいだに職長・日付が変わっていたら、応答は表示に使わない・読み直しもしない
            if (!sameTarget(target, targetRef.current)) return;
            // この人に、あとから別の保存を送っていたら、この応答は古いかもしれないので表示に使わず、読み直す
            const overtaken = userSeqRef.current.get(userId) !== userSeq;
            // 同じ人の保存が重なっていた（あとから送った・送っている最中に押した）ら、応答が届く順とサーバーが処理した順が
            // 違うことがあるので、最後に読み直して正しい状態にする
            const overlapped = overtaken || startedDuringAnother;
            // 「締めてあるか」が、画面に出している内容と違っていたら、ボタンの一覧から読み直す
            const shownNow = dataRef.current;
            const closedChanged = typeof json.monthClosed === 'boolean'
                && !!shownNow && sameTarget(shownNow, target) && shownNow.monthClosed !== json.monthClosed;
            const member = json.member;
            if (member && !overtaken) {
                // その人の記録だけを入れ替える（その人が画面に無ければ、何もしない）
                setData((prev) => {
                    const current = prev && sameTarget(prev, target) ? prev.members[member.userId] : undefined;
                    if (!prev || !current) return prev;
                    return { ...prev, members: { ...prev.members, [member.userId]: { ...current, records: member.records ?? [] } } };
                });
            }
            // 読み直す場面:
            //  - closed・inactive・not_target・not_found: 月が締められた・手当が「使わない」になった・手配が変わった など。ボタンの一覧から読み直す
            //  - 「締めてあるか」が変わっていた（応答は unchanged・blocked でも、月が締められていることがある）
            //  - 同じ人の保存が重なっていた
            //  - この保存より前に始まっていた読み直しが、まだ走っている: その答えは保存より前の状態なので、
            //    新しい読み直しで追い越す（古いほうの答えは、連番が進むので捨てられる）
            if (RELOAD_RESULTS.includes(json.result) || closedChanged || overlapped || loadingSeqRef.current !== 0) void load(target);
        } catch (err) {
            logger.error('手当の保存に失敗:', err);
            toast.error('手当の保存に失敗しました');
        } finally {
            userInFlightRef.current.set(userId, Math.max(0, (userInFlightRef.current.get(userId) ?? 1) - 1));
            busyRef.current.delete(busyKey);
            setBusyKeys(new Set(busyRef.current));
        }
    }, [load]);

    // 出すのは、いま開いている職長・日付の内容だけ。
    // 切り替えた直後の描画（上の効果が data を捨てる前）でも、前の職長・日付の内容を出さないように、ここで見比べる
    const shown = enabled && data !== null && data.foremanId === foremanId && data.dateKey === dateKey ? data : null;

    const memberOf = useCallback(
        (userId: string) => (shown ? shown.members[userId] : undefined),
        [shown],
    );
    const showsChips = useCallback(
        (userId: string) => {
            const m = shown ? shown.members[userId] : undefined;
            if (!shown || !m || !m.eligible) return false;
            return m.offers.length > 0 || m.records.length > 0;
        },
        [shown],
    );
    const isBusy = useCallback(
        (userId: string, itemId: string) => busyKeys.has(busyKeyOf({ foremanId, dateKey }, userId, itemId)),
        [busyKeys, foremanId, dateKey],
    );

    return {
        ready: shown !== null,
        monthClosed: shown ? shown.monthClosed : false,
        items: shown ? shown.items : [],
        memberOf,
        showsChips,
        isBusy,
        toggle,
    };
}
