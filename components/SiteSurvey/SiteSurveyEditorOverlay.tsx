// /site-surveys/* の URL に遷移せず、フルスクリーンで編集できるオーバーレイ
// useSiteSurveyEditor ストアの状態に応じて表示・非表示を切り替える
'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useSiteSurveyEditor } from '@/stores/siteSurveySlices/editorOpenSlice';
import { useSiteSurvey } from '@/hooks/useSiteSurveys';

const SiteSurveyEditor = dynamic(
    () => import('@/components/SiteSurvey/SiteSurveyEditor'),
    {
        ssr: false,
        loading: () => (
            <div className="fixed inset-0 z-[80] bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
            </div>
        ),
    },
);

export default function SiteSurveyEditorOverlay() {
    const isOpen = useSiteSurveyEditor((s) => s.isOpen);
    const mode = useSiteSurveyEditor((s) => s.mode);
    const surveyId = useSiteSurveyEditor((s) => s.surveyId);
    const projectMasterId = useSiteSurveyEditor((s) => s.projectMasterId);
    const close = useSiteSurveyEditor((s) => s.close);
    const openEdit = useSiteSurveyEditor((s) => s.openEdit);
    const { data: session } = useSession();
    const role = session?.user?.role;

    if (role !== 'admin' && role !== 'manager') return null;
    if (!isOpen) return null;

    return (
        <div className="z-[80]">
            {mode === 'edit' && surveyId ? (
                <EditMount
                    surveyId={surveyId}
                    onClose={close}
                />
            ) : (
                <SiteSurveyEditor
                    mode="new"
                    initialProjectMasterId={projectMasterId ?? undefined}
                    onClose={close}
                    onSaveNewSuccess={(id) => {
                        // 新規保存後はそのまま編集モードに切り替えて作業を継続できる
                        openEdit(id);
                    }}
                />
            )}
        </div>
    );
}

// 編集モードでは ID をもとに API から取得して読み込む
function EditMount({ surveyId, onClose }: { surveyId: string; onClose: () => void }) {
    const { siteSurvey, isLoading, error } = useSiteSurvey(surveyId);

    if (isLoading || siteSurvey === null) {
        return (
            <div className="fixed inset-0 z-[80] bg-slate-50 flex flex-col items-center justify-center gap-3">
                {error ? (
                    <>
                        <p className="text-sm text-red-600">{error}</p>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium"
                        >
                            閉じる
                        </button>
                    </>
                ) : (
                    <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                )}
            </div>
        );
    }

    return (
        <SiteSurveyEditor
            mode="edit"
            initial={siteSurvey}
            onClose={onClose}
        />
    );
}
