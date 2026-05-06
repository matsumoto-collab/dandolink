// /site-surveys/[id] フル画面エディタ。既存の現場調査を読み込んで編集する
'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useSiteSurvey } from '@/hooks/useSiteSurveys';

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

export default function SiteSurveyEditPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    useEffect(() => {
        if (status !== 'authenticated') return;
        const role = session?.user?.role;
        if (role !== 'admin' && role !== 'manager') {
            router.replace('/');
        }
    }, [status, session, router]);
    const id = (params?.id as string) ?? '';
    const { siteSurvey, isLoading, error } = useSiteSurvey(id);

    if (status === 'authenticated') {
        const role = session?.user?.role;
        if (role !== 'admin' && role !== 'manager') return null;
    }

    if (isLoading || siteSurvey === null) {
        return (
            <div className="fixed inset-0 z-30 bg-slate-50 flex flex-col items-center justify-center gap-3">
                {error ? (
                    <>
                        <p className="text-sm text-red-600">{error}</p>
                        <button
                            onClick={() => router.push('/site-surveys')}
                            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium"
                        >
                            一覧へ戻る
                        </button>
                    </>
                ) : (
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                )}
            </div>
        );
    }

    return <SiteSurveyEditor mode="edit" initial={siteSurvey} />;
}
