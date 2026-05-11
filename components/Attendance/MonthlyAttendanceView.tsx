'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronLeft, ChevronRight, Users, User as UserIcon, ArrowUpDown, Pencil, Trash2, X } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { sendBroadcast } from '@/lib/broadcastChannel';

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

interface UserBasic {
    id: string;
    displayName: string;
    role: string;
    isActive?: boolean;
}

const STANDARD_END_MIN = 17 * 60; // 17:00
const STANDARD_START = '8:00';
const STANDARD_END = '17:00';

function pad2(n: number): string {
    return n.toString().padStart(2, '0');
}

function formatYm(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function parseYm(s: string): { year: number; month: number } | null {
    if (!/^\d{4}-\d{2}$/.test(s)) return null;
    const [y, m] = s.split('-').map(Number);
    return { year: y, month: m };
}

function monthRange(year: number, month: number): { startStr: string; endStr: string; daysInMonth: number } {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0); // 月末
    const startStr = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
    const endStr = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
    return { startStr, endStr, daysInMonth: end.getDate() };
}

function calcEarlyEndMinutes(earlyEndTime: string | null): number {
    if (!earlyEndTime) return 0;
    const [h, m] = earlyEndTime.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    const minutes = h * 60 + m;
    return Math.max(0, STANDARD_END_MIN - minutes);
}

function minutesToHm(min: number): string {
    if (min === 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${pad2(m)}`;
}

function minutesToHmZero(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${pad2(m)}`;
}

const WEEK_LABEL = ['日', '月', '火', '水', '木', '金', '土'];

interface MonthlyAttendanceViewProps {
    /** 同階層 AttendancePage と整合させるためのリフレッシュトリガ */
    refreshKey?: number;
}

type Mode = 'summary' | 'detail';
type SortKey = 'name' | 'days' | 'overtime' | 'earlyEnd' | 'netOvertime' | 'earlyStart';
type SortDir = 'asc' | 'desc';

export default function MonthlyAttendanceView({ refreshKey }: MonthlyAttendanceViewProps) {
    const { data: session } = useSession();
    const userRole = session?.user?.role ?? '';
    const isAdmin = userRole === 'admin';
    const isAdminOrManager = userRole === 'admin' || userRole === 'manager';
    const isForeman = userRole === 'foreman1' || userRole === 'foreman2';
    const canView = isAdminOrManager || isForeman;

    const [month, setMonth] = useState<string>(() => formatYm(new Date()));
    const [mode, setMode] = useState<Mode>('summary');
    const [selectedUserId, setSelectedUserId] = useState<string>('');

    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [users, setUsers] = useState<UserBasic[]>([]);
    const [loading, setLoading] = useState(false);

    const [sortKey, setSortKey] = useState<SortKey>('netOvertime');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const ym = useMemo(() => parseYm(month), [month]);

    // ユーザー一覧（ドロップダウンと氏名解決用）
    useEffect(() => {
        fetch('/api/users', { cache: 'no-store' })
            .then(r => r.json())
            .then((data: UserBasic[]) => {
                if (Array.isArray(data)) {
                    setUsers(data.filter(u => u.isActive !== false));
                }
            })
            .catch(err => logger.error('ユーザー一覧取得失敗:', err));
    }, []);

    const userMap = useMemo(() => {
        const m = new Map<string, UserBasic>();
        for (const u of users) m.set(u.id, u);
        return m;
    }, [users]);

    const getUserName = useCallback(
        (id: string) => userMap.get(id)?.displayName ?? '(不明)',
        [userMap]
    );

    // 月次レコード取得
    const fetchRecords = useCallback(async () => {
        if (!ym) return;
        const { startStr, endStr } = monthRange(ym.year, ym.month);
        setLoading(true);
        try {
            const params = new URLSearchParams({ startDate: startStr, endDate: endStr });
            const res = await fetch(`/api/attendance?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = (await res.json()) as AttendanceRecord[];
            setRecords(data);
        } catch (err) {
            logger.error('月次出勤簿取得失敗:', err);
            toast.error('出勤簿の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [ym]);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords, refreshKey]);

    // 人別累計
    type Aggregate = {
        userId: string;
        days: number;
        earlyStart: number;
        morningLoading: number;
        overtime: number;
        eveningLoading: number;
        earlyEnd: number; // 早終時間（分）= 17:00 − earlyEndTime
        earlyEndCount: number;
    };

    const aggregates: Aggregate[] = useMemo(() => {
        const map = new Map<string, Aggregate>();
        for (const r of records) {
            const a = map.get(r.userId) ?? {
                userId: r.userId,
                days: 0,
                earlyStart: 0,
                morningLoading: 0,
                overtime: 0,
                eveningLoading: 0,
                earlyEnd: 0,
                earlyEndCount: 0,
            };
            // 出勤日のみカウント（status='present'）
            if (r.status === 'present') a.days += 1;
            a.earlyStart += r.earlyStartMinutes;
            a.morningLoading += r.morningLoadingMinutes;
            a.overtime += r.overtimeMinutes;
            a.eveningLoading += r.eveningLoadingMinutes;
            const ee = calcEarlyEndMinutes(r.earlyEndTime);
            a.earlyEnd += ee;
            if (ee > 0) a.earlyEndCount += 1;
            map.set(r.userId, a);
        }
        const arr = Array.from(map.values());
        arr.sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
                case 'name':
                    cmp = getUserName(a.userId).localeCompare(getUserName(b.userId), 'ja');
                    break;
                case 'days':
                    cmp = a.days - b.days;
                    break;
                case 'overtime':
                    cmp = a.overtime - b.overtime;
                    break;
                case 'earlyEnd':
                    cmp = a.earlyEnd - b.earlyEnd;
                    break;
                case 'earlyStart':
                    cmp = a.earlyStart - b.earlyStart;
                    break;
                case 'netOvertime':
                    cmp = (a.overtime - a.earlyEnd) - (b.overtime - b.earlyEnd);
                    break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [records, sortKey, sortDir, getUserName]);

    // 詳細モード対象人物のレコード（日付→record）
    const detailRecordByDate = useMemo(() => {
        const map = new Map<string, AttendanceRecord>();
        if (!selectedUserId) return map;
        for (const r of records) {
            if (r.userId !== selectedUserId) continue;
            const dateOnly = r.date.split('T')[0];
            map.set(dateOnly, r);
        }
        return map;
    }, [records, selectedUserId]);

    const detailAggregate = useMemo(() => {
        if (!selectedUserId) return null;
        return aggregates.find(a => a.userId === selectedUserId) ?? {
            userId: selectedUserId,
            days: 0,
            earlyStart: 0,
            morningLoading: 0,
            overtime: 0,
            eveningLoading: 0,
            earlyEnd: 0,
            earlyEndCount: 0,
        };
    }, [aggregates, selectedUserId]);

    const SortHeader = ({
        column,
        label,
        align = 'left',
    }: { column: SortKey; label: string; align?: 'left' | 'right' }) => {
        const active = sortKey === column;
        return (
            <button
                onClick={() => {
                    if (active) {
                        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
                    } else {
                        setSortKey(column);
                        setSortDir(column === 'name' ? 'asc' : 'desc');
                    }
                }}
                className={`flex items-center gap-1 hover:text-slate-900 transition-colors ${align === 'right' ? 'justify-end w-full' : ''}`}
            >
                {align === 'right' ? null : <span>{label}</span>}
                <ArrowUpDown className={`w-3 h-3 ${active ? 'text-slate-700' : 'text-slate-300'}`} />
                {align === 'right' ? <span>{label}</span> : null}
            </button>
        );
    };

    const handleSelectUser = (userId: string) => {
        setSelectedUserId(userId);
        setMode('detail');
    };

    const goPrevMonth = () => {
        if (!ym) return;
        const d = new Date(ym.year, ym.month - 2, 1);
        setMonth(formatYm(d));
    };

    const goNextMonth = () => {
        if (!ym) return;
        const d = new Date(ym.year, ym.month, 1);
        setMonth(formatYm(d));
    };

    if (!canView) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">閲覧権限がありません</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* ツールバー */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <button
                        onClick={goPrevMonth}
                        className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors bg-white shadow-sm"
                        aria-label="前月"
                    >
                        <ChevronLeft className="w-4 h-4 text-slate-600" />
                    </button>
                    <input
                        type="month"
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        className="px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                    />
                    <button
                        onClick={goNextMonth}
                        className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors bg-white shadow-sm"
                        aria-label="翌月"
                    >
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                    </button>
                </div>

                <div className="flex items-center bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                    <button
                        onClick={() => setMode('summary')}
                        className={`px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 transition-colors ${
                            mode === 'summary'
                                ? 'bg-slate-800 text-white'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        <Users className="w-4 h-4" />
                        比較サマリー
                    </button>
                    <button
                        onClick={() => setMode('detail')}
                        className={`px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 transition-colors ${
                            mode === 'detail'
                                ? 'bg-slate-800 text-white'
                                : 'text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        <UserIcon className="w-4 h-4" />
                        個人別月次表
                    </button>
                </div>

                {mode === 'detail' && (
                    <select
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm sm:ml-2"
                    >
                        <option value="">氏名を選択</option>
                        {/* レコードのある人を先頭、その後その他のアクティブユーザー */}
                        {(() => {
                            const withRecords = new Set(aggregates.map(a => a.userId));
                            const ranked = [
                                ...users.filter(u => withRecords.has(u.id)),
                                ...users.filter(u => !withRecords.has(u.id)),
                            ];
                            return ranked.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.displayName}
                                    {withRecords.has(u.id) ? '' : '（記録なし）'}
                                </option>
                            ));
                        })()}
                    </select>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-48">
                    <Loading text="読み込み中..." />
                </div>
            ) : mode === 'summary' ? (
                <SummaryTable
                    aggregates={aggregates}
                    getUserName={getUserName}
                    onSelectUser={handleSelectUser}
                    SortHeader={SortHeader}
                />
            ) : (
                <DetailMonthTable
                    ym={ym}
                    selectedUserId={selectedUserId}
                    getUserName={getUserName}
                    detailRecordByDate={detailRecordByDate}
                    detailAggregate={detailAggregate}
                    isAdmin={isAdmin}
                    onChanged={async (foremanId, dateStr) => {
                        await fetchRecords();
                        sendBroadcast('attendance_updated', { foremanId, date: dateStr });
                    }}
                    currentUserId={session?.user?.id ?? ''}
                />
            )}
        </div>
    );
}

/** ===== サマリービュー ===== */

interface SummaryTableProps {
    aggregates: {
        userId: string;
        days: number;
        earlyStart: number;
        morningLoading: number;
        overtime: number;
        eveningLoading: number;
        earlyEnd: number;
        earlyEndCount: number;
    }[];
    getUserName: (id: string) => string;
    onSelectUser: (id: string) => void;
    SortHeader: React.FC<{ column: 'name' | 'days' | 'overtime' | 'earlyEnd' | 'netOvertime' | 'earlyStart'; label: string; align?: 'left' | 'right' }>;
}

function SummaryTable({ aggregates, getUserName, onSelectUser, SortHeader }: SummaryTableProps) {
    if (aggregates.length === 0) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">対象月に出勤簿が登録されていません</p>
            </div>
        );
    }

    return (
        <>
            {/* デスクトップ */}
            <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="grid grid-cols-[2fr_72px_repeat(6,1fr)] gap-2 px-4 py-3 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-700">
                    <div><SortHeader column="name" label="氏名" /></div>
                    <div className="text-right"><SortHeader column="days" label="出勤" align="right" /></div>
                    <div className="text-right"><SortHeader column="earlyStart" label="早出" align="right" /></div>
                    <div className="text-right">朝積</div>
                    <div className="text-right"><SortHeader column="overtime" label="残業" align="right" /></div>
                    <div className="text-right">夕積</div>
                    <div className="text-right"><SortHeader column="earlyEnd" label="早終" align="right" /></div>
                    <div className="text-right"><SortHeader column="netOvertime" label="実残業" align="right" /></div>
                </div>
                <div className="divide-y divide-slate-100">
                    {aggregates.map(a => {
                        const net = a.overtime - a.earlyEnd;
                        const netClass = net > 0 ? 'text-amber-700' : net < 0 ? 'text-blue-700' : 'text-slate-700';
                        return (
                            <button
                                key={a.userId}
                                onClick={() => onSelectUser(a.userId)}
                                className="w-full grid grid-cols-[2fr_72px_repeat(6,1fr)] gap-2 px-4 py-3 hover:bg-slate-50 transition-colors text-[13px] items-center text-left"
                            >
                                <div className="font-semibold text-slate-900 truncate">{getUserName(a.userId)}</div>
                                <div className="text-right text-slate-700 tabular-nums">{a.days}日</div>
                                <div className="text-right text-slate-700 tabular-nums">{minutesToHm(a.earlyStart) || '-'}</div>
                                <div className="text-right text-slate-700 tabular-nums">{minutesToHm(a.morningLoading) || '-'}</div>
                                <div className="text-right text-slate-700 tabular-nums">{minutesToHm(a.overtime) || '-'}</div>
                                <div className="text-right text-slate-700 tabular-nums">{minutesToHm(a.eveningLoading) || '-'}</div>
                                <div className="text-right text-slate-700 tabular-nums">
                                    {a.earlyEnd > 0 ? `${minutesToHm(a.earlyEnd)} (${a.earlyEndCount}日)` : '-'}
                                </div>
                                <div className={`text-right font-semibold tabular-nums ${netClass}`}>
                                    {net === 0 ? '0:00' : `${net > 0 ? '+' : '−'}${minutesToHmZero(Math.abs(net))}`}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* モバイル */}
            <div className="md:hidden space-y-2">
                {aggregates.map(a => {
                    const net = a.overtime - a.earlyEnd;
                    const netClass = net > 0 ? 'text-amber-700' : net < 0 ? 'text-blue-700' : 'text-slate-700';
                    return (
                        <button
                            key={a.userId}
                            onClick={() => onSelectUser(a.userId)}
                            className="w-full bg-white rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors text-left"
                        >
                            <div className="flex items-baseline justify-between mb-2">
                                <div className="text-base font-semibold text-slate-900">{getUserName(a.userId)}</div>
                                <div className="text-sm text-slate-600">出勤 {a.days}日</div>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700">
                                <div>早出 <span className="tabular-nums">{minutesToHm(a.earlyStart) || '-'}</span></div>
                                <div>朝積 <span className="tabular-nums">{minutesToHm(a.morningLoading) || '-'}</span></div>
                                <div>残業 <span className="tabular-nums">{minutesToHm(a.overtime) || '-'}</span></div>
                                <div>夕積 <span className="tabular-nums">{minutesToHm(a.eveningLoading) || '-'}</span></div>
                                <div>早終 <span className="tabular-nums">{a.earlyEnd > 0 ? `${minutesToHm(a.earlyEnd)} (${a.earlyEndCount}日)` : '-'}</span></div>
                                <div>
                                    実残業{' '}
                                    <span className={`font-semibold tabular-nums ${netClass}`}>
                                        {net === 0 ? '0:00' : `${net > 0 ? '+' : '−'}${minutesToHmZero(Math.abs(net))}`}
                                    </span>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </>
    );
}

/** ===== 個人別月次表（画像のような縦並び） ===== */

interface DetailMonthTableProps {
    ym: { year: number; month: number } | null;
    selectedUserId: string;
    getUserName: (id: string) => string;
    detailRecordByDate: Map<string, AttendanceRecord>;
    detailAggregate: {
        userId: string;
        days: number;
        earlyStart: number;
        morningLoading: number;
        overtime: number;
        eveningLoading: number;
        earlyEnd: number;
        earlyEndCount: number;
    } | null;
    isAdmin: boolean;
    currentUserId: string;
    onChanged: (foremanId: string, dateStr: string) => void | Promise<void>;
}

function DetailMonthTable({
    ym,
    selectedUserId,
    getUserName,
    detailRecordByDate,
    detailAggregate,
    isAdmin,
    currentUserId,
    onChanged,
}: DetailMonthTableProps) {
    const [editTarget, setEditTarget] = useState<{
        dateStr: string;
        record: AttendanceRecord | null;
    } | null>(null);
    if (!ym) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">対象月の指定が不正です</p>
            </div>
        );
    }
    if (!selectedUserId) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">上のセレクタから氏名を選択してください</p>
            </div>
        );
    }

    const { year, month } = ym;
    const { daysInMonth } = monthRange(year, month);
    const days: number[] = [];
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* ヘッダー（タイトル＋氏名） */}
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <div className="text-base font-bold text-slate-800">
                    {year} 年 {month} 月 出勤簿
                </div>
                <div className="text-sm text-slate-600">
                    氏名 <span className="font-semibold text-slate-900 ml-1">{getUserName(selectedUserId)}</span>
                </div>
            </div>

            {/* テーブル */}
            <div className="overflow-x-auto">
                <table className="w-full text-[13px] border-collapse min-w-[640px]">
                    <thead>
                        <tr className="bg-blue-50 text-slate-800">
                            <th className="border border-slate-200 px-2 py-2 w-12">日付</th>
                            <th className="border border-slate-200 px-2 py-2 w-10"></th>
                            <th className="border border-slate-200 px-2 py-2 w-16">区分</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">早出</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">朝積</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">開始</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">終了</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">残業</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">夕積</th>
                        </tr>
                    </thead>
                    <tbody>
                        {days.map(day => {
                            const date = new Date(year, month - 1, day);
                            const dow = date.getDay(); // 0=日 6=土
                            const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
                            const r = detailRecordByDate.get(dateStr);
                            const isSunday = dow === 0;
                            const isSaturday = dow === 6;

                            const dateBg = isSunday
                                ? 'bg-orange-50'
                                : isSaturday
                                ? 'bg-blue-50'
                                : '';
                            const dateText = isSunday
                                ? 'text-red-600'
                                : isSaturday
                                ? 'text-blue-600'
                                : 'text-slate-700';

                            // 区分
                            let category = '';
                            let categoryClass = '';
                            if (r) {
                                if (r.status === 'present') {
                                    category = '出勤';
                                } else if (r.status === 'absent') {
                                    category = '欠勤';
                                } else if (r.status === 'paid_leave') {
                                    category = '有給';
                                } else if (r.status === 'holiday') {
                                    category = '休日';
                                    categoryClass = 'bg-orange-50 text-red-600';
                                }
                            } else if (isSunday) {
                                category = '休日';
                                categoryClass = 'bg-orange-50 text-red-600';
                            }

                            // 表示用フォーマット
                            const earlyStart = r ? minutesToHm(r.earlyStartMinutes) : '';
                            const morning = r ? minutesToHm(r.morningLoadingMinutes) : '';
                            const start = r && r.status === 'present' ? STANDARD_START : '';
                            const end = r && r.status === 'present' ? (r.earlyEndTime ?? STANDARD_END) : '';
                            const overtime = r ? minutesToHm(r.overtimeMinutes) : '';
                            const evening = r ? minutesToHm(r.eveningLoadingMinutes) : '';

                            const clickable = isAdmin;
                            const handleRowClick = () => {
                                if (!clickable) return;
                                setEditTarget({ dateStr, record: r ?? null });
                            };
                            return (
                                <tr
                                    key={day}
                                    className={`hover:bg-slate-50 ${clickable ? 'cursor-pointer' : ''}`}
                                    onClick={handleRowClick}
                                >
                                    <td className={`border border-slate-200 px-2 py-1.5 text-center font-semibold ${dateBg} ${dateText}`}>
                                        {day}
                                    </td>
                                    <td className={`border border-slate-200 px-2 py-1.5 text-center ${dateBg} ${dateText}`}>
                                        {WEEK_LABEL[dow]}
                                    </td>
                                    <td className={`border border-slate-200 px-2 py-1.5 text-center ${categoryClass}`}>
                                        <span className="inline-flex items-center gap-1">
                                            {category}
                                            {clickable && (
                                                <Pencil className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />
                                            )}
                                        </span>
                                    </td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{earlyStart}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{morning}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{start}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{end}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{overtime}</td>
                                    <td className="border border-slate-200 px-2 py-1.5 text-right tabular-nums">{evening}</td>
                                </tr>
                            );
                        })}
                        {/* 合計行 */}
                        <tr className="bg-blue-50 font-semibold">
                            <td colSpan={3} className="border border-slate-200 px-2 py-2 text-center">合計時間</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.earlyStart) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.morningLoading) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2"></td>
                            <td className="border border-slate-200 px-2 py-2"></td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.overtime) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.eveningLoading) || '-' : '-'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* 編集モーダル（admin のみ） */}
            {editTarget && (
                <MonthlyDetailEditModal
                    userId={selectedUserId}
                    userName={getUserName(selectedUserId)}
                    dateStr={editTarget.dateStr}
                    record={editTarget.record}
                    currentUserId={currentUserId}
                    onClose={() => setEditTarget(null)}
                    onSaved={async (foremanId, dateStr) => {
                        setEditTarget(null);
                        await onChanged(foremanId, dateStr);
                    }}
                />
            )}

            {/* サマリーパネル */}
            {detailAggregate && (
                <div className="px-4 py-4 border-t border-slate-200 bg-slate-50">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                        <SummaryRow label="出勤" value={`${detailAggregate.days} 日`} />
                        <SummaryRow label="朝積" value={minutesToHm(detailAggregate.morningLoading) || '-'} />
                        <SummaryRow label="夕積" value={minutesToHm(detailAggregate.eveningLoading) || '-'} />
                        <SummaryRow label="欠勤" value="-" muted />
                        <SummaryRow label="早出/残業" value={minutesToHm(detailAggregate.earlyStart + detailAggregate.overtime) || '-'} />
                        <SummaryRow
                            label="早残合計"
                            value={(() => {
                                const net = detailAggregate.overtime + detailAggregate.earlyStart - detailAggregate.earlyEnd;
                                if (net === 0) return '0:00';
                                return `${net > 0 ? '+' : '−'}${minutesToHmZero(Math.abs(net))}`;
                            })()}
                            highlight
                        />
                        <SummaryRow label="有給" value="-" muted />
                        <SummaryRow label="早終" value={detailAggregate.earlyEnd > 0 ? `${minutesToHm(detailAggregate.earlyEnd)} (${detailAggregate.earlyEndCount}日)` : '-'} />
                        <SummaryRow
                            label="合計"
                            value={(() => {
                                const total = detailAggregate.earlyStart + detailAggregate.morningLoading + detailAggregate.overtime + detailAggregate.eveningLoading;
                                return minutesToHm(total) || '-';
                            })()}
                            highlight
                        />
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                        ※「早残合計」= 早出 + 残業 − 早終時間。プラスは超過、マイナスは早終わり超過分を表します。
                    </div>
                </div>
            )}
        </div>
    );
}

function SummaryRow({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
    return (
        <div className={`flex items-center justify-between border-b border-slate-200 pb-1 ${muted ? 'opacity-60' : ''}`}>
            <span className="text-slate-600">{label}</span>
            <span className={`tabular-nums ${highlight ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{value}</span>
        </div>
    );
}

/** ===== 個人別月次表 admin編集モーダル ===== */

interface MonthlyDetailEditModalProps {
    userId: string;
    userName: string;
    dateStr: string; // YYYY-MM-DD
    record: AttendanceRecord | null;
    currentUserId: string; // admin user id（新規作成時の foremanId/createdBy 用）
    onClose: () => void;
    onSaved: (foremanId: string, dateStr: string) => void | Promise<void>;
}

const STATUS_OPTIONS: { value: 'present' | 'absent' | 'paid_leave' | 'holiday'; label: string }[] = [
    { value: 'present', label: '出勤' },
    { value: 'absent', label: '欠勤' },
    { value: 'paid_leave', label: '有給' },
    { value: 'holiday', label: '休日' },
];

function MonthlyDetailEditModal({
    userId,
    userName,
    dateStr,
    record,
    currentUserId,
    onClose,
    onSaved,
}: MonthlyDetailEditModalProps) {
    const isNew = !record;
    const [status, setStatus] = useState<'present' | 'absent' | 'paid_leave' | 'holiday'>(
        (record?.status as 'present' | 'absent' | 'paid_leave' | 'holiday') ?? 'present'
    );
    const [earlyStart, setEarlyStart] = useState<number>(record?.earlyStartMinutes ?? 0);
    const [morning, setMorning] = useState<number>(record?.morningLoadingMinutes ?? 0);
    const [overtime, setOvertime] = useState<number>(record?.overtimeMinutes ?? 0);
    const [evening, setEvening] = useState<number>(record?.eveningLoadingMinutes ?? 0);
    const [earlyEnd, setEarlyEnd] = useState<string>(record?.earlyEndTime ?? '');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            const earlyEndPayload = earlyEnd && /^\d{2}:\d{2}$/.test(earlyEnd) ? earlyEnd : null;
            if (isNew) {
                // 既存POSTを利用してupsert: foremanId は admin 自身（区分のみ調整するケース想定）
                const res = await fetch('/api/attendance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        foremanId: currentUserId,
                        date: dateStr,
                        items: [
                            {
                                userId,
                                earlyStartMinutes: earlyStart,
                                morningLoadingMinutes: morning,
                                overtimeMinutes: overtime,
                                eveningLoadingMinutes: evening,
                                earlyEndTime: earlyEndPayload,
                            },
                        ],
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    toast.error(data?.error || '保存に失敗しました');
                    return;
                }
                // 区分は既存POSTでは更新されない → 作成済みレコードを取得し直してPATCHで status を上書き
                if (status !== 'present') {
                    const createdList = (await res.json()) as AttendanceRecord[] | AttendanceRecord;
                    const created = Array.isArray(createdList) ? createdList[0] : createdList;
                    if (created?.id) {
                        const patchRes = await fetch(`/api/attendance/${created.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status }),
                        });
                        if (!patchRes.ok) {
                            const data = await patchRes.json().catch(() => ({}));
                            toast.error(data?.error || '区分の更新に失敗しました');
                            return;
                        }
                    }
                }
                toast.success('追加しました');
                await onSaved(currentUserId, dateStr);
            } else {
                const res = await fetch(`/api/attendance/${record!.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status,
                        earlyStartMinutes: earlyStart,
                        morningLoadingMinutes: morning,
                        overtimeMinutes: overtime,
                        eveningLoadingMinutes: evening,
                        earlyEndTime: earlyEndPayload,
                    }),
                });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    toast.error(data?.error || '更新に失敗しました');
                    return;
                }
                toast.success('更新しました');
                await onSaved(record!.foremanId, dateStr);
            }
        } catch (err) {
            logger.error('attendance save failed', err);
            toast.error('保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!record) return;
        if (!confirm(`${dateStr} ${userName} の出勤簿レコードを削除します。よろしいですか？`)) return;
        setDeleting(true);
        try {
            const res = await fetch(`/api/attendance/${record.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '削除に失敗しました');
                return;
            }
            toast.success('削除しました');
            await onSaved(record.foremanId, dateStr);
        } catch (err) {
            logger.error('attendance delete failed', err);
            toast.error('削除に失敗しました');
        } finally {
            setDeleting(false);
        }
    };

    const numInput = (
        label: string,
        value: number,
        setValue: (v: number) => void,
        max = 600
    ) => (
        <div>
            <label className="block text-xs text-slate-600 mb-1">{label}（分）</label>
            <input
                type="number"
                inputMode="numeric"
                min={0}
                max={max}
                step={1}
                value={value}
                onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isNaN(n)) return;
                    setValue(Math.max(0, Math.min(max, Math.round(n))));
                }}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
            />
        </div>
    );

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
                    <h3 className="text-base font-semibold text-slate-800">
                        出勤簿 {isNew ? '追加' : '編集'}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>
                <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
                    <div className="text-sm text-slate-700">
                        <span className="text-slate-500">対象</span>
                        <span className="ml-2 font-semibold">{userName}</span>
                        <span className="ml-2 text-slate-500">{dateStr}</span>
                    </div>

                    <div>
                        <label className="block text-xs text-slate-600 mb-1">出勤区分</label>
                        <div className="grid grid-cols-4 gap-2">
                            {STATUS_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setStatus(opt.value)}
                                    className={`px-2 py-2 text-sm rounded-xl border transition-colors ${status === opt.value
                                        ? 'bg-slate-800 text-white border-slate-800'
                                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        {numInput('早出', earlyStart, setEarlyStart)}
                        {numInput('朝積', morning, setMorning)}
                        {numInput('残業', overtime, setOvertime)}
                        {numInput('夕積', evening, setEvening)}
                    </div>

                    <div>
                        <label className="block text-xs text-slate-600 mb-1">早終時刻（空欄=早終なし）</label>
                        <input
                            type="time"
                            value={earlyEnd}
                            onChange={(e) => setEarlyEnd(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    {!isNew ? (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={deleting || saving}
                            className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-50"
                        >
                            <Trash2 className="w-4 h-4" />
                            削除
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={deleting || saving}
                            className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                        >
                            キャンセル
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={deleting || saving}
                            className="px-4 py-2 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-colors disabled:opacity-50"
                        >
                            {saving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
