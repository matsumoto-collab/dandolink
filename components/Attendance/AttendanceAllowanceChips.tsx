'use client';

/**
 * 「出勤簿入力」のカードに出す、手当のボタン。見た目と、押したときの画面のやりとりを受け持つ。
 * 読み込み・保存・エラーの扱いは hooks/useAllowanceDay.ts。
 * 作りは、評価ポイントの AttendancePointChips.tsx と同じ（別の部品にして、評価ポイントの動きを変えない）。
 *
 * 出す条件に合わないとき（その人に付けられる手当が無い・対象外の人・読み込み前や失敗）は何も描かないので、
 * そのあいだ「出勤簿入力」の画面は今までとまったく同じになる。
 *
 * だれに・どの区分（職長／職長以外）・いくらで付けられるかは、API（GET /api/allowances/day の members[].offers）が決める。
 * ここでは決めない（その日の手配で決まる。「手配と見比べる」と同じ決まり）。
 */
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import InfoTip from '@/components/ui/InfoTip';
import type { AllowanceDay, AllowanceDayItem, AllowanceDayRecord } from '@/hooks/useAllowanceDay';

interface ChipsProps {
    allowanceDay: AllowanceDay;
    /** このカードの人 */
    userId: string;
    /** 操作している人（session.user.id） */
    currentUserId: string;
}

interface Chip {
    itemId: string;
    label: string;
    /** 1日の金額（円）。記録があれば、記録に入っている金額。無ければ、今付けたときの金額 */
    amount: number;
    /** その手当の記録。無ければ null（オフ） */
    record: AllowanceDayRecord | null;
}

/** 1500 → 「1,500円」 */
const yen = (amount: number): string => `${amount.toLocaleString('ja-JP')}円`;

const CLOSED_REASON = 'この月の手当は締めてあります';

/** 各メンバーのカードの、評価ポイントのボタンの下に置く */
export default function AttendanceAllowanceChips({ allowanceDay, userId, currentUserId }: ChipsProps) {
    if (!allowanceDay.showsChips(userId)) return null;
    const member = allowanceDay.memberOf(userId);
    if (!member) return null;

    const itemById = new Map(allowanceDay.items.map((i) => [i.id, i]));
    const recordByItem = new Map(member.records.map((r) => [r.itemId, r]));
    const offeredIds = new Set(member.offers.map((o) => o.itemId));
    // 並び順: この人に付けられる手当（API が返した順）のあとに、今は付けられない手当の記録
    // （使わなくなった手当・手配が変わったあとに残った記録・締めた月の記録）。
    // 付けられる手当は今の名前で、そうでない記録は記録に写してある名前で出す。
    // 金額は、記録があれば記録に入っている金額、無ければ「この人に今付けたときの金額」（API が決めた金額）
    const chips: Chip[] = [
        ...member.offers.flatMap((o) => {
            const record = recordByItem.get(o.itemId) ?? null;
            const label = itemById.get(o.itemId)?.name ?? record?.itemName;
            // 名前が分からないボタンは出さない（API は、offers にある手当を必ず items にも入れて返す）
            if (!label) return [];
            return [{ itemId: o.itemId, label, amount: record ? record.amount : o.amount, record }];
        }),
        ...member.records.filter((r) => !offeredIds.has(r.itemId)).map((r) => ({ itemId: r.itemId, label: r.itemName, amount: r.amount, record: r })),
    ];
    if (chips.length === 0) return null;

    const isOwnCard = userId === currentUserId;
    /**
     * 取り消せない記録（鍵つき）の理由。
     * 締めた月の記録は、だれも変えられない。
     * 自分のカードの記録は、だれが付けたものでも、自分では取り消せない（管理者・マネージャーでも同じ）。
     */
    const lockedReason = (rec: AllowanceDayRecord, where: 'toast' | 'title'): string => {
        if (allowanceDay.monthClosed) return CLOSED_REASON;
        if (isOwnCard) return '自分の分の記録は、自分では取り消せません';
        return where === 'toast'
            ? `${rec.createdByName}さんが付けた記録です（取り消せるのは、付けた人と管理者・マネージャーです）`
            : `${rec.createdByName}さんが付けました`;
    };

    const handleClick = (chip: Chip) => {
        const rec = chip.record;
        if (!rec) {
            void allowanceDay.toggle(userId, chip.itemId, true);
            return;
        }
        if (!rec.canRemove) {
            // 取り消せない記録。通信はせず、理由だけを出す（スマホでは title が見えないため）
            toast(lockedReason(rec, 'toast'));
            return;
        }
        // 他の人が付けた記録を取り消すときは、押した直後に確かめる（管理者・マネージャーの押しまちがい防止）
        if (rec.createdBy !== currentUserId && !window.confirm(`${rec.createdByName}さんが付けた記録です。取り消しますか？`)) return;
        void allowanceDay.toggle(userId, chip.itemId, false);
    };

    return (
        <div className="mt-2 pt-2 border-t border-slate-100" data-testid={`allowance-chips-${userId}`}>
            <div className="mb-1 text-[11px] font-semibold text-slate-500">手当</div>
            <div className="flex flex-wrap gap-1.5">
                {chips.map((chip) => {
                    const rec = chip.record;
                    const busy = allowanceDay.isBusy(userId, chip.itemId);
                    const locked = !!rec && !rec.canRemove;
                    const pending = rec?.status === 'pending';
                    const tone = !rec
                        ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                        : pending
                            ? 'bg-amber-50 border-amber-400 text-amber-800'
                            : 'bg-teal-600 border-teal-600 text-white';
                    return (
                        <button
                            key={chip.itemId}
                            type="button"
                            onClick={() => handleClick(chip)}
                            // 押せなくするのは、送っているあいだだけ。
                            // 取り消せない記録（鍵つき）は disabled にしない＝押すと理由が出る
                            disabled={busy}
                            aria-pressed={!!rec}
                            aria-disabled={locked ? true : undefined}
                            title={locked ? lockedReason(rec, 'title') : undefined}
                            className={`min-h-[32px] px-2.5 inline-flex items-center gap-1 rounded-full border text-xs font-medium transition-colors ${tone} ${busy ? 'opacity-60' : ''}`}
                        >
                            {locked && <Lock className="w-3 h-3" aria-hidden="true" />}
                            <span>{chip.label}</span>
                            <span className="tabular-nums">{yen(chip.amount)}</span>
                            {pending && <span className="text-[10px]">確認待ち</span>}
                        </button>
                    );
                })}
            </div>
            {allowanceDay.monthClosed ? (
                <p className="mt-1 text-[11px] text-slate-500">{CLOSED_REASON}</p>
            ) : isOwnCard ? (
                // 自分のカードにボタンが出ているときだけ出す（ボタンの無いカードには何も足さない）
                <p className="mt-1 text-[11px] text-slate-500">自分の手当は確認待ちになります。管理者・マネージャーが認めると、手当に入ります。</p>
            ) : null}
        </div>
    );
}

/**
 * 手当のボタンが1つでも出ているときに、「積込・残業・早終」の見出しの行の下（評価ポイントの一文の下）に出す一文。
 * その日に付けられる手当が無いとき（締めた月で、記録だけが出ているとき など）は出さない。
 * 文の右の (i) を押すと、「名前：職長◯円・職長以外◯円」と説明が並ぶ。
 */
export function AttendanceAllowanceNotice({ items }: { items: AllowanceDayItem[] }) {
    if (items.length === 0) return null;
    return (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-slate-500" data-testid="allowance-notice">
            <span>手当は、押すとすぐ保存されます（下の『保存』とは別です）</span>
            <InfoTip title="手当">
                {items.map((i) => (
                    <span key={i.id} className="block">
                        {i.name}：職長 {yen(i.foremanAmount)}・職長以外 {yen(i.memberAmount)}
                        {i.description ? `（${i.description}）` : ''}
                    </span>
                ))}
            </InfoTip>
        </p>
    );
}
