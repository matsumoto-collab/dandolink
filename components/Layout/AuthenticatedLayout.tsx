'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import Loading from '@/components/ui/Loading';

export default function AuthenticatedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { data: session, status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        }
    }, [status, router]);

    // ローディング中
    if (status === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loading text="認証確認中..." />
            </div>
        );
    }

    // 未認証
    if (!session) {
        return null;
    }

    // 認証済み
    return (
        <div className="min-h-screen bg-gray-50">
            <Sidebar />
            <Header />
            <main className="
                fixed top-0 bottom-0 bg-gradient-to-br from-slate-50 via-white to-slate-100 overflow-auto
                
                /* Mobile: Full width with top padding for header */
                left-0 right-0 pt-16
                
                /* Desktop: Offset by sidebar width, no top padding */
                lg:left-64 lg:pt-0 lg:right-0
            ">
                <div className="p-4 sm:p-6 w-full min-w-0">
                    {children}
                </div>
            </main>
        </div>
    );
}
