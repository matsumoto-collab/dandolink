'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { useSession } from 'next-auth/react';
import { Plus, FileText, ChevronDown, ChevronRight, Copy, Trash2, Printer, Search, X, Zap, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import StatusBadge from './ui/StatusBadge';
import type { MaterialCategoryWithItems, MaterialItemWithStock, MaterialRequisition } from '@/types/material';
import {
    SHEET_TYPES,
    SHEET_SIZES,
    parseRequisitionNotes,
    serializeRequisitionNotes,
    type SheetType,
    type SheetSize,
    type SheetEntry,
    type FreeFormEntry,
    type RequisitionNotes,
} from '@/lib/materials/catalog';

// 日付フォーマット
function formatDate(d: string | Date) {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}
// JST基準で日付キー（YYYY-MM-DD）を返す
function jstDateKey(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
// JSTで「今日」「明日」「明後日」などのオフセット日付キーを返す
function jstDateKeyWithOffset(offsetDays: number): string {
    const now = new Date();
    // JST 0時を基準に加算（タイムゾーンずれ防止）
    const baseKey = jstDateKey(now);
    const base = new Date(`${baseKey}T00:00:00+09:00`);
    const target = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    return jstDateKey(target);
}
// 初期日付は「明日」(JST)
function defaultFormDate(): string {
    return jstDateKeyWithOffset(1);
}

// vehicleInfo は JSON ({vehicles:[...]}) 形式。一覧表示用に人間可読へ整形
function formatVehicleInfo(raw: string | null | undefined): string {
    if (!raw) return '';
    try {
        const obj = JSON.parse(raw);
        if (obj && Array.isArray(obj.vehicles)) {
            return obj.vehicles.filter((v: unknown) => !!v).join(' / ');
        }
    } catch {
        return raw; // 旧プレーン文字列
    }
    return raw;
}

export default function MaterialRequisitionPage() {
    const { categories, fetchCategories, isCategoriesInitialized, fetchRequisitions, requisitions, isRequisitionsLoading, createRequisition, updateRequisition, deleteRequisition } = useMaterialData();
    const { data: session } = useSession();

    const [view, setView] = useState<'list' | 'create'>('list');
    const [projectMasters, setProjectMasters] = useState<Array<{ id: string; title: string; name: string | null; customerName?: string | null; customerShortName?: string | null }>>([]);
    const [foremen, setForemen] = useState<Array<{ id: string; displayName: string }>>([]);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkPrinting, setIsBulkPrinting] = useState(false);

    // Form state
    const [formProjectId, setFormProjectId] = useState('');
    const [formDate, setFormDate] = useState(defaultFormDate());
    const [formForemanId, setFormForemanId] = useState('');
    const [formForemanName, setFormForemanName] = useState('');
    // 車両3欄 (旧 formVehicleInfo (単一文字列) は廃止し、JSON 化して保存)
    const [formVehicles, setFormVehicles] = useState<[string, string, string]>(['', '', '']);
    // notes は構造化 JSON（memo / sheets / freeForm）で保存。旧プレーン notes は memo として読む
    const [formMemo, setFormMemo] = useState('');
    // 選択中のシート種類（複数選択）
    const [formSheetTypes, setFormSheetTypes] = useState<Set<SheetType>>(new Set());
    // シート数量: type -> size -> [車両0,1,2]
    const [formSheetQty, setFormSheetQty] = useState<Record<string, Partial<Record<SheetSize, [number, number, number]>>>>({});
    // 汎用「その他自由欄」
    const [formFreeForm, setFormFreeForm] = useState<FreeFormEntry[]>([]);
    // 数量は materialItemId → [車両0, 車両1, 車両2] の3要素タプル
    const [formQuantities, setFormQuantities] = useState<Record<string, [number, number, number]>>({});
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [isSaving, setIsSaving] = useState(false);
    // この現場の標準セット（ProjectMaterialItem）をワンタップ反映
    const [isLoadingStandardSet, setIsLoadingStandardSet] = useState(false);

    // B2: 自分に割当てがある案件のみ
    const [myAssignedProjects, setMyAssignedProjects] = useState<Array<{ id: string; title: string; name: string | null }>>([]);
    const [isLoadingMyAssignments, setIsLoadingMyAssignments] = useState(false);
    // B2 フォールバック: admin/manager 用に全案件モード
    const [showAllProjects, setShowAllProjects] = useState(false);

    const sessionRole = session?.user?.role;
    const sessionUserId = session?.user?.id;
    const isAdminOrManager = sessionRole === 'admin' || sessionRole === 'manager';
    // worker / partner_member は /api/dispatch/foremen に含まれないため、
    // 自分を強制マージしつつ職長セレクトは「（自分）」固定（disabled）にする
    const isForemanSelectLocked = sessionRole === 'worker' || sessionRole === 'partner_member';

    // A2: 横断検索
    const [searchQuery, setSearchQuery] = useState('');

    // A6: 自動下書き保存
    const [autoSavedId, setAutoSavedId] = useState<string | null>(null);
    const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [autoSavedAt, setAutoSavedAt] = useState<Date | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipAutoSaveRef = useRef(false);
    const autoSaveDisabledRef = useRef(false);

    // Load data
    useEffect(() => {
        if (!isCategoriesInitialized) fetchCategories();
        fetchRequisitions({ type: '出庫' });
        // Fetch project masters and foremen
        fetch('/api/project-masters?status=active', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : [])
            .then(data => setProjectMasters(Array.isArray(data) ? data : data.projectMasters || []));
        fetch('/api/dispatch/foremen', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : [])
            .then(data => setForemen(Array.isArray(data) ? data : []));
    }, []);

    // B1: ログインユーザーを foremen に強制追加し、自分を最上位に並べる
    const orderedForemen = React.useMemo(() => {
        if (!sessionUserId) return foremen;
        const selfDisplay = session?.user?.name || '自分';
        const others = foremen.filter(f => f.id !== sessionUserId);
        const selfFromList = foremen.find(f => f.id === sessionUserId);
        const self = selfFromList || { id: sessionUserId, displayName: selfDisplay };
        return [self, ...others];
    }, [foremen, sessionUserId, session?.user?.name]);

    // B1: ログインユーザーを自動セット
    useEffect(() => {
        if (sessionUserId && !formForemanId) {
            const self = orderedForemen.find(f => f.id === sessionUserId);
            if (self) {
                setFormForemanId(self.id);
                setFormForemanName(self.displayName);
            }
        }
    }, [sessionUserId, orderedForemen, formForemanId]);

    // B2/B4: 日付・職長変更時に「自分に割当てがある案件」を再フェッチ
    useEffect(() => {
        if (!formForemanId || !formDate) {
            setMyAssignedProjects([]);
            return;
        }
        let cancelled = false;
        setIsLoadingMyAssignments(true);
        const params = new URLSearchParams({
            foremanId: formForemanId,
            date: formDate,
            rangeDays: '3',
        });
        fetch(`/api/materials/my-assignments?${params.toString()}`, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : []))
            .then((data: Array<{ id: string; title: string; name: string | null }>) => {
                if (cancelled) return;
                setMyAssignedProjects(Array.isArray(data) ? data : []);
            })
            .catch(() => {
                if (!cancelled) setMyAssignedProjects([]);
            })
            .finally(() => {
                if (!cancelled) setIsLoadingMyAssignments(false);
            });
        return () => { cancelled = true; };
    }, [formForemanId, formDate]);

    // 表示する案件リスト（B2のフィルタ + フォールバック）
    const projectsForSelect = React.useMemo<Array<{ id: string; title: string; name: string | null }>>(() => {
        if (showAllProjects && isAdminOrManager) return projectMasters;
        return myAssignedProjects;
    }, [showAllProjects, isAdminOrManager, projectMasters, myAssignedProjects]);

    // 案件リストが変わって現在選択中の案件が含まれなくなったらクリア
    useEffect(() => {
        if (!formProjectId) return;
        if (!projectsForSelect.some(p => p.id === formProjectId)) {
            setFormProjectId('');
        }
    }, [projectsForSelect, formProjectId]);

    const toggleCategory = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const expandAll = useCallback(() => {
        setExpandedCategories(new Set(categories.map(c => c.id)));
    }, [categories]);

    // 車両3列のいずれかに数量があるかの判定
    const hasAnyQty = (q?: [number, number, number]) => !!q && (q[0] > 0 || q[1] > 0 || q[2] > 0);

    const setQuantity = (itemId: string, vehicleIndex: 0 | 1 | 2, value: number) => {
        setFormQuantities(prev => {
            const current = prev[itemId] || [0, 0, 0];
            const nextTuple: [number, number, number] = [current[0], current[1], current[2]];
            nextTuple[vehicleIndex] = Math.max(0, value);
            if (!hasAnyQty(nextTuple)) {
                const { [itemId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: nextTuple };
        });
    };

    const resetForm = () => {
        setFormProjectId('');
        setFormDate(defaultFormDate());
        setFormVehicles(['', '', '']);
        setFormMemo('');
        setFormSheetTypes(new Set());
        setFormSheetQty({});
        setFormFreeForm([]);
        setFormQuantities({});
        setSearchQuery('');
        setAutoSavedId(null);
        setAutoSaveStatus('idle');
        setAutoSavedAt(null);
        setAutoSaveErrorReason('');
        autoSaveDisabledRef.current = false;
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
    };

    // A6: 自動下書き保存
    const formatSavedTime = (d: Date) => {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    };
    const [autoSaveErrorReason, setAutoSaveErrorReason] = useState<string>('');

    // 30秒間入力操作がなければ下書きを自動保存する。
    // formQuantities (タプル) → API送信用フラット配列に変換
    // 各 material × 車両(0/1/2) で数量>0 のものを別行として送る
    const flattenQuantitiesForApi = useCallback(() => {
        const result: Array<{ materialItemId: string; quantity: number; vehicleLabel: string }> = [];
        for (const [materialItemId, qtys] of Object.entries(formQuantities)) {
            qtys.forEach((qty, idx) => {
                if (qty > 0) {
                    result.push({ materialItemId, quantity: qty, vehicleLabel: String(idx) });
                }
            });
        }
        return result;
    }, [formQuantities]);

    // vehicleInfo は JSON ({vehicles: [...]}) 形式で保存
    const buildVehicleInfoJson = useCallback(() => {
        if (formVehicles.every(v => !v)) return null;
        return JSON.stringify({ vehicles: formVehicles });
    }, [formVehicles]);

    // notes は構造化 JSON（memo / sheets / freeForm）で保存。
    // 空（memo無し・シート無し・自由欄無し）なら null（旧来の notes 無しと同じ扱い）
    const buildNotesJson = useCallback((): string | null => {
        const sheets: SheetEntry[] = Array.from(formSheetTypes).map((type) => ({
            type,
            sizes: formSheetQty[type] || {},
        }));
        const payload: RequisitionNotes = {
            v: 1,
            memo: formMemo,
            sheets,
            freeForm: formFreeForm,
        };
        return serializeRequisitionNotes(payload);
    }, [formMemo, formSheetTypes, formSheetQty, formFreeForm]);

    // シート種類のトグル（選択解除時はその種類の数量も破棄）
    const toggleSheetType = useCallback((type: SheetType) => {
        setFormSheetTypes(prev => {
            const next = new Set(prev);
            if (next.has(type)) {
                next.delete(type);
                setFormSheetQty(q => {
                    const { [type]: _drop, ...rest } = q;
                    return rest;
                });
            } else {
                next.add(type);
            }
            return next;
        });
    }, []);

    // シート数量セット（type × size × 車両）
    const setSheetQty = useCallback((type: SheetType, size: SheetSize, vehicleIndex: 0 | 1 | 2, value: number) => {
        setFormSheetQty(prev => {
            const forType = { ...(prev[type] || {}) };
            const tuple: [number, number, number] = [...(forType[size] || [0, 0, 0])] as [number, number, number];
            tuple[vehicleIndex] = Math.max(0, value);
            if (tuple[0] === 0 && tuple[1] === 0 && tuple[2] === 0) {
                delete forType[size];
            } else {
                forType[size] = tuple;
            }
            return { ...prev, [type]: forType };
        });
    }, []);

    // 自由欄行の更新
    const setFreeFormCell = useCallback((idx: number, field: 'label' | 0 | 1 | 2, value: string) => {
        setFormFreeForm(prev => {
            const next = prev.map((row, i) => {
                if (i !== idx) return row;
                if (field === 'label') return { ...row, label: value };
                const qty: [string, string, string] = [row.qty[0], row.qty[1], row.qty[2]];
                qty[field] = value;
                return { ...row, qty };
            });
            return next;
        });
    }, []);

    const addFreeFormRow = useCallback(() => {
        setFormFreeForm(prev => [...prev, { label: '', qty: ['', '', ''] }]);
    }, []);

    const removeFreeFormRow = useCallback((idx: number) => {
        setFormFreeForm(prev => prev.filter((_, i) => i !== idx));
    }, []);

    // formQuantities をdepsに含めることで、数量変更ごとにタイマーがリセットされ debounce として機能する。
    useEffect(() => {
        // create view 以外、または手動操作後はスキップ
        if (view !== 'create') return;
        if (skipAutoSaveRef.current) {
            skipAutoSaveRef.current = false;
            return;
        }
        if (autoSaveDisabledRef.current) return;

        // 条件: projectMasterId と foremanId 両方セット、品目1つ以上
        if (!formProjectId || !formForemanId) return;
        const items = flattenQuantitiesForApi();
        if (items.length === 0) return;
        const vehicleInfoStr = buildVehicleInfoJson();
        const notesStr = buildNotesJson();

        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

        autoSaveTimerRef.current = setTimeout(async () => {
            try {
                setAutoSaveStatus('saving');
                if (!autoSavedId) {
                    const created = await createRequisition({
                        projectMasterId: formProjectId,
                        date: formDate,
                        foremanId: formForemanId,
                        foremanName: formForemanName,
                        type: '出庫',
                        status: 'draft',
                        vehicleInfo: vehicleInfoStr || undefined,
                        notes: notesStr || undefined,
                        items,
                    });
                    if (created?.id) {
                        setAutoSavedId(created.id);
                        setAutoSavedAt(new Date());
                        setAutoSaveStatus('saved');
                        setAutoSaveErrorReason('');
                    } else {
                        setAutoSaveStatus('error');
                        setAutoSaveErrorReason('保存に失敗しました（再開には再読み込み）');
                        autoSaveDisabledRef.current = true;
                    }
                } else {
                    await updateRequisition(autoSavedId, {
                        status: 'draft',
                        vehicleInfo: vehicleInfoStr,
                        notes: notesStr,
                        items,
                    });
                    setAutoSavedAt(new Date());
                    setAutoSaveStatus('saved');
                    setAutoSaveErrorReason('');
                }
            } catch (e) {
                setAutoSaveStatus('error');
                // 権限エラー等の継続失敗を避けるため以降は停止
                autoSaveDisabledRef.current = true;
                const err = e as Error & { status?: number };
                if (err?.status === 403) {
                    setAutoSaveErrorReason('権限不足で自動保存停止');
                    toast.error('権限不足のため自動保存を停止しました');
                } else {
                    setAutoSaveErrorReason('保存に失敗しました（再開には再読み込み）');
                    toast.error(err?.message || '自動保存に失敗しました');
                }
            }
        }, 30000);

        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, formProjectId, formDate, formForemanId, formVehicles, formMemo, formSheetTypes, formSheetQty, formFreeForm, formQuantities]);

    const handleSubmit = async (status: 'draft' | 'confirmed') => {
        if (!formProjectId) { toast.error('現場を選択してください'); return; }
        if (!formForemanId) { toast.error('職長を選択してください'); return; }

        const items = flattenQuantitiesForApi();
        if (items.length === 0) { toast.error('材料を1つ以上入力してください'); return; }
        const vehicleInfoStr = buildVehicleInfoJson();
        const notesStr = buildNotesJson();

        // A6: 手動保存時は自動保存タイマーをクリア
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        autoSaveDisabledRef.current = true;

        setIsSaving(true);
        try {
            // 自動保存済みの伝票がある場合は更新、無ければ新規作成
            if (autoSavedId) {
                await updateRequisition(autoSavedId, {
                    status,
                    vehicleInfo: vehicleInfoStr,
                    notes: notesStr,
                    items,
                });
            } else {
                await createRequisition({
                    projectMasterId: formProjectId,
                    date: formDate,
                    foremanId: formForemanId,
                    foremanName: formForemanName,
                    type: '出庫',
                    status,
                    vehicleInfo: vehicleInfoStr || undefined,
                    notes: notesStr || undefined,
                    items,
                });
            }
            toast.success(status === 'draft' ? '下書きを保存しました' : '伝票を確定しました');
            resetForm();
            setView('list');
            fetchRequisitions({ type: '出庫' });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
            autoSaveDisabledRef.current = false;
        } finally {
            setIsSaving(false);
        }
    };

    const handleCopyRequisition = useCallback(async (req: MaterialRequisition) => {
        // Copy quantities from existing requisition into tuple format
        // 既存データの vehicleLabel が '0'/'1'/'2' なら該当列、それ以外(null/レガシー)は車両0列に入れる
        const quantities: Record<string, [number, number, number]> = {};
        req.items?.forEach(item => {
            if (item.quantity > 0) {
                let idx: 0 | 1 | 2 = 0;
                if (item.vehicleLabel === '1') idx = 1;
                else if (item.vehicleLabel === '2') idx = 2;
                const tuple = quantities[item.materialItemId] || [0, 0, 0];
                tuple[idx] += item.quantity;
                quantities[item.materialItemId] = tuple;
            }
        });
        // 自動保存関連 state を新規作成扱いにリセット
        setAutoSavedId(null);
        setAutoSaveStatus('idle');
        setAutoSavedAt(null);
        setAutoSaveErrorReason('');
        autoSaveDisabledRef.current = false;
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        setFormQuantities(quantities);
        setFormProjectId(req.projectMasterId);
        const srcDate = req.date ? new Date(req.date) : null;
        const initialDate = srcDate && !Number.isNaN(srcDate.getTime())
            ? jstDateKey(srcDate)
            : defaultFormDate();
        setFormDate(initialDate);
        // vehicleInfo を JSON でパース、失敗したら 1列目に文字列
        let parsedVehicles: [string, string, string] = ['', '', ''];
        if (req.vehicleInfo) {
            try {
                const obj = JSON.parse(req.vehicleInfo);
                if (obj && Array.isArray(obj.vehicles)) {
                    parsedVehicles = [
                        String(obj.vehicles[0] ?? ''),
                        String(obj.vehicles[1] ?? ''),
                        String(obj.vehicles[2] ?? ''),
                    ];
                } else {
                    parsedVehicles = [req.vehicleInfo, '', ''];
                }
            } catch {
                parsedVehicles = [req.vehicleInfo, '', ''];
            }
        }
        setFormVehicles(parsedVehicles);
        // notes-JSON（シート / 自由欄）をコピー。memo はコピーしない（旧挙動踏襲）
        const parsedNotes = parseRequisitionNotes(req.notes);
        const copiedTypes = new Set<SheetType>();
        const copiedSheetQty: Record<string, Partial<Record<SheetSize, [number, number, number]>>> = {};
        for (const s of parsedNotes.sheets) {
            copiedTypes.add(s.type);
            copiedSheetQty[s.type] = { ...s.sizes };
        }
        setFormSheetTypes(copiedTypes);
        setFormSheetQty(copiedSheetQty);
        setFormFreeForm(parsedNotes.freeForm.map(f => ({ label: f.label, qty: [...f.qty] as [string, string, string] })));
        setFormMemo('');
        setSearchQuery('');
        expandAll();
        setView('create');
        toast.success('前回の伝票をコピーしました');
    }, [expandAll]);

    const handleStatusChange = async (id: string, newStatus: string) => {
        try {
            await updateRequisition(id, { status: newStatus });
            toast.success('ステータスを更新しました');
            fetchRequisitions({ type: '出庫' });
        } catch {
            toast.error('更新に失敗しました');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteRequisition(id);
            setDeleteConfirm(null);
            toast.success('削除しました');
        } catch {
            toast.error('削除に失敗しました');
        }
    };

    const handlePrintOne = (id: string) => {
        // 認証が必要なAPIなのでクッキーが付くよう同一オリジンで window.open する
        window.open(`/api/materials/requisitions/${id}/print`, '_blank', 'noopener,noreferrer');
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds(prev => {
            if (prev.size === requisitions.length && requisitions.length > 0) {
                return new Set();
            }
            return new Set(requisitions.map(r => r.id));
        });
    };

    const handleBulkPrint = async () => {
        if (selectedIds.size === 0) {
            toast.error('印刷する伝票を選択してください');
            return;
        }
        setIsBulkPrinting(true);
        try {
            const ids = Array.from(selectedIds);
            const res = await fetch('/api/materials/requisitions/print/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
                cache: 'no-store',
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'PDF生成に失敗しました');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener,noreferrer');
            // メモリ解放（少し遅らせる）
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'PDF生成に失敗しました');
        } finally {
            setIsBulkPrinting(false);
        }
    };

    const filledCount = Object.keys(formQuantities).length;
    const allSelected = requisitions.length > 0 && selectedIds.size === requisitions.length;

    // A2: 横断検索
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const searchResults = useMemo(() => {
        if (!trimmedQuery) return [];
        const rows: Array<{ categoryName: string; item: MaterialItemWithStock }> = [];
        for (const cat of categories) {
            if (!cat.items) continue;
            for (const item of cat.items) {
                const name = (item.name || '').toLowerCase();
                const spec = (item.spec || '').toLowerCase();
                if (name.includes(trimmedQuery) || spec.includes(trimmedQuery)) {
                    rows.push({ categoryName: cat.name, item });
                }
            }
        }
        return rows;
    }, [categories, trimmedQuery]);

    // A3: 入力済みサマリ
    const filledRows = useMemo(() => {
        if (filledCount === 0) return [];
        const rows: Array<{ categoryName: string; item: MaterialItemWithStock }> = [];
        for (const cat of categories) {
            if (!cat.items) continue;
            for (const item of cat.items) {
                if (hasAnyQty(formQuantities[item.id])) {
                    rows.push({ categoryName: cat.name, item });
                }
            }
        }
        return rows;
    }, [categories, formQuantities, filledCount]);

    // この現場の標準セット（案件×品目の required 数量）を車両1へ加算反映
    const applyStandardSet = useCallback(async () => {
        if (!formProjectId) { toast.error('先に現場を選択してください'); return; }
        setIsLoadingStandardSet(true);
        try {
            const res = await fetch(`/api/project-masters/${formProjectId}/materials`, { cache: 'no-store' });
            if (!res.ok) throw new Error();
            const items: Array<{ materialItemId: string; requiredQuantity: number }> = await res.json();
            const valid = items.filter(i => i.requiredQuantity > 0);
            if (valid.length === 0) {
                toast('この現場の標準セットは未登録です');
                return;
            }
            setFormQuantities(prev => {
                const next = { ...prev };
                for (const it of valid) {
                    const cur = next[it.materialItemId] || [0, 0, 0];
                    next[it.materialItemId] = [cur[0] + it.requiredQuantity, cur[1], cur[2]];
                }
                return next;
            });
            expandAll();
            toast.success(`標準セット ${valid.length}品目を追加しました`);
        } catch {
            toast.error('標準セットの取得に失敗しました');
        } finally {
            setIsLoadingStandardSet(false);
        }
    }, [formProjectId, expandAll]);

    // 出し過ぎ警告: 入力数量が倉庫在庫を超える非除外品目（出庫後残がマイナス）
    const overIssueItems = useMemo(() => {
        const list: Array<{ id: string; name: string; spec: string | null; over: number }> = [];
        for (const cat of categories) {
            for (const item of cat.items || []) {
                if (item.excludeFromStockDecrement) continue;
                const tuple = formQuantities[item.id];
                if (!tuple) continue;
                const used = tuple[0] + tuple[1] + tuple[2];
                if (used <= 0) continue;
                const residual = (item.stockQuantity ?? 0) - used;
                if (residual < 0) list.push({ id: item.id, name: item.name, spec: item.spec, over: -residual });
            }
        }
        return list;
    }, [categories, formQuantities]);

    // lg+ 左右分割レイアウト
    const isLgScreen = useMediaQuery('(min-width: 1024px)');

    // categoryName + itemName → MaterialItem.id の高速マップ
    const itemByKey = useMemo(() => {
        const map = new Map<string, string>();
        for (const cat of categories) {
            for (const item of cat.items || []) {
                map.set(`${cat.name}|${item.name}`, item.id);
            }
        }
        return map;
    }, [categories]);

    // PDF プレビュー用: セルキー → 数量を引く関数 (車両0/1/2 ぶん振り分け)
    const slipGetQty = useCallback((categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2): number => {
        const itemId = itemByKey.get(`${categoryName}|${itemName}`);
        if (!itemId) return 0;
        const tuple = formQuantities[itemId];
        if (!tuple) return 0;
        return tuple[vehicleIndex] || 0;
    }, [itemByKey, formQuantities]);

    // 選択中の案件情報（プレビュー用）
    const selectedProject = useMemo(() => {
        return projectMasters.find(p => p.id === formProjectId) || null;
    }, [projectMasters, formProjectId]);

    // プレビュー / 保存用に formSheetTypes + formSheetQty を SheetEntry[] へ整形
    const sheetEntries = useMemo<SheetEntry[]>(() => {
        return Array.from(formSheetTypes).map((type) => ({
            type,
            sizes: formSheetQty[type] || {},
        }));
    }, [formSheetTypes, formSheetQty]);

    // ライブプレビュー用 PDF Blob 生成
    const buildSlipPdfBlob = useCallback(async (): Promise<Blob | null> => {
        // 案件未選択かつ数量・シート・自由欄も無い場合はプレビュースキップ
        const hasExtra = sheetEntries.length > 0 || formFreeForm.length > 0;
        if (!formProjectId && Object.keys(formQuantities).length === 0 && !hasExtra) return null;
        const { generateMaterialRequisitionSlipPDFBlob } = await import('@/utils/reactPdfGenerator');
        return await generateMaterialRequisitionSlipPDFBlob({
            foremanName: formForemanName,
            customerName: selectedProject?.customerShortName || selectedProject?.customerName || '',
            siteName: selectedProject?.name || selectedProject?.title || '',
            assemblyDate: '',     // Phase 1: 案件マスタからの取得は省略
            demolitionDate: '',
            vehicles: formVehicles,
            getQty: slipGetQty,
            sheets: sheetEntries,
            freeForm: formFreeForm,
        });
    }, [formProjectId, formQuantities, formForemanName, selectedProject, formVehicles, slipGetQty, sheetEntries, formFreeForm]);

    // プレビュー再生成トリガー (seed)
    const livePreviewSignature = useMemo(() => {
        return JSON.stringify({
            formProjectId, formForemanName, formVehicles,
            quantities: formQuantities,
            sheets: sheetEntries,
            freeForm: formFreeForm,
            customer: selectedProject?.customerShortName || selectedProject?.customerName || '',
            site: selectedProject?.name || selectedProject?.title || '',
        });
    }, [formProjectId, formForemanName, formVehicles, formQuantities, sheetEntries, formFreeForm, selectedProject]);

    // 数量入力UI: 車両3列ぶんを横並びで入力 (車1/車2/車3)
    // ＋ 倉庫在庫と「出庫後の残」を表示（出し過ぎを防ぐ）。
    const renderQuantityControl = (item: MaterialItemWithStock) => {
        const tuple = formQuantities[item.id] || [0, 0, 0];
        const excluded = item.excludeFromStockDecrement === true;
        const stock = item.stockQuantity ?? 0;
        const used = tuple[0] + tuple[1] + tuple[2];
        const residual = stock - used;
        return (
            <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1">
                    {[0, 1, 2].map((idx) => (
                        <input
                            key={idx}
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            min="0"
                            value={tuple[idx] || ''}
                            onChange={(e) => setQuantity(item.id, idx as 0 | 1 | 2, parseInt(e.target.value) || 0)}
                            onFocus={(e) => e.currentTarget.select()}
                            className="w-12 text-center px-1 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                            placeholder={`車${idx + 1}`}
                            aria-label={`車両${idx + 1}の数量`}
                        />
                    ))}
                    <span className="text-xs text-slate-400 w-6">{item.unit}</span>
                </div>
                {!excluded && (
                    <div className="text-[11px] tabular-nums whitespace-nowrap pr-7">
                        <span className="text-slate-400">在庫 {stock.toLocaleString()}</span>
                        {used > 0 && (
                            <span className={`ml-1.5 font-medium ${residual < 0 ? 'text-red-600' : 'text-teal-600'}`}>
                                → 残 {residual.toLocaleString()}{residual < 0 ? '（出し過ぎ）' : ''}
                            </span>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50">
            <div className="flex-1 overflow-y-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-slate-800">材料出庫伝票</h1>
                    <p className="text-sm text-slate-500 mt-1">材料の出庫を管理します</p>
                </div>

                {/* View Toggle */}
                <div className="flex gap-2 mb-4 md:mb-6">
                    <Button
                        onClick={() => setView('list')}
                        variant={view === 'list' ? 'gradient' : 'secondary'}
                        size="md"
                        leftIcon={<FileText className="w-4 h-4" />}
                    >
                        伝票一覧
                    </Button>
                    <Button
                        onClick={() => { setView('create'); expandAll(); }}
                        variant={view === 'create' ? 'gradient' : 'secondary'}
                        size="md"
                        leftIcon={<Plus className="w-4 h-4" />}
                    >
                        新規作成
                    </Button>
                </div>

                {view === 'list' ? (
                    /* =================== LIST VIEW =================== */
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                        <div className="p-3 md:p-6">
                            {/* 一括操作バー */}
                            {!isRequisitionsLoading && requisitions.length > 0 && (
                                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-200">
                                    <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            onChange={toggleSelectAll}
                                            className="w-4 h-4 rounded border-slate-300 text-slate-700 focus:ring-slate-500"
                                        />
                                        <span>全選択</span>
                                    </label>
                                    {selectedIds.size > 0 && (
                                        <span className="text-sm text-slate-500">{selectedIds.size}件選択中</span>
                                    )}
                                    <div className="ml-auto">
                                        <button
                                            type="button"
                                            onClick={handleBulkPrint}
                                            disabled={selectedIds.size === 0 || isBulkPrinting}
                                            className="px-3 py-1.5 text-sm font-medium rounded-xl bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                                        >
                                            <Printer className="w-4 h-4" />
                                            {isBulkPrinting ? '生成中...' : 'まとめて印刷'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isRequisitionsLoading ? (
                                <div className="text-center py-12 text-slate-500">読み込み中...</div>
                            ) : requisitions.length === 0 ? (
                                <div className="text-center py-12 text-slate-500">
                                    <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                                    <p>出庫伝票がありません</p>
                                    <button
                                        onClick={() => { setView('create'); expandAll(); }}
                                        className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 text-sm"
                                    >
                                        新規作成
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {requisitions.map((req) => {
                                        const totalItems = req.items?.reduce((sum, i) => sum + i.quantity, 0) || 0;
                                        return (
                                            <div key={req.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(req.id)}
                                                    onChange={() => toggleSelect(req.id)}
                                                    aria-label="伝票を選択"
                                                    className="w-4 h-4 rounded border-slate-300 text-slate-700 focus:ring-slate-500 shrink-0"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-medium text-slate-900 truncate">{req.projectTitle}</span>
                                                        <StatusBadge status={req.status} />
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                                                        <span>{formatDate(req.date)}</span>
                                                        <span>{req.foremanName}</span>
                                                        <span>{totalItems}点</span>
                                                        {formatVehicleInfo(req.vehicleInfo) && <span>{formatVehicleInfo(req.vehicleInfo)}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {/* Status change */}
                                                    {req.status === 'draft' && (
                                                        <button
                                                            onClick={() => handleStatusChange(req.id, 'confirmed')}
                                                            className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-xl hover:bg-blue-200"
                                                        >
                                                            確定
                                                        </button>
                                                    )}
                                                    {req.status === 'confirmed' && (
                                                        <button
                                                            onClick={() => handleStatusChange(req.id, 'loaded')}
                                                            className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-xl hover:bg-green-200"
                                                        >
                                                            積込完了
                                                        </button>
                                                    )}
                                                    {/* Print */}
                                                    <button
                                                        onClick={() => handlePrintOne(req.id)}
                                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                                                        title="印刷"
                                                        aria-label="印刷"
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                    </button>
                                                    {/* Copy */}
                                                    <button
                                                        onClick={() => handleCopyRequisition(req)}
                                                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                                                        title="コピーして新規作成"
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                    </button>
                                                    {/* Delete */}
                                                    {deleteConfirm === req.id ? (
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleDelete(req.id)} className="px-2 py-1 text-xs bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors">削除</button>
                                                            <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 text-xs bg-slate-300 text-slate-700 rounded-xl">取消</button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => setDeleteConfirm(req.id)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* =================== CREATE VIEW =================== */
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200 lg:flex lg:flex-row lg:items-stretch">
                        <div className="p-3 md:p-6 space-y-4 lg:flex-1 lg:basis-3/5 lg:min-w-0">
                            {/* A6: 自動保存インジケータ */}
                            {(autoSaveStatus !== 'idle') && (
                                <div className="flex justify-end -mt-1">
                                    <span className={`text-xs px-2 py-1 rounded-lg ${
                                        autoSaveStatus === 'saving' ? 'bg-slate-100 text-slate-600' :
                                        autoSaveStatus === 'saved' ? 'bg-green-50 text-green-700' :
                                        'bg-red-50 text-red-700'
                                    }`}>
                                        {autoSaveStatus === 'saving' && '自動保存中...'}
                                        {autoSaveStatus === 'saved' && autoSavedAt && `下書き自動保存済 ${formatSavedTime(autoSavedAt)}`}
                                        {autoSaveStatus === 'error' && (autoSaveErrorReason || '自動保存に失敗')}
                                    </span>
                                </div>
                            )}

                            {/* Header fields */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="block text-sm font-medium text-slate-700">現場 *</label>
                                        {isAdminOrManager && (
                                            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={showAllProjects}
                                                    onChange={(e) => setShowAllProjects(e.target.checked)}
                                                    className="rounded border-slate-300"
                                                />
                                                全案件から選ぶ
                                            </label>
                                        )}
                                    </div>
                                    <select
                                        value={formProjectId}
                                        onChange={(e) => setFormProjectId(e.target.value)}
                                        disabled={isLoadingMyAssignments && !showAllProjects}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm disabled:bg-slate-50 disabled:text-slate-400"
                                    >
                                        <option value="">
                                            {isLoadingMyAssignments && !showAllProjects
                                                ? '読込中...'
                                                : projectsForSelect.length === 0
                                                    ? (showAllProjects ? '案件がありません' : 'この日付に割り当てられた案件がありません')
                                                    : '選択してください'}
                                        </option>
                                        {projectsForSelect.map(pm => (
                                            <option key={pm.id} value={pm.id}>{pm.name || pm.title}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">日付 *</label>
                                    <input
                                        type="date"
                                        value={formDate}
                                        onChange={(e) => setFormDate(e.target.value)}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                    {/* B3: 日付ショートカット */}
                                    <div className="flex gap-1.5 mt-2">
                                        {[
                                            { label: '今日', offset: 0 },
                                            { label: '明日', offset: 1 },
                                            { label: '明後日', offset: 2 },
                                        ].map(({ label, offset }) => {
                                            const key = jstDateKeyWithOffset(offset);
                                            const active = formDate === key;
                                            return (
                                                <button
                                                    key={label}
                                                    type="button"
                                                    onClick={() => setFormDate(key)}
                                                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                                                        active
                                                            ? 'bg-slate-800 text-white border-slate-800'
                                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">職長 *</label>
                                    <select
                                        value={formForemanId}
                                        onChange={(e) => {
                                            setFormForemanId(e.target.value);
                                            const f = orderedForemen.find(f => f.id === e.target.value);
                                            setFormForemanName(f?.displayName || '');
                                        }}
                                        disabled={isForemanSelectLocked}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm disabled:bg-slate-50 disabled:text-slate-600"
                                    >
                                        <option value="">選択してください</option>
                                        {orderedForemen.map(f => (
                                            <option key={f.id} value={f.id}>
                                                {f.id === sessionUserId ? `${f.displayName}（自分）` : f.displayName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">車両 (1〜3)</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[0, 1, 2].map(idx => (
                                            <input
                                                key={idx}
                                                type="text"
                                                value={formVehicles[idx]}
                                                onChange={(e) => {
                                                    const next: [string, string, string] = [formVehicles[0], formVehicles[1], formVehicles[2]];
                                                    next[idx] = e.target.value;
                                                    setFormVehicles(next);
                                                }}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                                placeholder={`車両${idx + 1}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Memo */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">備考</label>
                                <input
                                    type="text"
                                    value={formMemo}
                                    onChange={(e) => setFormMemo(e.target.value)}
                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    placeholder="メモ"
                                />
                            </div>

                            {/* シート（複数選択 + サイズ×車両3列） */}
                            <div className="border-t border-slate-200 pt-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-lg font-semibold text-slate-900">シート</h3>
                                    <span className="text-sm text-slate-500">{formSheetTypes.size}種類選択中</span>
                                </div>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {SHEET_TYPES.map((t) => {
                                        const active = formSheetTypes.has(t);
                                        return (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => toggleSheetType(t)}
                                                className={`px-3 py-1.5 text-sm rounded-xl border transition-colors ${
                                                    active
                                                        ? 'bg-slate-800 text-white border-slate-800'
                                                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                                }`}
                                            >
                                                {t}
                                            </button>
                                        );
                                    })}
                                </div>
                                {Array.from(formSheetTypes).length > 0 && (
                                    <div className="space-y-3">
                                        {SHEET_TYPES.filter(t => formSheetTypes.has(t)).map((t) => (
                                            <div key={t} className="border border-slate-200 rounded-xl overflow-hidden">
                                                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-700">
                                                    {t}
                                                </div>
                                                <div className="divide-y divide-slate-100">
                                                    {SHEET_SIZES.map((size) => {
                                                        const tuple = formSheetQty[t]?.[size] || [0, 0, 0];
                                                        return (
                                                            <div key={size} className="flex items-center gap-2 px-3 py-2">
                                                                <span className="w-10 text-sm text-slate-600">{size}</span>
                                                                <div className="flex items-center gap-1">
                                                                    {[0, 1, 2].map((vi) => (
                                                                        <input
                                                                            key={vi}
                                                                            type="number"
                                                                            inputMode="numeric"
                                                                            pattern="[0-9]*"
                                                                            min="0"
                                                                            value={tuple[vi] || ''}
                                                                            onChange={(e) => setSheetQty(t, size, vi as 0 | 1 | 2, parseInt(e.target.value) || 0)}
                                                                            onFocus={(e) => e.currentTarget.select()}
                                                                            className="w-12 text-center px-1 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                                            placeholder={`車${vi + 1}`}
                                                                            aria-label={`${t} ${size} 車両${vi + 1}の数量`}
                                                                        />
                                                                    ))}
                                                                </div>
                                                                <span className="text-xs text-slate-400">枚</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* その他自由欄 */}
                            <div className="border-t border-slate-200 pt-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-lg font-semibold text-slate-900">その他自由欄</h3>
                                    <button
                                        type="button"
                                        onClick={addFreeFormRow}
                                        className="px-3 py-1.5 text-sm rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1"
                                    >
                                        <Plus className="w-4 h-4" />行を追加
                                    </button>
                                </div>
                                {formFreeForm.length === 0 ? (
                                    <p className="text-sm text-slate-400">種別に無い品目を自由に記入できます</p>
                                ) : (
                                    <div className="space-y-2">
                                        {formFreeForm.map((row, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={row.label}
                                                    onChange={(e) => setFreeFormCell(idx, 'label', e.target.value)}
                                                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                    placeholder="品目名"
                                                />
                                                {[0, 1, 2].map((vi) => (
                                                    <input
                                                        key={vi}
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={row.qty[vi]}
                                                        onChange={(e) => setFreeFormCell(idx, vi as 0 | 1 | 2, e.target.value)}
                                                        className="w-12 text-center px-1 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                        placeholder={`車${vi + 1}`}
                                                        aria-label={`自由欄${idx + 1} 車両${vi + 1}`}
                                                    />
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => removeFreeFormRow(idx)}
                                                    className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl"
                                                    aria-label="この行を削除"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Material Categories (Accordion) */}
                            <div className="border-t border-slate-200 pt-4">
                                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                                    <h3 className="text-lg font-semibold text-slate-900">材料リスト</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-slate-500">{filledCount}品目入力済</span>
                                        <button
                                            type="button"
                                            onClick={applyStandardSet}
                                            disabled={!formProjectId || isLoadingStandardSet}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-dashed border-teal-400 bg-teal-50 text-teal-700 hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="この現場に登録された標準材料を数量に反映します"
                                        >
                                            <Zap className="w-4 h-4" />
                                            {isLoadingStandardSet ? '追加中...' : 'この現場の標準セットを追加'}
                                        </button>
                                    </div>
                                </div>

                                {/* 出し過ぎ警告: 倉庫在庫を超える入力がある場合 */}
                                {overIssueItems.length > 0 && (
                                    <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                                        <span>
                                            倉庫在庫を超える入力があります（出し過ぎ）：
                                            {overIssueItems.map((it, i) => (
                                                <span key={it.id}>
                                                    {i > 0 && '、'}
                                                    {it.name}{it.spec ? ` ${it.spec}` : ''}（{it.over}超過）
                                                </span>
                                            ))}
                                            。在庫の確認・棚卸しをご検討ください。
                                        </span>
                                    </div>
                                )}

                                {/* A2: 横断検索バー */}
                                <div className="relative mb-3">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="材料名検索..."
                                        className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-xl"
                                            aria-label="検索をクリア"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>

                                {/* A3: 入力済みサマリ（検索中は非表示） */}
                                {!trimmedQuery && filledRows.length > 0 && (
                                    <div className="mb-3 border border-slate-200 rounded-xl overflow-hidden">
                                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                            <span className="text-sm font-medium text-slate-700">入力済み ({filledRows.length}品目)</span>
                                        </div>
                                        <div className="bg-white divide-y divide-slate-100">
                                            {filledRows.map(({ categoryName, item }) => (
                                                <div
                                                    key={item.id}
                                                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-50"
                                                >
                                                    <span className="flex-1 text-sm text-slate-900 font-medium">
                                                        <span className="text-xs text-slate-500 mr-1">{categoryName}:</span>
                                                        {item.name}
                                                        {item.spec && <span className="text-xs text-slate-400 ml-1">{item.spec}</span>}
                                                    </span>
                                                    {renderQuantityControl(item)}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {categories.length === 0 ? (
                                    <div className="text-center py-8 text-slate-500">
                                        材料マスターが登録されていません。設定画面で材料を追加してください。
                                    </div>
                                ) : trimmedQuery ? (
                                    /* A2: 検索結果リスト */
                                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                                        {searchResults.length === 0 ? (
                                            <div className="text-center py-8 text-slate-500 bg-white">
                                                該当する材料が見つかりません
                                            </div>
                                        ) : (
                                            <div className="bg-white divide-y divide-slate-100">
                                                {searchResults.map(({ categoryName, item }) => {
                                                    const filled = hasAnyQty(formQuantities[item.id]);
                                                    return (
                                                        <div
                                                            key={item.id}
                                                            className={`flex items-center gap-2 px-4 py-2.5 ${filled ? 'bg-blue-50' : ''}`}
                                                        >
                                                            <span className={`flex-1 text-sm ${filled ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                                                                <span className="text-xs text-slate-500 mr-1">{categoryName}:</span>
                                                                {item.name}
                                                                {item.spec && <span className="text-xs text-slate-400 ml-1">{item.spec}</span>}
                                                            </span>
                                                            {renderQuantityControl(item)}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {categories.map((cat: MaterialCategoryWithItems) => {
                                            const catFilled = cat.items?.filter(i => hasAnyQty(formQuantities[i.id])).length || 0;
                                            const isExpanded = expandedCategories.has(cat.id);

                                            return (
                                                <div key={cat.id} className="border border-slate-200 rounded-xl overflow-hidden">
                                                    <button
                                                        onClick={() => toggleCategory(cat.id)}
                                                        className="w-full flex items-center gap-2 p-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                                                    >
                                                        {isExpanded ? (
                                                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                                                        ) : (
                                                            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                                                        )}
                                                        <span className="font-medium text-slate-900 flex-1">{cat.name}</span>
                                                        {catFilled > 0 && (
                                                            <span className="text-xs bg-slate-700 text-white px-2 py-0.5 rounded-full">
                                                                {catFilled}
                                                            </span>
                                                        )}
                                                    </button>

                                                    {isExpanded && cat.items && (
                                                        <div className="border-t border-slate-200 bg-white divide-y divide-slate-100">
                                                            {cat.items.map(item => {
                                                                const filled = hasAnyQty(formQuantities[item.id]);
                                                                return (
                                                                    <div
                                                                        key={item.id}
                                                                        className={`flex items-center gap-2 px-4 py-2.5 ${filled ? 'bg-blue-50' : ''}`}
                                                                    >
                                                                        <span className={`flex-1 text-sm ${filled ? 'text-slate-900 font-medium' : 'text-slate-500'}`}>
                                                                            {item.name}
                                                                        </span>
                                                                        {renderQuantityControl(item)}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Submit Buttons */}
                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button
                                    onClick={() => { resetForm(); setView('list'); }}
                                    className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium"
                                >
                                    キャンセル
                                </button>
                                <button
                                    onClick={() => handleSubmit('draft')}
                                    disabled={isSaving}
                                    className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium disabled:opacity-50"
                                >
                                    下書き保存
                                </button>
                                <button
                                    onClick={() => handleSubmit('confirmed')}
                                    disabled={isSaving}
                                    className="flex-1 px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium shadow-md hover:shadow-lg disabled:opacity-50"
                                >
                                    {isSaving ? '保存中...' : '確定して保存'}
                                </button>
                            </div>
                        </div>

                        {/* 右カラム: リアルタイム PDF プレビュー (lg+ のみ) */}
                        <div className="hidden lg:flex lg:flex-col lg:basis-2/5 lg:min-w-0 lg:border-l lg:border-slate-200 lg:bg-slate-50">
                            <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-200px)]">
                                {isLgScreen && (
                                    <LivePdfPreview
                                        seed={livePreviewSignature}
                                        renderPdf={buildSlipPdfBlob}
                                        debounceMs={700}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
