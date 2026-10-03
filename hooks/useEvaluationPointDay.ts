'use client';

/**
 * 「出勤簿入力」の中で、評価ポイントの読み込み・保存・エラーの扱いを全部受け持つフック。
 *
 * 出勤簿のデータ・API には一切触らない（呼ぶのは /api/evaluation-points/day だけ）。
 * 読み込みや保存が失敗しても、出勤簿の入力は今までどおりできる（失敗したらボタンを出さないだけ）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import type { EvaluationPointStatus } from '@/lib/evaluationPoints';

/** GET /api/evaluation-points/day の items の1件（職長が付けられる・使用中の項目） */
export interface EvaluationPointDayItem {
    id: string;
    name: string;
    description: string | null;
}

/** その人・その日の記録の1件 */
export interface EvaluationPointDayRecord {
    id: string;
    itemId: string;
    /** 記録に写してある項目名 */
    itemName: string;
    status: EvaluationPointStatus;
    createdBy: string;
    createdByName: string;
    /** 操作している人が取り消せるか */
    canRemove: boolean;
}

/** GET /api/evaluation-points/day の members の1人ぶん（PUT の応答の member も同じ形） */
export interface EvaluationPointDayMember {
    userId: string;
    /** ポイントの対象の人か（協力会社のメンバーなどは false） */
    eligible: boolean;
    records: EvaluationPointDayRecord[];
}

type DayToggleResult = 'added' | 'removed' | 'unchanged' | 'blocked' | 'rejected';

/** いま開いている職長・日付 */
interface Target {
    foremanId: string;
    dateKey: string;
}

interface DayData extends Target {
    items: EvaluationPointDayItem[];
    members: Record<string, EvaluationPointDayMember>;
}

export interface EvaluationPointDay {
    /** 読み込みが済んで、今の職長・日付の中身を出せる状態か */
    ready: boolean;
    /** 職長が付けられる項目（使用中）。ready でなければ空 */
    items: EvaluationPointDayItem[];
    /** その人の状態。読み込み前・失敗・班にいない人は undefined */
    memberOf: (userId: string) => EvaluationPointDayMember | undefined;
    /** その人のカードにボタンを出すか（対象の人で、項目が1つ以上あるか、その人に記録が1つ以上ある） */
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

/** 「送っている最中のボタン」の鍵。職長・日付も入れる（日付を切り替えた先の、同じ人・同じ項目のボタンまで止めないため） */
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

export function useEvaluationPointDay({ enabled, foremanId, dateKey }: Args): EvaluationPointDay {
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
     * 読み込む。読めたら data を置き換えるだけで、読み込みを始めるときには data を消さない。
     *  - 同じ職長・日付の読み直し（知らせを受けたとき・rejected のあと）→ 前の内容を出したまま
     *    （消すと、ほかの人がボタンを押すたびに、開いている全員の画面でボタンが点滅する）
     *  - 開いたとき・職長や日付が変わったとき → 下の効果（useEffect）が data を捨ててから、これを呼ぶ
     */
    const load = useCallback(async (target: Target) => {
        const seq = ++loadSeqRef.current;
        loadingSeqRef.current = seq;
        const isStale = () => seq !== loadSeqRef.current || !sameTarget(target, targetRef.current);
        try {
            const res = await fetch(
                `/api/evaluation-points/day?foremanId=${encodeURIComponent(target.foremanId)}&date=${encodeURIComponent(target.dateKey)}`,
                { cache: 'no-store' },
            );
            if (!res.ok) throw new Error(`status ${res.status}`);
            const json = (await res.json()) as { items?: EvaluationPointDayItem[]; members?: EvaluationPointDayMember[] };
            // 古い読み込みの答えは捨てる（職長・日付を切り替えた後に届いた答え／後から始めた読み込みに追い越された答え）
            if (isStale()) return;
            const members: Record<string, EvaluationPointDayMember> = {};
            for (const m of json.members ?? []) members[m.userId] = m;
            setData({ ...target, items: json.items ?? [], members });
        } catch (err) {
            if (isStale()) return;
            // 失敗したら、新しい内容は出さない（開いた直後・切り替えた直後なら、ボタンは出ない）。
            // 出勤簿の入力のじゃまをしないよう、トーストは出さない。
            // 同じ職長・日付の読み直しの失敗なら、前に読めた内容は出したままにする
            // （押せば、サーバーが今の状態で判定して、応答でその人の表示も直る）
            logger.error('評価ポイントの読み込みに失敗:', err);
        } finally {
            if (loadingSeqRef.current === seq) loadingSeqRef.current = 0;
        }
    }, []);

    // enabled・foremanId・dateKey が変わるたびに読む
    useEffect(() => {
        // 開いた・閉じた・職長や日付が変わった: 前に読んだ内容は捨てて、新しい答えが届くまで何も出さない
        // （日付を進めてすぐ戻したときや、閉じて開き直したときに、前に読んだ古い内容を出さないため）
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

    // 別の端末で付けた・取り消した分を映す（AttendancePage の attendance_updated と同じ作り）
    useEffect(() => {
        if (!enabled || !foremanId) return;
        initBroadcastChannel(); // 何回呼んでも、初期化されるのは1回だけ
        const target: Target = { foremanId, dateKey };
        return onBroadcast('evaluation_points_updated', (payload) => {
            // 日付の付いた知らせ（出勤簿入力から）は、開いている日付のときだけ読み直す。
            // 日付の無い知らせ（評価ポイントの画面から）は、いつも読み直す
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
        try {
            const res = await fetch('/api/evaluation-points/day', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ foremanId: target.foremanId, date: target.dateKey, userId, itemId, on }),
                cache: 'no-store',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                if (res.status === 400 || res.status === 403) {
                    toast.error(serverMessage(body) ?? '評価ポイントの保存に失敗しました');
                } else {
                    toast.error('評価ポイントの保存に失敗しました');
                }
                // ボタンの色は応答で変える（押した瞬間には変えない）ので、失敗のときは何も変えず、また押せるようにするだけ
                return;
            }
            const json = (await res.json()) as { result: DayToggleResult; member?: EvaluationPointDayMember };
            // 実際に入った・消えたときだけ、ほかの端末へ知らせる（日付は、送ったときの日付）
            if (json.result === 'added' || json.result === 'removed') {
                sendBroadcast('evaluation_points_updated', { date: target.dateKey });
            }
            // 断られたこと（＝保存されていない）は、送っているあいだに職長・日付を切り替えていても知らせる
            if (json.result === 'blocked') {
                toast.error('この記録は取り消せません');
            } else if (json.result === 'rejected') {
                toast.error('この項目は、今は付けられません');
            }
            // 送っているあいだに職長・日付が変わっていたら、応答は表示に使わない・読み直しもしない
            // （ここで前の職長・日付を読み直すと、新しい職長・日付の読み込みの答えを「古いもの」として捨ててしまう）
            if (!sameTarget(target, targetRef.current)) return;
            const member = json.member;
            if (member) {
                setData((prev) => (prev && sameTarget(prev, target) ? { ...prev, members: { ...prev.members, [member.userId]: member } } : prev));
            }
            // 読み直す場面:
            //  - rejected: 項目が「使わない」になった・管理者だけの項目になった など。項目の一覧から読み直す
            //  - この保存より前に始まっていた読み直しが、まだ走っている: その答えは保存より前の状態なので、
            //    新しい読み直しで追い越す（古いほうの答えは、連番が進むので捨てられる）
            if (json.result === 'rejected' || loadingSeqRef.current !== 0) void load(target);
        } catch (err) {
            logger.error('評価ポイントの保存に失敗:', err);
            toast.error('評価ポイントの保存に失敗しました');
        } finally {
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
            return shown.items.length > 0 || m.records.length > 0;
        },
        [shown],
    );
    const isBusy = useCallback(
        (userId: string, itemId: string) => busyKeys.has(busyKeyOf({ foremanId, dateKey }, userId, itemId)),
        [busyKeys, foremanId, dateKey],
    );

    return {
        ready: shown !== null,
        items: shown ? shown.items : [],
        memberOf,
        showsChips,
        isBusy,
        toggle,
    };
}
