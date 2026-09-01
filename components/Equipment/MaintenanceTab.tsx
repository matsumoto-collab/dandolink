'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Paperclip, Trash2, Pencil, FileText, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import { MAINTENANCE_CATEGORIES, maintenanceCategoryLabel } from '@/lib/equipment';
import { ImageLightbox } from '@/components/ui/ImageLightbox';
import { Button } from '@/components/ui/Button';
import { MaintenanceRecord, fmtDate, fmtYen, toDateInput } from './types';

interface Props {
    targetType: 'vehicle' | 'tool';
    targetId: string;
    /** 走行距離の欄を出すか（車両のみ） */
    showOdometer?: boolean;
    canEdit: boolean;
    /** 履歴が増減したとき（一覧の件数・累計費用を取り直すため） */
    onChanged?: () => void;
}

interface FormState {
    id: string | null;
    date: string;
    category: string;
    title: string;
    vendor: string;
    amount: string;
    odometer: string;
    nextDueDate: string;
    note: string;
}

const emptyForm = (): FormState => ({
    id: null,
    date: new Date().toISOString().slice(0, 10),
    category: 'repair',
    title: '',
    vendor: '',
    amount: '',
    odometer: '',
    nextDueDate: '',
    note: '',
});

/**
 * 整備・修理履歴のタブ。車両・電動工具のどちらからも同じ形で使う。
 * 見積書や請求書は写真（またはPDF）で1件に何枚でも貼れる。
 */
export function MaintenanceTab({ targetType, targetId, showOdometer, canEdit, onChanged }: Props) {
    const [records, setRecords] = useState<MaintenanceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<{ images: { src: string; alt: string }[]; index: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<string | null>(null);

    const fetchRecords = useCallback(async () => {
        try {
            const res = await fetch(`/api/equipment/maintenance?targetType=${targetType}&targetId=${targetId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('failed');
            setRecords(await res.json());
        } catch (e) {
            logger.error('Failed to fetch maintenance records:', e);
            toast.error('整備・修理履歴の読み込みに失敗しました');
        } finally {
            setLoading(false);
        }
    }, [targetType, targetId]);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);

    const total = useMemo(() => records.reduce((s, r) => s + (r.amount ?? 0), 0), [records]);

    const openNew = () => {
        setForm(emptyForm());
        setFormOpen(true);
    };

    const openEdit = (r: MaintenanceRecord) => {
        setForm({
            id: r.id,
            date: toDateInput(r.date),
            category: r.category,
            title: r.title,
            vendor: r.vendor ?? '',
            amount: r.amount == null ? '' : String(r.amount),
            odometer: r.odometer == null ? '' : String(r.odometer),
            nextDueDate: toDateInput(r.nextDueDate),
            note: r.note ?? '',
        });
        setFormOpen(true);
    };

    const save = async () => {
        if (!form.date) {
            toast.error('日付を入力してください');
            return;
        }
        if (!form.title.trim()) {
            toast.error('内容を入力してください');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                targetType,
                targetId,
                date: form.date,
                category: form.category,
                title: form.title.trim(),
                vendor: form.vendor.trim(),
                amount: form.amount,
                odometer: form.odometer,
                nextDueDate: form.nextDueDate,
                note: form.note.trim(),
            };
            const res = await fetch(form.id ? `/api/equipment/maintenance/${form.id}` : '/api/equipment/maintenance', {
                method: form.id ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || '保存に失敗しました');
            }
            toast.success(form.id ? '履歴を更新しました' : '履歴を追加しました');
            setFormOpen(false);
            setForm(emptyForm());
            await fetchRecords();
            onChanged?.();
        } catch (e) {
            logger.error('Failed to save maintenance record:', e);
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (r: MaintenanceRecord) => {
        if (!window.confirm(`${fmtDate(r.date)}「${r.title}」を削除します。添付した写真も消えます。よろしいですか？`)) return;
        try {
            const res = await fetch(`/api/equipment/maintenance/${r.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('failed');
            toast.success('履歴を削除しました');
            await fetchRecords();
            onChanged?.();
        } catch (e) {
            logger.error('Failed to delete maintenance record:', e);
            toast.error('削除に失敗しました');
        }
    };

    const pickFiles = (recordId: string) => {
        uploadTargetRef.current = recordId;
        fileInputRef.current?.click();
    };

    const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const recordId = uploadTargetRef.current;
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!recordId || files.length === 0) return;

        setUploadingId(recordId);
        try {
            const fd = new FormData();
            files.forEach((f) => fd.append('files', f));
            const res = await fetch(`/api/equipment/maintenance/${recordId}/files`, { method: 'POST', body: fd });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || 'アップロードに失敗しました');
            }
            toast.success('写真を添付しました');
            await fetchRecords();
        } catch (err) {
            logger.error('Failed to upload maintenance files:', err);
            toast.error(err instanceof Error ? err.message : 'アップロードに失敗しました');
        } finally {
            setUploadingId(null);
        }
    };

    const removeFile = async (fileId: string) => {
        if (!window.confirm('この写真を削除します。よろしいですか？')) return;
        try {
            const res = await fetch(`/api/equipment/maintenance/files/${fileId}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('failed');
            toast.success('写真を削除しました');
            await fetchRecords();
        } catch (e) {
            logger.error('Failed to delete maintenance file:', e);
            toast.error('削除に失敗しました');
        }
    };

    const openFile = (record: MaintenanceRecord, index: number) => {
        const file = record.files[index];
        if (!file) return;
        if (file.mimeType === 'application/pdf') {
            if (file.signedUrl) window.open(file.signedUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        const images = record.files
            .filter((f) => f.mimeType !== 'application/pdf' && f.signedUrl)
            .map((f) => ({ src: f.signedUrl as string, alt: f.fileName }));
        const target = images.findIndex((im) => im.src === file.signedUrl);
        if (images.length > 0) setLightbox({ images, index: Math.max(0, target) });
    };

    return (
        <div className="space-y-4">
            <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={handleFiles} />

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-600">
                    {records.length}件　累計 <span className="font-medium text-slate-800">{fmtYen(total)}</span>
                </div>
                {canEdit && (
                    <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>
                        履歴を追加
                    </Button>
                )}
            </div>

            {formOpen && canEdit && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{form.id ? '履歴を編集' : '履歴を追加'}</span>
                        <button type="button" onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-600">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label className="text-xs text-slate-600">
                            日付
                            <input
                                type="date"
                                value={form.date}
                                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            区分
                            <select
                                value={form.category}
                                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            >
                                {MAINTENANCE_CATEGORIES.map((c) => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs text-slate-600 sm:col-span-2">
                            内容
                            <input
                                type="text"
                                value={form.title}
                                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                                placeholder="例: ブレーキパッド交換"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            業者
                            <input
                                type="text"
                                value={form.vendor}
                                onChange={(e) => setForm((p) => ({ ...p, vendor: e.target.value }))}
                                placeholder="例: ○○自動車"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600">
                            金額（税込）
                            <input
                                type="text"
                                inputMode="numeric"
                                value={form.amount}
                                onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                                placeholder="例: 38000"
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        {showOdometer && (
                            <label className="text-xs text-slate-600">
                                走行距離（km）
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={form.odometer}
                                    onChange={(e) => setForm((p) => ({ ...p, odometer: e.target.value }))}
                                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                />
                            </label>
                        )}
                        <label className="text-xs text-slate-600">
                            次回の満了日（車検・保険のとき）
                            <input
                                type="date"
                                value={form.nextDueDate}
                                onChange={(e) => setForm((p) => ({ ...p, nextDueDate: e.target.value }))}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                        <label className="text-xs text-slate-600 sm:col-span-2">
                            メモ
                            <textarea
                                value={form.note}
                                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                                rows={2}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            />
                        </label>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setFormOpen(false)}>キャンセル</Button>
                        <Button variant="primary" size="sm" onClick={save} isLoading={saving}>保存</Button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                        写真（見積書・請求書）は保存したあと、一覧の「写真を添付」から追加できます。
                    </p>
                </div>
            )}

            {loading ? (
                <div className="py-10 text-center text-slate-500">読み込み中...</div>
            ) : records.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
                    まだ履歴がありません
                </div>
            ) : (
                <div className="space-y-2">
                    {records.map((r) => (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium text-slate-800">{fmtDate(r.date)}</span>
                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                                            {maintenanceCategoryLabel(r.category)}
                                        </span>
                                        <span className="text-sm text-slate-800">{r.title}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                        {r.vendor && <span>業者: {r.vendor}</span>}
                                        {r.odometer != null && <span>走行: {r.odometer.toLocaleString()}km</span>}
                                        {r.nextDueDate && <span>次回満了: {fmtDate(r.nextDueDate)}</span>}
                                        {r.createdByName && <span>登録: {r.createdByName}</span>}
                                    </div>
                                    {r.note && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{r.note}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-slate-800">{fmtYen(r.amount)}</span>
                                    {canEdit && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => openEdit(r)}
                                                title="編集"
                                                aria-label="編集"
                                                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => remove(r)}
                                                title="削除"
                                                aria-label="削除"
                                                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {r.files.map((f, i) => (
                                    <div key={f.id} className="group relative">
                                        <button
                                            type="button"
                                            onClick={() => openFile(r, i)}
                                            title={f.fileName}
                                            className="block h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                                        >
                                            {f.mimeType === 'application/pdf' ? (
                                                <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
                                                    <FileText className="h-5 w-5" />
                                                    <span className="text-[10px]">PDF</span>
                                                </span>
                                            ) : f.thumbnailSignedUrl || f.signedUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={(f.thumbnailSignedUrl || f.signedUrl) as string} alt={f.fileName} className="h-full w-full object-cover" />
                                            ) : (
                                                <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">画像</span>
                                            )}
                                        </button>
                                        {canEdit && (
                                            <button
                                                type="button"
                                                onClick={() => removeFile(f.id)}
                                                title="この写真を削除"
                                                aria-label="この写真を削除"
                                                className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-slate-200 bg-white p-0.5 text-slate-400 shadow-sm hover:text-red-600 group-hover:block"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => pickFiles(r.id)}
                                        disabled={uploadingId === r.id}
                                        className="inline-flex h-16 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 text-xs text-slate-500 transition-colors hover:border-teal-400 hover:text-teal-600 disabled:opacity-50"
                                    >
                                        <Paperclip className="h-4 w-4" />
                                        {uploadingId === r.id ? '添付中...' : '写真を添付'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {lightbox && (
                <ImageLightbox images={lightbox.images} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
            )}
        </div>
    );
}
