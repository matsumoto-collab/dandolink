/**
 * チャットの表示形式の判定（PC・iPad はウインドウ／スマホはチャット画面＋ボトムシート）。
 * 閾値は md:(768px) に揃える。lg: はアスペクト比条件付きで iPad が外れるため使わない。
 */
export const CHAT_WINDOW_MEDIA_QUERY = '(min-width: 768px)';

/** 今の画面幅ならチャットはウインドウ表示か（PC・iPad=true／スマホ=false。SSR は false） */
export function isChatWindowViewport(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(CHAT_WINDOW_MEDIA_QUERY).matches;
}
