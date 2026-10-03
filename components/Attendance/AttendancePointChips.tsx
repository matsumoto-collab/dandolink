'use client';

/**
 * 「出勤簿入力」のカードに出す、評価ポイントの項目のボタン。見た目と、押したときの画面のやりとりを受け持つ。
 * 読み込み・保存・エラーの扱いは hooks/useEvaluationPointDay.ts。
 *
 * 出す条件に合わないとき（項目が無い・対象外の人・読み込み前や失敗）は何も描かないので、
 * そのあいだ「出勤簿入力」の画面は今までとまったく同じになる。
 */
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import InfoTip from '@/components/ui/InfoTip';
import type { EvaluationPointDay, EvaluationPointDayItem, EvaluationPointDayRecord } from '@/hooks/useEvaluationPointDay';

interface ChipsProps {
    pointDay: EvaluationPointDay;
    /** このカードの人 */
    userId: string;
    /** 操作している人（session.user.id） */
    currentUserId: string;
}

interface Chip {
    itemId: string;
    label: string;
    /** その項目の記録。無ければ null（オフ） */
    record: EvaluationPointDayRecord | null;
}

/** 各メンバーのカードの「早出・朝積・残業・夕積・早終」の行の下に置く */
export default function AttendancePointChips({ pointDay, userId, currentUserId }: ChipsProps) {
    if (!pointDay.showsChips(userId)) return null;
    const member = pointDay.memberOf(userId);
    if (!member) return null;

    const recordByItem = new Map(member.records.map((r) => [r.itemId, r]));
    const activeIds = new Set(pointDay.items.map((i) => i.id));
    // 並び順: 使用中の項目（API が返した順＝設定の並び順）のあとに、「使わない」にした項目の記録。
    // 使用中の項目は今の項目名で、「使わない」項目は記録に写してある名前で出す
    const chips: Chip[] = [
        ...pointDay.items.map((i) => ({ itemId: i.id, label: i.name, record: recordByItem.get(i.id) ?? null })),
        ...member.records.filter((r) => !activeIds.has(r.itemId)).map((r) => ({ itemId: r.itemId, label: r.itemName, record: r })),
    ];

    const isOwnCard = userId === currentUserId;
    /**
     * 取り消せない記録（鍵つき）の理由。
     * 自分のカードの記録は、だれが付けたものでも、自分では取り消せない（管理者・マネージャーでも同じ）。
     * だから「付けた人が自分か」ではなく「自分のカードか」で文言を分ける。
     */
    const lockedReason = (rec: EvaluationPointDayRecord, where: 'toast' | 'title'): string => {
        if (isOwnCard) return '自分の分の記録は、自分では取り消せません';
        return where === 'toast'
            ? `${rec.createdByName}さんが付けた記録です（取り消せるのは、付けた人と管理者・マネージャーです）`
            : `${rec.createdByName}さんが付けました`;
    };

    const handleClick = (chip: Chip) => {
        const rec = chip.record;
        if (!rec) {
            void pointDay.toggle(userId, chip.itemId, true);
            return;
        }
        if (!rec.canRemove) {
            // 取り消せない記録。通信はせず、理由だけを出す（スマホでは title が見えないため）
            toast(lockedReason(rec, 'toast'));
            return;
        }
        // 他の人が付けた記録を取り消すときは、押した直後に確かめる（管理者・マネージャーの押しまちがい防止）
        if (rec.createdBy !== currentUserId && !window.confirm(`${rec.createdByName}さんが付けた記録です。取り消しますか？`)) return;
        void pointDay.toggle(userId, chip.itemId, false);
    };

    return (
        <div className="mt-2 pt-2 border-t border-slate-100" data-testid={`point-chips-${userId}`}>
            <div className="mb-1 text-[11px] font-semibold text-slate-500">ポイント</div>
            <div className="flex flex-wrap gap-1.5">
                {chips.map((chip) => {
                    const rec = chip.record;
                    const busy = pointDay.isBusy(userId, chip.itemId);
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
                            {pending && <span className="text-[10px]">確認待ち</span>}
                        </button>
                    );
                })}
            </div>
            {isOwnCard && (
                // 自分のカードにボタンが出ているときだけ出す（ボタンの無いカードには何も足さない）
                <p className="mt-1 text-[11px] text-slate-500">自分の分は申請になります。管理者・マネージャーが認めると数えられます。</p>
            )}
        </div>
    );
}

/**
 * ボタンが1つでも出ているときに、「積込・残業・早終」の見出しの行のすぐ下に出す一文。
 * 説明のある項目があれば、文の右に (i) を1つだけ出す（押すと「項目名：説明」が並ぶ）。
 * 見出しの行そのものには何も足さない（出勤簿の見出しの説明とまちがえないように、ポイントの文のほうに付ける）。
 */
export function AttendancePointNotice({ items }: { items: EvaluationPointDayItem[] }) {
    const described = items.filter((i) => i.description);
    return (
        <p className="mb-2 flex items-center gap-1 text-[11px] text-slate-500" data-testid="point-notice">
            <span>ポイントは、押すとすぐ保存されます（下の『保存』とは別です）</span>
            {described.length > 0 && (
                <InfoTip title="評価ポイントの項目">
                    {described.map((i) => (
                        <span key={i.id} className="block">{i.name}：{i.description}</span>
                    ))}
                </InfoTip>
            )}
        </p>
    );
}
