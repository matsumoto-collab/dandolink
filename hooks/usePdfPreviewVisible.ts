import { useLocalStorage } from './useLocalStorage';

/**
 * PDFライブプレビューの表示/非表示状態を localStorage に永続化するフック。
 *
 * 帳票種別ごとに storageKey を分けることで、画面ごとに独立した設定を保持する
 * （例: 見積書はプレビューON、請求書はOFF）。
 *
 * @param storageKey localStorage キー（画面ごとにユニークにすること）
 * @param defaultVisible 初回アクセス時のデフォルト表示状態（既定: 表示）
 */
export function usePdfPreviewVisible(storageKey: string, defaultVisible = true) {
    const [visible, setVisible] = useLocalStorage<boolean>(storageKey, defaultVisible);
    const toggle = () => setVisible(v => !v);
    return { visible, setVisible, toggle } as const;
}
