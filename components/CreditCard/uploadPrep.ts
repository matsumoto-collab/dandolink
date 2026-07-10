import imageCompression from 'browser-image-compression';

// Vercel のリクエストボディ上限（約4.5MB）。圧縮後の画像・PDF がこれを超えたら送信前に弾く。
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type UploadStatus = 'compressing' | 'uploading' | 'done' | 'error';
export interface UploadRow { name: string; status: UploadStatus; message?: string }

// クライアント側の前処理。画像は圧縮（失敗時は原本）、PDFは無加工。上限超過はエラーで返す。
// app/(finance)/cashbook/page.tsx の prepareFile と同処理（受け箱と明細書アップロードで共用するため切り出し）。
export async function prepareFile(file: File): Promise<{ blob: Blob; name: string } | { error: string }> {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);

    if (isPdf) {
        if (file.size > MAX_UPLOAD_BYTES) return { error: 'PDFは4MB以下にしてください' };
        return { blob: file, name: file.name };
    }
    if (isImg) {
        let blob: Blob = file;
        if (file.size > 1024 * 1024) {
            try {
                blob = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 2000, useWebWorker: true, initialQuality: 0.8 });
            } catch {
                blob = file; // HEIC 等で圧縮に失敗したら原本を送る（サーバの sharp が変換）
            }
        }
        if (blob.size > MAX_UPLOAD_BYTES) return { error: '画像が大きすぎます（4MB以下にしてください）' };
        return { blob, name: file.name };
    }
    return { error: '対応していないファイル形式です（画像・PDF）' };
}

// 一覧・テーブルで共用する表示フォーマッタ（日付は UTC 0時保存なので UTC 基準で表示する）
export const fmtDate = (s: string | null) => {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

export const yen = (n: number | string | null) => {
    if (n == null || n === '') return '—';
    const v = Number(n);
    return v < 0 ? `-¥${Math.abs(v).toLocaleString()}` : `¥${v.toLocaleString()}`;
};

// 通貨つき金額表示。currency が null/空なら円（整数）、外貨は小数2桁＋記号（USD は $、その他はコード）
export const money = (n: number | string | null, currency?: string | null) => {
    if (n == null || n === '') return '—';
    if (!currency) return yen(n);
    const v = Number(n);
    const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const sym = currency === 'USD' ? '$' : `${currency} `;
    return `${v < 0 ? '-' : ''}${sym}${abs}`;
};

// 'YYYY-MM-DD'（date input 用。UTC 0時保存の ISO 文字列から）
export const toInputDate = (s: string | null) => (s ? s.slice(0, 10) : '');
