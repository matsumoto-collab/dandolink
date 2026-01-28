import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavigationProvider } from "@/contexts/NavigationContext";
import AuthProvider from '@/components/AuthProvider';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "施工管理システム - YuSystem",
    description: "建設・施工管理向けの業務管理システム",
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
                <AuthProvider>
                    <NavigationProvider>
                        {children}
                    </NavigationProvider>
                </AuthProvider>
            </body>
        </html>
    );
}
