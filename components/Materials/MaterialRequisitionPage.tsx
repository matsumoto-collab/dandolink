'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMaterialData } from '@/hooks/useMaterialData';
import { useSession } from 'next-auth/react';
import { Plus, FileText, Copy, Trash2, Printer, Search, X, Zap, AlertTriangle, Image as ImageIcon, RotateCcw, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import SearchableSelect from '@/components/ui/SearchableSelect';
import ProjectMasterFilesView from '@/components/ProjectMaster/ProjectMasterFilesView';
import MaterialRequisitionDetailModal from './MaterialRequisitionDetailModal';
import StatusBadge from './ui/StatusBadge';
import type { MaterialRequisition } from '@/types/material';
import {
    PDF_LAYOUT,
    SHEET_TYPES,
    SHEET_SIZES,
    parseRequisitionNotes,
    serializeRequisitionNotes,
    cellTextToNumber,
    type SheetType,
    type SheetSize,
    type SheetEntry,
    type FreeFormEntry,
    type RequisitionNotes,
    type CellTextMap,
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

// 現場プルダウン用の案件オプション（my-assignments / project-masters 双方を吸収）
interface ProjectOption {
    id: string;
    title: string;
    name: string | null;
    customerName?: string | null;
    customerShortName?: string | null;
    honorific?: string | null;
    assemblyDate?: string;   // YYYY-MM-DD（my-assignments のみ算出）
    demolitionDate?: string; // YYYY-MM-DD（my-assignments のみ算出）
}

// 現場プルダウンの表示ラベル：「得意先（敬称）／工事名称」
function buildProjectLabel(p: ProjectOption): string {
    const cust = p.customerShortName || p.customerName || '';
    const custWithHon = cust ? `${cust}${p.honorific ? ` ${p.honorific}` : ''}` : '';
    const work = p.title || p.name || '(名称未設定)';
    return custWithHon ? `${custWithHon}／${work}` : work;
}

/* ============================================================================
 * PDF風グリッド（拾い出し）用のレイアウト。
 * PDF_LAYOUT（COL1→COL2→COL3 / Sheet1 準拠）を 1 列に平坦化し、
 * カテゴリ単位（連続する同 categoryName）でグループ化する。
 * 紙の材料表（Sheet1）と同じ並びを縦 1 列で再現するための単一の正。
 * ========================================================================== */
interface GridRow {
    categoryName: string;
    itemName: string;
    /** 規格表示（specLabel）。categoryName と同一の単独品目は規格を空表示にする */
    spec: string;
}
interface GridGroup {
    categoryName: string;
    rows: GridRow[];
}

const GRID_GROUPS: GridGroup[] = (() => {
    const flat: GridRow[] = [];
    for (const col of PDF_LAYOUT) {
        for (const g of col.groups) {
            for (const r of g.rows) {
                flat.push({ categoryName: r.categoryName, itemName: r.itemName, spec: r.spec });
            }
        }
    }
    // 連続する同 categoryName をまとめる（SPINE 由来で同カテゴリ行は必ず連続）
    const groups: GridGroup[] = [];
    for (const r of flat) {
        const last = groups[groups.length - 1];
        if (last && last.categoryName === r.categoryName) last.rows.push(r);
        else groups.push({ categoryName: r.categoryName, rows: [r] });
    }
    return groups;
})();

/** シート（※1）はネット品目として表現される。グリッドでは種類選択ブロックに置換する */
const SHEET_GRID_CATEGORY = 'ネット';
/** 自由記入欄の行数（リース品の下・3 列の最下段を揃える） */
const FREE_ROW_COUNT = 19;
/** フリー入力ヒント（単独品目の規格欄に淡色で表示） */
const GRID_HINTS: Record<string, string> = { '親綱': 'ｍ', 'イメージシート': '名称', 'リース品': '内容' };
/** グリッドの規格欄に表示する文字列（単独品目＝カテゴリ名と同一なら空） */
function gridSpecText(categoryName: string, spec: string): string {
    return spec === categoryName ? '' : spec;
}

export default function MaterialRequisitionPage() {
    const { categories, fetchCategories, isCategoriesInitialized, fetchRequisitions, requisitions, isRequisitionsLoading, createRequisition, updateRequisition, deleteRequisition } = useMaterialData();
    const { data: session } = useSession();

    const [view, setView] = useState<'list' | 'create'>('list');
    // 一覧で案件をクリックして開くPDF詳細モーダル（見積書/請求書と同じ挙動）
    const [detailReq, setDetailReq] = useState<MaterialRequisition | null>(null);
    // 既存伝票の「編集モード」（その伝票を上書き更新・新規コピーとは区別）。
    // null=新規作成、{id,status}=その伝票を編集中（保存はstatus維持で更新）。
    const [editingExisting, setEditingExisting] = useState<{ id: string; status: string } | null>(null);
    const [projectMasters, setProjectMasters] = useState<ProjectOption[]>([]);
    const [foremen, setForemen] = useState<Array<{ id: string; displayName: string }>>([]);
    // 車両コンボボックスの候補（選択＋自由入力）
    const [vehicleOptions, setVehicleOptions] = useState<string[]>([]);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkPrinting, setIsBulkPrinting] = useState(false);

    // Form state
    const [formProjectId, setFormProjectId] = useState('');
    const [formDate, setFormDate] = useState(defaultFormDate());
    const [formForemanId, setFormForemanId] = useState('');
    const [formForemanName, setFormForemanName] = useState('');
    // 記入者（施工班とは別軸。初期値はログインユーザー / プルダウンで変更可）
    const [formWriterId, setFormWriterId] = useState('');
    const [formWriterName, setFormWriterName] = useState('');
    // 組立日 / 解体日（手入力・空欄可。現場選択時に ProjectAssignment からプリフィル）
    const [formAssemblyDate, setFormAssemblyDate] = useState('');
    const [formDemolitionDate, setFormDemolitionDate] = useState('');
    // 車両3欄 (旧 formVehicleInfo (単一文字列) は廃止し、JSON 化して保存)
    const [formVehicles, setFormVehicles] = useState<[string, string, string]>(['', '', '']);
    // notes は構造化 JSON（memo / sheets / freeForm）で保存。旧プレーン notes は memo として読む
    const [formMemo, setFormMemo] = useState('');
    // 選択中のシート種類（複数選択）
    const [formSheetTypes, setFormSheetTypes] = useState<Set<SheetType>>(new Set());
    // シート数量(表示文字): type -> size -> [車両0,1,2]（自由入力＝文字列）
    const [formSheetQty, setFormSheetQty] = useState<Record<string, Partial<Record<SheetSize, [string, string, string]>>>>({});
    // 汎用「その他自由欄」
    const [formFreeForm, setFormFreeForm] = useState<FreeFormEntry[]>([]);
    // 数量(表示文字)は materialItemId → [車両0, 車両1, 車両2] の3要素タプル（自由入力＝文字列）
    // 合計・在庫・API数量は cellTextToNumber で数値化。書いたとおりの文字は notes.cells に保存
    const [formQuantities, setFormQuantities] = useState<Record<string, [string, string, string]>>({});
    // 図面・添付ファイルモーダル
    const [showDrawingModal, setShowDrawingModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    // この現場の標準セット（ProjectMaterialItem）をワンタップ反映
    const [isLoadingStandardSet, setIsLoadingStandardSet] = useState(false);

    // B2: 自分に割当てがある案件のみ
    const [myAssignedProjects, setMyAssignedProjects] = useState<ProjectOption[]>([]);
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
        // 車両コンボの候補（選択＋自由入力）
        fetch('/api/master-data/vehicles', { cache: 'no-store' })
            .then(r => r.ok ? r.json() : [])
            .then((data: Array<{ name?: string | null }>) => {
                const names = Array.isArray(data)
                    ? data.map(v => (v?.name || '').trim()).filter((n): n is string => !!n)
                    : [];
                setVehicleOptions(Array.from(new Set(names)));
            })
            .catch(() => setVehicleOptions([]));
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

    // B1: ログインユーザーを施工班・記入者の初期値に自動セット
    useEffect(() => {
        if (!sessionUserId) return;
        const self = orderedForemen.find(f => f.id === sessionUserId);
        if (self && !formForemanId) {
            setFormForemanId(self.id);
            setFormForemanName(self.displayName);
        }
        if (!formWriterId) {
            const writerSelf = self || { id: sessionUserId, displayName: session?.user?.name || '自分' };
            setFormWriterId(writerSelf.id);
            setFormWriterName(writerSelf.displayName);
        }
    }, [sessionUserId, orderedForemen, formForemanId, formWriterId, session?.user?.name]);

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
            rangeDays: '14',
        });
        fetch(`/api/materials/my-assignments?${params.toString()}`, { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : []))
            .then((data: ProjectOption[]) => {
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
    const projectsForSelect = React.useMemo<ProjectOption[]>(() => {
        if (showAllProjects && isAdminOrManager) return projectMasters;
        return myAssignedProjects;
    }, [showAllProjects, isAdminOrManager, projectMasters, myAssignedProjects]);

    // 選択中案件のメタ（得意先・敬称・組立解体日）。プルダウン候補から解決
    const selectedProjectMeta = React.useMemo<ProjectOption | null>(() => {
        return projectsForSelect.find(p => p.id === formProjectId) || null;
    }, [projectsForSelect, formProjectId]);

    // 現場プルダウンの選択ハンドラ（選択時に組立/解体日をプリフィル）
    const handleSelectProject = useCallback((id: string) => {
        setFormProjectId(id);
        const p = projectsForSelect.find(x => x.id === id);
        // 案件由来の日付があればプリフィル（無ければ空欄のまま・手入力可）
        setFormAssemblyDate(p?.assemblyDate || '');
        setFormDemolitionDate(p?.demolitionDate || '');
    }, [projectsForSelect]);

    // 案件リストが変わって現在選択中の案件が含まれなくなったらクリア（組立/解体日も一緒に）
    useEffect(() => {
        if (!formProjectId) return;
        if (!projectsForSelect.some(p => p.id === formProjectId)) {
            setFormProjectId('');
            setFormAssemblyDate('');
            setFormDemolitionDate('');
        }
    }, [projectsForSelect, formProjectId]);

    // 車両3列のいずれかに入力があるかの判定（文字列）
    const hasAnyQty = (q?: [string, string, string]) => !!q && q.some(s => (s ?? '').trim() !== '');

    const setQuantity = (itemId: string, vehicleIndex: 0 | 1 | 2, value: string) => {
        setFormQuantities(prev => {
            const current = prev[itemId] || ['', '', ''];
            const nextTuple: [string, string, string] = [current[0], current[1], current[2]];
            nextTuple[vehicleIndex] = value;
            if (!hasAnyQty(nextTuple)) {
                const { [itemId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [itemId]: nextTuple };
        });
    };

    const resetForm = () => {
        setFormProjectId('');
        setFormAssemblyDate('');
        setFormDemolitionDate('');
        setFormVehicles(['', '', '']);
        setFormDate(defaultFormDate());
        setFormMemo('');
        setFormSheetTypes(new Set());
        setFormSheetQty({});
        setFormFreeForm([]);
        setFormQuantities({});
        setSearchQuery('');
        setEditingExisting(null);
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
            qtys.forEach((raw, idx) => {
                const qty = cellTextToNumber(raw);
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
        // 数量セルの表示文字を notes.cells（key=`${categoryName}|${itemName}`）へ保存
        const idToKey = new Map<string, string>();
        for (const cat of categories) {
            for (const item of cat.items || []) idToKey.set(item.id, `${cat.name}|${item.name}`);
        }
        const cells: CellTextMap = {};
        for (const [id, tuple] of Object.entries(formQuantities)) {
            const key = idToKey.get(id);
            if (key && tuple.some(s => (s ?? '').trim() !== '')) {
                cells[key] = [tuple[0] ?? '', tuple[1] ?? '', tuple[2] ?? ''];
            }
        }
        const payload: RequisitionNotes = {
            v: 1,
            memo: formMemo,
            sheets,
            freeForm: formFreeForm,
            cells,
            writerName: formWriterName,
            assemblyDate: formAssemblyDate,
            demolitionDate: formDemolitionDate,
        };
        return serializeRequisitionNotes(payload);
    }, [formMemo, formSheetTypes, formSheetQty, formFreeForm, formQuantities, categories, formWriterName, formAssemblyDate, formDemolitionDate]);

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
    const setSheetQty = useCallback((type: SheetType, size: SheetSize, vehicleIndex: 0 | 1 | 2, value: string) => {
        setFormSheetQty(prev => {
            const forType = { ...(prev[type] || {}) };
            const tuple: [string, string, string] = [...(forType[size] || ['', '', ''])] as [string, string, string];
            tuple[vehicleIndex] = value;
            if (!tuple.some(s => (s ?? '').trim() !== '')) {
                delete forType[size];
            } else {
                forType[size] = tuple;
            }
            return { ...prev, [type]: forType };
        });
    }, []);

    // 自由欄セルの更新（19行固定グリッド用。idx まで配列を自動拡張する）。
    // 末尾の空行は serializeRequisitionNotes / 各集計側で間引かれるため state に空行が残っても無害。
    const setFreeFormCellAt = useCallback((idx: number, field: 'label' | 0 | 1 | 2, value: string) => {
        setFormFreeForm(prev => {
            const next = prev.map(row => ({ label: row.label, qty: [...row.qty] as [string, string, string] }));
            while (next.length <= idx) next.push({ label: '', qty: ['', '', ''] });
            if (field === 'label') next[idx].label = value;
            else next[idx].qty[field] = value;
            return next;
        });
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
    }, [view, formProjectId, formDate, formForemanId, formVehicles, formMemo, formSheetTypes, formSheetQty, formFreeForm, formQuantities, formWriterName, formAssemblyDate, formDemolitionDate]);

    const handleSubmit = async (status: 'draft' | 'confirmed') => {
        if (!formProjectId) { toast.error('現場を選択してください'); return; }
        if (!formForemanId) { toast.error('施工班名を選択してください'); return; }

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
        // 既存伝票をコピー。表示文字は notes.cells（書いたとおり）を最優先、無ければ DB 数量を文字化
        const parsedNotes = parseRequisitionNotes(req.notes);
        // cat|item → materialItemId（notes.cells の key 解決用）
        const keyToId = new Map<string, string>();
        for (const cat of categories) {
            for (const it of cat.items || []) keyToId.set(`${cat.name}|${it.name}`, it.id);
        }
        const quantities: Record<string, [string, string, string]> = {};
        // 1) DB items（数値）→ 文字列の初期値（vehicleLabel '0'/'1'/'2'、その他は車両0列）
        req.items?.forEach(item => {
            if (item.quantity > 0) {
                let idx: 0 | 1 | 2 = 0;
                if (item.vehicleLabel === '1') idx = 1;
                else if (item.vehicleLabel === '2') idx = 2;
                const tuple = quantities[item.materialItemId] || ['', '', ''];
                tuple[idx] = String(cellTextToNumber(tuple[idx]) + item.quantity);
                quantities[item.materialItemId] = tuple;
            }
        });
        // 2) notes.cells（書いたとおりの表示文字）で上書き
        for (const [key, tuple] of Object.entries(parsedNotes.cells ?? {})) {
            const id = keyToId.get(key);
            if (id) quantities[id] = [tuple[0] ?? '', tuple[1] ?? '', tuple[2] ?? ''];
        }
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
        const copiedTypes = new Set<SheetType>();
        const copiedSheetQty: Record<string, Partial<Record<SheetSize, [string, string, string]>>> = {};
        for (const s of parsedNotes.sheets) {
            copiedTypes.add(s.type);
            copiedSheetQty[s.type] = { ...s.sizes };
        }
        setFormSheetTypes(copiedTypes);
        setFormSheetQty(copiedSheetQty);
        setFormFreeForm(parsedNotes.freeForm.map(f => ({ label: f.label, qty: [...f.qty] as [string, string, string] })));
        // 組立/解体日はコピー元の値を引き継ぐ（記入者は現行ユーザーのまま）
        setFormAssemblyDate(parsedNotes.assemblyDate || '');
        setFormDemolitionDate(parsedNotes.demolitionDate || '');
        setFormMemo('');
        setSearchQuery('');
        setView('create');
        toast.success('前回の伝票をコピーしました');
    }, [categories]);

    // 既存伝票を「編集モード」でフォームへ読み込む（複製ではなくその伝票を上書き更新）。
    // - autoSavedId = req.id（保存先＝この伝票）
    // - 30秒自動保存は無効化（明示「保存（更新）」のみ・状態の意図せぬ下書き降格を防ぐ）
    // - 記入者名・備考も元の値を読み込む（複製では引き継がない項目）
    const loadRequisitionForEdit = useCallback((req: MaterialRequisition) => {
        const parsedNotes = parseRequisitionNotes(req.notes);
        const keyToId = new Map<string, string>();
        for (const cat of categories) {
            for (const it of cat.items || []) keyToId.set(`${cat.name}|${it.name}`, it.id);
        }
        const quantities: Record<string, [string, string, string]> = {};
        req.items?.forEach(item => {
            if (item.quantity > 0) {
                let idx: 0 | 1 | 2 = 0;
                if (item.vehicleLabel === '1') idx = 1;
                else if (item.vehicleLabel === '2') idx = 2;
                const tuple = quantities[item.materialItemId] || ['', '', ''];
                tuple[idx] = String(cellTextToNumber(tuple[idx]) + item.quantity);
                quantities[item.materialItemId] = tuple;
            }
        });
        for (const [key, tuple] of Object.entries(parsedNotes.cells ?? {})) {
            const id = keyToId.get(key);
            if (id) quantities[id] = [tuple[0] ?? '', tuple[1] ?? '', tuple[2] ?? ''];
        }
        // 編集モード state（autoSavedId=この伝票・自動保存OFF）
        setEditingExisting({ id: req.id, status: req.status });
        setAutoSavedId(req.id);
        setAutoSaveStatus('idle');
        setAutoSavedAt(null);
        setAutoSaveErrorReason('');
        autoSaveDisabledRef.current = true;
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        setFormQuantities(quantities);
        setFormProjectId(req.projectMasterId);
        // 施工班は元伝票の値を表示（PATCH では foremanId は変更しないが、表示整合のため）
        if (req.foremanId) {
            setFormForemanId(req.foremanId);
            setFormForemanName(req.foremanName || '');
        }
        const srcDate = req.date ? new Date(req.date) : null;
        setFormDate(srcDate && !Number.isNaN(srcDate.getTime()) ? jstDateKey(srcDate) : defaultFormDate());
        let parsedVehicles: [string, string, string] = ['', '', ''];
        if (req.vehicleInfo) {
            try {
                const obj = JSON.parse(req.vehicleInfo);
                if (obj && Array.isArray(obj.vehicles)) {
                    parsedVehicles = [String(obj.vehicles[0] ?? ''), String(obj.vehicles[1] ?? ''), String(obj.vehicles[2] ?? '')];
                } else {
                    parsedVehicles = [req.vehicleInfo, '', ''];
                }
            } catch {
                parsedVehicles = [req.vehicleInfo, '', ''];
            }
        }
        setFormVehicles(parsedVehicles);
        const types = new Set<SheetType>();
        const sheetQty: Record<string, Partial<Record<SheetSize, [string, string, string]>>> = {};
        for (const s of parsedNotes.sheets) { types.add(s.type); sheetQty[s.type] = { ...s.sizes }; }
        setFormSheetTypes(types);
        setFormSheetQty(sheetQty);
        setFormFreeForm(parsedNotes.freeForm.map(f => ({ label: f.label, qty: [...f.qty] as [string, string, string] })));
        setFormAssemblyDate(parsedNotes.assemblyDate || '');
        setFormDemolitionDate(parsedNotes.demolitionDate || '');
        if (parsedNotes.writerName) setFormWriterName(parsedNotes.writerName);
        setFormMemo(parsedNotes.memo || '');
        setSearchQuery('');
        setDetailReq(null);
        setView('create');
        toast.success('編集モードで開きました');
    }, [categories]);

    // 編集モードの保存：その伝票を上書き更新（状態は維持。在庫整合はPATCH側が処理）。
    const handleUpdateExisting = async () => {
        if (!editingExisting) return;
        if (!formProjectId) { toast.error('現場を選択してください'); return; }
        if (!formForemanId) { toast.error('施工班名を選択してください'); return; }
        const items = flattenQuantitiesForApi();
        if (items.length === 0) { toast.error('材料を1つ以上入力してください'); return; }
        const vehicleInfoStr = buildVehicleInfoJson();
        const notesStr = buildNotesJson();
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
        autoSaveDisabledRef.current = true;
        setIsSaving(true);
        try {
            await updateRequisition(editingExisting.id, {
                status: editingExisting.status,
                vehicleInfo: vehicleInfoStr,
                notes: notesStr,
                items,
            });
            toast.success('伝票を更新しました');
            resetForm();
            setView('list');
            fetchRequisitions({ type: '出庫' });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : '更新に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

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

    const allSelected = requisitions.length > 0 && selectedIds.size === requisitions.length;

    // 検索（任意）：グリッドの品目を絞り込む。空ならカタログ全行を常に表示（紙と同じ安心感）
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const visibleGroups = useMemo<GridGroup[]>(() => {
        if (!trimmedQuery) return GRID_GROUPS;
        const out: GridGroup[] = [];
        for (const g of GRID_GROUPS) {
            // シート（ネット）は「シート」でも引けるように検索対象語を補う
            const catText = (g.categoryName === SHEET_GRID_CATEGORY ? `シート ${g.categoryName}` : g.categoryName).toLowerCase();
            if (catText.includes(trimmedQuery)) { out.push(g); continue; }
            const rows = g.rows.filter(r => r.spec.toLowerCase().includes(trimmedQuery) || r.itemName.toLowerCase().includes(trimmedQuery));
            if (rows.length) out.push({ ...g, rows });
        }
        return out;
    }, [trimmedQuery]);

    // 車両別合計（フッター表示用）。カタログ＋シート＋自由欄を文字→数値（cellTextToNumber）で合算
    const gridTotals = useMemo(() => {
        const c: [number, number, number] = [0, 0, 0];
        const add = (t: [string, string, string]) => ([0, 1, 2] as const).forEach(vi => { c[vi] += cellTextToNumber(t[vi]); });
        for (const t of Object.values(formQuantities)) add(t);
        for (const sizes of Object.values(formSheetQty)) {
            for (const t of Object.values(sizes)) { if (t) add(t); }
        }
        for (const f of formFreeForm) add(f.qty);
        return { car1: c[0], car2: c[1], car3: c[2], total: c[0] + c[1] + c[2] };
    }, [formQuantities, formSheetQty, formFreeForm]);

    // PDF 風グリッドの列テンプレート（品目 | 規格 | 車① | 車② | 車③）。ヘッダ・各行で共有
    const gridColsClass = 'grid grid-cols-[minmax(0,1fr)_3.25rem_2.75rem_2.75rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_4.5rem_3.5rem_3.5rem_3.5rem]';
    // グリッドのセル（数量入力）共通クラス。タップ→ネイティブ数値キーパッド、入力済みは色付け
    const gridCellInputClass = 'w-full h-10 text-center text-sm font-bold text-slate-800 bg-transparent border-0 focus:outline-none focus:bg-teal-50 focus:ring-2 focus:ring-inset focus:ring-teal-500 disabled:bg-slate-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

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
                    const cur = next[it.materialItemId] || ['', '', ''];
                    next[it.materialItemId] = [String(cellTextToNumber(cur[0]) + it.requiredQuantity), cur[1], cur[2]];
                }
                return next;
            });
            toast.success(`標準セット ${valid.length}品目を追加しました`);
        } catch {
            toast.error('標準セットの取得に失敗しました');
        } finally {
            setIsLoadingStandardSet(false);
        }
    }, [formProjectId]);

    // 出し過ぎ警告: 入力数量が倉庫在庫を超える非除外品目（出庫後残がマイナス）
    const overIssueItems = useMemo(() => {
        const list: Array<{ id: string; name: string; spec: string | null; over: number }> = [];
        for (const cat of categories) {
            for (const item of cat.items || []) {
                if (item.excludeFromStockDecrement) continue;
                const tuple = formQuantities[item.id];
                if (!tuple) continue;
                const used = cellTextToNumber(tuple[0]) + cellTextToNumber(tuple[1]) + cellTextToNumber(tuple[2]);
                if (used <= 0) continue;
                const residual = (item.stockQuantity ?? 0) - used;
                if (residual < 0) list.push({ id: item.id, name: item.name, spec: item.spec, over: -residual });
            }
        }
        return list;
    }, [categories, formQuantities]);

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

    // PDF プレビュー用: セルキー → 表示文字を引く関数 (車両0/1/2 ぶん振り分け)
    const slipGetQty = useCallback((categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2): string => {
        const itemId = itemByKey.get(`${categoryName}|${itemName}`);
        if (!itemId) return '';
        const tuple = formQuantities[itemId];
        if (!tuple) return '';
        return tuple[vehicleIndex] || '';
    }, [itemByKey, formQuantities]);

    // 選択中の案件情報（プレビュー用）
    const selectedProject = useMemo(() => {
        return projectMasters.find(p => p.id === formProjectId) || null;
    }, [projectMasters, formProjectId]);

    // 得意先名・敬称・工事名称（得意先欄 / ライブプレビュー / PDF 共通）。
    // プルダウン候補(selectedProjectMeta) → project-masters(selectedProject) の順で解決
    const slipCustomerName = selectedProjectMeta?.customerShortName || selectedProjectMeta?.customerName
        || selectedProject?.customerShortName || selectedProject?.customerName || '';
    const slipHonorific = selectedProjectMeta?.honorific ?? selectedProject?.honorific ?? '';
    const slipWorkName = selectedProjectMeta?.title || selectedProject?.title
        || selectedProjectMeta?.name || selectedProject?.name || '';

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
            writerName: formWriterName,
            customerName: slipCustomerName,
            honorific: slipHonorific,
            siteName: slipWorkName,
            assemblyDate: formAssemblyDate,
            demolitionDate: formDemolitionDate,
            vehicles: formVehicles,
            getQty: slipGetQty,
            sheets: sheetEntries,
            freeForm: formFreeForm,
        });
    }, [formProjectId, formQuantities, formForemanName, formWriterName, slipCustomerName, slipHonorific, slipWorkName, formAssemblyDate, formDemolitionDate, formVehicles, slipGetQty, sheetEntries, formFreeForm]);

    // 車両別 積込リスト（車両別版PDF用）。カタログ品目＋シート＋自由欄を車両ごとに集計
    const loadingByVehicle = useMemo(() => {
        const per: Array<{ items: Array<{ name: string; spec: string; qty: string }>; subtotal: number }> = [
            { items: [], subtotal: 0 }, { items: [], subtotal: 0 }, { items: [], subtotal: 0 },
        ];
        // 1) カタログ品目（Sheet1 / グリッド順）。シート（ネット）は (2) で別途集計
        //    表示は書いたとおりの文字（例「20本」）、小計は cellTextToNumber で数値化
        for (const group of GRID_GROUPS) {
            if (group.categoryName === SHEET_GRID_CATEGORY) continue;
            for (const row of group.rows) {
                const id = itemByKey.get(`${group.categoryName}|${row.itemName}`);
                if (!id) continue;
                const t = formQuantities[id];
                if (!t) continue;
                ([0, 1, 2] as const).forEach((vi) => {
                    const raw = (t[vi] || '').trim();
                    if (!raw) return;
                    per[vi].items.push({ name: group.categoryName, spec: gridSpecText(group.categoryName, row.spec), qty: raw });
                    per[vi].subtotal += cellTextToNumber(raw);
                });
            }
        }
        // 2) シート（種類 × サイズ × 車両）
        for (const s of sheetEntries) {
            for (const size of SHEET_SIZES) {
                const t = s.sizes[size];
                if (!t) continue;
                ([0, 1, 2] as const).forEach((vi) => {
                    const raw = (t[vi] || '').trim();
                    if (!raw) return;
                    per[vi].items.push({ name: s.type, spec: size, qty: raw });
                    per[vi].subtotal += cellTextToNumber(raw);
                });
            }
        }
        // 3) 自由欄（書いたとおりの文字を表示・小計は数値化できる分のみ）
        for (const f of formFreeForm) {
            if (!f.label.trim()) continue;
            ([0, 1, 2] as const).forEach((vi) => {
                const raw = (f.qty[vi] || '').trim();
                if (!raw) return;
                per[vi].items.push({ name: f.label, spec: '', qty: raw });
                per[vi].subtotal += cellTextToNumber(raw);
            });
        }
        return per;
    }, [itemByKey, formQuantities, sheetEntries, formFreeForm]);

    // Blob を新規タブで開く（印刷プレビュー）
    const openPdfBlob = useCallback((blob: Blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, []);

    const [isPrinting, setIsPrinting] = useState(false);

    // 印刷：全項目版（既存の材料表PDF・決まった位置に全品目）
    const handlePrintFull = useCallback(async () => {
        setIsPrinting(true);
        try {
            const blob = await buildSlipPdfBlob();
            if (!blob) { toast.error('印刷する内容がありません'); return; }
            openPdfBlob(blob);
        } catch {
            toast.error('PDF生成に失敗しました');
        } finally {
            setIsPrinting(false);
        }
    }, [buildSlipPdfBlob, openPdfBlob]);

    // 印刷：車両別版（B案・各トラックに積む物だけを一覧）
    const handlePrintLoading = useCallback(async () => {
        const vehicles = ([0, 1, 2] as const)
            .map((vi) => ({
                label: `車両${['①', '②', '③'][vi]}`,
                name: formVehicles[vi] || '',
                items: loadingByVehicle[vi].items,
                subtotal: loadingByVehicle[vi].subtotal,
            }))
            .filter((v) => v.items.length > 0);
        if (vehicles.length === 0) { toast.error('積み込む品目がありません'); return; }
        setIsPrinting(true);
        try {
            const { generateMaterialRequisitionLoadingPDFBlob } = await import('@/utils/reactPdfGenerator');
            const blob = await generateMaterialRequisitionLoadingPDFBlob({
                foremanName: formForemanName,
                writerName: formWriterName,
                customerName: slipCustomerName,
                honorific: slipHonorific,
                siteName: slipWorkName,
                assemblyDate: formAssemblyDate,
                demolitionDate: formDemolitionDate,
                vehicleNames: formVehicles,
                vehicles,
                grandTotal: vehicles.reduce((a, v) => a + v.subtotal, 0),
            });
            openPdfBlob(blob);
        } catch {
            toast.error('PDF生成に失敗しました');
        } finally {
            setIsPrinting(false);
        }
    }, [loadingByVehicle, formVehicles, formForemanName, formWriterName, slipCustomerName, slipHonorific, slipWorkName, formAssemblyDate, formDemolitionDate, openPdfBlob]);

    // 前回と同じ：同現場の直近伝票（自動保存中の下書きを除く）から数量・シート・自由欄をコピー
    const applyPreviousSame = useCallback(() => {
        if (!formProjectId) { toast.error('先に現場を選択してください'); return; }
        const prev = requisitions
            .filter(r => r.projectMasterId === formProjectId && r.id !== autoSavedId)
            .slice()
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        if (!prev) { toast('この現場の過去伝票が見つかりません'); return; }
        // 数量（車両別）をマージ加算
        const addQ: Record<string, [number, number, number]> = {};
        prev.items?.forEach(item => {
            if (item.quantity > 0) {
                let idx: 0 | 1 | 2 = 0;
                if (item.vehicleLabel === '1') idx = 1;
                else if (item.vehicleLabel === '2') idx = 2;
                const t = addQ[item.materialItemId] || [0, 0, 0];
                t[idx] += item.quantity;
                addQ[item.materialItemId] = t;
            }
        });
        if (Object.keys(addQ).length === 0) { toast('前回伝票に数量がありませんでした'); return; }
        setFormQuantities(prevQ => {
            const next = { ...prevQ };
            for (const [id, t] of Object.entries(addQ)) {
                const cur = next[id] || ['', '', ''];
                const merged: [string, string, string] = [cur[0], cur[1], cur[2]];
                ([0, 1, 2] as const).forEach(vi => {
                    if (t[vi] > 0) merged[vi] = String(cellTextToNumber(cur[vi]) + t[vi]);
                });
                next[id] = merged;
            }
            return next;
        });
        // シート / 自由欄は現在が空のときのみ取り込む（既存入力を壊さない）
        const notes = parseRequisitionNotes(prev.notes);
        if (formSheetTypes.size === 0 && notes.sheets.length > 0) {
            const types = new Set<SheetType>();
            const qty: Record<string, Partial<Record<SheetSize, [string, string, string]>>> = {};
            for (const s of notes.sheets) { types.add(s.type); qty[s.type] = { ...s.sizes }; }
            setFormSheetTypes(types);
            setFormSheetQty(qty);
        }
        if (formFreeForm.length === 0 && notes.freeForm.length > 0) {
            setFormFreeForm(notes.freeForm.map(f => ({ label: f.label, qty: [...f.qty] as [string, string, string] })));
        }
        toast.success(`前回（${formatDate(prev.date)}）の内容をコピーしました`);
    }, [formProjectId, requisitions, autoSavedId, formSheetTypes, formFreeForm]);

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-50">
            {/* overflow-x-hidden: 横方向のはみ出しでページ全体がパンするのを防止（縦スクロール・sticky は維持） */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
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
                        onClick={() => { if (editingExisting) resetForm(); setView('create'); }}
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
                                        onClick={() => setView('create')}
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
                                                <button
                                                    type="button"
                                                    onClick={() => setDetailReq(req)}
                                                    className="flex-1 min-w-0 text-left cursor-pointer rounded-lg -m-1 p-1 hover:bg-white/70 transition-colors"
                                                    title="クリックでPDFを表示"
                                                >
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
                                                </button>
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
                    /* =================== CREATE VIEW（拾い出し2ペイン） =================== */
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                        <div className="p-3 md:p-6 space-y-4">
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
                                {/* 現場（検索式ドロップダウン・全幅）。得意先（敬称）／工事名称で表示 */}
                                <div className="md:col-span-2">
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
                                    <div className="flex items-stretch gap-2">
                                        <SearchableSelect
                                            options={projectsForSelect.map(pm => ({ id: pm.id, label: buildProjectLabel(pm) }))}
                                            value={formProjectId}
                                            onChange={handleSelectProject}
                                            disabled={isLoadingMyAssignments && !showAllProjects}
                                            allowEmpty
                                            emptyLabel="未選択"
                                            placeholder={
                                                isLoadingMyAssignments && !showAllProjects
                                                    ? '読込中...'
                                                    : projectsForSelect.length === 0
                                                        ? (showAllProjects ? '案件がありません' : 'この期間に割り当てられた案件がありません')
                                                        : '得意先／工事名称で選択'
                                            }
                                            className="w-full flex-1 min-w-0"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowDrawingModal(true)}
                                            disabled={!formProjectId}
                                            className="shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                            title="この現場の図面・添付ファイルを表示"
                                        >
                                            <ImageIcon className="w-4 h-4" />
                                            <span className="hidden sm:inline">図面を見る</span>
                                        </button>
                                    </div>
                                </div>

                                {/* 得意先名（現場選択で自動表示・手入力不可） */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">得意先名</label>
                                    <div className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50 text-sm text-slate-700 min-h-[42px] flex items-center">
                                        {slipCustomerName
                                            ? `${slipCustomerName}${slipHonorific ? ` ${slipHonorific}` : ''}`
                                            : <span className="text-slate-400">現場を選択すると表示されます</span>}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">日付 *</label>
                                    <input
                                        type="date"
                                        value={formDate}
                                        onChange={(e) => setFormDate(e.target.value)}
                                        className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
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
                                {/* 施工班名（出庫を行う施工班＝責任者。旧「職長」） */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">施工班名 *</label>
                                    <select
                                        value={formForemanId}
                                        onChange={(e) => {
                                            setFormForemanId(e.target.value);
                                            const f = orderedForemen.find(f => f.id === e.target.value);
                                            setFormForemanName(f?.displayName || '');
                                        }}
                                        disabled={isForemanSelectLocked}
                                        className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm disabled:bg-slate-50 disabled:text-slate-600"
                                    >
                                        <option value="">選択してください</option>
                                        {orderedForemen.map(f => (
                                            <option key={f.id} value={f.id}>
                                                {f.id === sessionUserId ? `${f.displayName}（自分）` : f.displayName}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* 記入者（この伝票を記入した人。初期値=ログインユーザー） */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">記入者</label>
                                    <select
                                        value={formWriterId}
                                        onChange={(e) => {
                                            setFormWriterId(e.target.value);
                                            const f = orderedForemen.find(f => f.id === e.target.value);
                                            setFormWriterName(f?.displayName || '');
                                        }}
                                        className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    >
                                        <option value="">選択してください</option>
                                        {orderedForemen.map(f => (
                                            <option key={f.id} value={f.id}>
                                                {f.id === sessionUserId ? `${f.displayName}（自分）` : f.displayName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {/* 組立日 / 解体日（手入力・空欄可。現場選択でプリフィル） */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">組立日</label>
                                    <input
                                        type="date"
                                        value={formAssemblyDate}
                                        onChange={(e) => setFormAssemblyDate(e.target.value)}
                                        className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">解体日</label>
                                    <input
                                        type="date"
                                        value={formDemolitionDate}
                                        onChange={(e) => setFormDemolitionDate(e.target.value)}
                                        className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    />
                                </div>

                                {/* 車両（選択＋自由入力 / 最大3台。候補=車両マスタ） */}
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">車両 (1〜3)</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {[0, 1, 2].map(idx => (
                                            <input
                                                key={idx}
                                                type="text"
                                                list="material-vehicle-options"
                                                value={formVehicles[idx]}
                                                onChange={(e) => {
                                                    const next: [string, string, string] = [formVehicles[0], formVehicles[1], formVehicles[2]];
                                                    next[idx] = e.target.value;
                                                    setFormVehicles(next);
                                                }}
                                                className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                                placeholder={`車両${idx + 1}`}
                                            />
                                        ))}
                                    </div>
                                    <datalist id="material-vehicle-options">
                                        {vehicleOptions.map(v => (
                                            <option key={v} value={v} />
                                        ))}
                                    </datalist>
                                </div>
                            </div>

                            {/* ===== 拾い出し：PDF風グリッド（Sheet1 の並びを縦1列・各行3セルをタップ入力） ===== */}
                            <div className="border-t border-slate-200 pt-4">
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

                                <div className="space-y-3">
                                    {/* ツールバー：検索（任意・グリッド絞り込み）／標準セット／前回と同じ */}
                                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                        <div className="relative flex-1 min-w-0">
                                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                placeholder="品目名で絞り込み（例：柱、手摺、単管）"
                                                className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500"
                                            />
                                            {searchQuery && (
                                                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-xl" aria-label="検索をクリア">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={applyStandardSet}
                                                disabled={!formProjectId || isLoadingStandardSet}
                                                className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-sm rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="この現場に登録された標準材料を反映します"
                                            >
                                                <Zap className="w-4 h-4" />
                                                {isLoadingStandardSet ? '追加中...' : '標準セットを追加'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={applyPreviousSame}
                                                disabled={!formProjectId}
                                                className="inline-flex items-center gap-1.5 px-3 min-h-[44px] text-sm rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="この現場の直近伝票の内容をコピーします"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                                前回と同じ
                                            </button>
                                        </div>
                                    </div>

                                    {/* PDF風グリッド：Sheet1 の並びを縦1列。各行に車①②③の3セル＝タップで数量入力 */}
                                    {/* overflow-hidden を付けると sticky ヘッダーが効かないため付けない（角丸は header/footer 側で） */}
                                    <div className="border-[1.5px] border-slate-800 rounded-lg">
                                        {/* ヘッダー（スクロール時に列見出しを上部固定） */}
                                        <div className={`${gridColsClass} bg-slate-800 text-white text-[11px] font-bold rounded-t-md sticky top-0 z-10`}>
                                            <div className="px-2 py-2">品目</div>
                                            <div className="px-1 py-2 text-center border-l border-slate-600">規格</div>
                                            {[0, 1, 2].map((vi) => (
                                                <div key={vi} className="px-1 py-2 text-center border-l border-slate-600 leading-tight">
                                                    車{['①', '②', '③'][vi]}
                                                    <span className="block text-[9px] font-normal text-slate-300 truncate">{formVehicles[vi] || '—'}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {categories.length === 0 ? (
                                            <div className="px-4 py-10 text-center text-sm text-slate-500">材料マスターが登録されていません</div>
                                        ) : (
                                            <>
                                                {visibleGroups.map((group, gi) => {
                                                    // シート（※1）＝ネット品目はグリッド上で「種類選択ブロック」に置換
                                                    if (group.categoryName === SHEET_GRID_CATEGORY) {
                                                        return (
                                                            <div key={`g${gi}`} className="border-t-2 border-slate-700">
                                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 bg-slate-100">
                                                                    <span className="text-[13px] font-bold text-slate-800">シート <span className="text-rose-600">※1</span></span>
                                                                    <span className="text-[13px] text-slate-500">種類：</span>
                                                                    <select
                                                                        value=""
                                                                        onChange={(e) => { if (e.target.value) toggleSheetType(e.target.value as SheetType); }}
                                                                        className="h-9 px-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                                        aria-label="シートの種類を追加"
                                                                    >
                                                                        <option value="">＋ シートの種類を追加</option>
                                                                        {SHEET_TYPES.filter((t) => !formSheetTypes.has(t)).map((t) => (
                                                                            <option key={t} value={t}>{t}</option>
                                                                        ))}
                                                                    </select>
                                                                    <span className="text-[11px] text-slate-400">種類が複数あるので選択式</span>
                                                                </div>
                                                                {Array.from(formSheetTypes).length === 0 ? (
                                                                    <div className={`${gridColsClass} border-t border-slate-100`}>
                                                                        <div className="col-span-2 px-2 py-2 text-xs text-slate-400 border-r border-slate-200">種類を選ぶとサイズ別に入力できます</div>
                                                                        <div className="border-r border-slate-200" />
                                                                        <div className="border-r border-slate-200" />
                                                                        <div />
                                                                    </div>
                                                                ) : (
                                                                    SHEET_TYPES.filter((t) => formSheetTypes.has(t)).map((t) => (
                                                                        <div key={t}>
                                                                            <div className="flex items-center justify-between px-2 py-1 bg-slate-50 border-t border-slate-100">
                                                                                <span className="text-xs font-medium text-slate-700">{t}</span>
                                                                                <button type="button" onClick={() => toggleSheetType(t)} className="p-1 text-slate-400 hover:text-red-600" aria-label={`${t} を外す`}>
                                                                                    <X className="w-3.5 h-3.5" />
                                                                                </button>
                                                                            </div>
                                                                            {SHEET_SIZES.map((size) => {
                                                                                const tuple = formSheetQty[t]?.[size] || ['', '', ''];
                                                                                return (
                                                                                    <div key={size} className={`${gridColsClass} border-t border-slate-100`}>
                                                                                        <div className="px-2 py-1.5 border-r border-slate-200" />
                                                                                        <div className="px-1.5 py-1.5 text-[13px] text-slate-600 flex items-center border-r border-slate-200">{size}</div>
                                                                                        {[0, 1, 2].map((vi) => {
                                                                                            const val = tuple[vi] || '';
                                                                                            return (
                                                                                                <div key={vi} className={`border-r border-slate-200 last:border-r-0 ${val.trim() ? 'bg-amber-100' : ''}`}>
                                                                                                    <input type="text" value={val} onChange={(e) => setSheetQty(t, size, vi as 0 | 1 | 2, e.target.value)} onFocus={(e) => e.currentTarget.select()} className={gridCellInputClass} aria-label={`シート ${t} ${size} 車両${vi + 1}`} />
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    ))
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                    // 通常カテゴリ：見出し（先頭行）＋規格＋車①②③の3セル
                                                    return (
                                                        <div key={`g${gi}`} className="border-t-2 border-slate-700">
                                                            {group.rows.map((row, ri) => {
                                                                const id = itemByKey.get(`${group.categoryName}|${row.itemName}`);
                                                                const tuple = (id && formQuantities[id]) || ['', '', ''];
                                                                return (
                                                                    <div key={ri} className={`${gridColsClass} ${ri > 0 ? 'border-t border-slate-100' : ''}`}>
                                                                        <div className="px-2 py-1.5 flex items-center border-r border-slate-200 min-w-0">
                                                                            <span className="font-bold text-slate-800 text-[13px] truncate">{ri === 0 ? group.categoryName : ''}</span>
                                                                        </div>
                                                                        <div className="px-1.5 py-1.5 flex items-center border-r border-slate-200 min-w-0">
                                                                            <span className="text-[13px] text-slate-600 truncate">{gridSpecText(group.categoryName, row.spec)}</span>
                                                                            {ri === 0 && GRID_HINTS[group.categoryName] && <span className="ml-1 text-[10px] text-slate-400 shrink-0">{GRID_HINTS[group.categoryName]}</span>}
                                                                        </div>
                                                                        {[0, 1, 2].map((vi) => {
                                                                            const val = tuple[vi] || '';
                                                                            return (
                                                                                <div key={vi} className={`border-r border-slate-200 last:border-r-0 ${val.trim() ? 'bg-amber-100' : ''}`}>
                                                                                    <input type="text" disabled={!id} value={val} onChange={(e) => id && setQuantity(id, vi as 0 | 1 | 2, e.target.value)} onFocus={(e) => e.currentTarget.select()} className={gridCellInputClass} aria-label={`${group.categoryName} ${row.spec} 車両${vi + 1}`} />
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    );
                                                })}

                                                {/* 自由記入欄（リース品の下・19行／3列の最下段を揃える）。検索中は非表示 */}
                                                {!trimmedQuery && (
                                                    <div className="border-t-2 border-slate-700">
                                                        <div className="flex flex-wrap items-center gap-x-2 px-2 py-2 bg-white">
                                                            <span className="text-[13px] font-bold text-slate-800">自由記入欄</span>
                                                            <span className="text-[11px] text-slate-400">カタログに無い材料はここに記入（品目名も入力）</span>
                                                        </div>
                                                        {Array.from({ length: Math.max(FREE_ROW_COUNT, formFreeForm.length) }).map((_, i) => {
                                                            const row = formFreeForm[i] || { label: '', qty: ['', '', ''] as [string, string, string] };
                                                            return (
                                                                <div key={i} className={`${gridColsClass} border-t border-slate-100`}>
                                                                    <div className="col-span-2 border-r border-slate-200 min-w-0">
                                                                        <input type="text" value={row.label} onChange={(e) => setFreeFormCellAt(i, 'label', e.target.value)} placeholder="（品目名）" className="w-full h-10 px-2 text-[13px] text-slate-800 bg-transparent border-0 focus:outline-none focus:bg-teal-50 focus:ring-2 focus:ring-inset focus:ring-teal-500 placeholder:text-slate-300" aria-label={`自由記入${i + 1} 品目名`} />
                                                                    </div>
                                                                    {[0, 1, 2].map((vi) => {
                                                                        const v = row.qty[vi] || '';
                                                                        return (
                                                                            <div key={vi} className={`border-r border-slate-200 last:border-r-0 ${v.trim() ? 'bg-amber-100' : ''}`}>
                                                                                <input type="text" value={v} onChange={(e) => setFreeFormCellAt(i, vi as 0 | 1 | 2, e.target.value)} className="w-full h-10 text-center text-sm font-bold text-slate-800 bg-transparent border-0 focus:outline-none focus:bg-teal-50 focus:ring-2 focus:ring-inset focus:ring-teal-500" aria-label={`自由記入${i + 1} 車両${vi + 1}`} />
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </>
                                        )}

                                        {/* フッター合計（車両別＋総計） */}
                                        <div className="flex items-center justify-end gap-3 sm:gap-4 px-3 py-2.5 bg-slate-50 border-t-2 border-slate-700 rounded-b-md text-xs sm:text-sm">
                                            <span className="text-slate-500">車①：<b className="text-slate-900 tabular-nums">{gridTotals.car1}</b></span>
                                            <span className="text-slate-500">車②：<b className="text-slate-900 tabular-nums">{gridTotals.car2}</b></span>
                                            <span className="text-slate-500">車③：<b className="text-slate-900 tabular-nums">{gridTotals.car3}</b></span>
                                            <span className="text-slate-700 font-medium">合計：<b className="text-slate-900 tabular-nums">{gridTotals.total}</b>点</span>
                                        </div>
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
                                    className="w-full min-w-0 px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm"
                                    placeholder="メモ"
                                />
                            </div>

                            {/* アクションバー（新規: 下書き保存/確定、編集: 保存（更新）） */}
                            <div className="sticky bottom-0 -mx-3 md:-mx-6 -mb-3 md:-mb-6 mt-2 px-3 md:px-6 py-3 bg-white/95 backdrop-blur border-t border-slate-200 flex flex-wrap items-center gap-2 justify-end rounded-b-xl">
                                <span className="mr-auto text-xs text-slate-400 hidden sm:block">
                                    {editingExisting ? '編集中：保存で上書き更新します' : '下書きは自動保存されます'}
                                </span>
                                <button
                                    onClick={() => { resetForm(); setView('list'); }}
                                    className="px-3 min-h-[44px] bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium text-sm"
                                >
                                    キャンセル
                                </button>
                                {!editingExisting && (
                                    <button
                                        onClick={() => handleSubmit('draft')}
                                        disabled={isSaving}
                                        className="px-3 min-h-[44px] bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 font-medium text-sm disabled:opacity-50"
                                    >
                                        下書き保存
                                    </button>
                                )}
                                <button
                                    onClick={handlePrintFull}
                                    disabled={isPrinting}
                                    className="inline-flex items-center gap-1.5 px-3 min-h-[44px] border border-slate-200 bg-white text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
                                >
                                    <Printer className="w-4 h-4" />印刷：全項目版
                                </button>
                                <button
                                    onClick={handlePrintLoading}
                                    disabled={isPrinting}
                                    className="inline-flex items-center gap-1.5 px-3 min-h-[44px] border border-slate-200 bg-white text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50"
                                >
                                    <Printer className="w-4 h-4" />印刷：車両別版
                                </button>
                                {editingExisting ? (
                                    <button
                                        onClick={handleUpdateExisting}
                                        disabled={isSaving}
                                        className="inline-flex items-center gap-1.5 px-4 min-h-[44px] bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium text-sm shadow-md hover:shadow-lg disabled:opacity-50"
                                    >
                                        <Check className="w-4 h-4" />{isSaving ? '保存中...' : '保存（更新）'}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleSubmit('confirmed')}
                                        disabled={isSaving}
                                        className="inline-flex items-center gap-1.5 px-4 min-h-[44px] bg-teal-600 text-white rounded-xl hover:bg-teal-700 font-medium text-sm shadow-md hover:shadow-lg disabled:opacity-50"
                                    >
                                        <Check className="w-4 h-4" />{isSaving ? '保存中...' : '確定して在庫を減らす'}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 図面・添付ファイル モーダル（この現場の ProjectMasterFile を表示） */}
            {showDrawingModal && formProjectId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowDrawingModal(false)}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
                            <h3 className="font-semibold text-slate-900">図面・添付ファイル</h3>
                            <button onClick={() => setShowDrawingModal(false)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg" aria-label="閉じる">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="overflow-y-auto p-4">
                            <ProjectMasterFilesView projectMasterId={formProjectId} />
                        </div>
                    </div>
                </div>
            )}

            {/* 出庫伝票 詳細（PDF表示）モーダル＝一覧で案件クリックで開く */}
            {detailReq && (
                <MaterialRequisitionDetailModal
                    req={detailReq}
                    onClose={() => setDetailReq(null)}
                    onEdit={loadRequisitionForEdit}
                    onPrint={handlePrintOne}
                />
            )}
        </div>
    );
}
