'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { ChevronLeft, ChevronRight, Users, User as UserIcon, ArrowUpDown, Trash2, Plus, Loader2, FileDown, X } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';
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
    note: string | null;
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
    const [pdfExporting, setPdfExporting] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);

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
        absent: number;
        paidLeave: number;
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
                absent: 0,
                paidLeave: 0,
                earlyStart: 0,
                morningLoading: 0,
                overtime: 0,
                eveningLoading: 0,
                earlyEnd: 0,
                earlyEndCount: 0,
            };
            // 出勤日のみカウント（status='present'）
            if (r.status === 'present') a.days += 1;
            if (r.status === 'absent') a.absent += 1;
            if (r.status === 'paid_leave') a.paidLeave += 1;
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
                    cmp = (a.earlyStart + a.morningLoading + a.overtime + a.eveningLoading - a.earlyEnd) - (b.earlyStart + b.morningLoading + b.overtime + b.eveningLoading - b.earlyEnd);
                    break;
            }
            return sortDir === 'asc' ? cmp : -cmp;
        });
        return arr;
    }, [records, sortKey, sortDir, getUserName]);

    // 氏名セレクタ／まとめPDF選択モーダルで共有する並び順
    // （レコードのある人を先頭、その後その他のアクティブユーザー）
    const userOptions = useMemo(() => {
        const withRecords = new Set(aggregates.map(a => a.userId));
        return [
            ...users.filter(u => withRecords.has(u.id)),
            ...users.filter(u => !withRecords.has(u.id)),
        ].map(u => ({ id: u.id, displayName: u.displayName, hasRecords: withRecords.has(u.id) }));
    }, [aggregates, users]);

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
            absent: 0,
            paidLeave: 0,
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

    // 個人別月次表を紙の出勤簿と同じレイアウトでPDF出力
    const handleExportPdf = async () => {
        if (!ym || !selectedUserId) {
            toast.error('氏名を選択してください');
            return;
        }
        try {
            setPdfExporting(true);
            const { exportAttendanceMonthlyPDF } = await import('@/utils/attendanceMonthlyPdf');
            await exportAttendanceMonthlyPDF({
                year: ym.year,
                month: ym.month,
                userId: selectedUserId,
                userName: getUserName(selectedUserId),
                records,
            });
            toast.success('PDFを出力しました');
        } catch (err) {
            logger.error('出勤簿PDF出力失敗:', err);
            toast.error(err instanceof Error ? err.message : 'PDF出力に失敗しました');
        } finally {
            setPdfExporting(false);
        }
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
                        {userOptions.map(u => (
                            <option key={u.id} value={u.id}>
                                {u.displayName}
                                {u.hasRecords ? '' : '（記録なし）'}
                            </option>
                        ))}
                    </select>
                )}

                {mode === 'detail' && selectedUserId && (
                    <Button
                        variant="outline"
                        onClick={handleExportPdf}
                        disabled={pdfExporting}
                        leftIcon={
                            pdfExporting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <FileDown className="w-4 h-4" />
                            )
                        }
                    >
                        PDF出力
                    </Button>
                )}

                <Button
                    variant="outline"
                    onClick={() => setBulkOpen(true)}
                    leftIcon={<Users className="w-4 h-4" />}
                >
                    まとめてPDF
                </Button>
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
                    onJumpToMonth={(y, m) => setMonth(`${y}-${pad2(m)}`)}
                />
            )}

            {bulkOpen && ym && (
                <BulkPdfModal
                    year={ym.year}
                    month={ym.month}
                    userOptions={userOptions}
                    records={records}
                    onClose={() => setBulkOpen(false)}
                />
            )}
        </div>
    );
}

/** ===== まとめPDF 出力対象の選択モーダル ===== */

interface BulkPdfModalProps {
    year: number;
    month: number;
    userOptions: { id: string; displayName: string; hasRecords: boolean }[];
    records: AttendanceRecord[];
    onClose: () => void;
}

function BulkPdfModal({ year, month, userOptions, records, onClose }: BulkPdfModalProps) {
    /** 選択した順を保持する（この順にページが並ぶ） */
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [exporting, setExporting] = useState(false);

    const toggle = (id: string) => {
        setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    };

    const handleExport = async () => {
        if (selectedIds.length === 0 || exporting) return;
        const nameMap = new Map(userOptions.map(u => [u.id, u.displayName]));
        try {
            setExporting(true);
            const { exportAttendanceMonthlyBulkPDF } = await import('@/utils/attendanceMonthlyPdf');
            await exportAttendanceMonthlyBulkPDF({
                year,
                month,
                people: selectedIds.map(id => ({ userId: id, userName: nameMap.get(id) ?? '(不明)' })),
                records,
            });
            toast.success(`${selectedIds.length}名分のPDFを出力しました`);
            onClose();
        } catch (err) {
            logger.error('出勤簿まとめPDF出力失敗:', err);
            toast.error(err instanceof Error ? err.message : 'PDF出力に失敗しました');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b px-6 py-4">
                    <h2 className="text-lg font-semibold">
                        まとめてPDF出力（{year}年{month}月）
                    </h2>
                    <button onClick={onClose} className="rounded p-1 hover:bg-slate-100" aria-label="閉じる">
                        <X size={20} />
                    </button>
                </div>

                <div className="px-6 py-3 border-b flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setSelectedIds(userOptions.map(u => u.id))}
                        className="px-3 py-1.5 text-sm bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
                    >
                        全選択（リスト順）
                    </button>
                    <button
                        type="button"
                        onClick={() => setSelectedIds([])}
                        className="px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 rounded-xl"
                    >
                        全解除
                    </button>
                    <span className="text-xs text-slate-500 ml-auto">選択した順にページが並びます</span>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-3">
                    {userOptions.length === 0 ? (
                        <p className="py-8 text-center text-sm text-slate-500">対象者がいません</p>
                    ) : (
                        <div className="space-y-1">
                            {userOptions.map(u => {
                                const order = selectedIds.indexOf(u.id);
                                const checked = order >= 0;
                                return (
                                    <label
                                        key={u.id}
                                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                                            checked
                                                ? 'border-teal-300 bg-teal-50'
                                                : 'border-slate-200 hover:bg-slate-50'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggle(u.id)}
                                        />
                                        <span className="text-sm text-slate-800 flex-1 truncate">
                                            {u.displayName}
                                            {u.hasRecords ? '' : (
                                                <span className="text-xs text-slate-400 ml-1">（記録なし）</span>
                                            )}
                                        </span>
                                        {checked && (
                                            <span className="inline-flex w-6 h-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold tabular-nums">
                                                {order + 1}
                                            </span>
                                        )}
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 border-t px-6 py-4">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={exporting}>
                        キャンセル
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        isLoading={exporting}
                        disabled={selectedIds.length === 0}
                        onClick={handleExport}
                    >
                        PDF出力（{selectedIds.length}名）
                    </Button>
                </div>
            </div>
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
                        const net = a.earlyStart + a.morningLoading + a.overtime + a.eveningLoading - a.earlyEnd;
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
                    const net = a.earlyStart + a.morningLoading + a.overtime + a.eveningLoading - a.earlyEnd;
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
        absent: number;
        paidLeave: number;
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
    onJumpToMonth: (year: number, month: number) => void;
}

type AttendanceStatus =
    | 'present'
    | 'absent'
    | 'paid_leave'
    | 'holiday'
    | 'night_shift'
    | 'compensatory_holiday'
    | 'holiday_work';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
    { value: 'present', label: '出勤' },
    { value: 'absent', label: '欠勤' },
    { value: 'paid_leave', label: '有給' },
    { value: 'holiday', label: '休日' },
    { value: 'night_shift', label: '夜勤' },
    { value: 'compensatory_holiday', label: '代休' },
    { value: 'holiday_work', label: '休日出勤' },
];

const STATUS_LABEL_MAP: Record<string, string> = Object.fromEntries(
    STATUS_OPTIONS.map((o) => [o.value, o.label])
);

function statusCategoryClass(status: string | undefined): string {
    if (status === 'holiday' || status === 'holiday_work') return 'bg-orange-50 text-red-600';
    if (status === 'night_shift') return 'bg-indigo-50 text-indigo-700';
    if (status === 'compensatory_holiday') return 'bg-emerald-50 text-emerald-700';
    if (status === 'paid_leave') return 'text-emerald-700';
    if (status === 'absent') return 'text-slate-500';
    return '';
}

/** "h:mm" または数字のみ ("90") を受け取って分数を返す。空欄/不正は null */
function parseHmOrMinutes(input: string): number | null {
    const s = input.trim();
    if (s === '') return 0;
    if (/^\d+:\d{1,2}$/.test(s)) {
        const [h, m] = s.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m) || m >= 60) return null;
        return h * 60 + m;
    }
    if (/^\d+$/.test(s)) {
        return Number(s);
    }
    return null;
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
    onJumpToMonth,
}: DetailMonthTableProps) {
    const [savingCellId, setSavingCellId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [addDate, setAddDate] = useState<string>('');

    /** 部分パッチをサーバに保存（新規/既存どちらも対応） */
    const saveField = useCallback(
        async (
            dateStr: string,
            record: AttendanceRecord | null,
            patch: Partial<{
                status: AttendanceStatus;
                earlyStartMinutes: number;
                morningLoadingMinutes: number;
                overtimeMinutes: number;
                eveningLoadingMinutes: number;
                earlyEndTime: string | null;
                note: string | null;
            }>,
            cellId: string
        ) => {
            setSavingCellId(cellId);
            try {
                if (record) {
                    const res = await fetch(`/api/attendance/${record.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(patch),
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        toast.error(data?.error || '更新に失敗しました');
                        return;
                    }
                    await onChanged(record.foremanId, dateStr);
                } else {
                    // 新規: 既存POSTでupsert。admin は status も同送信できる
                    const res = await fetch('/api/attendance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            foremanId: currentUserId,
                            date: dateStr,
                            items: [
                                {
                                    userId: selectedUserId,
                                    earlyStartMinutes: patch.earlyStartMinutes ?? 0,
                                    morningLoadingMinutes: patch.morningLoadingMinutes ?? 0,
                                    overtimeMinutes: patch.overtimeMinutes ?? 0,
                                    eveningLoadingMinutes: patch.eveningLoadingMinutes ?? 0,
                                    earlyEndTime: patch.earlyEndTime ?? null,
                                    note: patch.note ?? null,
                                    status: patch.status,
                                },
                            ],
                        }),
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        toast.error(data?.error || '保存に失敗しました');
                        return;
                    }
                    await onChanged(currentUserId, dateStr);
                }
            } catch (err) {
                logger.error('attendance saveField failed', err);
                toast.error('保存に失敗しました');
            } finally {
                setSavingCellId(null);
            }
        },
        [currentUserId, onChanged, selectedUserId]
    );

    const handleDeleteRow = useCallback(
        async (record: AttendanceRecord, dateStr: string) => {
            if (!confirm(`${dateStr} の記録を削除します。よろしいですか？`)) return;
            setSavingCellId(`delete:${dateStr}`);
            try {
                const res = await fetch(`/api/attendance/${record.id}`, { method: 'DELETE' });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    toast.error(data?.error || '削除に失敗しました');
                    return;
                }
                toast.success('削除しました');
                await onChanged(record.foremanId, dateStr);
            } catch (err) {
                logger.error('attendance delete failed', err);
                toast.error('削除に失敗しました');
            } finally {
                setSavingCellId(null);
            }
        },
        [onChanged]
    );

    const handleAddDate = useCallback(async () => {
        if (!addDate || !/^\d{4}-\d{2}-\d{2}$/.test(addDate)) {
            toast.error('日付を選択してください');
            return;
        }
        // 既に当月内に表示されている日でレコード未作成ならインラインで編集できる旨を案内
        if (detailRecordByDate.has(addDate)) {
            toast('その日付には既にレコードがあります', { icon: 'ℹ️' });
            setAddOpen(false);
            return;
        }
        setSavingCellId(`add:${addDate}`);
        try {
            const res = await fetch('/api/attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    foremanId: currentUserId,
                    date: addDate,
                    items: [
                        {
                            userId: selectedUserId,
                            earlyStartMinutes: 0,
                            morningLoadingMinutes: 0,
                            overtimeMinutes: 0,
                            eveningLoadingMinutes: 0,
                            earlyEndTime: null,
                            note: null,
                            status: 'present',
                        },
                    ],
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '追加に失敗しました');
                return;
            }
            toast.success('日付行を追加しました');
            const [y, m] = addDate.split('-').map(Number);
            if (ym && (ym.year !== y || ym.month !== m)) {
                onJumpToMonth(y, m);
            }
            await onChanged(currentUserId, addDate);
            setAddOpen(false);
            setAddDate('');
        } catch (err) {
            logger.error('attendance addDate failed', err);
            toast.error('追加に失敗しました');
        } finally {
            setSavingCellId(null);
        }
    }, [addDate, currentUserId, detailRecordByDate, onChanged, onJumpToMonth, selectedUserId, ym]);

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
                <table className="w-full text-[13px] border-collapse min-w-[860px]">
                    <thead>
                        <tr className="bg-blue-50 text-slate-800">
                            <th className="border border-slate-200 px-2 py-2 w-12">日付</th>
                            <th className="border border-slate-200 px-2 py-2 w-10"></th>
                            <th className="border border-slate-200 px-2 py-2 w-20">区分</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">早出</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">朝積</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">開始</th>
                            <th className="border border-slate-200 px-2 py-2 w-20">終了</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">残業</th>
                            <th className="border border-slate-200 px-2 py-2 w-16">夕積</th>
                            <th className="border border-slate-200 px-2 py-2">備考</th>
                            {isAdmin && <th className="border border-slate-200 px-2 py-2 w-10"></th>}
                        </tr>
                    </thead>
                    <tbody>
                        {days.map(day => {
                            const date = new Date(year, month - 1, day);
                            const dow = date.getDay();
                            const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
                            const r = detailRecordByDate.get(dateStr) ?? null;
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

                            // 区分ラベル（未登録の日曜は休日扱い）
                            const statusValue = (r?.status ?? (isSunday ? 'holiday' : '')) as string;
                            const categoryClass = r ? statusCategoryClass(r.status) : isSunday ? 'bg-orange-50 text-red-600' : '';

                            // 出勤系扱い（開始/終了の表示用）
                            const workish =
                                r?.status === 'present' ||
                                r?.status === 'night_shift' ||
                                r?.status === 'holiday_work';

                            const start = workish ? STANDARD_START : '';
                            const endStr = workish ? (r?.earlyEndTime ?? STANDARD_END) : '';

                            const cellBase = 'border border-slate-200 px-1.5 py-1';

                            return (
                                <tr key={day} className="hover:bg-slate-50">
                                    <td className={`${cellBase} text-center font-semibold ${dateBg} ${dateText}`}>
                                        {day}
                                    </td>
                                    <td className={`${cellBase} text-center ${dateBg} ${dateText}`}>
                                        {WEEK_LABEL[dow]}
                                    </td>
                                    <StatusCell
                                        record={r}
                                        dateStr={dateStr}
                                        value={statusValue}
                                        readOnly={!isAdmin}
                                        categoryClass={categoryClass}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    <MinutesCell
                                        record={r}
                                        dateStr={dateStr}
                                        field="earlyStartMinutes"
                                        value={r?.earlyStartMinutes ?? 0}
                                        readOnly={!isAdmin}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    <MinutesCell
                                        record={r}
                                        dateStr={dateStr}
                                        field="morningLoadingMinutes"
                                        value={r?.morningLoadingMinutes ?? 0}
                                        readOnly={!isAdmin}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    <td className={`${cellBase} text-right tabular-nums text-slate-500`}>{start}</td>
                                    <TimeCell
                                        record={r}
                                        dateStr={dateStr}
                                        value={r?.earlyEndTime ?? ''}
                                        displayValue={endStr}
                                        readOnly={!isAdmin}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    <MinutesCell
                                        record={r}
                                        dateStr={dateStr}
                                        field="overtimeMinutes"
                                        value={r?.overtimeMinutes ?? 0}
                                        readOnly={!isAdmin}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    <MinutesCell
                                        record={r}
                                        dateStr={dateStr}
                                        field="eveningLoadingMinutes"
                                        value={r?.eveningLoadingMinutes ?? 0}
                                        readOnly={!isAdmin}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    <NoteCell
                                        record={r}
                                        dateStr={dateStr}
                                        value={r?.note ?? ''}
                                        readOnly={!isAdmin}
                                        cellBase={cellBase}
                                        savingCellId={savingCellId}
                                        onSave={saveField}
                                    />
                                    {isAdmin && (
                                        <td className={`${cellBase} text-center`}>
                                            {r && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteRow(r, dateStr)}
                                                    className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                                    title="この日のレコードを削除"
                                                    disabled={savingCellId === `delete:${dateStr}`}
                                                >
                                                    {savingCellId === `delete:${dateStr}` ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    )}
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {/* 合計行 */}
                        <tr className="bg-blue-50 font-semibold">
                            <td colSpan={3} className="border border-slate-200 px-2 py-2 text-center">合計時間</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.earlyStart) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.morningLoading) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2"></td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate && detailAggregate.earlyEnd > 0 ? minutesToHm(detailAggregate.earlyEnd) : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.overtime) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2 text-right tabular-nums">{detailAggregate ? minutesToHm(detailAggregate.eveningLoading) || '-' : '-'}</td>
                            <td className="border border-slate-200 px-2 py-2"></td>
                            {isAdmin && <td className="border border-slate-200 px-2 py-2"></td>}
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* 日付行追加（admin） */}
            {isAdmin && (
                <div className="px-4 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center gap-2">
                    {!addOpen ? (
                        <button
                            type="button"
                            onClick={() => {
                                setAddOpen(true);
                                // デフォルトは現在表示中の月の1日
                                setAddDate(`${year}-${pad2(month)}-01`);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"
                        >
                            <Plus className="w-4 h-4" />
                            日付行を追加
                        </button>
                    ) : (
                        <>
                            <input
                                type="date"
                                value={addDate}
                                onChange={(e) => setAddDate(e.target.value)}
                                className="px-3 py-1.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white shadow-sm text-sm"
                            />
                            <button
                                type="button"
                                onClick={handleAddDate}
                                disabled={savingCellId?.startsWith('add:')}
                                className="px-3 py-1.5 text-sm bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-50"
                            >
                                追加
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setAddOpen(false);
                                    setAddDate('');
                                }}
                                className="px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 rounded-xl"
                            >
                                キャンセル
                            </button>
                            <span className="text-xs text-slate-500">
                                ※ 当月外の日付を選ぶと、追加後にその月へ自動で移動します
                            </span>
                        </>
                    )}
                </div>
            )}

            {/* サマリーパネル */}
            {detailAggregate && (
                <div className="px-4 py-4 border-t border-slate-200 bg-slate-50">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                        <SummaryRow label="出勤" value={`${detailAggregate.days} 日`} />
                        <SummaryRow label="朝積" value={minutesToHm(detailAggregate.morningLoading) || '-'} />
                        <SummaryRow
                            label="時間外合計"
                            value={(() => {
                                // 時間外合計 = 朝積 + 早出 + 残業 + 夕積
                                const total = detailAggregate.morningLoading + detailAggregate.earlyStart + detailAggregate.overtime + detailAggregate.eveningLoading;
                                return total > 0 ? minutesToHmZero(total) : '0:00';
                            })()}
                            highlight
                        />
                        <SummaryRow label="欠勤" value={`${detailAggregate.absent} 日`} />
                        <SummaryRow label="早出/残業" value={minutesToHm(detailAggregate.earlyStart + detailAggregate.overtime) || '-'} />
                        <SummaryRow label="早終" value={detailAggregate.earlyEnd > 0 ? `${minutesToHm(detailAggregate.earlyEnd)} (${detailAggregate.earlyEndCount}日)` : '-'} />
                        <SummaryRow label="有給" value={`${detailAggregate.paidLeave} 日`} />
                        <SummaryRow label="夕積" value={minutesToHm(detailAggregate.eveningLoading) || '-'} />
                        <SummaryRow
                            label="合計"
                            value={(() => {
                                // 合計 = 時間外合計 − 早終
                                const total = detailAggregate.morningLoading + detailAggregate.earlyStart + detailAggregate.overtime + detailAggregate.eveningLoading - detailAggregate.earlyEnd;
                                if (total === 0) return '-';
                                return total > 0 ? minutesToHmZero(total) : `−${minutesToHmZero(Math.abs(total))}`;
                            })()}
                            highlight
                        />
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-500">
                        <div>※「時間外合計」= 朝積 + 早出 + 残業 + 夕積</div>
                        <div>※「合計」= 時間外合計 − 早終</div>
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

/** ===== インライン編集セル群 ===== */

type SaveFieldFn = (
    dateStr: string,
    record: AttendanceRecord | null,
    patch: Partial<{
        status: AttendanceStatus;
        earlyStartMinutes: number;
        morningLoadingMinutes: number;
        overtimeMinutes: number;
        eveningLoadingMinutes: number;
        earlyEndTime: string | null;
        note: string | null;
    }>,
    cellId: string
) => Promise<void>;

interface BaseCellProps {
    record: AttendanceRecord | null;
    dateStr: string;
    readOnly: boolean;
    cellBase: string;
    savingCellId: string | null;
    onSave: SaveFieldFn;
}

function StatusCell({
    record,
    dateStr,
    value,
    readOnly,
    categoryClass,
    cellBase,
    savingCellId,
    onSave,
}: BaseCellProps & { value: string; categoryClass: string }) {
    const cellId = `status:${dateStr}`;
    const saving = savingCellId === cellId;
    const label = value && STATUS_LABEL_MAP[value] ? STATUS_LABEL_MAP[value] : '';

    if (readOnly) {
        return <td className={`${cellBase} text-center ${categoryClass}`}>{label}</td>;
    }
    return (
        <td className={`${cellBase} text-center ${categoryClass} p-0`}>
            <div className="relative">
                <select
                    value={value || ''}
                    onChange={(e) => {
                        const next = e.target.value;
                        // "-" は no-op（レコード未作成のままにする / 既存レコードを誤って消さない）
                        if (next === '') return;
                        if (next === record?.status) return;
                        void onSave(dateStr, record, { status: next as AttendanceStatus }, cellId);
                    }}
                    disabled={saving}
                    className={`w-full px-1 py-1 bg-transparent text-center focus:outline-none focus:ring-1 focus:ring-slate-400 rounded ${saving ? 'opacity-50' : ''}`}
                >
                    {!record && <option value="">-</option>}
                    {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </select>
                {saving && (
                    <Loader2 className="w-3 h-3 animate-spin absolute right-1 top-1/2 -translate-y-1/2 text-slate-400" />
                )}
            </div>
        </td>
    );
}

function MinutesCell({
    record,
    dateStr,
    field,
    value,
    readOnly,
    cellBase,
    savingCellId,
    onSave,
}: BaseCellProps & {
    field: 'earlyStartMinutes' | 'morningLoadingMinutes' | 'overtimeMinutes' | 'eveningLoadingMinutes';
    value: number;
}) {
    const cellId = `${field}:${dateStr}`;
    const saving = savingCellId === cellId;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<string>(minutesToHm(value));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(minutesToHm(value));
    }, [value, editing]);

    const commit = () => {
        const parsed = parseHmOrMinutes(draft);
        if (parsed === null) {
            toast.error('h:mm 形式または分数で入力してください');
            setDraft(minutesToHm(value));
            setEditing(false);
            return;
        }
        const clamped = Math.max(0, Math.min(600, Math.round(parsed)));
        setEditing(false);
        if (clamped === value) return;
        void onSave(dateStr, record, { [field]: clamped }, cellId);
    };

    if (readOnly || !editing) {
        return (
            <td
                className={`${cellBase} text-right tabular-nums ${readOnly ? '' : 'cursor-text hover:bg-slate-50'}`}
                onClick={() => {
                    if (readOnly) return;
                    setEditing(true);
                    setTimeout(() => inputRef.current?.select(), 0);
                }}
            >
                {saving ? (
                    <span className="inline-flex items-center justify-end gap-1">
                        <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                    </span>
                ) : (
                    minutesToHm(value) || (readOnly ? '' : <span className="text-slate-300">—</span>)
                )}
            </td>
        );
    }

    return (
        <td className={`${cellBase} text-right p-0`}>
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={draft}
                placeholder="h:mm"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        setDraft(minutesToHm(value));
                        setEditing(false);
                    }
                }}
                autoFocus
                className="w-full px-2 py-1 text-right tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
        </td>
    );
}

function TimeCell({
    record,
    dateStr,
    value,
    displayValue,
    readOnly,
    cellBase,
    savingCellId,
    onSave,
}: BaseCellProps & { value: string; displayValue: string }) {
    const cellId = `earlyEndTime:${dateStr}`;
    const saving = savingCellId === cellId;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        const next = draft && /^\d{2}:\d{2}$/.test(draft) ? draft : null;
        const prev = value && /^\d{2}:\d{2}$/.test(value) ? value : null;
        if (next === prev) return;
        void onSave(dateStr, record, { earlyEndTime: next }, cellId);
    };

    if (readOnly || !editing) {
        return (
            <td
                className={`${cellBase} text-right tabular-nums ${readOnly ? '' : 'cursor-text hover:bg-slate-50'}`}
                onClick={() => !readOnly && setEditing(true)}
            >
                {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400 inline-block" />
                ) : (
                    displayValue || (readOnly ? '' : <span className="text-slate-300">—</span>)
                )}
            </td>
        );
    }

    return (
        <td className={`${cellBase} text-right p-0`}>
            <input
                type="time"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        setDraft(value);
                        setEditing(false);
                    }
                }}
                autoFocus
                className="w-full px-2 py-1 text-right tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
        </td>
    );
}

function NoteCell({
    record,
    dateStr,
    value,
    readOnly,
    cellBase,
    savingCellId,
    onSave,
}: BaseCellProps & { value: string }) {
    const cellId = `note:${dateStr}`;
    const saving = savingCellId === cellId;
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    const commit = () => {
        setEditing(false);
        const next = draft.trim() === '' ? null : draft;
        const prev = value === '' ? null : value;
        if (next === prev) return;
        void onSave(dateStr, record, { note: next }, cellId);
    };

    if (readOnly || !editing) {
        return (
            <td
                className={`${cellBase} text-left ${readOnly ? '' : 'cursor-text hover:bg-slate-50'}`}
                onClick={() => !readOnly && setEditing(true)}
            >
                {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin text-slate-400 inline-block" />
                ) : value ? (
                    <span className="text-slate-700">{value}</span>
                ) : readOnly ? (
                    ''
                ) : (
                    <span className="text-slate-300">—</span>
                )}
            </td>
        );
    }

    return (
        <td className={`${cellBase} text-left p-0`}>
            <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') {
                        setDraft(value);
                        setEditing(false);
                    }
                }}
                autoFocus
                className="w-full px-2 py-1 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
        </td>
    );
}
