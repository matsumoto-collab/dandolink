import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import { NavigationProvider } from "@/contexts/NavigationContext";
import AuthProvider from '@/components/AuthProvider';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Toaster } from 'react-hot-toast';
import ToastWatchdog from '@/components/ui/ToastWatchdog';
import { TOAST_DURATIONS } from '@/lib/toastConfig';
import { CalendarProviders } from './providers/CalendarProviders';
import { FinanceProviders } from './providers/FinanceProviders';

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const notoSansJP = Noto_Sans_JP({
    subsets: ["latin"],
    weight: ["400", "500", "700"],
    variable: "--font-noto",
    display: "swap",
    // unicode-range 分割で 40+ chunk が <link rel="preload"> として吐かれ初回ロードを膨らませるため、preload は無効化。実際に必要なchunkだけ後続で読み込まれる
    preload: false,
});

// viewport は metadata とは別に定義（Next.js 14+ 推奨）
// maximumScale は指定しない（ピンチズーム禁止はアクセシビリティ違反）
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
};

export const metadata: Metadata = {
    title: "施工管理システム - DandoLink",
    description: "建設・施工管理向けの業務管理システム",
    manifest: "/manifest.json",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "DandoLink",
    },
    icons: {
        icon: "/icon-192.png",
        apple: "/apple-touch-icon.png",
    },
    themeColor: "#0f172a",
    other: {
        'mobile-web-app-capable': 'yes',
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ja">
            <body className={`${notoSansJP.variable} ${inter.variable} font-sans`} suppressHydrationWarning>
                {/* サイドバー折りたたみ状態を paint 前に確定し、メインコンテンツのレイアウトジャンプを防ぐ。
                    localStorage を同期読み込みして body の data 属性へ反映 → CSS が左オフセットを即座に適用する。
                    （React state だとマウント後の useEffect で反映されるため一瞬ジャンプしていた） */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){try{var v=localStorage.getItem('dandolink:sidebarCollapsed');document.body.dataset.sidebarCollapsed=(v==='true')?'true':'false';}catch(e){}})();`,
                    }}
                />
                <Toaster
                    position="top-center"
                    containerClassName="dl-toast-container"
                    toastOptions={{
                        duration: TOAST_DURATIONS.default,
                        style: {
                            background: '#363636',
                            color: '#fff',
                        },
                        success: {
                            duration: TOAST_DURATIONS.success,
                            style: {
                                background: '#22c55e',
                            },
                        },
                        error: {
                            duration: TOAST_DURATIONS.error,
                            style: {
                                background: '#ef4444',
                            },
                        },
                    }}
                />
                {/* hover一時停止の固着で消えなくなったトーストを表示時間+1秒で強制クローズする保険 */}
                <ToastWatchdog />
                <ErrorBoundary>
                    <AuthProvider>
                        <NavigationProvider>
                            <CalendarProviders>
                                <FinanceProviders>
                                    {children}
                                </FinanceProviders>
                            </CalendarProviders>
                        </NavigationProvider>
                    </AuthProvider>
                </ErrorBoundary>
                {/* Service Worker 登録 */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `
                            if ('serviceWorker' in navigator) {
                                window.addEventListener('load', function() {
                                    navigator.serviceWorker.register('/sw.js').catch(function() {});
                                });
                            }
                        `,
                    }}
                />
            </body>
        </html>
    );
}
