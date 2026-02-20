import { BarChart3 } from 'lucide-react';

export default function ProfitDashboardLoading() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
            <div className="max-w-7xl mx-auto">
                {/* ヘッダー */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            <BarChart3 className="w-7 h-7" />
                            利益ダッシュボード
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">全案件の利益状況を一覧で確認</p>
                    </div>
                </div>

                {/* サマリーカードのスケルトン */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="rounded-lg border p-4 bg-white border-slate-200 animate-pulse">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-5 h-5 bg-slate-200 rounded" />
                                <div className="w-16 h-4 bg-slate-200 rounded" />
                            </div>
                            <div className="w-24 h-8 bg-slate-200 rounded" />
                        </div>
                    ))}
                </div>

                {/* フィルターのスケルトン */}
                <div className="bg-white rounded-lg shadow p-4 mb-6 animate-pulse">
                    <div className="flex items-center gap-4">
                        <div className="w-24 h-4 bg-slate-200 rounded" />
                        <div className="flex gap-2">
                            {[...Array(3)].map((_, i) => (
                                <div key={i} className="w-16 h-8 bg-slate-200 rounded-lg" />
                            ))}
                        </div>
                    </div>
                </div>

                {/* テーブルのスケルトン */}
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-3 text-left"><div className="w-16 h-4 bg-slate-200 rounded" /></th>
                                    <th className="px-4 py-3 text-left"><div className="w-12 h-4 bg-slate-200 rounded" /></th>
                                    <th className="px-4 py-3 text-right"><div className="w-12 h-4 bg-slate-200 rounded ml-auto" /></th>
                                    <th className="px-4 py-3 text-right"><div className="w-12 h-4 bg-slate-200 rounded ml-auto" /></th>
                                    <th className="px-4 py-3 text-right"><div className="w-12 h-4 bg-slate-200 rounded ml-auto" /></th>
                                    <th className="px-4 py-3 text-right"><div className="w-12 h-4 bg-slate-200 rounded ml-auto" /></th>
                                    <th className="px-4 py-3 text-center"><div className="w-12 h-4 bg-slate-200 rounded mx-auto" /></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {[...Array(8)].map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-4 py-3">
                                            <div className="w-32 h-5 bg-slate-200 rounded mb-1" />
                                            <div className="w-16 h-3 bg-slate-100 rounded" />
                                        </td>
                                        <td className="px-4 py-3"><div className="w-20 h-4 bg-slate-200 rounded" /></td>
                                        <td className="px-4 py-3 text-right"><div className="w-20 h-4 bg-slate-200 rounded ml-auto" /></td>
                                        <td className="px-4 py-3 text-right"><div className="w-20 h-4 bg-slate-200 rounded ml-auto" /></td>
                                        <td className="px-4 py-3 text-right"><div className="w-20 h-4 bg-slate-200 rounded ml-auto" /></td>
                                        <td className="px-4 py-3 text-right"><div className="w-12 h-4 bg-slate-200 rounded ml-auto" /></td>
                                        <td className="px-4 py-3 text-center"><div className="w-8 h-4 bg-slate-200 rounded mx-auto" /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
