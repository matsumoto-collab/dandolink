'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useNavigation } from '@/contexts/NavigationContext';
import { useChatStore } from '@/stores/chatStore';
import { isChatWindowViewport } from '@/lib/chatWindow';

/**
 * 「チャット」を開く入口を一本化する。
 *  - PC・iPad(768px以上): 画面内のチャットウインドウで開く（チャット画面へは遷移しない）
 *  - スマホ: 従来どおりチャット画面へ遷移する
 *
 * ウインドウはトップ(/)の MainContent でしか描画されないので、別ルート
 * （/project-masters など）に居るときはスケジュール画面へ移してから出す。
 *
 * @param roomId 開くルーム。省略時はウインドウ（一覧）／チャット画面を開くだけ
 */
export function useOpenChat() {
    const { activePage, setActivePage } = useNavigation();
    const router = useRouter();
    const pathname = usePathname();

    return useCallback(
        (roomId?: string | null) => {
            if (isChatWindowViewport()) {
                const store = useChatStore.getState();
                if (roomId) store.setDockedRoom(roomId);
                else store.openChatWindow();
                if (pathname !== '/') {
                    setActivePage('schedule');
                    router.push('/?page=schedule');
                } else if (activePage === 'chat') {
                    // チャット画面ではウインドウを出さない仕様なので、スケジュール画面に戻して出す
                    setActivePage('schedule');
                }
                return;
            }
            setActivePage('chat');
            if (roomId) router.push(`/?page=chat&roomId=${roomId}`);
            else if (pathname !== '/') router.push('/?page=chat');
        },
        [activePage, setActivePage, router, pathname]
    );
}
