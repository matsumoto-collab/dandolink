'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { X, ChevronLeft, ChevronRight, Save, Users, User, Copy, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

// 早出/朝積/残業/夕積 のドロップダウン選択肢: 0〜3時間（15分刻み、計13選択肢）
const MINUTE_OPTIONS: number[] = (() => {
    const arr: number[] = [];
    for (let m = 0; m <= 180; m += 15) arr.push(m);
    return arr;
})();

// 早終 時刻ドロップダウン: 12:00〜16:45（15分刻み）
const EARLY_END_OPTIONS: string[] = (() => {
    const arr: string[] = [];
    for (let h = 12; h <= 16; h++) {
        for (let m = 0; m < 60; m += 15) {
            arr.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
        }
    }
    return arr;
})();

function formatMinutes(min: number): string {
    if (min === 0) return '0分';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}分`;
    if (m === 0) return `${h}時間`;
    return `${h}時間${m}分`;
}

function formatDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function isToday(d: Date): boolean {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}

interface MemberUser {
    id: string;
    displayName: string;
    role: string;
    dispatchSortOrder: number | null;
}

interface AttendanceItemForm {
    userId: string;
    earlyStartMinutes: number;
    morningLoadingMinutes: number;
    overtimeMinutes: number;
    eveningLoadingMinutes: number;
    earlyEndTime: string | null; // "HH:mm" or null
}

const EMPTY_ITEM = (userId: string): AttendanceItemForm => ({
    userId,
    earlyStartMinutes: 0,
    morningLoadingMinutes: 0,
    overtimeMinutes: 0,
    eveningLoadingMinutes: 0,
    earlyEndTime: null,
});

interface AttendanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialDate?: Date;
    initialForemanId?: string;
    onSaved?: () => void;
}

export default function AttendanceModal({
    isOpen,
    onClose,
    initialDate,
    initialForemanId,
    onSaved,
}: AttendanceModalProps) {
    const { data: session } = useSession();
    const userRole = session?.user?.role ?? '';
    const userId = session?.user?.id ?? '';
    const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

    const modalRef = useModalKeyboard(isOpen, onClose);

    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const d = initialDate ?? new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    });
    const [selectedForemanId, setSelectedForemanId] = useState<string>(initialForemanId || userId || '');

    const [foremen, setForemen] = useState<MemberUser[]>([]);
    const [members, setMembers] = useState<MemberUser[]>([]);
    const [items, setItems] = useState<Record<string, AttendanceItemForm>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const dateKey = formatDateKey(selectedDate);

    // 初期化（モーダルが開かれた時）
    useEffect(() => {
        if (!isOpen) return;
        const d = initialDate ?? new Date();
        d.setHours(0, 0, 0, 0);
        setSelectedDate(d);
        setSelectedForemanId(initialForemanId || userId || '');
    }, [isOpen, initialDate, initialForemanId, userId]);

    // 職長一覧（admin/manager のみセレクタ表示用に取得）
    useEffect(() => {
        if (!isOpen) return;
        if (!isAdminOrManager) return;
        fetch('/api/dispatch/foremen', { cache: 'no-store' })
            .then(r => r.json())
            .then((data: MemberUser[]) => {
                // DB の role は大文字保存（FOREMAN1 等）なので case-insensitive に判定
                const filtered = data.filter(f => {
                    const r = (f.role ?? '').toLowerCase();
                    return r === 'foreman1' || r === 'foreman2' || r === 'admin' || r === 'manager';
                });
                setForemen(filtered);
            })
            .catch(err => logger.error('職長一覧取得失敗:', err));
    }, [isOpen, isAdminOrManager]);

    // メンバー + 既存出勤レコード取得
    const fetchData = useCallback(async () => {
        if (!selectedForemanId) {
            setMembers([]);
            setItems({});
            return;
        }
        setLoading(true);
        try {
            const [membersRes, recordsRes] = await Promise.all([
                fetch(`/api/attendance/members?foremanId=${selectedForemanId}&date=${dateKey}`, { cache: 'no-store' }),
                fetch(`/api/attendance?foremanId=${selectedForemanId}&date=${dateKey}`, { cache: 'no-store' }),
            ]);
            const membersData = (await membersRes.json()) as MemberUser[];
            const recordsData = (await recordsRes.json()) as Array<{
                userId: string;
                earlyStartMinutes: number;
                morningLoadingMinutes: number;
                overtimeMinutes: number;
                eveningLoadingMinutes: number;
                earlyEndTime: string | null;
            }>;

            setMembers(membersData);
            const byUser: Record<string, AttendanceItemForm> = {};
            for (const m of membersData) {
                byUser[m.id] = EMPTY_ITEM(m.id);
            }
            for (const r of recordsData) {
                if (byUser[r.userId]) {
                    byUser[r.userId] = {
                        userId: r.userId,
                        earlyStartMinutes: r.earlyStartMinutes,
                        morningLoadingMinutes: r.morningLoadingMinutes,
                        overtimeMinutes: r.overtimeMinutes,
                        eveningLoadingMinutes: r.eveningLoadingMinutes,
                        earlyEndTime: r.earlyEndTime,
                    };
                } else {
                    // 既存レコードがあるが現在のメンバーリストに含まれない場合（過去データ）
                    byUser[r.userId] = {
                        userId: r.userId,
                        earlyStartMinutes: r.earlyStartMinutes,
                        morningLoadingMinutes: r.morningLoadingMinutes,
                        overtimeMinutes: r.overtimeMinutes,
                        eveningLoadingMinutes: r.eveningLoadingMinutes,
                        earlyEndTime: r.earlyEndTime,
                    };
                }
            }
            setItems(byUser);
        } catch (err) {
            logger.error('データ取得失敗:', err);
            toast.error('データの取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [selectedForemanId, dateKey]);

    useEffect(() => {
        if (!isOpen) return;
        fetchData();
    }, [isOpen, fetchData]);

    const updateItem = useCallback((targetUserId: string, patch: Partial<AttendanceItemForm>) => {
        setItems(prev => ({
            ...prev,
            [targetUserId]: { ...(prev[targetUserId] ?? EMPTY_ITEM(targetUserId)), ...patch },
        }));
    }, []);

    // 個別「定時」: その人だけ全項目0クリア
    const applyStandardTo = useCallback((targetUserId: string) => {
        setItems(prev => ({
            ...prev,
            [targetUserId]: EMPTY_ITEM(targetUserId),
        }));
    }, []);

    // 全員定時
    const applyStandardAll = useCallback(() => {
        setItems(prev => {
            const next: Record<string, AttendanceItemForm> = {};
            for (const m of members) {
                next[m.id] = EMPTY_ITEM(m.id);
            }
            // 念のため既存もクリア対象に
            for (const k of Object.keys(prev)) {
                if (!next[k]) next[k] = EMPTY_ITEM(k);
            }
            return next;
        });
    }, [members]);

    // 1人目（職長）の値を他全員にコピー
    const copyForemanToAll = useCallback(() => {
        const src = items[selectedForemanId];
        if (!src) return;
        setItems(prev => {
            const next = { ...prev };
            for (const m of members) {
                if (m.id === selectedForemanId) continue;
                next[m.id] = {
                    userId: m.id,
                    earlyStartMinutes: src.earlyStartMinutes,
                    morningLoadingMinutes: src.morningLoadingMinutes,
                    overtimeMinutes: src.overtimeMinutes,
                    eveningLoadingMinutes: src.eveningLoadingMinutes,
                    earlyEndTime: src.earlyEndTime,
                };
            }
            return next;
        });
        toast.success('他のメンバーへコピーしました');
    }, [items, selectedForemanId, members]);

    const handleSave = useCallback(async () => {
        if (!selectedForemanId) {
            toast.error('職長が選択されていません');
            return;
        }
        if (members.length === 0) {
            toast.error('対象メンバーがいません');
            return;
        }
        setSaving(true);
        try {
            const itemsArr = members.map(m => {
                const it = items[m.id] ?? EMPTY_ITEM(m.id);
                return {
                    userId: m.id,
                    earlyStartMinutes: it.earlyStartMinutes,
                    morningLoadingMinutes: it.morningLoadingMinutes,
                    overtimeMinutes: it.overtimeMinutes,
                    eveningLoadingMinutes: it.eveningLoadingMinutes,
                    earlyEndTime: it.earlyEndTime,
                };
            });
            const res = await fetch('/api/attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    foremanId: selectedForemanId,
                    date: dateKey,
                    items: itemsArr,
                }),
                cache: 'no-store',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `status ${res.status}`);
            }
            toast.success('保存しました');
            onSaved?.();
            onClose();
        } catch (err) {
            logger.error('出勤簿保存失敗:', err);
            toast.error(err instanceof Error ? err.message : '保存に失敗しました');
        } finally {
            setSaving(false);
        }
    }, [selectedForemanId, dateKey, members, items, onSaved, onClose]);

    const goPrevDay = () => {
        const d = new Date(selectedDate);
        d.setDate(d.getDate() - 1);
        setSelectedDate(d);
    };
    const goNextDay = () => {
        const d = new Date(selectedDate);
        d.setDate(d.getDate() + 1);
        setSelectedDate(d);
    };
    const goToday = () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        setSelectedDate(d);
    };

    const summary = useMemo(() => {
        let totalEarly = 0, totalMorning = 0, totalOvertime = 0, totalEvening = 0, earlyEndCount = 0;
        for (const m of members) {
            const it = items[m.id];
            if (!it) continue;
            totalEarly += it.earlyStartMinutes;
            totalMorning += it.morningLoadingMinutes;
            totalOvertime += it.overtimeMinutes;
            totalEvening += it.eveningLoadingMinutes;
            if (it.earlyEndTime) earlyEndCount += 1;
        }
        return { totalEarly, totalMorning, totalOvertime, totalEvening, earlyEndCount };
    }, [members, items]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto flex-1 lg:flex-none lg:rounded-xl lg:shadow-xl lg:max-w-3xl lg:mx-4 lg:max-h-[90vh]"
            >
                {/* Header */}
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h2 className="text-xl font-semibold text-slate-800">出勤簿入力</h2>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
                    {/* 日付ナビ */}
                    <div className="bg-slate-50 rounded-xl p-3 mb-4">
                        <div className="flex items-center justify-center gap-2">
                            <button
                                onClick={goPrevDay}
                                className="w-9 h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 hover:bg-white transition-colors"
                                aria-label="前日"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <input
                                type="date"
                                value={dateKey}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                                    const [y, m, d] = v.split('-').map(Number);
                                    setSelectedDate(new Date(y, m - 1, d));
                                }}
                                className="h-9 px-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                            />
                            <button
                                onClick={goToday}
                                className={`h-9 px-3 text-sm rounded-xl border transition-colors ${
                                    isToday(selectedDate) ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 hover:bg-white'
                                }`}
                            >
                                今日
                            </button>
                            <button
                                onClick={goNextDay}
                                className="w-9 h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 hover:bg-white transition-colors"
                                aria-label="翌日"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* 職長セレクタ */}
                    <div className="mb-4">
                        <label className="text-sm font-medium text-slate-700 inline-flex items-center gap-1 mb-1.5">
                            <User className="w-4 h-4" />
                            職長選択
                        </label>
                        {isAdminOrManager ? (
                            <select
                                value={selectedForemanId}
                                onChange={(e) => setSelectedForemanId(e.target.value)}
                                className="w-full h-10 px-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                            >
                                {[...foremen].sort((a, b) => {
                                    if (a.id === userId) return -1;
                                    if (b.id === userId) return 1;
                                    return a.displayName.localeCompare(b.displayName, 'ja');
                                }).map(f => (
                                    <option key={f.id} value={f.id}>{f.displayName}</option>
                                ))}
                            </select>
                        ) : (
                            <div className="w-full h-10 px-3 inline-flex items-center text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-700">
                                {session?.user?.name || session?.user?.username || '自分'}
                            </div>
                        )}
                    </div>

                    {/* メンバー入力リスト */}
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loading text="読み込み中..." />
                        </div>
                    ) : !selectedForemanId ? (
                        <div className="text-center py-12 text-slate-500 text-sm">職長を選択してください</div>
                    ) : members.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 text-sm">
                            この日に手配確定されたメンバーはいません
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-slate-700 inline-flex items-center gap-1">
                                    <Users className="w-4 h-4" />
                                    積込・残業・早終
                                </h3>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={applyStandardAll}
                                    leftIcon={<Clock className="w-4 h-4" />}
                                >
                                    全員定時
                                </Button>
                            </div>

                            <div className="space-y-2">
                                {members.map((m, idx) => {
                                    const it = items[m.id] ?? EMPTY_ITEM(m.id);
                                    const isForeman = m.id === selectedForemanId;
                                    return (
                                        <div
                                            key={m.id}
                                            className={`border border-slate-200 rounded-xl p-3 ${isForeman ? 'bg-slate-50' : 'bg-white'}`}
                                        >
                                            <div className="flex items-start sm:items-center justify-between flex-wrap gap-2 mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-slate-900">{m.displayName}</span>
                                                    {isForeman && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700">職長</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => applyStandardTo(m.id)}
                                                        className="h-8 px-2.5 text-xs rounded-xl border border-slate-200 hover:bg-white transition-colors text-slate-700"
                                                    >
                                                        定時
                                                    </button>
                                                    {idx === 0 && members.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={copyForemanToAll}
                                                            className="h-8 px-2.5 text-xs rounded-xl border border-slate-200 hover:bg-white transition-colors text-slate-700 inline-flex items-center gap-1"
                                                        >
                                                            <Copy className="w-3 h-3" />
                                                            他のメンバーへコピー
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap gap-x-2 gap-y-2">
                                                <CategoryDropdown
                                                    label="早出"
                                                    value={it.earlyStartMinutes}
                                                    onChange={(v) => updateItem(m.id, { earlyStartMinutes: v })}
                                                />
                                                <CategoryDropdown
                                                    label="朝積"
                                                    value={it.morningLoadingMinutes}
                                                    onChange={(v) => updateItem(m.id, { morningLoadingMinutes: v })}
                                                />
                                                <CategoryDropdown
                                                    label="残業"
                                                    value={it.overtimeMinutes}
                                                    onChange={(v) => updateItem(m.id, { overtimeMinutes: v })}
                                                />
                                                <CategoryDropdown
                                                    label="夕積"
                                                    value={it.eveningLoadingMinutes}
                                                    onChange={(v) => updateItem(m.id, { eveningLoadingMinutes: v })}
                                                />
                                                <EarlyEndDropdown
                                                    value={it.earlyEndTime}
                                                    onChange={(v) => updateItem(m.id, { earlyEndTime: v })}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* サマリ */}
                            <div className="mt-4 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
                                合計: 早出 {formatMinutes(summary.totalEarly)} / 朝積 {formatMinutes(summary.totalMorning)} / 残業 {formatMinutes(summary.totalOvertime)} / 夕積 {formatMinutes(summary.totalEvening)} / 早終 {summary.earlyEndCount}名
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-white">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        キャンセル
                    </Button>
                    <Button
                        variant="gradient"
                        onClick={handleSave}
                        isLoading={saving}
                        disabled={members.length === 0}
                        leftIcon={<Save className="w-4 h-4" />}
                    >
                        保存
                    </Button>
                </div>
            </div>
        </div>
    );
}

function CategoryDropdown({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (v: number) => void;
}) {
    return (
        <div className="inline-flex items-center gap-1.5">
            <span className="text-xs text-slate-700 w-9 text-right">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="h-8 px-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
                {MINUTE_OPTIONS.map(m => (
                    <option key={m} value={m}>
                        {m === 0 ? '0分' : formatMinutes(m)}
                    </option>
                ))}
            </select>
        </div>
    );
}

function EarlyEndDropdown({
    value,
    onChange,
}: {
    value: string | null;
    onChange: (v: string | null) => void;
}) {
    return (
        <div className="inline-flex items-center gap-1.5">
            <span className="text-xs text-slate-700 w-9 text-right">早終</span>
            <select
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
                className="h-8 px-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
                <option value="">なし</option>
                {EARLY_END_OPTIONS.map(t => (
                    <option key={t} value={t}>{t}</option>
                ))}
            </select>
        </div>
    );
}
