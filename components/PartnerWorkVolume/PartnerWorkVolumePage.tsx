'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { ChevronLeft, ChevronRight, Plus, FileDown, Loader2, Check, Lock, Users, Eye, EyeOff, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import Loading from '@/components/ui/Loading';
import { Button } from '@/components/ui/Button';
import type {
    PartnerWorkVolumeRow,
    PartnerWorkVolumeResponse,
    PartnerCompanyOption,
    PartnerWorkVolumeMonthStatus,
    PartnerTaxMode,
} from '@/types/partnerWorkVolume';
import type { ProjectMaster } from '@/types/calendar';
import type { ProjectMasterFormData } from '@/components/ProjectMasters/ProjectMasterForm';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useMasterData } from '@/hooks/useMasterData';
import { buildProjectMasterUpdatePayload } from '@/lib/projectMasterUpdate';
import { createAssignmentsFromWorkDates } from '@/lib/projectMasterCreate';
import PartnerWorkVolumeTable from './PartnerWorkVolumeTable';
import { exportPartnerWorkVolumePDF } from '@/utils/partnerWorkVolumePdf';

// 案件詳細モーダル（案件一覧・請求待ちボードと同じもの。現場名の詳細ボタンで開く）
const ProjectMasterDetailModal = dynamic(() => import('@/components/ProjectMaster/ProjectMasterDetailModal'), {
    ssr: false,
    loading: () => null,
});

const MANAGER_FILTER_ALL = '__all__';
const MANAGER_FILTER_BLANK = '__blank__';

function todayJstYm(): { year: number; month: number } {
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
    });
    const [y, m] = f.format(new Date()).split('-').map(Number);
    return { year: y, month: m };
}

function ymLabel(year: number, month: number): string {
    const reiwaY = year - 2018;
    return `令和${reiwaY}年 ${month}月`;
}

function rowKey(row: PartnerWorkVolumeRow): string {
    // 1 配置に対して作業費 / 運搬費の 2 行が並ぶため rowType もキーに含める
    if (row.id) return row.id;
    if (row.sourceAssignmentId) return `${row.sourceAssignmentId}:${row.rowType}`;
    return `manual:${row.date}:${row.projectTitle}:${row.sortOrder}`;
}

function rowMatches(a: PartnerWorkVolumeRow, b: PartnerWorkVolumeRow): boolean {
    return rowKey(a) === rowKey(b);
}

interface UserApiItem {
    id: string;
    displayName: string;
    role: string;
    isActive?: boolean;
}

export default function PartnerWorkVolumePage() {
    const { data: session } = useSession();
    const role = session?.user?.role ?? '';
    const userId = session?.user?.id ?? '';
    const isAdminOrManager = role === 'admin' || role === 'manager';
    const isPartner = role === 'partner';
    // 税理士(accountant)は全社の出来高を閲覧のみ（行編集・公開などの操作は不可）
    const isAccountant = role === 'accountant';
    const canViewAllCompanies = isAdminOrManager || isAccountant;
    // 案件詳細モーダルは社内情報（材料・チャット等）を含むため協力業者には出さない
    const canOpenProjectDetail = isAdminOrManager || isAccountant;

    const { updateProjectMaster } = useProjectMasters();
    // 案件詳細モーダルの編集モードは工事種別マスタを参照するためロードしておく
    useMasterData();

    const initial = todayJstYm();
    const [year, setYear] = useState<number>(initial.year);
    const [month, setMonth] = useState<number>(initial.month);
    const [companyId, setCompanyId] = useState<string>(() => {
        if (role === 'partner') return userId;
        return '';
    });
    const [companies, setCompanies] = useState<PartnerCompanyOption[]>([]);
    const [companyName, setCompanyName] = useState<string>('');
    const [taxMode, setTaxMode] = useState<PartnerTaxMode>('exclusive');
    const [rows, setRows] = useState<PartnerWorkVolumeRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [monthStatus, setMonthStatus] = useState<PartnerWorkVolumeMonthStatus>('draft');
    const [completedAt, setCompletedAt] = useState<string | null>(null);
    const [published, setPublished] = useState(false);
    const [publishedAt, setPublishedAt] = useState<string | null>(null);
    const [publishing, setPublishing] = useState(false);
    const [totalRows, setTotalRows] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const [managerFilter, setManagerFilter] = useState<string>(MANAGER_FILTER_ALL);
    const [showDeleted, setShowDeleted] = useState<boolean>(false);
    // 案件詳細モーダル（現場名の詳細ボタンで開く）
    const [detailPm, setDetailPm] = useState<ProjectMaster | null>(null);
    const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

    // admin / manager / accountant: 協力会社一覧を取得
    useEffect(() => {
        if (!canViewAllCompanies) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/users?role=partner', { cache: 'no-store' });
                if (!res.ok) throw new Error(`status ${res.status}`);
                const data = (await res.json()) as UserApiItem[];
                if (cancelled) return;
                const list = (Array.isArray(data) ? data : [])
                    .filter((u) => u.isActive !== false)
                    .map((u) => ({ id: u.id, displayName: u.displayName }));
                setCompanies(list);
                if (!companyId && list.length > 0) {
                    setCompanyId(list[0].id);
                }
            } catch (e) {
                logger.error('協力会社一覧取得失敗:', e);
                toast.error('協力会社一覧の取得に失敗しました');
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canViewAllCompanies]);

    const fetchRows = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                companyId,
                year: String(year),
                month: String(month),
            });
            if (showDeleted && isAdminOrManager) params.set('includeDeleted', '1');
            const res = await fetch(`/api/partner-work-volume?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = (await res.json()) as PartnerWorkVolumeResponse;
            setRows(data.rows);
            setCompanyName(data.partnerCompany.displayName);
            setTaxMode(data.partnerCompany.taxMode ?? 'exclusive');
            setMonthStatus(data.monthStatus ?? 'draft');
            setCompletedAt(data.completedAt ?? null);
            setPublished(data.published ?? false);
            setPublishedAt(data.publishedAt ?? null);
            setTotalRows(data.totalRows ?? data.rows.length);
            setCompletedCount(data.completedCount ?? 0);
        } catch (e) {
            logger.error('協力会社出来高取得失敗:', e);
            toast.error('出来高の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, [companyId, year, month, showDeleted, isAdminOrManager]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const goPrev = () => {
        if (month === 1) {
            setYear((y) => y - 1);
            setMonth(12);
        } else {
            setMonth((m) => m - 1);
        }
    };
    const goNext = () => {
        if (month === 12) {
            setYear((y) => y + 1);
            setMonth(1);
        } else {
            setMonth((m) => m + 1);
        }
    };

    const handleSave = useCallback(
        async (row: PartnerWorkVolumeRow, patch: Partial<PartnerWorkVolumeRow>) => {
            const key = rowKey(row);
            setSavingRowKey(key);
            try {
                const merged: PartnerWorkVolumeRow = { ...row, ...patch };
                // 金額セルが直接編集された場合だけ amountOverridden=true を立てる。
                // これにより GET 側で amount=0 でも案件マスタからの再算出をスキップする。
                const isAmountEdit = Object.prototype.hasOwnProperty.call(patch, 'amount');
                const body = {
                    id: merged.id,
                    partnerCompanyId: companyId,
                    date: merged.date,
                    customerName: merged.customerName,
                    projectMasterId: merged.projectMasterId,
                    projectTitle: merged.projectTitle,
                    managerName: merged.managerName,
                    constructionContent: merged.constructionContent,
                    amount: merged.amount,
                    sourceAssignmentId: merged.sourceAssignmentId,
                    rowType: merged.rowType,
                    isManual: merged.isManual,
                    sortOrder: merged.sortOrder,
                    notes: merged.notes,
                    ...(isAmountEdit ? { amountOverridden: true } : {}),
                };
                const res = await fetch('/api/partner-work-volume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error(`status ${res.status}`);
                const saved = await res.json();
                setRows((prev) =>
                    prev.map((r) =>
                        rowKey(r) === key
                            ? {
                                  ...merged,
                                  id: saved.id,
                                  sortOrder: saved.sortOrder ?? merged.sortOrder,
                                  isManual: saved.isManual ?? merged.isManual,
                              }
                            : r
                    )
                );
            } catch (e) {
                logger.error('出来高保存失敗:', e);
                toast.error('保存に失敗しました');
                fetchRows();
            } finally {
                setSavingRowKey(null);
            }
        },
        [companyId, fetchRows]
    );

    const handleDelete = useCallback(
        async (row: PartnerWorkVolumeRow) => {
            const isAutoRow = !!row.sourceAssignmentId;
            const confirmMsg = isAutoRow
                ? 'この行を削除します。以降この月で再表示されません（「削除済みを表示」から復元可能）。よろしいですか？'
                : 'この行を削除してよろしいですか？';
            if (!window.confirm(confirmMsg)) return;
            const key = rowKey(row);
            setSavingRowKey(key);
            try {
                if (row.id) {
                    // 保存済み行: 行種別に応じて API 側で soft / hard を分岐
                    const res = await fetch(`/api/partner-work-volume/${row.id}`, {
                        method: 'DELETE',
                    });
                    if (!res.ok) {
                        const text = await res.text().catch(() => '');
                        throw new Error(text || `status ${res.status}`);
                    }
                } else if (isAutoRow) {
                    // 未保存の auto 行: POST で tombstone を作成（deleted:true）
                    const body = {
                        partnerCompanyId: companyId,
                        date: row.date,
                        customerName: row.customerName,
                        projectMasterId: row.projectMasterId,
                        projectTitle: row.projectTitle,
                        managerName: row.managerName,
                        constructionContent: row.constructionContent,
                        amount: row.amount,
                        sourceAssignmentId: row.sourceAssignmentId,
                        rowType: row.rowType,
                        isManual: false,
                        sortOrder: row.sortOrder,
                        notes: row.notes,
                        deleted: true,
                    };
                    const res = await fetch('/api/partner-work-volume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                        const text = await res.text().catch(() => '');
                        throw new Error(text || `status ${res.status}`);
                    }
                } else {
                    // 未保存の手動行は理論上存在しないが、ガードとして何もしない
                    return;
                }
                toast.success('削除しました');
                fetchRows();
            } catch (e) {
                logger.error('出来高削除失敗:', e);
                const msg = e instanceof Error && e.message ? e.message : '削除に失敗しました';
                toast.error(msg);
            } finally {
                setSavingRowKey(null);
            }
        },
        [companyId, fetchRows]
    );

    const handleRestore = useCallback(
        async (row: PartnerWorkVolumeRow) => {
            if (!row.id) return;
            const key = rowKey(row);
            setSavingRowKey(key);
            try {
                const body = {
                    id: row.id,
                    partnerCompanyId: companyId,
                    date: row.date,
                    customerName: row.customerName,
                    projectMasterId: row.projectMasterId,
                    projectTitle: row.projectTitle,
                    managerName: row.managerName,
                    constructionContent: row.constructionContent,
                    amount: row.amount,
                    sourceAssignmentId: row.sourceAssignmentId,
                    rowType: row.rowType,
                    isManual: row.isManual,
                    sortOrder: row.sortOrder,
                    notes: row.notes,
                    deleted: false,
                };
                const res = await fetch('/api/partner-work-volume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error(`status ${res.status}`);
                toast.success('復元しました');
                fetchRows();
            } catch (e) {
                logger.error('出来高復元失敗:', e);
                toast.error('復元に失敗しました');
            } finally {
                setSavingRowKey(null);
            }
        },
        [companyId, fetchRows]
    );

    const createManualRow = useCallback(
        async (date: string, sortOrder: number) => {
            try {
                const res = await fetch('/api/partner-work-volume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        partnerCompanyId: companyId,
                        date,
                        projectTitle: '(新規)',
                        isManual: true,
                        sortOrder,
                    }),
                });
                if (!res.ok) throw new Error(`status ${res.status}`);
                toast.success('行を追加しました');
                fetchRows();
            } catch (e) {
                logger.error('行追加失敗:', e);
                toast.error('行の追加に失敗しました');
            }
        },
        [companyId, fetchRows]
    );

    const handleAddRow = useCallback(() => {
        if (!companyId) return;
        // 月の途中日を選択しやすいよう、初期日付は今月なら今日、それ以外は月初
        const today = todayJstYm();
        const dateStr =
            today.year === year && today.month === month
                ? new Intl.DateTimeFormat('en-CA', {
                      timeZone: 'Asia/Tokyo',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                  }).format(new Date())
                : `${year}-${String(month).padStart(2, '0')}-01`;
        // 最後尾に追加（同日の既存行より大きい sortOrder を採用）
        const sameDateRows = rows.filter((r) => r.date === dateStr);
        const maxSort = sameDateRows.reduce((m, r) => Math.max(m, r.sortOrder), 0);
        void createManualRow(dateStr, maxSort + 100);
    }, [companyId, year, month, rows, createManualRow]);

    const handleInsert = useCallback(
        (row: PartnerWorkVolumeRow, position: 'above' | 'below') => {
            if (!companyId) return;
            // 同じ日付内で row の上 / 下に挿入するための sortOrder を計算
            const sameDateRows = rows.filter((r) => r.date === row.date);
            const sorted = [...sameDateRows].sort((a, b) => a.sortOrder - b.sortOrder);
            const idx = sorted.findIndex((r) => rowMatches(r, row));
            if (idx === -1) {
                void createManualRow(row.date, row.sortOrder + (position === 'below' ? 100 : -100));
                return;
            }
            let newSort: number;
            if (position === 'above') {
                const prev = sorted[idx - 1];
                if (!prev) newSort = row.sortOrder - 100;
                else newSort = Math.floor((prev.sortOrder + row.sortOrder) / 2);
                // 同じ整数になってしまったら前を 100 下げる
                if (newSort === row.sortOrder || (prev && newSort === prev.sortOrder)) {
                    newSort = row.sortOrder - 100;
                }
            } else {
                const next = sorted[idx + 1];
                if (!next) newSort = row.sortOrder + 100;
                else newSort = Math.floor((row.sortOrder + next.sortOrder) / 2);
                if (newSort === row.sortOrder || (next && newSort === next.sortOrder)) {
                    newSort = row.sortOrder + 100;
                }
            }
            void createManualRow(row.date, newSort);
        },
        [companyId, rows, createManualRow]
    );

    const handleToggleStatus = useCallback(
        async (row: PartnerWorkVolumeRow) => {
            const key = rowKey(row);
            const nextStatus = row.status === 'completed' ? 'draft' : 'completed';
            setSavingRowKey(key);
            try {
                const body = {
                    id: row.id,
                    partnerCompanyId: companyId,
                    date: row.date,
                    customerName: row.customerName,
                    projectMasterId: row.projectMasterId,
                    projectTitle: row.projectTitle,
                    managerName: row.managerName,
                    constructionContent: row.constructionContent,
                    amount: row.amount,
                    sourceAssignmentId: row.sourceAssignmentId,
                    rowType: row.rowType,
                    isManual: row.isManual,
                    sortOrder: row.sortOrder,
                    notes: row.notes,
                    status: nextStatus,
                };
                const res = await fetch('/api/partner-work-volume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error(`status ${res.status}`);
                if (nextStatus === 'completed') {
                    toast.success('完了しました');
                }
                fetchRows();
            } catch (e) {
                logger.error('行ステータス更新失敗:', e);
                toast.error('更新に失敗しました');
            } finally {
                setSavingRowKey(null);
            }
        },
        [companyId, fetchRows]
    );

    // 月単位の協力業者への公開 / 公開解除。
    // 全行完了だけでは公開されず、このボタン操作で初めて協力業者から見えるようになる。
    const handlePublishToggle = useCallback(
        async (next: boolean) => {
            if (!companyId) return;
            const confirmMsg = next
                ? `${ymLabel(year, month)}分の出来高を協力業者（${companyName || 'この会社'}）に公開します。よろしいですか？`
                : `${ymLabel(year, month)}分の公開を解除します。協力業者からこの月の出来高が見えなくなります。よろしいですか？`;
            if (!window.confirm(confirmMsg)) return;
            setPublishing(true);
            try {
                const res = await fetch('/api/partner-work-volume/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ companyId, year, month, published: next }),
                });
                if (!res.ok) {
                    const data = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(data.error || `status ${res.status}`);
                }
                toast.success(next ? '協力業者に公開しました' : '公開を解除しました');
                fetchRows();
            } catch (e) {
                logger.error('出来高公開状態の更新失敗:', e);
                toast.error(e instanceof Error && e.message ? e.message : '公開状態の更新に失敗しました');
            } finally {
                setPublishing(false);
            }
        },
        [companyId, year, month, companyName, fetchRows]
    );

    const handleExportPdf = useCallback(async () => {
        // PDF 出力からは削除済み行を除外
        const exportRows = rows.filter((r) => !r.deletedAt);
        if (exportRows.length === 0) {
            toast.error('出力する出来高がありません');
            return;
        }
        setExporting(true);
        try {
            await exportPartnerWorkVolumePDF({
                partnerCompanyName: companyName || '(協力会社)',
                year,
                month,
                taxMode,
                rows: exportRows.map((r) => ({
                    date: r.date,
                    customerName: r.customerName,
                    projectTitle: r.projectTitle,
                    managerName: r.managerName,
                    constructionContent: r.constructionContent,
                    amount: r.amount,
                    notes: r.notes,
                })),
            });
        } catch (e) {
            logger.error('PDF出力失敗:', e);
            toast.error('PDF出力に失敗しました');
        } finally {
            setExporting(false);
        }
    }, [rows, companyName, year, month, taxMode]);

    // ── 案件詳細モーダル（現場名の詳細ボタン）────────────────────
    const handleOpenProjectDetail = useCallback(async (projectMasterId: string) => {
        setDetailLoadingId(projectMasterId);
        try {
            const res = await fetch(`/api/project-masters/${projectMasterId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('案件情報の取得に失敗しました');
            const pm: ProjectMaster = await res.json();
            setDetailPm(pm);
        } catch (e) {
            logger.error('案件詳細の取得失敗:', e);
            toast.error(e instanceof Error ? e.message : '案件情報の取得に失敗しました');
        } finally {
            setDetailLoadingId(null);
        }
    }, []);

    // 案件詳細モーダルからの保存（案件一覧と同じ変換ロジック＋作業日程からの配置生成）
    const handleDetailUpdate = useCallback(
        async (id: string, data: ProjectMasterFormData) => {
            const updated = await updateProjectMaster(id, buildProjectMasterUpdatePayload(data));
            await createAssignmentsFromWorkDates(id, data.workDates);
            if (updated) setDetailPm(updated);
            await fetchRows();
        },
        [updateProjectMaster, fetchRows]
    );

    const monthLabel = useMemo(() => ymLabel(year, month), [year, month]);

    // 担当者フィルタ: 表の行から抽出。'__blank__' = 担当者未設定の行
    const managerOptions = useMemo(() => {
        const set = new Set<string>();
        let hasBlank = false;
        for (const r of rows) {
            const name = r.managerName?.trim();
            if (name) {
                // 「、」区切りで複数いる場合は各々を選択肢に
                for (const n of name.split(/[、,]/).map((x) => x.trim()).filter(Boolean)) {
                    set.add(n);
                }
            } else {
                hasBlank = true;
            }
        }
        return { names: Array.from(set).sort((a, b) => a.localeCompare(b, 'ja')), hasBlank };
    }, [rows]);

    const displayedRows = useMemo(() => {
        if (managerFilter === MANAGER_FILTER_ALL) return rows;
        if (managerFilter === MANAGER_FILTER_BLANK) {
            return rows.filter((r) => !r.managerName || r.managerName.trim() === '');
        }
        return rows.filter((r) => {
            if (!r.managerName) return false;
            const names = r.managerName.split(/[、,]/).map((x) => x.trim());
            return names.includes(managerFilter);
        });
    }, [rows, managerFilter]);

    if (!isAdminOrManager && !isPartner && !isAccountant) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">閲覧権限がありません</p>
            </div>
        );
    }

    if (isPartner && !companyId) {
        return (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                <p className="text-slate-500">所属会社が設定されていません。管理者にお問い合わせください。</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 max-w-[1800px] w-full mx-auto h-full min-h-0">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h1 className="text-xl font-bold text-slate-900">
                    {isPartner ? '出来高表' : '協力業者出来高'}
                </h1>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex items-center bg-white rounded-xl border border-slate-200 shadow-sm">
                        <button
                            type="button"
                            onClick={goPrev}
                            className="px-2 py-2 text-slate-600 hover:bg-slate-50 rounded-l-xl"
                            aria-label="前の月"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-3 py-2 text-sm font-semibold text-slate-700 tabular-nums min-w-[120px] text-center">
                            {monthLabel}
                        </span>
                        <button
                            type="button"
                            onClick={goNext}
                            className="px-2 py-2 text-slate-600 hover:bg-slate-50 rounded-r-xl"
                            aria-label="次の月"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                    {canViewAllCompanies && (
                        <select
                            value={companyId}
                            onChange={(e) => setCompanyId(e.target.value)}
                            className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white shadow-sm focus:ring-2 focus:ring-slate-500"
                        >
                            <option value="">協力会社を選択</option>
                            {companies.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.displayName}
                                </option>
                            ))}
                        </select>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        leftIcon={exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                        onClick={handleExportPdf}
                        disabled={exporting || rows.length === 0}
                    >
                        PDF出力
                    </Button>
                    {isAdminOrManager && (
                        <Button
                            variant="gradient"
                            size="sm"
                            leftIcon={<Plus className="w-4 h-4" />}
                            onClick={handleAddRow}
                            disabled={!companyId}
                        >
                            行追加
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                    {companyName && (
                        <div className="text-sm text-slate-600 inline-flex items-center gap-2">
                            <span>対象: <span className="font-semibold text-slate-800">{companyName}</span></span>
                            <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    taxMode === 'inclusive'
                                        ? 'bg-indigo-100 text-indigo-700'
                                        : 'bg-slate-100 text-slate-600'
                                }`}
                                title={taxMode === 'inclusive' ? '出来高を税込で表示する協力会社' : '出来高を税別で表示する協力会社'}
                            >
                                {taxMode === 'inclusive' ? '税込' : '税別'}
                            </span>
                        </div>
                    )}
                    {isAdminOrManager && companyId && rows.length > 0 && (
                        <div className="inline-flex items-center gap-1.5">
                            <Users className="w-4 h-4 text-slate-400" />
                            <select
                                value={managerFilter}
                                onChange={(e) => setManagerFilter(e.target.value)}
                                className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white shadow-sm focus:ring-2 focus:ring-slate-500"
                            >
                                <option value={MANAGER_FILTER_ALL}>担当者: すべて</option>
                                {managerOptions.names.map((n) => (
                                    <option key={n} value={n}>担当者: {n}</option>
                                ))}
                                {managerOptions.hasBlank && (
                                    <option value={MANAGER_FILTER_BLANK}>担当者: (未設定)</option>
                                )}
                            </select>
                        </div>
                    )}
                    {isAdminOrManager && companyId && (
                        <button
                            type="button"
                            onClick={() => setShowDeleted((v) => !v)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm shadow-sm transition ${
                                showDeleted
                                    ? 'bg-slate-700 text-white border-slate-700 hover:bg-slate-800'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                            title={showDeleted ? '削除済みを非表示にする' : '削除済みを表示する'}
                        >
                            {showDeleted ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                            削除済み{showDeleted ? '表示中' : 'を表示'}
                        </button>
                    )}
                </div>
                {isAdminOrManager && companyId && (
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                        {monthStatus === 'completed' && published ? (
                            <>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                                    <Check className="w-3 h-3" />
                                    協力業者に公開中
                                    {publishedAt && (
                                        <span className="text-emerald-600/70">
                                            {new Date(publishedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
                                        </span>
                                    )}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePublishToggle(false)}
                                    disabled={publishing}
                                >
                                    公開解除
                                </Button>
                            </>
                        ) : monthStatus === 'completed' ? (
                            <>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 font-medium">
                                    <Check className="w-3 h-3" />
                                    全行完了・未公開
                                    {completedAt && (
                                        <span className="text-sky-600/70">
                                            {new Date(completedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
                                        </span>
                                    )}
                                </span>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    leftIcon={<Send className="w-3.5 h-3.5" />}
                                    onClick={() => handlePublishToggle(true)}
                                    isLoading={publishing}
                                >
                                    協力業者へ公開
                                </Button>
                            </>
                        ) : (
                            <>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                                    <Lock className="w-3 h-3" />
                                    未完了 {totalRows > 0 && `(${completedCount}/${totalRows})`} ・ 協力業者には非表示
                                </span>
                                {published && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 font-medium">
                                        公開設定済み・全行完了で再公開されます
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
                {!companyId ? (
                    <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                        <p className="text-slate-500">協力会社を選択してください</p>
                    </div>
                ) : isPartner && !(monthStatus === 'completed' && published) ? (
                    loading && rows.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <Loading text="出来高を読み込み中..." />
                        </div>
                    ) : (
                        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
                            <Lock className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500 font-medium">この月の出来高はまだ公開されていません</p>
                            <p className="text-slate-400 text-sm mt-1">管理者が公開すると閲覧できます</p>
                        </div>
                    )
                ) : loading && rows.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <Loading text="出来高を読み込み中..." />
                    </div>
                ) : (
                    <div className="relative">
                        {loading && (
                            <div className="sticky top-2 z-20 flex justify-center pointer-events-none">
                                <div className="inline-flex items-center gap-1.5 bg-white/95 border border-slate-200 rounded-full shadow px-3 py-1 text-xs text-slate-600">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    更新中...
                                </div>
                            </div>
                        )}
                        <PartnerWorkVolumeTable
                            rows={displayedRows}
                            readOnly={isPartner || isAccountant}
                            savingRowKey={savingRowKey}
                            taxMode={taxMode}
                            onSave={handleSave}
                            onDelete={handleDelete}
                            onRestore={handleRestore}
                            onInsert={handleInsert}
                            onToggleStatus={handleToggleStatus}
                            onOpenProjectDetail={canOpenProjectDetail ? handleOpenProjectDetail : undefined}
                            detailLoadingId={detailLoadingId}
                        />
                    </div>
                )}
            </div>

            {/* 案件詳細（案件一覧と同じモーダル）。税理士は閲覧のみ。 */}
            {detailPm && (
                <ProjectMasterDetailModal
                    pm={detailPm}
                    onClose={() => setDetailPm(null)}
                    onUpdate={handleDetailUpdate}
                    readOnly={!isAdminOrManager}
                />
            )}
        </div>
    );
}
