import { bucketKeyFor } from '@/lib/orderBacklog/classify';
import type {
    BucketKey,
    OrderBacklogLineInput,
    ScheduleMap,
    UnreceivedMode,
} from '@/lib/orderBacklog/types';

/** 区分集約の見出し（上段は件数を差し込む）。 */
export interface BucketDefinition {
    key: BucketKey;
    /** 上段（契約先の位置）。件数を入れて使う */
    topLabel: string;
    /** 下段（工事名の位置） */
    bottom: string;
}

/**
 * 区分集約の並び順と見出し（提出済みシートの実物に合わせた文言・この順で出す）。
 * 「その他新築工事」だけ住宅側が「他住宅新築工事」になっているのは元の様式のとおり。
 */
export const ORDER_BACKLOG_BUCKETS: readonly BucketDefinition[] = [
    { key: 'temp_other_mid', topLabel: 'その他仮設工事', bottom: '50万～100万の工事' },
    { key: 'temp_other_low', topLabel: 'その他仮設工事', bottom: '～50万の工事' },
    { key: 'temp_house_mid', topLabel: 'その他住宅仮設工事', bottom: '50万～100万の工事' },
    { key: 'temp_house_low', topLabel: 'その他住宅仮設工事', bottom: '～50万の工事' },
    { key: 'new_other_mid', topLabel: 'その他新築工事', bottom: '50万～100万の工事' },
    { key: 'new_other_low', topLabel: 'その他新築工事', bottom: '～50万の工事' },
    { key: 'new_house_mid', topLabel: '他住宅新築工事', bottom: '50万～100万の工事' },
    { key: 'new_house_low', topLabel: '他住宅新築工事', bottom: '～50万の工事' },
] as const;

/** 区分行の上段（例: 「その他仮設工事　4件」）。区切りは元の様式どおり全角空白。 */
export function bucketTopLabel(key: BucketKey, count: number): string {
    const def = ORDER_BACKLOG_BUCKETS.find((b) => b.key === key);
    return `${def?.topLabel ?? key}　${count}件`;
}

/** 区分行の下段（例: 「～50万の工事」）。 */
export function bucketBottomLabel(key: BucketKey): string {
    return ORDER_BACKLOG_BUCKETS.find((b) => b.key === key)?.bottom ?? '';
}

/** 出来高金額（円）。契約額 × 出来高％。 */
export function progressAmountYen(line: Pick<OrderBacklogLineInput, 'contractAmount' | 'progressRate'>): number {
    return Math.round((line.contractAmount * line.progressRate) / 100);
}

/**
 * 未受領金額（円）。
 * - 'remaining' = 契約額 − 出来高金額（提出済みシートはこちら）
 * - 'unpaid'    = 出来高金額 − 既受領
 */
export function unreceivedAmountYen(
    line: Pick<OrderBacklogLineInput, 'contractAmount' | 'progressRate' | 'receivedAmount'>,
    mode: UnreceivedMode,
): number {
    const progress = progressAmountYen(line);
    return mode === 'unpaid' ? progress - line.receivedAmount : line.contractAmount - progress;
}

/** 区分集約1行ぶんの合計（すべて円）。 */
export interface BucketAggregate {
    key: BucketKey;
    count: number;
    contractAmount: number;
    receivedAmount: number;
    unreceivedAmount: number;
    schedule: ScheduleMap;
}

/** aggregateBuckets の戻り。個別行と区分行に振り分けたもの。 */
export interface BucketSplit {
    /** 閾値以上＝1案件1行で出す明細 */
    individual: OrderBacklogLineInput[];
    /** 件数0の区分は含まない（§3.3 の順） */
    buckets: BucketAggregate[];
}

/**
 * 明細を「個別行」と「区分集約」に振り分ける。
 *
 * 除外（excluded）した行は個別行にも集約にも入れない。
 * 集約は **円で足してから** 出力時に千円へ丸める（1件ずつ丸めると合計がずれるため）。
 */
export function aggregateBuckets(
    lines: readonly OrderBacklogLineInput[],
    options: { individualThreshold: number; unreceivedMode: UnreceivedMode },
): BucketSplit {
    const individual: OrderBacklogLineInput[] = [];
    const map = new Map<BucketKey, BucketAggregate>();

    for (const line of lines) {
        if (line.excluded) continue;
        const key = bucketKeyFor(line, options.individualThreshold);
        if (!key) {
            individual.push(line);
            continue;
        }
        const agg = map.get(key) ?? {
            key,
            count: 0,
            contractAmount: 0,
            receivedAmount: 0,
            unreceivedAmount: 0,
            schedule: {},
        };
        agg.count += 1;
        agg.contractAmount += line.contractAmount;
        agg.receivedAmount += line.receivedAmount;
        agg.unreceivedAmount += unreceivedAmountYen(line, options.unreceivedMode);
        for (const [ym, amount] of Object.entries(line.schedule ?? {})) {
            agg.schedule[ym] = (agg.schedule[ym] ?? 0) + amount;
        }
        map.set(key, agg);
    }

    // 件数0の区分は出さない（様式の枠を無駄に埋めないため）
    const buckets = ORDER_BACKLOG_BUCKETS.map((b) => map.get(b.key)).filter(
        (b): b is BucketAggregate => b !== undefined,
    );

    return { individual, buckets };
}
