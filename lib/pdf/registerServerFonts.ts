/**
 * サーバーサイド PDF 生成専用のフォント登録（CDN 非依存化）。
 *
 * 背景:
 *   components/pdf/styles.ts は日本語フォント NotoSansJP を CDN (jsdelivr) の woff
 *   URL から登録する。ブラウザ側レンダリング（見積/請求書のライブプレビュー）では
 *   ブラウザが取得するため問題ないが、@react-pdf/renderer をサーバー（Node ランタイム）
 *   で renderToBuffer する材料出庫伝票の印刷 PDF では、レンダリング時に毎回
 *   サーバーから CDN を fetch する。Vercel のサーバーレス環境ではこの外部 fetch が
 *   失敗/遅延することがあり、その場合フォント解決が例外を投げて PDF 生成全体が落ちる
 *   （症状: {"error":"材料出庫伝票PDF生成に失敗しました"}）。
 *
 * 対処:
 *   サーバー側ではリポジトリ同梱の TTF（public/fonts/NotoSansJP-Regular.ttf）を
 *   ローカルファイルパスとして登録する。@react-pdf/font のローダーはローカルパスを
 *   fontkit.open でディスクから読むため、ネットワーク取得が一切発生しない。
 *   既存の NotoSansJP 登録（styles.ts の CDN 副作用）は破棄してローカルを優先する
 *   （Helvetica 等の標準フォントは温存するため Font.clear() は使わない）。
 *   同梱ファイルが見つからない場合のみ CDN にフォールバックし、回帰を起こさない。
 *
 * 注意:
 *   Vercel のサーバーレス関数へ TTF を確実に同梱するため、next.config.js の
 *   experimental.outputFileTracingIncludes で当該ルートに public/fonts を含める
 *   （Regular / Bold の両方を列挙すること）。
 */
import fs from 'fs';
import path from 'path';
import { Font } from '@react-pdf/renderer';

// styles.ts と完全一致の CDN フォールバック（同梱ファイル不在時のみ使用）
const CDN_400 =
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-400-normal.woff';
const CDN_700 =
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@4.5.12/files/noto-sans-jp-japanese-700-normal.woff';

const regularPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.ttf');
const boldPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Bold.ttf');
const exists = (p: string) => {
    try {
        return fs.existsSync(p);
    } catch {
        return false;
    }
};
const hasLocalFont = exists(regularPath);
// Bold が無い場合のみ Regular で代替（従来動作）。
const hasLocalBold = exists(boldPath);

const src400 = hasLocalFont ? regularPath : CDN_400;
const src700 = hasLocalBold ? boldPath : hasLocalFont ? regularPath : CDN_700;

// 既存の NotoSansJP 登録（CDN）を破棄してローカル優先で再登録する。
// Font.clear() は Helvetica 等の標準フォントまで消すため使わず、当該ファミリーのみ削除。
const registeredFamilies = Font.getRegisteredFonts() as Record<string, unknown>;
if (registeredFamilies && registeredFamilies['NotoSansJP']) {
    delete registeredFamilies['NotoSansJP'];
}

Font.register({
    family: 'NotoSansJP',
    fonts: [
        { src: src400, fontWeight: 'normal' },
        { src: src700, fontWeight: 'bold' },
    ],
});

/** 同梱フォントが使われているか（ログ/検証用） */
export const usingLocalFont = hasLocalFont;
