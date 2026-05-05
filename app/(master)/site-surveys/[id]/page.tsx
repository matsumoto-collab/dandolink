// プレースホルダー実装。Phase 1 の次タスクで実機能に置き換え予定。
import Link from 'next/link';
import { ArrowLeft, FileSearch } from 'lucide-react';

interface PageProps {
    params: { id: string };
}

export default function SiteSurveyPage({ params }: PageProps) {
    return (
        <div className="max-w-[1800px] mx-auto p-6">
            <div className="flex items-center gap-3 mb-6">
                <FileSearch className="w-6 h-6 text-teal-600" />
                <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                    現場調査
                </h1>
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                    未実装
                </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <p className="text-sm text-slate-700 mb-2">
                    <span className="font-medium">ID:</span> {params.id}
                </p>
                <p className="text-sm text-slate-600">
                    現場調査機能は次のタスクで実装されます。
                </p>
            </div>

            <div className="mt-6">
                <Link
                    href="/?page=project-masters"
                    className="inline-flex items-center gap-1.5 text-sm text-teal-600 hover:text-teal-700"
                >
                    <ArrowLeft className="w-4 h-4" />
                    案件一覧へ戻る
                </Link>
            </div>
        </div>
    );
}
