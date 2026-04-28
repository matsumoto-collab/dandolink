'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { Plus, Trash2, Calendar, Users, Download, ChevronUp, ChevronDown, ChevronsUpDown, ListChecks, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

const AttendanceModal = dynamic(() => import('./AttendanceModal'), {
    loading: () => <Loading overlay />,
});

const MonthlyAttendanceView = dynamic(() => import('./MonthlyAttendanceView'), {
    loading: () => <Loading overlay />,
});

type AttendanceTab = 'daily' | 'monthly';

interface AttendanceRecord {
    id: string;
    userId: string;
    date: string;
    foremanId: string;
    earlyStartMinutes: number;
    morningLoadingMinutes: number;
    overtimeMinutes: number;
    eveningLoadingMinutes: number;
    earlyEndTime: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
}

interface ForemanUser {
    id: string;
    displayName: string;
    role: string;
}

interface Group {
    key: string;
    date: string;
    foremanId: string;
    memberCount: number;
    totalEarly: number;
    totalOvertime: number;
    totalMorning: number;
    totalEvening: number;
    earlyEndCount: number;
    updatedAt: string;
}

function formatDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function formatJaDate(s: string): string {
    const d = new Date(s);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const dd = d.getDate();
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${y}/${m}/${dd}（${w}）`;
}

function formatMinutes(min: number): string {
    if (min === 0) return '-';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}分`;
    if (m === 0) return `${h}時間`;
    return `${h}時間${m}分`;
}

const getInitialRange = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: formatDateKey(start), end: formatDateKey(end) };
};

export default function AttendancePage() {
    const { data: session } = useSession();
    const userRole = session?.user?.role ?? '';
    const userId = session?.user?.id ?? '';
    const isAdminOrManager = userRole === 'admin' || userRole === 'manager';
    const isForeman = userRole === 'foreman1' || userRole === 'foreman2';
    const canInput = isAdminOrManager || isForeman;

    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [foremen, setForemen] = useState<ForemanUser[]>([]);
    const [loading, setLoading] = useState(false);

    const initialRange = useMemo(getInitialRange, []);
    const [rangeStart, setRangeStart] = useState(initialRange.start);
    const [rangeEnd, setRangeEnd] = useState(initialRange.end);
    const [foremanFilter, setForemanFilter] = useState<string>('all');

    const [csvMonth, setCsvMonth] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    });
    const [csvLoading, setCsvLoading] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<{ date: Date; foremanId: string } | null>(null);

    const [activeTab, setActiveTab] = useState<AttendanceTab>('daily');
    const [monthlyRefreshKey, setMonthlyRefreshKey] = useState(0);

    type SortKey = 'date' | 'foreman' | 'count';
    type SortDir = 'asc' | 'desc';
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir(key === 'date' ? 'desc' : 'asc');
        }
    };

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return <ChevronsUpDown className="w-3 h-3 text-slate-300" />;
        return sortDir === 'asc'
            ? <ChevronUp className="w-3 h-3 text-slate-600" />
            : <ChevronDown className="w-3 h-3 text-slate-600" />;
    };

    const foremanNameMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const f of foremen) map.set(f.id, f.displayName);
        return map;
    }, [foremen]);
    const getForemanName = (id: string) => foremanNameMap.get(id) ?? '(未設定)';

    // 職長一覧
    useEffect(() => {
        fetch('/api/dispatch/foremen', { cache: 'no-store' })
            .then(r => r.json())
            .then((data: ForemanUser[]) => setForemen(data))
            .catch(err => logger.error('職長取得失敗:', err));
    }, []);

    // 出勤レコード取得
    const fetchRecords = useCallback(async () => {
        if (!rangeStart || !rangeEnd) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({ startDate: rangeStart, endDate: rangeEnd });
            const res = await fetch(`/api/attendance?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = (await res.json()) as AttendanceRecord[];
            setRecords(data);
        } catch (err) {
            logger.error('出勤簿取得失敗:', err);
            toast.error('出勤簿の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [rangeStart, rangeEnd]);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);

    // Supabase broadcast 経由で別端末の保存・削除を即時反映
    // self: false のため自分自身の操作は受信しない（自分は onSaved / 削除直後の fetch で更新）
    useEffect(() => {
        if (!session) return;
        initBroadcastChannel();
        const cleanup = onBroadcast('attendance_updated', () => {
            fetchRecords();
            setMonthlyRefreshKey(k => k + 1);
        });
        return cleanup;
    }, [session, fetchRecords]);

    // (foremanId, date) でグルーピング
    const groups: Group[] = useMemo(() => {
        const map = new Map<string, Group>();
        for (const r of records) {
            // フィルタ
            if (foremanFilter !== 'all' && r.foremanId !== foremanFilter) continue;
            const dateOnly = r.date.split('T')[0];
            const key = `${r.foremanId}__${dateOnly}`;
            const g = map.get(key) ?? {
                key,
                date: dateOnly,
                foremanId: r.foremanId,
                memberCount: 0,
                totalEarly: 0,
                totalOvertime: 0,
                totalMorning: 0,
                totalEvening: 0,
                earlyEndCount: 0,
                updatedAt: r.updatedAt,
            };
            g.memberCount += 1;
            g.totalEarly += r.earlyStartMinutes;
            g.totalOvertime += r.overtimeMinutes;
            g.totalMorning += r.morningLoadingMinutes;
            g.totalEvening += r.eveningLoadingMinutes;
            if (r.earlyEndTime) g.earlyEndCount += 1;
            if (new Date(r.updatedAt) > new Date(g.updatedAt)) g.updatedAt = r.updatedAt;
            map.set(key, g);
        }
        const arr = Array.from(map.values());
        arr.sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
                case 'date':
                    cmp = a.date.localeCompare(b.date);
                    break;
                case 'foreman':
                    cmp = getForemanName(a.foremanId).localeCompare(getForemanName(b.foremanId), 'ja');
                    break;
                case 'count':
                    cmp = a.memberCount - b.memberCount;
                    break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [records, foremanFilter, sortKey, sortDir, foremanNameMap]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleAddNew = () => {
        setEditTarget({ date: new Date(), foremanId: isForeman ? userId : '' });
        setIsModalOpen(true);
    };

    const handleEdit = (g: Group) => {
        if (!canInput) return;
        // 職長は自分のレコードのみ編集可
        if (isForeman && g.foremanId !== userId) {
            toast.error('他職長の出勤簿は編集できません');
            return;
        }
        const [y, m, d] = g.date.split('-').map(Number);
        setEditTarget({ date: new Date(y, m - 1, d), foremanId: g.foremanId });
        setIsModalOpen(true);
    };

    const handleDelete = async (e: React.MouseEvent, g: Group) => {
        e.stopPropagation();
        if (isForeman && g.foremanId !== userId) {
            toast.error('他職長の出勤簿は削除できません');
            return;
        }
        if (!confirm(`${formatJaDate(g.date)} ${getForemanName(g.foremanId)} の出勤簿を削除します。よろしいですか？`)) return;
        try {
            const res = await fetch(`/api/attendance?foremanId=${g.foremanId}&date=${g.date}`, {
                method: 'DELETE',
                cache: 'no-store',
            });
            if (!res.ok) throw new Error(`status ${res.status}`);
            toast.success('削除しました');
            // 別端末（同一ログイン）へ即時通知
            sendBroadcast('attendance_updated', { foremanId: g.foremanId, date: g.date });
            await fetchRecords();
            setMonthlyRefreshKey(k => k + 1);
        } catch (err) {
            logger.error('削除失敗:', err);
            toast.error('削除に失敗しました');
        }
    };

    const handleDownloadCsv = useCallback(async () => {
        if (!/^\d{4}-\d{2}$/.test(csvMonth)) {
            toast.error('対象月の形式が不正です');
            return;
        }
        setCsvLoading(true);
        try {
            const res = await fetch(`/api/attendance/export?month=${csvMonth}`, { cache: 'no-store' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `status ${res.status}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `attendance_${csvMonth}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            logger.error('CSV出力失敗:', err);
            toast.error('CSV出力に失敗しました');
        } finally {
            setCsvLoading(false);
        }
    }, [csvMonth]);

    const resetRange = () => {
        const r = getInitialRange();
        setRangeStart(r.start);
        setRangeEnd(r.end);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 w-full max-w-[1800px] mx-auto">
            {/* ヘッダー */}
            <div className="mb-4 flex-shrink-0">
                <h1 className="text-2xl font-bold text-slate-800">出勤簿一覧</h1>
                <p className="text-sm text-slate-500 mt-1">
                    {activeTab === 'daily'
                        ? '職長が登録した出勤簿を管理できます'
                        : '個人ごとの累計と月次明細を確認できます（閲覧専用）'}
                </p>
            </div>

            {/* タブ */}
            <div className="mb-4 flex-shrink-0 flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('daily')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'daily'
                            ? 'border-slate-800 text-slate-800'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <ListChecks className="w-4 h-4" />
                    日次（職長別）
                </button>
                <button
                    onClick={() => setActiveTab('monthly')}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                        activeTab === 'monthly'
                            ? 'border-slate-800 text-slate-800'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                >
                    <UserCircle className="w-4 h-4" />
                    月次（個人別）
                </button>
            </div>

            {activeTab === 'monthly' ? (
                <div className="flex-1 min-h-0 overflow-y-auto pb-4">
                    <MonthlyAttendanceView refreshKey={monthlyRefreshKey} />
                </div>
            ) : (
            <>
            {/* ツールバー */}
            <div className="mb-6 flex-shrink-0 flex flex-col gap-3 sm:gap-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <div className="flex-1" />
                    {canInput && (
                        <Button
                            variant="primary"
                            onClick={handleAddNew}
                            leftIcon={<Plus className="w-5 h-5" />}
                        >
                            <span className="hidden sm:inline">新規出勤簿入力</span>
                            <span className="sm:hidden">新規追加</span>
                        </Button>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
                    <select
                        value={foremanFilter}
                        onChange={(e) => setForemanFilter(e.target.value)}
                        className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="all">全ての職長</option>
                        {foremen.map(f => (
                            <option key={f.id} value={f.id}>{f.displayName}</option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-slate-600 whitespace-nowrap">期間</span>
                        <input
                            type="date"
                            value={rangeStart}
                            max={rangeEnd || undefined}
                            onChange={(e) => setRangeStart(e.target.value)}
                            className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        <span className="text-slate-400">〜</span>
                        <input
                            type="date"
                            value={rangeEnd}
                            min={rangeStart || undefined}
                            onChange={(e) => setRangeEnd(e.target.value)}
                            className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        <button
                            onClick={resetRange}
                            className="px-3 py-2.5 text-sm text-slate-600 hover:text-slate-800 transition-colors whitespace-nowrap"
                        >
                            直近30日
                        </button>
                    </div>

                    {(isAdminOrManager || isForeman) && (
                        <div className="flex items-center gap-2 sm:ml-auto">
                            <input
                                type="month"
                                value={csvMonth}
                                onChange={(e) => setCsvMonth(e.target.value)}
                                className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                            />
                            <Button
                                variant="outline"
                                onClick={handleDownloadCsv}
                                isLoading={csvLoading}
                                leftIcon={<Download className="w-4 h-4" />}
                            >
                                月次CSV
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* リスト */}
            <div className="flex-1 min-h-0 overflow-y-auto md:border md:border-slate-200 md:rounded-xl md:bg-white">
                {/* デスクトップ: ヘッダー */}
                <div className="hidden md:block bg-slate-100 border-b border-slate-200 select-none sticky top-0 z-10 md:rounded-t-xl">
                    <div className="grid grid-cols-[140px_140px_90px_1fr_70px] gap-2 px-4 py-3 text-xs font-bold text-slate-800 uppercase tracking-wider">
                        <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('date')}>
                            <Calendar className="w-3.5 h-3.5" />
                            日付
                            <SortIcon column="date" />
                        </div>
                        <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('foreman')}>
                            職長
                            <SortIcon column="foreman" />
                        </div>
                        <div className="flex items-center gap-1 cursor-pointer hover:text-slate-600" onClick={() => toggleSort('count')}>
                            <Users className="w-3.5 h-3.5" />
                            人数
                            <SortIcon column="count" />
                        </div>
                        <div>合計</div>
                        <div></div>
                    </div>
                </div>

                <div>
                    {loading ? (
                        <div className="flex items-center justify-center h-48">
                            <Loading text="読み込み中..." />
                        </div>
                    ) : groups.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                            <p className="text-slate-500">指定期間に出勤簿が登録されていません</p>
                        </div>
                    ) : (
                        <div className="space-y-3 md:space-y-0 md:divide-y md:divide-slate-100">
                            {groups.map(g => {
                                const canDelete = isAdminOrManager || (isForeman && g.foremanId === userId);
                                return (
                                    <div
                                        key={g.key}
                                        className="bg-white rounded-xl md:rounded-none border border-slate-200 md:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
                                        onClick={() => handleEdit(g)}
                                    >
                                        {/* モバイル */}
                                        <div className="md:hidden p-4">
                                            <div className="flex items-start justify-between mb-2">
                                                <div>
                                                    <div className="text-base font-semibold text-slate-900">
                                                        {formatJaDate(g.date)}
                                                    </div>
                                                    <div className="text-sm text-slate-600 mt-0.5">
                                                        {getForemanName(g.foremanId)} / {g.memberCount}名
                                                    </div>
                                                </div>
                                                {canDelete && (
                                                    <button
                                                        onClick={(e) => handleDelete(e, g)}
                                                        className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                                                        aria-label="削除"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                                                {g.totalEarly > 0 && <span>早出 {formatMinutes(g.totalEarly)}</span>}
                                                {g.totalMorning > 0 && <span>朝積 {formatMinutes(g.totalMorning)}</span>}
                                                {g.totalOvertime > 0 && <span>残業 {formatMinutes(g.totalOvertime)}</span>}
                                                {g.totalEvening > 0 && <span>夕積 {formatMinutes(g.totalEvening)}</span>}
                                                {g.earlyEndCount > 0 && <span>早終 {g.earlyEndCount}名</span>}
                                                {g.totalEarly === 0 && g.totalMorning === 0 && g.totalOvertime === 0 && g.totalEvening === 0 && g.earlyEndCount === 0 && (
                                                    <span className="text-slate-400">全員定時</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* デスクトップ */}
                                        <div className="hidden md:grid grid-cols-[140px_140px_90px_1fr_70px] gap-2 px-4 py-3 items-center">
                                            <div className="text-[12px] font-semibold text-slate-900">
                                                {formatJaDate(g.date)}
                                            </div>
                                            <div className="text-[12px] text-slate-700 truncate">
                                                {getForemanName(g.foremanId)}
                                            </div>
                                            <div className="text-[12px] text-slate-700">
                                                {g.memberCount}名
                                            </div>
                                            <div className="text-[12px] text-slate-700 flex flex-wrap gap-x-3 gap-y-0.5 min-w-0">
                                                {g.totalEarly > 0 && <span>早出 {formatMinutes(g.totalEarly)}</span>}
                                                {g.totalMorning > 0 && <span>朝積 {formatMinutes(g.totalMorning)}</span>}
                                                {g.totalOvertime > 0 && <span>残業 {formatMinutes(g.totalOvertime)}</span>}
                                                {g.totalEvening > 0 && <span>夕積 {formatMinutes(g.totalEvening)}</span>}
                                                {g.earlyEndCount > 0 && <span>早終 {g.earlyEndCount}名</span>}
                                                {g.totalEarly === 0 && g.totalMorning === 0 && g.totalOvertime === 0 && g.totalEvening === 0 && g.earlyEndCount === 0 && (
                                                    <span className="text-slate-400">全員定時</span>
                                                )}
                                            </div>
                                            <div className="flex justify-end">
                                                {canDelete && (
                                                    <button
                                                        onClick={(e) => handleDelete(e, g)}
                                                        className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                                    >
                                                        削除
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-2 flex-shrink-0 text-sm text-slate-600">
                全 {groups.length} 件
            </div>
            </>
            )}

            {/* モーダル */}
            <AttendanceModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                initialDate={editTarget?.date}
                initialForemanId={editTarget?.foremanId}
                onSaved={() => {
                    fetchRecords();
                    setMonthlyRefreshKey(k => k + 1);
                }}
            />
        </div>
    );
}
