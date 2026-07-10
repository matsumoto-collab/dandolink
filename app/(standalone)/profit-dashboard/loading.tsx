export default function ProfitDashboardLoading() {
    return (
        <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
            <div className="max-w-[1800px] mx-auto">
                {/* ヘッダー */}
                <div className="mb-4 sm:mb-6">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">利益ダッシュボード</h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">読み込み中…</p>
                </div>

                {/* 月次パネルのスケルトン */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-pulse">
                    {/* 期間コントロール行 */}
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-40 h-7 bg-slate-200 rounded-lg" />
                        <div className="w-32 h-7 bg-slate-100 rounded-lg" />
                    </div>
                    {/* ヘッドライン＋グラフ */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-4">
                        <div className="lg:col-span-1 space-y-2">
                            <div className="w-24 h-3 bg-slate-100 rounded" />
                            <div className="w-40 h-9 bg-slate-200 rounded" />
                            <div className="w-32 h-4 bg-slate-100 rounded" />
                        </div>
                        <div className="lg:col-span-2 h-[200px] bg-slate-100 rounded-lg" />
                    </div>
                    {/* KPI 4枚 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                        {[...Array(4)].map((_, i) => (
                            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                                <div className="w-16 h-3 bg-slate-200 rounded mb-2" />
                                <div className="w-24 h-5 bg-slate-200 rounded" />
                            </div>
                        ))}
                    </div>
                    {/* 内訳テーブル */}
                    <div className="border-t border-slate-200 pt-5 space-y-2">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-8 bg-slate-100 rounded" />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
