/**
 * 案件マスターのファイル（完了報告の写真など）を
 * 「同じ人が・近い時刻にまとめて保存した塊（＝1回の報告）」ごとにグループ化する。
 *
 * 写真は1枚ずつ個別に保存され、塊を表す物理的なIDが無いため、
 * 「保存者(uploadedBy)が同じ」かつ「保存時刻(createdAt)が近い」ものを
 * 1グループとみなすヒューリスティックでまとめる。
 */

/** グループ化に必要な最小フィールド（各画面の File 型がこれを満たす） */
export interface GroupableFile {
    id: string;
    createdAt: string;
    uploadedBy?: string | null;
    uploadedByName?: string | null;
}

export interface FileGroup<T extends GroupableFile> {
    /** React key 用（グループ先頭ファイルの id） */
    key: string;
    /** 保存者のユーザーID（不明なら null） */
    uploadedBy: string | null;
    /** 保存者の表示名（解決できなければ null） */
    uploadedByName: string | null;
    /** 見出しに使う代表時刻（グループ内で最も新しい createdAt） */
    representativeAt: string;
    files: T[];
}

/**
 * 同一グループとみなす時刻の許容差。
 * 1回の完了報告での連続アップロードは通常数秒〜数分で終わるが、
 * 電波状況で間延びすることもあるため余裕をもって 30 分とする。
 */
const GROUP_GAP_MS = 30 * 60 * 1000;

/** "6月30日 14:25" 形式に整形する */
export function formatUploadedAt(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ja-JP', {
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * ファイル配列をアップロード単位でグループ化する。
 * 入力は createdAt の降順（新しい順）を前提とし、その並びを保ったまま
 * 隣接要素を「同一保存者 かつ 直近ファイルとの時刻差が許容内」で束ねる。
 */
export function groupFilesByUpload<T extends GroupableFile>(files: T[]): FileGroup<T>[] {
    const groups: FileGroup<T>[] = [];
    let lastMs = 0;

    for (const file of files) {
        const uploadedBy = file.uploadedBy ?? null;
        const t = new Date(file.createdAt).getTime();
        const current = groups[groups.length - 1];

        if (
            current &&
            current.uploadedBy === uploadedBy &&
            !Number.isNaN(t) &&
            Math.abs(lastMs - t) <= GROUP_GAP_MS
        ) {
            current.files.push(file);
        } else {
            groups.push({
                key: file.id,
                uploadedBy,
                uploadedByName: file.uploadedByName ?? null,
                representativeAt: file.createdAt,
                files: [file],
            });
        }

        if (!Number.isNaN(t)) lastMs = t;
    }

    return groups;
}
