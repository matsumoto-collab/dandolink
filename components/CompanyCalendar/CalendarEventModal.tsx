'use client';

import React, { useEffect, useState } from 'react';
import { X, Lock, Unlock, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
    CALENDAR_CATEGORIES,
    CALENDAR_CATEGORY_LABELS,
    type CalendarCategory,
    type CalendarEventDTO,
    type CalendarVisibility,
} from '@/types/companyCalendar';
import { sendBroadcast } from '@/lib/broadcastChannel';

interface ProjectOption {
    id: string;
    title: string;
}

interface Props {
    event: CalendarEventDTO | null;
    defaultDate: Date | null;
    currentUserId: string | null;
    currentUserRole: string | null;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * カレンダーイベントの作成・編集モーダル
 */
export default function CalendarEventModal({
    event,
    defaultDate,
    currentUserId,
    currentUserRole,
    onClose,
    onSaved,
}: Props) {
    const isEdit = !!event;
    const canModify =
        !event ||
        event.createdBy === currentUserId ||
        currentUserRole === 'admin';

    const [title, setTitle] = useState(event?.title ?? '');
    const [description, setDescription] = useState(event?.description ?? '');
    const [category, setCategory] = useState<CalendarCategory>(
        (event?.category as CalendarCategory) ?? 'meeting',
    );
    const [allDay, setAllDay] = useState(event?.allDay ?? true);
    const [startAt, setStartAt] = useState(() =>
        toLocalInput(event ? new Date(event.startAt) : defaultDate ?? new Date(), event?.allDay ?? true),
    );
    const [endAt, setEndAt] = useState(() =>
        toLocalInput(event ? new Date(event.endAt) : defaultDate ?? new Date(), event?.allDay ?? true),
    );
    const [location, setLocation] = useState(event?.location ?? '');
    const [visibility, setVisibility] = useState<CalendarVisibility>(
        event?.visibility ?? 'shared',
    );
    const [projectMasterId, setProjectMasterId] = useState<string>(
        event?.projectMasterId ?? '',
    );

    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // 案件一覧を取得（紐付け用ドロップダウン）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/project-masters?status=active', {
                    cache: 'no-store',
                });
                if (!res.ok) return;
                const json = await res.json();
                // API のレスポンス形が { items: [...] } または配列の両ケースをカバー
                const list: ProjectOption[] = Array.isArray(json)
                    ? json.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title }))
                    : Array.isArray(json.items)
                      ? json.items.map((p: { id: string; title: string }) => ({
                            id: p.id,
                            title: p.title,
                        }))
                      : Array.isArray(json.projects)
                        ? json.projects.map((p: { id: string; title: string }) => ({
                              id: p.id,
                              title: p.title,
                          }))
                        : [];
                if (!cancelled) setProjects(list);
            } catch {
                // 案件取得失敗時は紐付けなしで進める
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // 終日切替時に日時フォーマットを調整
    useEffect(() => {
        setStartAt((cur) => normalizeForAllDay(cur, allDay));
        setEndAt((cur) => normalizeForAllDay(cur, allDay));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allDay]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) {
            toast.error('タイトルを入力してください');
            return;
        }
        const startDate = parseLocalInput(startAt, allDay);
        const endDate = parseLocalInput(endAt, allDay);
        if (!startDate || !endDate) {
            toast.error('日時の形式が正しくありません');
            return;
        }
        if (endDate < startDate) {
            toast.error('終了日時は開始日時以降にしてください');
            return;
        }

        const payload = {
            title: title.trim(),
            description: description.trim() || null,
            category,
            startAt: startDate.toISOString(),
            endAt: endDate.toISOString(),
            allDay,
            location: location.trim() || null,
            visibility,
            projectMasterId: projectMasterId || null,
        };

        setSubmitting(true);
        try {
            const res = await fetch(
                isEdit ? `/api/company-calendar/${event!.id}` : '/api/company-calendar',
                {
                    method: isEdit ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: '保存に失敗しました' }));
                throw new Error(err.error || '保存に失敗しました');
            }
            // 保存成功後のレスポンス（更新後のイベントID等）を取得して broadcast 送信
            const saved = await res.json().catch(() => null) as { event?: { id?: string } } | null;
            const savedId = saved?.event?.id ?? event?.id ?? null;
            sendBroadcast('company_calendar_updated', {
                eventId: savedId,
                projectMasterId: payload.projectMasterId,
            });
            toast.success(isEdit ? '更新しました' : '作成しました');
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '保存に失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!event) return;
        if (!confirm('この予定を削除しますか？')) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/company-calendar/${event.id}`, {
                method: 'DELETE',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: '削除に失敗しました' }));
                throw new Error(err.error || '削除に失敗しました');
            }
            sendBroadcast('company_calendar_updated', {
                eventId: event.id,
                projectMasterId: event.projectMasterId ?? null,
            });
            toast.success('削除しました');
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : '削除に失敗しました');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-2">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <h2 className="text-lg font-bold text-slate-900">
                        {isEdit ? '予定を編集' : '予定を追加'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 hover:bg-slate-100 rounded-lg"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
                >
                    {/* タイトル */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            タイトル <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            placeholder="例：○○様邸 現調"
                            disabled={!canModify}
                            maxLength={200}
                            required
                        />
                    </div>

                    {/* 種別 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            種別
                        </label>
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value as CalendarCategory)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            disabled={!canModify}
                        >
                            {CALENDAR_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                    {CALENDAR_CATEGORY_LABELS[c]}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* 終日 / 日時 */}
                    <div>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input
                                type="checkbox"
                                checked={allDay}
                                onChange={(e) => setAllDay(e.target.checked)}
                                disabled={!canModify}
                            />
                            終日
                        </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                開始
                            </label>
                            <input
                                type={allDay ? 'date' : 'datetime-local'}
                                value={startAt}
                                onChange={(e) => setStartAt(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                                disabled={!canModify}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                終了
                            </label>
                            <input
                                type={allDay ? 'date' : 'datetime-local'}
                                value={endAt}
                                onChange={(e) => setEndAt(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                                disabled={!canModify}
                                required
                            />
                        </div>
                    </div>

                    {/* 場所 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            場所
                        </label>
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            placeholder="例：○○市役所"
                            disabled={!canModify}
                        />
                    </div>

                    {/* 関連案件 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            関連案件
                        </label>
                        <select
                            value={projectMasterId}
                            onChange={(e) => setProjectMasterId(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                            disabled={!canModify}
                        >
                            <option value="">（紐付けなし）</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* 詳細 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            詳細
                        </label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y"
                            rows={3}
                            placeholder="メモやリンクなど"
                            disabled={!canModify}
                        />
                    </div>

                    {/* 公開範囲 */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                            公開範囲
                        </label>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    setVisibility(visibility === 'shared' ? 'private' : 'shared')
                                }
                                disabled={!canModify}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium ${
                                    visibility === 'private'
                                        ? 'bg-amber-100 border-amber-400 text-amber-800'
                                        : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                }`}
                            >
                                {visibility === 'private' ? (
                                    <>
                                        <Lock className="w-4 h-4" /> プライベート
                                    </>
                                ) : (
                                    <>
                                        <Unlock className="w-4 h-4" /> 共有（admin/manager）
                                    </>
                                )}
                            </button>
                            <span className="text-xs text-slate-500">
                                {visibility === 'private'
                                    ? '自分だけが閲覧できます'
                                    : 'admin と manager が閲覧できます'}
                            </span>
                        </div>
                    </div>
                </form>

                {/* フッター */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200">
                    <div>
                        {isEdit && canModify && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={submitting}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                            >
                                <Trash2 className="w-4 h-4" /> 削除
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                        >
                            キャンセル
                        </button>
                        {canModify && (
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={submitting}
                                className="px-4 py-1.5 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
                            >
                                {submitting ? '保存中...' : isEdit ? '更新' : '作成'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Date を <input type="date"|"datetime-local"> に渡せる文字列に変換 */
function toLocalInput(d: Date, allDay: boolean): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (allDay) return `${y}-${m}-${day}`;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${hh}:${mm}`;
}

function parseLocalInput(s: string, allDay: boolean): Date | null {
    if (!s) return null;
    // datetime-local / date のどちらでも Date() に通す
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    if (allDay) {
        // 終日は YYYY-MM-DD の 0:00（ローカル）として扱う
        // 既に Date オブジェクトでローカル解釈されているのでそのまま返す
    }
    return d;
}

function normalizeForAllDay(cur: string, allDay: boolean): string {
    if (!cur) return cur;
    if (allDay) {
        // datetime-local → date
        return cur.length >= 10 ? cur.slice(0, 10) : cur;
    }
    // date → datetime-local (時刻 09:00 を補う)
    if (cur.length === 10) return `${cur}T09:00`;
    return cur;
}
