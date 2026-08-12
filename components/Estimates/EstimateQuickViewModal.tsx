'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import { useCompany } from '@/hooks/useCompany';
import { useCustomers } from '@/hooks/useCustomers';
import { useCalendarStore } from '@/stores/calendarStore';
import type { Estimate } from '@/types/estimate';
import type { Project, ProjectMaster } from '@/types/calendar';
import { logger } from '@/lib/logger';

interface EstimateQuickViewModalProps {
    isOpen: boolean;
    onClose: () => void;
    projectMasterId: string;
    projectTitle?: string;
}

/** API レスポンス（日付は ISO 文字列・案件キーは projectMasterId） */
type EstimateApiResponse = Omit<Estimate, 'validUntil' | 'createdAt' | 'updatedAt' | 'projectId'> & {
    projectId?: string;
    projectMasterId?: string;
    validUntil: string;
    createdAt: string;
    updatedAt: string;
};

function parseEstimate(e: EstimateApiResponse): Estimate {
    return {
        ...e,
        projectId: e.projectId ?? e.projectMasterId ?? undefined,
        costTotal: e.costTotal ?? null,
        validUntil: new Date(e.validUntil),
        createdAt: new Date(e.createdAt),
        updatedAt: new Date(e.updatedAt),
    };
}

const STATUS_LABEL: Record<Estimate['status'], string> = {
    draft: '下書き',
    sent: '送付済み',
    approved: '承認済み',
    rejected: '却下',
};

/**
 * 案件詳細モーダルから開く「見積書のPDF閲覧専用」モーダル。
 * 自己完結（見積・案件マスタ・自社情報を自前で解決）・編集導線は持たない。
 */
export default function EstimateQuickViewModal({
    isOpen,
    onClose,
    projectMasterId,
    projectTitle,
}: EstimateQuickViewModalProps) {
    const [estimates, setEstimates] = useState<Estimate[]>([]);
    const [selectedId, setSelectedId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [projectMaster, setProjectMaster] = useState<ProjectMaster | null>(null);

    const { companyInfo, ensureDataLoaded: ensureCompanyLoaded } = useCompany();
    const { customers, ensureDataLoaded: ensureCustomersLoaded } = useCustomers();
    // ストアに既に読み込まれていればそれを使う（カレンダー画面からは常に読み込み済み）
    const projectMasterFromStore = useCalendarStore(
        useCallback((s) => s.projectMasters.find((pm) => pm.id === projectMasterId), [projectMasterId]),
    );

    // 自社情報・顧客マスタの遅延ロード
    useEffect(() => {
        if (!isOpen) return;
        ensureCompanyLoaded();
        ensureCustomersLoaded();
    }, [isOpen, ensureCompanyLoaded, ensureCustomersLoaded]);

    // 見積一覧の取得
    useEffect(() => {
        if (!isOpen || !projectMasterId) return;
        const controller = new AbortController();
        setLoading(true);
        setErrorMessage('');
        (async () => {
            try {
                const res = await fetch(`/api/estimates?projectMasterId=${encodeURIComponent(projectMasterId)}`, {
                    signal: controller.signal,
                });
                if (!res.ok) {
                    throw new Error(res.status === 403 ? '見積書を閲覧する権限がありません' : '見積書の取得に失敗しました');
                }
                const data: EstimateApiResponse[] = await res.json();
                const list = Array.isArray(data) ? data.map(parseEstimate) : [];
                setEstimates(list);
                setSelectedId(list[0]?.id ?? '');
            } catch (e) {
                if (controller.signal.aborted) return;
                logger.error('見積書の取得エラー:', e);
                setErrorMessage(e instanceof Error ? e.message : '見積書の取得に失敗しました');
                setEstimates([]);
                setSelectedId('');
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        })();
        return () => controller.abort();
    }, [isOpen, projectMasterId]);

    // 案件マスタ: ストアに無ければ API から取得
    useEffect(() => {
        if (!isOpen || !projectMasterId) return;
        if (projectMasterFromStore) {
            setProjectMaster(projectMasterFromStore);
            return;
        }
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetch(`/api/project-masters/${projectMasterId}`, { signal: controller.signal });
                if (!res.ok) return;
                const pm = (await res.json()) as ProjectMaster;
                setProjectMaster(pm);
            } catch (e) {
                if (!controller.signal.aborted) logger.error('案件マスタの取得エラー:', e);
            }
        })();
        return () => controller.abort();
    }, [isOpen, projectMasterId, projectMasterFromStore]);

    // Esc で閉じる
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    const selectedEstimate = useMemo(
        () => estimates.find((e) => e.id === selectedId) ?? null,
        [estimates, selectedId],
    );

    // 見積PDFの Blob 生成（請求待ちボードと同じ構成）
    const renderEstimatePdf = useCallback(
        async (est: Estimate): Promise<Blob | null> => {
            if (!companyInfo || !projectMaster) return null;
            // 宛名は顧客マスタの現在値を優先（顧客名・敬称の変更に追従）
            const cust = projectMaster.customerId
                ? customers.find((c) => c.id === projectMaster.customerId)
                : undefined;
            const project = {
                id: projectMaster.id,
                title: projectMaster.title,
                startDate: new Date(),
                category: 'construction' as const,
                color: '#3B82F6',
                customer: cust?.name || projectMaster.customerName || projectMaster.customerShortName || '',
                customerHonorific: cust?.honorific || '御中',
                location: projectMaster.location || '',
                createdAt: projectMaster.createdAt,
                updatedAt: projectMaster.updatedAt,
            } as unknown as Project;
            const { generateEstimatePDFBlobOnlyReact } = await import('@/utils/reactPdfGenerator');
            return generateEstimatePDFBlobOnlyReact(est, project, companyInfo, { includeDetails: true });
        },
        [companyInfo, projectMaster, customers],
    );

    if (!isOpen) return null;
    if (typeof document === 'undefined') return null;

    // 親（案件詳細モーダル z-[60]）のスタッキングコンテキストに閉じ込められないよう body 直下へ
    return createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            {/* PDF を大きく読ませたいので PC では画面幅の大部分を使う */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label="見積書"
                className="relative flex h-full w-full flex-1 flex-col bg-white lg:h-[92vh] lg:w-[92vw] lg:max-w-[1600px] lg:flex-none lg:rounded-lg lg:shadow-xl"
            >
                {/* ヘッダー */}
                <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 md:px-6">
                    <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold text-slate-900">見積書</h2>
                        {projectTitle && <p className="truncate text-xs text-slate-500">{projectTitle}</p>}
                    </div>
                    <button
                        onClick={onClose}
                        title="閉じる"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* 見積切替ピル（複数ある場合のみ） */}
                {estimates.length > 1 && (
                    <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-slate-200 p-2">
                        <span className="px-1 text-xs text-slate-500">見積:</span>
                        {estimates.map((e) => (
                            <button
                                key={e.id}
                                type="button"
                                onClick={() => setSelectedId(e.id)}
                                title={e.title || e.estimateNumber}
                                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                    selectedId === e.id
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >
                                {e.estimateNumber}
                                <span className={selectedId === e.id ? 'text-white/80' : 'text-slate-400'}>
                                    {` (${STATUS_LABEL[e.status] ?? e.status})`}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {estimates.length === 1 && (
                    <div className="flex-shrink-0 border-b border-slate-200 px-4 py-2 text-xs text-slate-500 md:px-6">
                        {estimates[0].estimateNumber}
                        {` / ${STATUS_LABEL[estimates[0].status] ?? estimates[0].status}`}
                        {estimates[0].title ? ` / ${estimates[0].title}` : ''}
                    </div>
                )}

                {/* 本文 */}
                <div className="min-h-0 flex-1 overflow-hidden bg-slate-100">
                    {loading ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <span className="text-sm">見積書を読み込んでいます...</span>
                        </div>
                    ) : errorMessage ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-500">
                            {errorMessage}
                        </div>
                    ) : estimates.length === 0 ? (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                            この案件の見積書はまだありません
                        </div>
                    ) : selectedEstimate && companyInfo && projectMaster ? (
                        <div className="h-full min-h-[50vh]">
                            <LivePdfPreview
                                // 見積が更新されたらプレビューも作り直す
                                seed={`${selectedEstimate.id}:${new Date(selectedEstimate.updatedAt).getTime()}`}
                                renderPdf={() => renderEstimatePdf(selectedEstimate)}
                                debounceMs={250}
                                initialDelayMs={0}
                            />
                        </div>
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <span className="text-sm">プレビューを準備しています...</span>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
