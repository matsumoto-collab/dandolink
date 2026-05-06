// /site-surveys/new 新規作成用フル画面エディタ
'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';

const SiteSurveyEditor = dynamic(
    () => import('@/components/SiteSurvey/SiteSurveyEditor'),
    {
        ssr: false,
        loading: () => (
            <div className="fixed inset-0 z-30 bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
            </div>
        ),
    },
);

function NewSiteSurveyEditorWithParams() {
    const { data: session, status } = useSession();
    const router = useRouter();
    useEffect(() => {
        if (status !== 'authenticated') return;
        const role = session?.user?.role;
        if (role !== 'admin' && role !== 'manager') {
            router.replace('/');
        }
    }, [status, session, router]);
    const search = useSearchParams();
    const initialProjectMasterId = search?.get('projectMasterId') ?? undefined;
    if (status === 'authenticated') {
        const role = session?.user?.role;
        if (role !== 'admin' && role !== 'manager') return null;
    }
    return <SiteSurveyEditor mode="new" initialProjectMasterId={initialProjectMasterId} />;
}

export default function NewSiteSurveyPage() {
    return (
        <Suspense
            fallback={
                <div className="fixed inset-0 z-30 bg-slate-50 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                </div>
            }
        >
            <NewSiteSurveyEditorWithParams />
        </Suspense>
    );
}
