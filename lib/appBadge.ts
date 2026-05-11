/**
 * Web App Badging API ラッパー。
 * PWA としてインストールされたアプリのアイコンに未読件数バッジを表示する。
 *
 * 対応: Android Chrome/Edge (PWA), iOS/iPadOS 16.4+ Safari (PWA), Desktop Chrome/Edge
 * 非対応: iOS Safari (ブラウザ), Firefox, サードパーティiOSブラウザ
 *
 * 非対応環境では何もしない（feature-detectで握りつぶし）。
 */

type BadgeNavigator = {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
};

/**
 * バッジ件数を設定する。0 を渡すとバッジをクリアする。
 * 非対応環境では no-op。
 */
export async function setAppBadge(count: number): Promise<void> {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as unknown as BadgeNavigator;
    try {
        if (count <= 0) {
            if (typeof nav.clearAppBadge === 'function') {
                await nav.clearAppBadge();
            }
            return;
        }
        if (typeof nav.setAppBadge === 'function') {
            await nav.setAppBadge(count);
        }
    } catch {
        // 非対応環境やフォーカスなし状態などでrejectされても無視
    }
}

/**
 * バッジを明示的にクリアする。ログアウト時などに使用。
 */
export async function clearAppBadge(): Promise<void> {
    await setAppBadge(0);
}
