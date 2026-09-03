'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { TOOL_STATUSES, toolStatusLabel } from '@/lib/equipment';
import { Button } from '@/components/ui/Button';
import { MaintenanceTab } from './MaintenanceTab';
import { EquipmentTool, ToolCategory, ToolLog, VehicleUsage, fmtDate, fmtDateTime, toDateInput } from './types';

interface Props {
    tool: EquipmentTool;
    categories: ToolCategory[];
    canEdit: boolean;
    onClose: () => void;
    onChanged: () => void;
}

type TabKey = 'profile' | 'maintenance' | 'usage';

interface SimpleUser {
    id: string;
    displayName: string;
    isActive?: boolean;
}

/** 電動工具1台の詳細。基本情報・整備履歴・使用記録（誰が使っていたか）を切り替えて見る。 */
export function ToolDetailModal({ tool, categories, canEdit, onClose, onChanged }: Props) {
    const [tab, setTab] = useState<TabKey>('profile');
    const [form, setForm] = useState({
        categoryId: tool.categoryId,
        name: tool.name,
        maker: tool.maker ?? '',
        modelNumber: tool.modelNumber ?? '',
        serialNumber: tool.serialNumber ?? '',
        purchaseDate: toDateInput(tool.purchaseDate),
        purchasePrice: tool.purchasePrice == null ? '' : String(tool.purchasePrice),
        note: tool.note ?? '',
    });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const [logs, setLogs] = useState<ToolLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    // 現場での使用履歴（スケジュールで選ばれた配置から自動で出る。手入力の持出し記録とは別物）
    const [usage, setUsage] = useState<VehicleUsage[]>([]);
    const [usageLoading, setUsageLoading] = useState(false);
    const [users, setUsers] = useState<SimpleUser[]>([]);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [checkout, setCheckout] = useState({ holderId: '', holderName: '', destinationNote: '', note: '' });
    const [working, setWorking] = useState(false);

    const fetchLogs = useCallback(async () => {
        setLogsLoading(true);
        try {
            const res = await fetch(`/api/equipment/tools/${tool.id}/logs`, { cache: 'no-store' });
            if (!res.ok) throw new Error('failed');
            setLogs(await res.json());
        } catch (e) {
            logger.error('Failed to fetch tool logs:', e);
            toast.error('使用記録の読み込みに失敗しました');
        } finally {
            setLogsLoading(false);
        }
    }, [tool.id]);

    const fetchUsage = useCallback(async () => {
        setUsageLoading(true);
        try {
            const res = await fetch(`/api/equipment/tools/${tool.id}/usage`, { cache: 'no-store' });
            if (!res.ok) throw new Error('failed');
            setUsage(await res.json());
        } catch (e) {
            logger.error('Failed to fetch tool usage:', e);
        } finally {
            setUsageLoading(false);
        }
    }, [tool.id]);

    useEffect(() => {
        if (tab !== 'usage') return;
        fetchLogs();
        fetchUsage();
        if (users.length === 0) {
            fetch('/api/users', { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : []))
                .then((list: SimpleUser[]) => setUsers(Array.isArray(list) ? list.filter((u) => u.isActive !== false) : []))
                .catch(() => setUsers([]));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, tool.id]);

    const saveProfile = async () => {
        if (!form.name.trim()) {
            toast.error('名前（管理番号）を入力してください');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/equipment/tools/${tool.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '保存に失敗しました');
            }
            toast.success('保存しました');
            onChanged();
        } catch (e) {
            logger.error('Failed to save tool:', e);
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    // 一覧から外した分類でも、今その工具が属しているなら選択肢に残す（分類が空欄にならないように）
    const selectableCategories = useMemo(
        () => categories.filter((c) => c.isActive || c.id === tool.categoryId),
        [categories, tool.categoryId],
    );

    /** 台帳から外す（論理削除）／完全に削除（?mode=hard）。どちらも成功したら閉じる。 */
    const runDelete = async (query: string, successMessage: string) => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/equipment/tools/${tool.id}${query}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '削除に失敗しました');
            }
            toast.success(successMessage);
            onChanged();
            onClose();
        } catch (e) {
            logger.error('Failed to delete tool:', e);
            toast.error(e instanceof Error ? e.message : '削除に失敗しました');
        } finally {
            setDeleting(false);
        }
    };

    const removeFromLedger = () => {
        if (!window.confirm(`「${tool.name}」を台帳から外します。\nスケジュールの選択肢からは消えますが、これまでの手配表・使用履歴・整備の記録はそのまま残ります。よろしいですか？`)) return;
        runDelete('', '台帳から外しました');
    };

    const deletePermanently = () => {
        if (!window.confirm(`「${tool.name}」を完全に削除します。\n元に戻せません。使った記録が残っている工具は削除できません。よろしいですか？`)) return;
        runDelete('?mode=hard', '完全に削除しました');
    };

    const restoreToLedger = async () => {
        setDeleting(true);
        try {
            const res = await fetch(`/api/equipment/tools/${tool.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: true }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '戻せませんでした');
            }
            toast.success('台帳に戻しました');
            onChanged();
        } catch (e) {
            logger.error('Failed to restore tool:', e);
            toast.error(e instanceof Error ? e.message : '戻せませんでした');
        } finally {
            setDeleting(false);
        }
    };

    const post = async (body: Record<string, unknown>, successMessage: string) => {
        setWorking(true);
        try {
            const res = await fetch(`/api/equipment/tools/${tool.id}/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '記録に失敗しました');
            }
            toast.success(successMessage);
            setCheckoutOpen(false);
            setCheckout({ holderId: '', holderName: '', destinationNote: '', note: '' });
            await fetchLogs();
            onChanged();
        } catch (e) {
            logger.error('Failed to record tool usage:', e);
            toast.error(e instanceof Error ? e.message : '記録に失敗しました');
        } finally {
            setWorking(false);
        }
    };

    const doCheckout = () => {
        if (!checkout.holderId && !checkout.holderName.trim()) {
            toast.error('使用者を選ぶか入力してください');
            return;
        }
        post({ action: 'checkout', ...checkout }, '持出しを記録しました');
    };

    const tabs: { key: TabKey; label: string }[] = [
        { key: 'profile', label: '基本情報' },
        { key: 'maintenance', label: '整備・修理' },
        { key: 'usage', label: '使用記録' },
    ];

    const input = (label: string, key: keyof typeof form, type: 'text' | 'date' = 'text', placeholder?: string) => (
        <label className="text-xs text-slate-600">
            {label}
            <input
                type={type}
                value={form[key]}
                onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                disabled={!canEdit}
                placeholder={placeholder}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            />
        </label>
    );

    return (
        <div className="fixed inset-0 lg:left-48 z-[60] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black bg-opacity-50 hidden lg:block" onClick={onClose} />

            <div
                role="dialog"
                aria-modal="true"
                className="relative bg-white flex flex-col w-full h-full lg:h-[90vh] lg:rounded-lg lg:shadow-xl lg:max-w-4xl lg:mx-4"
            >
                <div className="flex-shrink-0 border-b border-slate-200 px-4 py-4 md:px-6 lg:rounded-t-lg">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-sm text-slate-500">機材台帳（電動工具）</div>
                            <h2 className="truncate text-xl font-semibold text-slate-800">{tool.name}</h2>
                            <div className="mt-1 text-xs text-slate-500">
                                {toolStatusLabel(tool.status)}
                                {tool.status === 'checked_out' && tool.holderName ? ` / ${tool.holderName}` : ''}
                                {tool.status === 'checked_out' && tool.checkedOutAt ? `（${fmtDateTime(tool.checkedOutAt)}〜）` : ''}
                            </div>
                        </div>
                        <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="mt-3 flex gap-1">
                        {tabs.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setTab(t.key)}
                                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                                    tab === t.key ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                    {tab === 'profile' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="text-xs text-slate-600">
                                    分類
                                    <select
                                        value={form.categoryId}
                                        onChange={(e) => setForm((p) => ({ ...p, categoryId: e.target.value }))}
                                        disabled={!canEdit}
                                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                    >
                                        {selectableCategories.map((c) => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </label>
                                {input('名前・管理番号', 'name')}
                                {input('メーカー', 'maker', 'text', '例: マキタ')}
                                {input('型番', 'modelNumber')}
                                {input('製造番号', 'serialNumber')}
                                <div className="hidden sm:block" />
                                {input('購入日', 'purchaseDate', 'date')}
                                {input('購入金額（税込）', 'purchasePrice')}
                            </div>
                            <label className="block text-xs text-slate-600">
                                メモ
                                <textarea
                                    value={form.note}
                                    onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                                    disabled={!canEdit}
                                    rows={3}
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                />
                            </label>
                            {canEdit && (
                                <div className="flex justify-end">
                                    <Button variant="primary" onClick={saveProfile} isLoading={saving}>保存</Button>
                                </div>
                            )}

                            {canEdit && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <div className="text-xs font-medium text-slate-700">この工具を台帳から削除</div>
                                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                        「台帳から外す」は一覧とスケジュールの選択肢から消えるだけで、これまでの手配表・使用履歴・整備の記録はそのまま残ります。<br />
                                        「完全に削除」は間違えて登録した分の消去用です。使った記録が1件でもある工具は削除できません。
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {tool.isActive ? (
                                            <Button variant="secondary" size="sm" onClick={removeFromLedger} disabled={deleting}>
                                                台帳から外す
                                            </Button>
                                        ) : (
                                            <Button variant="secondary" size="sm" onClick={restoreToLedger} disabled={deleting}>
                                                台帳に戻す
                                            </Button>
                                        )}
                                        <Button variant="danger" size="sm" leftIcon={<Trash2 className="h-4 w-4" />} onClick={deletePermanently} disabled={deleting}>
                                            完全に削除
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'maintenance' && (
                        <MaintenanceTab targetType="tool" targetId={tool.id} canEdit={canEdit} onChanged={onChanged} />
                    )}

                    {tab === 'usage' && (
                        <div className="space-y-4">
                            {canEdit && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {tool.status === 'checked_out' ? (
                                            <Button variant="primary" size="sm" onClick={() => post({ action: 'return' }, '返却を記録しました')} isLoading={working}>
                                                返却する
                                            </Button>
                                        ) : (
                                            <Button variant="primary" size="sm" onClick={() => setCheckoutOpen((v) => !v)}>
                                                持ち出す
                                            </Button>
                                        )}
                                        <select
                                            value=""
                                            onChange={(e) => {
                                                if (!e.target.value) return;
                                                post({ action: 'status_change', status: e.target.value }, '状態を変更しました');
                                            }}
                                            disabled={working}
                                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                        >
                                            <option value="">状態を変更...</option>
                                            {TOOL_STATUSES.filter((s) => s.value !== 'checked_out').map((s) => (
                                                <option key={s.value} value={s.value}>{s.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {checkoutOpen && tool.status !== 'checked_out' && (
                                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <label className="text-xs text-slate-600">
                                                使用者（社内から選ぶ）
                                                <select
                                                    value={checkout.holderId}
                                                    onChange={(e) => setCheckout((p) => ({ ...p, holderId: e.target.value }))}
                                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                                >
                                                    <option value="">選択してください</option>
                                                    {users.map((u) => (
                                                        <option key={u.id} value={u.id}>{u.displayName}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="text-xs text-slate-600">
                                                使用者（一覧に無いとき手入力）
                                                <input
                                                    type="text"
                                                    value={checkout.holderName}
                                                    onChange={(e) => setCheckout((p) => ({ ...p, holderName: e.target.value }))}
                                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <label className="text-xs text-slate-600 sm:col-span-2">
                                                行き先・メモ
                                                <input
                                                    type="text"
                                                    value={checkout.destinationNote}
                                                    onChange={(e) => setCheckout((p) => ({ ...p, destinationNote: e.target.value }))}
                                                    placeholder="例: 山田様邸 / 事務所"
                                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                                />
                                            </label>
                                            <div className="flex justify-end gap-2 sm:col-span-2">
                                                <Button variant="secondary" size="sm" onClick={() => setCheckoutOpen(false)}>キャンセル</Button>
                                                <Button variant="primary" size="sm" onClick={doCheckout} isLoading={working}>記録する</Button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 現場での使用履歴（スケジュールから自動） */}
                            <div className="mb-5">
                                <div className="mb-2 flex items-baseline gap-2">
                                    <h4 className="text-sm font-semibold text-slate-700">現場での使用履歴</h4>
                                    <span className="text-xs text-slate-500">スケジュールで選ばれた分を自動で出しています（直近100件）</span>
                                </div>
                                {usageLoading ? (
                                    <div className="py-6 text-center text-sm text-slate-500">読み込み中...</div>
                                ) : usage.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500">
                                        この工具を使った配置の記録がありません
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[520px] text-sm">
                                            <thead>
                                                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                                                    <th className="py-2 pr-3">日付</th>
                                                    <th className="py-2 pr-3">現場</th>
                                                    <th className="py-2 pr-3">職長</th>
                                                    <th className="py-2">作業員</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {usage.map((u) => (
                                                    <tr key={u.id} className="border-b border-slate-100">
                                                        <td className="whitespace-nowrap py-2 pr-3 text-slate-700">{fmtDate(u.date)}</td>
                                                        <td className="py-2 pr-3 text-slate-700">{u.projectName}</td>
                                                        <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{u.foremanName || '—'}</td>
                                                        <td className="py-2 text-slate-600">{u.workerNames.join('、') || '—'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <h4 className="mb-2 text-sm font-semibold text-slate-700">持出し・返却の記録</h4>
                            {logsLoading ? (
                                <div className="py-10 text-center text-slate-500">読み込み中...</div>
                            ) : logs.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
                                    まだ使用の記録がありません
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {logs.map((l) => (
                                        <div key={l.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-slate-500">{fmtDateTime(l.createdAt)}</span>
                                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                                                    {l.action === 'checkout' ? '持出し' : l.action === 'return' ? '返却' : '状態変更'}
                                                </span>
                                                <span className="text-slate-700">{toolStatusLabel(l.status)}</span>
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                                                {l.holderName && <span>使用者: {l.holderName}</span>}
                                                {l.projectName && <span>現場: {l.projectName}</span>}
                                                {l.destinationNote && <span>行き先: {l.destinationNote}</span>}
                                                {l.createdByName && <span>記録: {l.createdByName}</span>}
                                            </div>
                                            {l.note && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{l.note}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {tab === 'profile' && tool.purchaseDate && (
                    <div className="flex-shrink-0 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 md:px-6">
                        購入日 {fmtDate(tool.purchaseDate)}
                    </div>
                )}
            </div>
        </div>
    );
}
