import { z } from 'zod';
import { ROAD_PERMIT_SYMBOL_CATEGORIES } from '@/types/roadPermitSymbol';
import type { RoadPermitSymbolGeometry } from '@/types/roadPermitSymbol';
import {
    ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES,
    ROAD_PERMIT_SYMBOL_NAME_MAX,
    normalizeRoadPermitSymbolGeometry,
} from '@/lib/roadPermit/symbols/normalize';
import { symbolPrimitiveCount } from '@/lib/roadPermit/symbols/geometry';

/**
 * 道路申請の記号（RoadPermitSymbol）API の入力検証（docs/指示書_道路申請_Phase2b_記号.md §2・§3）。
 *
 * - 文字の欄は前後の空白を落としてから長さを見る
 * - 形（geometry）は normalize を通してから、区間の合計が 1〜5,000 かを見る（送られてきた数が上限を超えていれば断る）
 * - 変更（PUT）で受け付けるのは 名前・分類・数量の数え方・コーンバーの間隔・出どころ・並び順・使う／使わない だけ。
 *   形・大きさ・取り込み元は知らないキーとして落とす（形は取り込んだあと直さない）
 */

const trimIfString = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

const text = (label: string, max: number) =>
    z.preprocess(trimIfString, z.string().max(max, `${label}は${max}文字以内で入力してください`));

const nameSchema = z.preprocess(
    trimIfString,
    z
        .string()
        .min(1, '名前を入力してください')
        .max(ROAD_PERMIT_SYMBOL_NAME_MAX, `名前は${ROAD_PERMIT_SYMBOL_NAME_MAX}文字以内で入力してください`),
);

const categorySchema = z.enum(ROAD_PERMIT_SYMBOL_CATEGORIES, { message: '分類を選んでください' });

const sizeSchema = (label: string) =>
    z
        .number({ message: `${label}は数で指定してください` })
        .refine((v) => Number.isFinite(v) && v > 0, `${label}は0より大きい数にしてください`)
        .refine((v) => v <= 100_000, `${label}が大きすぎます`);

const barPitchSchema = z
    .number({ message: 'コーンの間隔は数で指定してください' })
    .int('コーンの間隔は整数（mm）で入力してください')
    .min(1, 'コーンの間隔は1以上で入力してください')
    .max(100_000, 'コーンの間隔が大きすぎます')
    .nullable();

/** 送られてきた形の区間の数（normalize の前。上限を超えていたら断るため） */
function rawPrimitiveCount(raw: unknown): number {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
    const o = raw as Record<string, unknown>;
    const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    let n = Math.floor(len(o.lines) / 4) + Math.floor(len(o.circles) / 3) + Math.floor(len(o.arcs) / 5);
    if (Array.isArray(o.polylines)) for (const p of o.polylines) n += Math.max(0, Math.floor(len(p) / 2) - 1);
    return n;
}

const geometrySchema = z
    .unknown()
    .superRefine((raw, ctx) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            ctx.addIssue({ code: 'custom', message: '形（geometry）がありません' });
            return;
        }
        if (rawPrimitiveCount(raw) > ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES) {
            ctx.addIssue({
                code: 'custom',
                message: `線が多すぎます（${ROAD_PERMIT_SYMBOL_MAX_PRIMITIVES.toLocaleString('ja-JP')}本まで）`,
            });
            return;
        }
        if (symbolPrimitiveCount(normalizeRoadPermitSymbolGeometry(raw)) < 1) {
            ctx.addIssue({ code: 'custom', message: '形に線がありません' });
        }
    })
    .transform((raw): RoadPermitSymbolGeometry => normalizeRoadPermitSymbolGeometry(raw));

/** POST /api/road-permits/symbols（1 件登録） */
export const roadPermitSymbolCreateSchema = z.object({
    name: nameSchema,
    category: categorySchema,
    countLabel: text('数量の名前', 100),
    countUnit: text('数量の単位', 10),
    countNote: text('数量の添え字', 50),
    geometry: geometrySchema,
    lengthMm: sizeSchema('長さ'),
    widthMm: sizeSchema('幅'),
    barPitchMm: barPitchSchema,
    sourceFile: text('取り込み元のファイル名', 200),
    sourceBlock: text('取り込み元のブロック名', 200),
    sourceNote: text('出どころ', 200),
    isActive: z.boolean().optional(),
});

export type RoadPermitSymbolCreateInput = z.infer<typeof roadPermitSymbolCreateSchema>;

/** PUT /api/road-permits/symbols/[id]（部分更新。形・大きさ・取り込み元は落とす） */
export const roadPermitSymbolUpdateSchema = z.object({
    name: nameSchema.optional(),
    category: categorySchema.optional(),
    countLabel: text('数量の名前', 100).optional(),
    countUnit: text('数量の単位', 10).optional(),
    countNote: text('数量の添え字', 50).optional(),
    barPitchMm: barPitchSchema.optional(),
    sourceNote: text('出どころ', 200).optional(),
    sortOrder: z
        .number({ message: '並び順は数で指定してください' })
        .int('並び順は整数で指定してください')
        .min(0, '並び順は0以上で指定してください')
        .max(1_000_000, '並び順が大きすぎます')
        .optional(),
    isActive: z.boolean({ message: '使う／使わないの指定が正しくありません' }).optional(),
});

export type RoadPermitSymbolUpdateInput = z.infer<typeof roadPermitSymbolUpdateSchema>;
