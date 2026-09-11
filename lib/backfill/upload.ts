/**
 * 画面からアップロードされた 4 ファイルを読む（サーバー側）。
 *
 * 元の CSV は UTF-8（BOM 付き）だが、Excel で開いて保存し直すと Shift_JIS になることがある。
 * UTF-8 として正しく読めなければ Shift_JIS として読み直す（文字化けしたまま見出し不一致になるのを防ぐ）。
 */
import type { BackfillFileKind, BackfillFileTexts } from './parse';

const KINDS: BackfillFileKind[] = ['projects', 'sales', 'works', 'adjustments'];

/** 1 ファイルの上限（元の作業履歴 CSV が約 0.6MB） */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function decodeCsv(buf: ArrayBuffer): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return new TextDecoder('shift_jis').decode(buf);
    }
}

export async function readBackfillUpload(form: FormData): Promise<
    { ok: true; texts: BackfillFileTexts; fileNames: Record<BackfillFileKind, string> } | { ok: false; error: string }
> {
    const texts: Partial<BackfillFileTexts> = {};
    const fileNames: Partial<Record<BackfillFileKind, string>> = {};
    for (const kind of KINDS) {
        const file = form.get(kind);
        if (!file || typeof file === 'string') return { ok: false, error: '4 つのファイルをすべて選んでください' };
        if (file.size > MAX_FILE_BYTES) return { ok: false, error: `${file.name} が大きすぎます（5MB まで）` };
        texts[kind] = decodeCsv(await file.arrayBuffer());
        fileNames[kind] = file.name;
    }
    return { ok: true, texts: texts as BackfillFileTexts, fileNames: fileNames as Record<BackfillFileKind, string> };
}
