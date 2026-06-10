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

// モバイルの固定列用の短い日付（例: 6/10（火））
function formatShortJaDate(s: string): string {
    const d = new Date(s);
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}（${w}）`;
}

// テーブルセル用の時間表示（0 は「−」、それ以外は H:MM）
function formatHM(min: number): string {
    if (min <= 0) return '−';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${m.toString().padStart(2, '0')}`;
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
    // 報告一覧と同じ 20件/ページ のページネーション
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 20;

    const [csvMonth, setCsvMonth] = useState<string>(() => {
        const d = new Date();
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    });
    const [csvLoading, setCsvLoading] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<{ date: Date; foremanId: string } | null>(null);

    const [activeTab, setActiveTab] = useState<AttendanceTab>('daily');
    const [monthlyRefreshKey, setMonthlyRefreshKey] = useState(0);

    type SortKey = 'date' | 'foreman' | 'count' | 'early' | 'morning' | 'overtime' | 'evening' | 'earlyEnd';
    type SortDir = 'asc' | 'desc';
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            // 日付・時間系は新しい/多い順が見たいので desc 始まり
            setSortDir(key === 'foreman' || key === 'count' ? 'asc' : 'desc');
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
                case 'early':
                    cmp = a.totalEarly - b.totalEarly;
                    break;
                case 'morning':
                    cmp = a.totalMorning - b.totalMorning;
                    break;
                case 'overtime':
                    cmp = a.totalOvertime - b.totalOvertime;
                    break;
                case 'evening':
                    cmp = a.totalEvening - b.totalEvening;
                    break;
                case 'earlyEnd':
                    cmp = a.earlyEndCount - b.earlyEndCount;
                    break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [records, foremanFilter, sortKey, sortDir, foremanNameMap]); // eslint-disable-line react-hooks/exhaustive-deps

    // フィルタ・期間変更時はページをリセット（報告一覧と同じ挙動）
    useEffect(() => {
        setCurrentPage(1);
    }, [foremanFilter, rangeStart, rangeEnd]);

    const totalPages = Math.ceil(groups.length / ITEMS_PER_PAGE);
    const paginatedGroups = useMemo(() => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return groups.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    }, [groups, currentPage]);

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
            {/* ヘッダー（モバイルは新規追加をタイトル行へ統合・説明文非表示） */}
            <div className="mb-3 sm:mb-4 flex-shrink-0 flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800">出勤簿一覧</h1>
                    <p className="hidden sm:block text-sm text-slate-500 mt-1">
                        {activeTab === 'daily'
                            ? '職長が登録した出勤簿を管理できます'
                            : '個人ごとの累計と月次明細を確認できます（閲覧専用）'}
                    </p>
                </div>
                {canInput && activeTab === 'daily' && (
                    <div className="sm:hidden flex-shrink-0">
                        <Button
                            variant="primary"
                            onClick={handleAddNew}
                            leftIcon={<Plus className="w-5 h-5" />}
                        >
                            新規追加
                        </Button>
                    </div>
                )}
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
            {/* ツールバー（モバイルは 職長 / 期間+直近30日 / 月次CSV の3段に圧縮。新規はタイトル行へ） */}
            <div className="mb-3 sm:mb-6 flex-shrink-0 flex flex-col gap-2 sm:gap-4">
                <div className="hidden sm:flex items-center gap-3">
                    <div className="flex-1" />
                    {canInput && (
                        <Button
                            variant="primary"
                            onClick={handleAddNew}
                            leftIcon={<Plus className="w-5 h-5" />}
                        >
                            新規出勤簿入力
                        </Button>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
                    <select
                        value={foremanFilter}
                        onChange={(e) => setForemanFilter(e.target.value)}
                        className="px-3 sm:px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    >
                        <option value="all">全ての職長</option>
                        {foremen.map(f => (
                            <option key={f.id} value={f.id}>{f.displayName}</option>
                        ))}
                    </select>
                    {/* 期間2つ+直近30日を1行に（「期間」ラベルは sm+ のみ表示） */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="hidden sm:inline text-sm text-slate-600 whitespace-nowrap">期間</span>
                        <input
                            type="date"
                            value={rangeStart}
                            max={rangeEnd || undefined}
                            onChange={(e) => setRangeStart(e.target.value)}
                            // モバイルで input が縮まず横並びを押し出さないよう flex-1 min-w-0
                            className="flex-1 sm:flex-none min-w-0 px-2 sm:px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        <span className="text-slate-400 flex-shrink-0">〜</span>
                        <input
                            type="date"
                            value={rangeEnd}
                            min={rangeStart || undefined}
                            onChange={(e) => setRangeEnd(e.target.value)}
                            className="flex-1 sm:flex-none min-w-0 px-2 sm:px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                        <button
                            onClick={resetRange}
                            className="flex-shrink-0 px-2 sm:px-3 py-2.5 text-sm font-medium text-teal-700 hover:text-teal-800 sm:font-normal sm:text-slate-600 sm:hover:text-slate-800 transition-colors whitespace-nowrap"
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
                                className="flex-1 sm:flex-none min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
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

            {/* リスト（PC・モバイル共通のテーブル。内訳は独立列・モバイルは横スクロールで日付/職長を左固定） */}
            <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-xl bg-white">
                {loading ? (
                    <div className="flex items-center justify-center h-48">
                        <Loading text="読み込み中..." />
                    </div>
                ) : groups.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500">指定期間に出勤簿が登録されていません</p>
                    </div>
                ) : (
                    <table className="w-full min-w-[640px] border-collapse text-[12px]">
                        <thead className="select-none">
                            <tr className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                                <th
                                    className="sticky top-0 left-0 z-30 bg-slate-100 border-b border-slate-200 px-3 md:px-4 py-3 text-left w-[116px] min-w-[116px] md:w-[150px] cursor-pointer hover:text-slate-600"
                                    onClick={() => toggleSort('date')}
                                >
                                    <span className="flex items-center gap-1">
                                        <Calendar className="w-3.5 h-3.5" />
                                        日付
                                        <SortIcon column="date" />
                                    </span>
                                </th>
                                <th
                                    className="sticky top-0 left-[116px] z-30 bg-slate-100 border-b border-r border-slate-200 px-2 md:px-3 py-3 text-left w-[80px] min-w-[80px] md:w-[120px] cursor-pointer hover:text-slate-600"
                                    onClick={() => toggleSort('foreman')}
                                >
                                    <span className="flex items-center gap-1">
                                        職長
                                        <SortIcon column="foreman" />
                                    </span>
                                </th>
                                <th
                                    className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 px-2 md:px-3 py-3 cursor-pointer hover:text-slate-600 whitespace-nowrap"
                                    onClick={() => toggleSort('count')}
                                >
                                    <span className="flex items-center justify-end gap-1">
                                        <Users className="w-3.5 h-3.5" />
                                        人数
                                        <SortIcon column="count" />
                                    </span>
                                </th>
                                <th
                                    className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 px-2 md:px-3 py-3 cursor-pointer hover:text-slate-600 whitespace-nowrap"
                                    onClick={() => toggleSort('early')}
                                >
                                    <span className="flex items-center justify-end gap-1">早出<SortIcon column="early" /></span>
                                </th>
                                <th
                                    className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 px-2 md:px-3 py-3 cursor-pointer hover:text-slate-600 whitespace-nowrap"
                                    onClick={() => toggleSort('morning')}
                                >
                                    <span className="flex items-center justify-end gap-1">朝積<SortIcon column="morning" /></span>
                                </th>
                                <th
                                    className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 px-2 md:px-3 py-3 cursor-pointer hover:text-slate-600 whitespace-nowrap"
                                    onClick={() => toggleSort('overtime')}
                                >
                                    <span className="flex items-center justify-end gap-1">残業<SortIcon column="overtime" /></span>
                                </th>
                                <th
                                    className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 px-2 md:px-3 py-3 cursor-pointer hover:text-slate-600 whitespace-nowrap"
                                    onClick={() => toggleSort('evening')}
                                >
                                    <span className="flex items-center justify-end gap-1">夕積<SortIcon column="evening" /></span>
                                </th>
                                <th
                                    className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 px-2 md:px-3 py-3 cursor-pointer hover:text-slate-600 whitespace-nowrap"
                                    onClick={() => toggleSort('earlyEnd')}
                                >
                                    <span className="flex items-center justify-end gap-1">早終<SortIcon column="earlyEnd" /></span>
                                </th>
                                <th className="sticky top-0 z-20 bg-slate-100 border-b border-slate-200 w-[56px] px-2 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedGroups.map(g => {
                                const canDelete = isAdminOrManager || (isForeman && g.foremanId === userId);
                                return (
                                    <tr
                                        key={g.key}
                                        onClick={() => handleEdit(g)}
                                        className="group cursor-pointer hover:bg-slate-50 transition-colors"
                                    >
                                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3 md:px-4 py-3 font-semibold text-slate-900 whitespace-nowrap transition-colors">
                                            <span className="md:hidden">{formatShortJaDate(g.date)}</span>
                                            <span className="hidden md:inline">{formatJaDate(g.date)}</span>
                                        </td>
                                        <td className="sticky left-[116px] z-10 bg-white group-hover:bg-slate-50 border-r border-slate-200 px-2 md:px-3 py-3 text-slate-700 whitespace-nowrap max-w-[80px] md:max-w-none truncate transition-colors">
                                            {getForemanName(g.foremanId)}
                                        </td>
                                        <td className="px-2 md:px-3 py-3 text-right tabular-nums text-slate-700 whitespace-nowrap">
                                            {g.memberCount}名
                                        </td>
                                        <td className={`px-2 md:px-3 py-3 text-right tabular-nums whitespace-nowrap ${g.totalEarly > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}`}>
                                            {formatHM(g.totalEarly)}
                                        </td>
                                        <td className={`px-2 md:px-3 py-3 text-right tabular-nums whitespace-nowrap ${g.totalMorning > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}`}>
                                            {formatHM(g.totalMorning)}
                                        </td>
                                        <td className={`px-2 md:px-3 py-3 text-right tabular-nums whitespace-nowrap ${g.totalOvertime > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}`}>
                                            {formatHM(g.totalOvertime)}
                                        </td>
                                        <td className={`px-2 md:px-3 py-3 text-right tabular-nums whitespace-nowrap ${g.totalEvening > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}`}>
                                            {formatHM(g.totalEvening)}
                                        </td>
                                        <td className={`px-2 md:px-3 py-3 text-right tabular-nums whitespace-nowrap ${g.earlyEndCount > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}`}>
                                            {g.earlyEndCount > 0 ? `${g.earlyEndCount}名` : '−'}
                                        </td>
                                        <td className="px-2 py-2 text-right whitespace-nowrap">
                                            {canDelete && (
                                                <button
                                                    onClick={(e) => handleDelete(e, g)}
                                                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                                                    aria-label="削除"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
                {/* モバイル: 横スクロールのヒント */}
                {!loading && groups.length > 0 && (
                    <div className="md:hidden sticky left-0 px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">
                        ← 横にスクロールできます（日付・職長は固定）
                    </div>
                )}
            </div>

            {/* ページネーション（報告一覧と同じ20件/ページ。モバイルは件数も同じ行に統合） */}
            {totalPages > 1 && (
                <div className="flex-shrink-0 flex justify-center items-center gap-2 py-2 sm:py-3">
                    <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                    >
                        前へ
                    </button>
                    <span className="text-sm font-medium text-slate-600 px-2 sm:px-4 tabular-nums">
                        {currentPage} / {totalPages}
                        <span className="sm:hidden font-normal text-slate-400"> ・ 全{groups.length}件</span>
                    </span>
                    <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                    >
                        次へ
                    </button>
                </div>
            )}

            {/* 件数表示（ページネーションがある場合、モバイルでは上の行に統合済み） */}
            <div className={`mt-2 flex-shrink-0 text-sm text-slate-600 ${totalPages > 1 ? 'hidden sm:block' : ''}`}>
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
