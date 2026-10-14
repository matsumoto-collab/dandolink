/**
 * 道路申請の「許可書（スキャン）」の決まり（純粋関数だけ。サーバー専用の import を入れない＝画面からも使う）。
 * docs/指示書_道路申請_許可書を見ての修正.md §4
 */
import type { RoadPermitDocuments, RoadPermitFormId, RoadPermitPermitFile } from '@/types/roadPermit';

/** 1 ファイルの上限（20MB。※ Vercel の実際の上限は約 4.5MB＝画面で 413 の文言を出す） */
export const ROAD_PERMIT_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** Storage のパスの頭（road-permits/<申請の id>/） */
export const ROAD_PERMIT_FILE_PATH_PREFIX = 'road-permits/';

/** 付けられる種類（PDF と画像）の拡張子。それ以外は null＝受け付けない */
export function permitFileExtension(mimeType: string): string | null {
    switch ((mimeType || '').toLowerCase()) {
        case 'application/pdf':
            return 'pdf';
        case 'image/jpeg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'image/heic':
            return 'heic';
        case 'image/heif':
            return 'heif';
        default:
            return null;
    }
}

/** 保存してある 1 件を検査して型どおりにする（壊れていれば null＝落とす） */
export function normalizePermitFile(raw: unknown): RoadPermitPermitFile | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
    if (!nonEmpty(o.id) || !nonEmpty(o.fileName) || !nonEmpty(o.storagePath)) return null;
    if (!o.storagePath.startsWith(ROAD_PERMIT_FILE_PATH_PREFIX)) return null;
    if (typeof o.mimeType !== 'string') return null;
    if (typeof o.size !== 'number' || !Number.isFinite(o.size) || o.size < 0) return null;
    if (typeof o.uploadedAt !== 'string') return null;
    if (o.uploadedBy !== null && typeof o.uploadedBy !== 'string') return null;
    if (typeof o.uploadedByName !== 'string') return null;
    return {
        id: o.id,
        fileName: o.fileName,
        storagePath: o.storagePath,
        mimeType: o.mimeType,
        size: Math.round(o.size),
        uploadedAt: o.uploadedAt,
        uploadedBy: o.uploadedBy,
        uploadedByName: o.uploadedByName,
    };
}

/** 保存してある一覧を読む（無い・配列でない → []。壊れた 1 件は落とす） */
export function normalizePermitFiles(raw: unknown): RoadPermitPermitFile[] {
    if (!Array.isArray(raw)) return [];
    const out: RoadPermitPermitFile[] = [];
    for (const item of raw) {
        const f = normalizePermitFile(item);
        if (f) out.push(f);
    }
    return out;
}

/**
 * next の様式ごとの permitFiles を existing（DB）の同じ様式の値で置き換える（next に無い様式は何もしない）。
 * - PUT: 画面から来た permitFiles は捨てて DB の値を残す（ファイルの一覧はサーバーだけが書く）
 * - 画面: 付けた・消したあと、入力中の値を消さずに一覧だけを最新にする
 */
export function withPermitFilesFrom(next: RoadPermitDocuments, existing: RoadPermitDocuments): RoadPermitDocuments {
    const byId = new Map<RoadPermitFormId, RoadPermitPermitFile[]>();
    for (const f of existing.forms) byId.set(f.formId, f.permitFiles ?? []);
    return {
        ...next,
        forms: next.forms.map((f) => ({ ...f, permitFiles: (byId.get(f.formId) ?? []).map((p) => ({ ...p })) })),
    };
}
