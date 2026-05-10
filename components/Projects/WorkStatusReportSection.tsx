'use client';

import React, { useState, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import { useCalendarStore } from '@/stores/calendarStore';
import { Play, Square, Loader2, X, ImagePlus, Trash2 } from 'lucide-react';
import { logger } from '@/lib/logger';

type ImageCategory = 'assembly' | 'demolition' | 'other';

interface WorkStatusReportSectionProps {
    assignmentId: string;
    projectMasterId?: string;
    title: string;
    workStartedAt?: Date | null;
    workEndedAt?: Date | null;
    onUpdated?: (updated: { workStartedAt: Date | null; workEndedAt: Date | null }) => void;
}

const CATEGORY_LABELS: Record<ImageCategory, string> = {
    assembly: '組立',
    demolition: '解体',
    other: 'その他',
};

const formatHHmm = (d: Date | null | undefined): string => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};

export default function WorkStatusReportSection({
    assignmentId,
    projectMasterId,
    title,
    workStartedAt,
    workEndedAt,
    onUpdated,
}: WorkStatusReportSectionProps) {
    const upsertAssignmentStore = useCalendarStore((s) => s.upsertAssignment);

    const [busy, setBusy] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
    const [commentPrompt, setCommentPrompt] = useState<{ type: 'start' | 'end' } | null>(null);
    const [commentText, setCommentText] = useState('');
    const [imageCategory, setImageCategory] = useState<ImageCategory | null>(null);
    const [imageFiles, setImageFiles] = useState<File[]>([]);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);

    useEffect(() => {
        if (!commentPrompt) {
            imagePreviews.forEach((url) => URL.revokeObjectURL(url));
            setImageFiles([]);
            setImagePreviews([]);
            setCommentText('');
            setImageCategory(null);
        }
    }, [commentPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleImagesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return;
        setImageFiles((prev) => [...prev, ...files]);
        const newPreviews = files.map((f) => URL.createObjectURL(f));
        setImagePreviews((prev) => [...prev, ...newPreviews]);
        e.target.value = '';
    };

    const removeImage = (index: number) => {
        setImageFiles((prev) => prev.filter((_, i) => i !== index));
        setImagePreviews((prev) => {
            const toRevoke = prev[index];
            if (toRevoke) URL.revokeObjectURL(toRevoke);
            return prev.filter((_, i) => i !== index);
        });
    };

    const compressIfNeeded = async (file: File): Promise<File | Blob> => {
        if (!file.type.startsWith('image/') || file.size <= 3 * 1024 * 1024) return file;
        try {
            return await imageCompression(file, {
                maxSizeMB: 3,
                maxWidthOrHeight: 3000,
                useWebWorker: true,
                initialQuality: 0.9,
            });
        } catch (e) {
            logger.error('Client-side image compression failed', e, { fileName: file.name });
            return file;
        }
    };

    const uploadImages = async (
        category: ImageCategory,
        files: File[]
    ): Promise<{ uploadedCount: number; failedCount: number; firstError?: string }> => {
        if (!projectMasterId) {
            return { uploadedCount: 0, failedCount: files.length, firstError: 'projectMasterId is missing' };
        }
        const results = await Promise.all(
            files.map(async (file): Promise<{ ok: boolean; error?: string }> => {
                try {
                    const compressed = await compressIfNeeded(file);
                    const fd = new FormData();
                    fd.append('file', compressed, file.name);
                    fd.append('category', category);
                    const res = await fetch(`/api/project-masters/${projectMasterId}/files`, {
                        method: 'POST',
                        body: fd,
                    });
                    if (res.ok) return { ok: true };
                    const data = await res.json().catch(() => ({}));
                    const msg = data?.error || `status ${res.status}`;
                    logger.error('Image upload failed', msg, { fileName: file.name });
                    return { ok: false, error: msg };
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    logger.error('Image upload threw', e, { fileName: file.name });
                    return { ok: false, error: msg };
                }
            })
        );
        const uploadedCount = results.filter((r) => r.ok).length;
        const firstError = results.find((r) => !r.ok)?.error;
        return { uploadedCount, failedCount: results.length - uploadedCount, firstError };
    };

    const submit = async (
        type: 'start' | 'end',
        comment: string,
        images: { category: ImageCategory; files: File[] } | undefined
    ) => {
        setBusy((prev) => ({ ...prev, [type]: true }));
        try {
            let uploadedImageCount = 0;
            let uploadFailedCount = 0;
            let uploadFirstError: string | undefined;
            let imageCategoryForBody: ImageCategory | null = null;
            if (images && images.files.length > 0 && projectMasterId) {
                const result = await uploadImages(images.category, images.files);
                uploadedImageCount = result.uploadedCount;
                uploadFailedCount = result.failedCount;
                uploadFirstError = result.firstError;
                imageCategoryForBody = images.category;
            }

            const res = await fetch(`/api/assignments/${assignmentId}/work-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    comment: comment || undefined,
                    uploadedImageCount: uploadedImageCount || undefined,
                    imageCategory: imageCategoryForBody || undefined,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || '通知の送信に失敗しました');
                return;
            }

            const data = await res.json();
            const timeStr: string = data?.time || '';
            const a = data?.assignment;
            if (a) {
                const nextStart = a.workStartedAt ? new Date(a.workStartedAt) : null;
                const nextEnd = a.workEndedAt ? new Date(a.workEndedAt) : null;
                upsertAssignmentStore({
                    ...a,
                    date: new Date(a.date),
                    createdAt: new Date(a.createdAt),
                    updatedAt: new Date(a.updatedAt),
                    workStartedAt: nextStart,
                    workEndedAt: nextEnd,
                    projectMaster: a.projectMaster
                        ? {
                              ...a.projectMaster,
                              createdAt: new Date(a.projectMaster.createdAt),
                              updatedAt: new Date(a.projectMaster.updatedAt),
                          }
                        : undefined,
                });
                onUpdated?.({ workStartedAt: nextStart, workEndedAt: nextEnd });
            }

            const imageSuffix = uploadedImageCount > 0 && imageCategoryForBody
                ? `・${CATEGORY_LABELS[imageCategoryForBody]}に${uploadedImageCount}枚保存`
                : '';
            const failSuffix = uploadFailedCount > 0
                ? `（${uploadFailedCount}枚の画像アップロードに失敗${uploadFirstError ? `: ${uploadFirstError}` : ''}）`
                : '';
            const message = (type === 'start'
                ? `作業開始を通知しました（${timeStr}）${imageSuffix}`
                : `作業完了を通知しました（${timeStr}）${imageSuffix}`) + failSuffix;
            if (uploadFailedCount > 0) toast.error(message);
            else toast.success(message);
        } catch (e) {
            logger.error('work-status submit failed', e);
            toast.error('通知の送信に失敗しました');
        } finally {
            setBusy((prev) => ({ ...prev, [type]: false }));
        }
    };

    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">作業時間の報告</label>
            <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setCommentPrompt({ type: 'start' })}
                        disabled={busy.start}
                        className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                    >
                        {busy.start ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        開始
                    </button>
                    <button
                        type="button"
                        onClick={() => setCommentPrompt({ type: 'end' })}
                        disabled={busy.end}
                        className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium bg-slate-700 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                    >
                        {busy.end ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                        完了
                    </button>
                </div>
                {(workStartedAt || workEndedAt) && (
                    <div className="text-xs text-slate-600 flex items-center gap-3">
                        {workStartedAt && <span>開始 {formatHHmm(workStartedAt)}</span>}
                        {workEndedAt && <span>完了 {formatHHmm(workEndedAt)}</span>}
                    </div>
                )}
            </div>

            {commentPrompt && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
                            <h3 className="text-base font-semibold text-slate-800">
                                {commentPrompt.type === 'start' ? '作業開始を通知' : '作業完了を通知'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setCommentPrompt(null)}
                                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
                            <div className="text-sm text-slate-600 truncate">{title}</div>
                            <div>
                                <label className="block text-sm text-slate-700 mb-1">
                                    一言メモ（任意・100文字まで）
                                </label>
                                <textarea
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value.slice(0, 100))}
                                    rows={3}
                                    maxLength={100}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    placeholder="例: 資材遅れのため30分押しで開始"
                                />
                                <div className="mt-1 text-xs text-slate-400 text-right">
                                    {commentText.length}/100
                                </div>
                            </div>
                            {commentPrompt.type === 'end' && (
                                <div className="pt-2 border-t border-slate-200">
                                    <label className="block text-sm text-slate-700 mb-2">
                                        画像（任意・案件フォルダに保存されます）
                                    </label>
                                    <div className="flex gap-2 mb-2">
                                        {(['assembly', 'demolition', 'other'] as const).map((cat) => {
                                            const active = imageCategory === cat;
                                            return (
                                                <button
                                                    key={cat}
                                                    type="button"
                                                    onClick={() => setImageCategory(cat)}
                                                    className={`flex-1 px-3 py-2 text-sm rounded-xl border transition-colors ${
                                                        active
                                                            ? 'bg-slate-800 text-white border-slate-800'
                                                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                                                    }`}
                                                >
                                                    {CATEGORY_LABELS[cat]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <label className="flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors">
                                        <ImagePlus className="w-4 h-4" />
                                        画像を選択（複数可）
                                        <input
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            onChange={handleImagesSelected}
                                            className="hidden"
                                        />
                                    </label>
                                    {imageFiles.length > 0 && !imageCategory && (
                                        <div className="mt-2 text-xs text-red-500">
                                            画像を保存するカテゴリ（組立/解体/その他）を選択してください
                                        </div>
                                    )}
                                    {imagePreviews.length > 0 && (
                                        <div className="grid grid-cols-3 gap-2 mt-3">
                                            {imagePreviews.map((src, idx) => (
                                                <div
                                                    key={idx}
                                                    className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={src} alt={`preview-${idx}`} className="w-full h-full object-cover" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeImage(idx)}
                                                        className="absolute top-1 right-1 p-1 bg-white/90 rounded-full hover:bg-white transition-colors shadow-sm"
                                                        title="削除"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5 text-slate-700" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {imageFiles.length > 0 && (
                                        <div className="mt-2 text-xs text-slate-500">{imageFiles.length}枚選択中</div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                            <button
                                type="button"
                                onClick={() => setCommentPrompt(null)}
                                className="px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
                            >
                                キャンセル
                            </button>
                            <button
                                type="button"
                                disabled={commentPrompt.type === 'end' && imageFiles.length > 0 && !imageCategory}
                                onClick={() => {
                                    const p = commentPrompt;
                                    const imagesPayload =
                                        p.type === 'end' && imageFiles.length > 0 && imageCategory
                                            ? { category: imageCategory, files: imageFiles }
                                            : undefined;
                                    setCommentPrompt(null);
                                    submit(p.type, commentText.trim(), imagesPayload);
                                }}
                                className={`flex items-center gap-1 px-4 py-2 rounded-xl text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                    commentPrompt.type === 'start'
                                        ? 'bg-emerald-600 hover:bg-emerald-700'
                                        : 'bg-slate-700 hover:bg-slate-800'
                                }`}
                            >
                                {commentPrompt.type === 'start' ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                {commentPrompt.type === 'end' && imageFiles.length > 0
                                    ? `通知を送信（画像${imageFiles.length}枚）`
                                    : '通知を送信'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
