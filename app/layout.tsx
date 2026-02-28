import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavigationProvider } from "@/contexts/NavigationContext";
import AuthProvider from '@/components/AuthProvider';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Toaster } from 'react-hot-toast';
import { CalendarProviders } from './providers/CalendarProviders';
import { FinanceProviders } from './providers/FinanceProviders';
import { ProfitDashboardProvider } from '@/contexts/ProfitDashboardContext';

const inter = Inter({ subsets: ["latin"] });

// viewport は metadata とは別に定義（Next.js 14+ 推奨）
export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
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
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ja">
            <body className={inter.className}>
                <Toaster
                    position="top-center"
                    toastOptions={{
                        duration: 4000,
                        style: {
                            background: '#363636',
                            color: '#fff',
                        },
                        success: {
                            duration: 3000,
                            style: {
                                background: '#22c55e',
                            },
                        },
                        error: {
                            duration: 5000,
                            style: {
                                background: '#ef4444',
                            },
                        },
                    }}
                />
                <ErrorBoundary>
                    <AuthProvider>
                        <NavigationProvider>
                            <CalendarProviders>
                                <FinanceProviders>
                                    <ProfitDashboardProvider>
                                        {children}
                                    </ProfitDashboardProvider>
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
