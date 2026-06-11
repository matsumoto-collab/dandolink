'use client';

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    ArrowLeft,
    ArrowDown,
    ArrowUp,
    AlertTriangle,
    Download,
    Printer,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import { PdfPreviewToggle } from '@/components/ui/PdfPreviewToggle';
import { usePdfPreviewVisible } from '@/hooks/usePdfPreviewVisible';
import {
    CRANE_QUALIFICATION_KEYWORDS,
    SAFETY_DOCUMENT_TYPE_LABELS,
    getMachineCategoryLabel,
    getMachineMissingFields,
    getVehicleTodokeMissingFields,
    toIsoDateString,
    type KikaiTodokeData,
    type MachineSnapshot,
    type MeiboHeader,
    type SafetyDocumentData,
    type TodokeVehicleSnapshot,
    type VehicleTodokeData,
} from '@/lib/safetyDocuments';
import { todayJstIsoDate } from '@/lib/safetyClient';
import {
    exportSafetyDocumentPDF,
    printSafetyDocumentPDF,
    renderSafetyDocumentBlob,
} from '@/utils/safetyDocumentPdf';
import type {
    MachineDto,
    SafetyDocumentDto,
    SafetyTargetDto,
    VehicleSafetyTargetDto,
} from '@/types/safety';
import { logger } from '@/lib/logger';

/**
 * 車両届・持込機械届・クレーン等使用届の作成ウィザード（Phase 2）。
 * 対象（車両 or 機械）の選択と行ごとの運転者/取扱者入力以外は3種別で共通。
 */

type TodokeType = 'vehicle_todoke' | 'kikai_todoke' | 'crane_todoke';

interface TodokeWizardProps {
    docType: TodokeType;
    editingDoc: SafetyDocumentDto | null;
    duplicateSource: SafetyDocumentDto | null;
    onSaved: () => void;
    onCancel: () => void;
}

/** 選択行（車両/機械を吸収した内部表現） */
interface SelectedItem {
    id: string; // vehicleId / machineId
    personName: string; // driverName / operatorName
}

const INPUT_CLASS =
    'w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm text-sm';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600 mb-1';

const EMPTY_HEADER: MeiboHeader = {
    primeContractor: '',
    primeSiteManager: '',
    siteName: '',
    tier: '',
    submitDate: '',
    companyName: '',
    companyRepresentative: '',
    companyAddress: '',
};

interface ProjectOption {
    id: string;
    title: string;
}

export default function TodokeWizard({ docType, editingDoc, duplicateSource, onSaved, onCancel }: TodokeWizardProps) {
    const isVehicle = docType === 'vehicle_todoke';
    const isCrane = docType === 'crane_todoke';
    const personLabel = isVehicle ? '運転者' : '取扱者・オペレーター';
    const docLabel = SAFETY_DOCUMENT_TYPE_LABELS[docType];

    const initialDoc = editingDoc ?? duplicateSource;
    const initialData = initialDoc?.data as VehicleTodokeData | KikaiTodokeData | undefined;

    const [currentDoc, setCurrentDoc] = useState<SafetyDocumentDto | null>(editingDoc);
    const [vehicles, setVehicles] = useState<VehicleSafetyTargetDto[]>([]);
    const [machines, setMachines] = useState<MachineDto[]>([]);
    const [workerTargets, setWorkerTargets] = useState<SafetyTargetDto[]>([]); // クレーン資格チェック用
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [title, setTitle] = useState(
        editingDoc ? editingDoc.title : duplicateSource ? `${duplicateSource.title}（複製）` : ''
    );
    const [projectId, setProjectId] = useState<string | null>(initialDoc?.projectId ?? null);
    const [header, setHeader] = useState<MeiboHeader>(
        initialData ? { ...EMPTY_HEADER, ...initialData.header } : { ...EMPTY_HEADER, submitDate: todayJstIsoDate() }
    );
    const [periodFrom, setPeriodFrom] = useState(initialData?.periodFrom ?? '');
    const [periodTo, setPeriodTo] = useState(initialData?.periodTo ?? '');
    const [selectedItems, setSelectedItems] = useState<SelectedItem[]>(() => {
        if (!initialData) return [];
        if ('vehicles' in initialData) {
            return initialData.vehicles.map((v) => ({ id: v.vehicleId, personName: v.driverName }));
        }
        return initialData.machines.map((m) => ({ id: m.machineId, personName: m.operatorName }));
    });

    const [itemSearch, setItemSearch] = useState('');

    const { visible: previewVisible, toggle: togglePreview } = usePdfPreviewVisible(
        `dandolink:pdfPreview:safetyTodoke:${docType}`
    );

    // 編集時: 保存済みスナップショットは据え置きで表示（FR-4-2。複製は最新値で取り直すため含めない）
    const existingSnapshotMap = useMemo(() => {
        const map = new Map<string, TodokeVehicleSnapshot | MachineSnapshot>();
        if (!currentDoc) return map;
        const data = currentDoc.data as VehicleTodokeData | KikaiTodokeData;
        if ('vehicles' in data) {
            for (const v of data.vehicles) map.set(v.vehicleId, v);
        } else if ('machines' in data) {
            for (const m of data.machines) map.set(m.machineId, m);
        }
        return map;
    }, [currentDoc]);

    // 初期データ（対象一覧・案件一覧・自社情報・クレーン時は作業員資格）を並列フェッチ
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [targetRes, projectsRes, companyRes, workersRes] = await Promise.all([
                    isVehicle
                        ? fetch('/api/vehicle-safety-profiles', { cache: 'no-store' })
                        : fetch('/api/machines', { cache: 'no-store' }),
                    fetch('/api/project-masters?status=active', { cache: 'no-store' }),
                    fetch('/api/master-data/company', { cache: 'no-store' }),
                    isCrane ? fetch('/api/safety-profiles', { cache: 'no-store' }) : Promise.resolve(null),
                ]);
                if (cancelled) return;

                if (targetRes.ok) {
                    const data = await targetRes.json();
                    if (isVehicle) setVehicles(data);
                    else setMachines(data);
                }
                if (projectsRes.ok) {
                    const data = await projectsRes.json();
                    const list = Array.isArray(data) ? data : data?.data ?? [];
                    setProjects(list.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })));
                }
                if (companyRes.ok) {
                    const company = await companyRes.json();
                    if (company) {
                        setHeader((prev) => ({
                            ...prev,
                            companyName: prev.companyName || company.name || '',
                            companyRepresentative: prev.companyRepresentative || company.representative || '',
                            companyAddress: prev.companyAddress || company.address || '',
                        }));
                    }
                }
                if (workersRes && workersRes.ok) {
                    setWorkerTargets(await workersRes.json());
                }
            } catch (error) {
                logger.error('届ウィザード初期データ取得エラー:', error);
                toast.error('データの取得に失敗しました');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVehicle, isCrane]);

    const updateHeader = (patch: Partial<MeiboHeader>) => setHeader((prev) => ({ ...prev, ...patch }));

    const handleProjectSelect = (id: string) => {
        setProjectId(id || null);
        const project = projects.find((p) => p.id === id);
        if (project) updateHeader({ siteName: project.title });
    };

    /** 選択候補（車両/機械を共通形に） */
    const candidates = useMemo(() => {
        if (isVehicle) {
            return vehicles.map((v) => ({
                id: v.vehicleId,
                name: v.name,
                sub: v.profile?.registrationNumber ?? '',
                defaultPerson: v.profile?.defaultDriverName ?? '',
                hasProfile: !!v.profile,
                isCraneCategory: false,
            }));
        }
        const list = isCrane ? [...machines].sort((a, b) => (a.category === 'crane' ? -1 : 1) - (b.category === 'crane' ? -1 : 1)) : machines;
        return list.map((m) => ({
            id: m.id,
            name: m.name,
            sub: [getMachineCategoryLabel(m.category), m.model ?? ''].filter(Boolean).join(' / '),
            defaultPerson: m.defaultOperatorName ?? '',
            hasProfile: true,
            isCraneCategory: m.category === 'crane',
        }));
    }, [isVehicle, isCrane, vehicles, machines]);

    const filteredCandidates = useMemo(() => {
        const q = itemSearch.trim();
        if (!q) return candidates;
        return candidates.filter((c) => c.name.includes(q) || c.sub.includes(q));
    }, [candidates, itemSearch]);

    const selectedIdSet = useMemo(() => new Set(selectedItems.map((s) => s.id)), [selectedItems]);

    const toggleItem = (id: string, defaultPerson: string) => {
        setSelectedItems((prev) => {
            if (prev.some((s) => s.id === id)) return prev.filter((s) => s.id !== id);
            return [...prev, { id, personName: defaultPerson }];
        });
    };

    const moveItem = (index: number, delta: -1 | 1) => {
        setSelectedItems((prev) => {
            const next = [...prev];
            const to = index + delta;
            if (to < 0 || to >= next.length) return prev;
            [next[index], next[to]] = [next[to], next[index]];
            return next;
        });
    };

    const removeItem = (index: number) => setSelectedItems((prev) => prev.filter((_, i) => i !== index));

    const setPersonName = (index: number, personName: string) => {
        setSelectedItems((prev) => prev.map((s, i) => (i === index ? { ...s, personName } : s)));
    };

    /** 選択行の表示用スナップショット（編集時は保存済み優先 = 保存結果と一致。人名は現在の入力値） */
    const resolveVehicleSnapshot = (item: SelectedItem): TodokeVehicleSnapshot | null => {
        const existing = existingSnapshotMap.get(item.id) as TodokeVehicleSnapshot | undefined;
        if (existing) return { ...existing, driverName: item.personName };
        const v = vehicles.find((x) => x.vehicleId === item.id);
        if (!v) return null;
        const p = v.profile;
        return {
            vehicleId: v.vehicleId,
            name: v.name,
            driverName: item.personName,
            profile: p
                ? {
                      vehicleType: p.vehicleType,
                      registrationNumber: p.registrationNumber,
                      usage: p.usage,
                      inspectionExpiry: toIsoDateString(p.inspectionExpiry),
                      jibaisekiCompany: p.jibaisekiCompany,
                      jibaisekiExpiry: toIsoDateString(p.jibaisekiExpiry),
                      insuranceCompany: p.insuranceCompany,
                      insuranceExpiry: toIsoDateString(p.insuranceExpiry),
                      insurancePersonal: p.insurancePersonal,
                      insuranceObjective: p.insuranceObjective,
                      insurancePassenger: p.insurancePassenger,
                      notes: p.notes,
                  }
                : null,
        };
    };

    const resolveMachineSnapshot = (item: SelectedItem): MachineSnapshot | null => {
        const existing = existingSnapshotMap.get(item.id) as MachineSnapshot | undefined;
        if (existing) return { ...existing, operatorName: item.personName };
        const m = machines.find((x) => x.id === item.id);
        if (!m) return null;
        return {
            machineId: m.id,
            name: m.name,
            category: m.category,
            operatorName: item.personName,
            model: m.model,
            serialNumber: m.serialNumber,
            maker: m.maker,
            capacity: m.capacity,
            ownerName: m.ownerName,
            inspectionDate: toIsoDateString(m.inspectionDate),
            inspectionExpiry: toIsoDateString(m.inspectionExpiry),
            certificateNumber: m.certificateNumber,
            notes: m.notes,
        };
    };

    const previewData = useMemo<SafetyDocumentData>(() => {
        if (isVehicle) {
            const rows = selectedItems
                .map(resolveVehicleSnapshot)
                .filter((v): v is TodokeVehicleSnapshot => v !== null);
            return {
                header,
                periodFrom: periodFrom || null,
                periodTo: periodTo || null,
                vehicles: rows,
            } satisfies VehicleTodokeData;
        }
        const rows = selectedItems.map(resolveMachineSnapshot).filter((m): m is MachineSnapshot => m !== null);
        return {
            header,
            periodFrom: periodFrom || null,
            periodTo: periodTo || null,
            machines: rows,
        } satisfies KikaiTodokeData;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVehicle, selectedItems, header, periodFrom, periodTo, vehicles, machines, existingSnapshotMap]);

    const previewSeed = useMemo(() => JSON.stringify(previewData), [previewData]);

    /** クレーン届: オペレーター名に一致する作業員がクレーン系資格を持っているかの簡易チェック（警告用） */
    const craneQualWarning = (personName: string): string | null => {
        if (!isCrane || !personName.trim()) return null;
        const normalized = personName.replace(/[\s　]/g, '');
        const target = workerTargets.find((t) => t.name.replace(/[\s　]/g, '') === normalized);
        if (!target) return null; // マスター外の名前はチェック対象外
        const hasCraneQual = (target.profile?.qualifications ?? []).some((q) =>
            CRANE_QUALIFICATION_KEYWORDS.some((kw) => q.name.includes(kw))
        );
        return hasCraneQual ? null : 'クレーン系資格が安全情報に未登録です';
    };

    const effectiveTitle = () => title.trim() || `${header.siteName ? `${header.siteName} ` : ''}${docLabel}`;

    const handleSave = async () => {
        if (!header.submitDate) {
            toast.error('提出日を入力してください');
            return;
        }
        if (selectedItems.length === 0) {
            toast.error(`${isVehicle ? '車両' : '機械'}を1台以上選択してください`);
            return;
        }
        setIsSaving(true);
        try {
            const isUpdate = !!currentDoc;
            const listBody = isVehicle
                ? { vehicles: selectedItems.map((s) => ({ vehicleId: s.id, driverName: s.personName })) }
                : { machines: selectedItems.map((s) => ({ machineId: s.id, operatorName: s.personName })) };
            const body = {
                type: docType,
                projectId,
                title: effectiveTitle(),
                header,
                periodFrom: periodFrom || null,
                periodTo: periodTo || null,
                ...listBody,
            };
            const res = await fetch(
                isUpdate ? `/api/safety-documents/${currentDoc!.id}` : '/api/safety-documents',
                {
                    method: isUpdate ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '保存に失敗しました');
            }
            toast.success('安全書類を保存しました');
            onSaved();
        } catch (error) {
            logger.error('安全書類保存エラー:', error);
            toast.error(error instanceof Error ? error.message : '保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRefreshSnapshot = async () => {
        if (!currentDoc) return;
        setIsRefreshing(true);
        try {
            const res = await fetch(`/api/safety-documents/${currentDoc.id}/refresh`, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '更新に失敗しました');
            }
            const { document, notFoundKeys } = await res.json();
            setCurrentDoc(document);
            if (notFoundKeys?.length > 0) {
                toast(`マスターから削除済みの ${notFoundKeys.length} 件は保存時の内容のままです`, { icon: '⚠️' });
            } else {
                toast.success('マスターの最新値で更新しました');
            }
        } catch (error) {
            logger.error('スナップショット更新エラー:', error);
            toast.error(error instanceof Error ? error.message : '更新に失敗しました');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleExportPdf = async () => {
        try {
            await exportSafetyDocumentPDF(docType, previewData, effectiveTitle());
        } catch {
            toast.error('PDFの出力に失敗しました');
        }
    };

    const handlePrint = async () => {
        try {
            await printSafetyDocumentPDF(docType, previewData);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '印刷用PDFを開けませんでした');
        }
    };

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* ツールバー */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={onCancel}>
                    一覧へ戻る
                </Button>
                <h2 className="text-lg font-semibold text-slate-900 flex-1 min-w-0 truncate">
                    {currentDoc ? `${docLabel}の編集` : `${docLabel}の作成`}
                </h2>
                <div className="hidden lg:block">
                    <PdfPreviewToggle visible={previewVisible} onToggle={togglePreview} />
                </div>
                {currentDoc && (
                    <Button
                        variant="outline"
                        size="sm"
                        leftIcon={<RefreshCw className="w-4 h-4" />}
                        onClick={handleRefreshSnapshot}
                        isLoading={isRefreshing}
                    >
                        最新値で更新
                    </Button>
                )}
                <Button variant="outline" size="sm" leftIcon={<Printer className="w-4 h-4" />} onClick={handlePrint}>
                    印刷
                </Button>
                <Button variant="outline" size="sm" leftIcon={<Download className="w-4 h-4" />} onClick={handleExportPdf}>
                    PDF
                </Button>
                <Button size="sm" onClick={handleSave} isLoading={isSaving}>
                    保存
                </Button>
            </div>

            <div className="flex-1 min-h-0 flex gap-4">
                {/* ── 左: フォーム ── */}
                <div className={`flex-1 min-w-0 overflow-y-auto pr-1 ${previewVisible ? 'lg:max-w-[50%]' : ''}`}>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40 text-slate-400 text-sm">読み込み中...</div>
                    ) : (
                        <div className="space-y-5">
                            {/* 基本情報 */}
                            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-900">基本情報</h3>
                                <div>
                                    <label className={LABEL_CLASS}>書類タイトル</label>
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder={`空欄の場合は「現場名 ${docLabel}」を自動設定`}
                                        className={INPUT_CLASS}
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL_CLASS}>案件（任意）</label>
                                        <select
                                            value={projectId ?? ''}
                                            onChange={(e) => handleProjectSelect(e.target.value)}
                                            className={INPUT_CLASS}
                                        >
                                            <option value="">案件に紐付けない（現場名を手入力）</option>
                                            {projects.map((p) => (
                                                <option key={p.id} value={p.id}>
                                                    {p.title}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>提出日</label>
                                        <input
                                            type="date"
                                            value={header.submitDate}
                                            onChange={(e) => updateHeader({ submitDate: e.target.value })}
                                            className={INPUT_CLASS}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className={LABEL_CLASS}>現場名（事業所の名称）</label>
                                    <input
                                        type="text"
                                        value={header.siteName}
                                        onChange={(e) => updateHeader({ siteName: e.target.value })}
                                        className={INPUT_CLASS}
                                    />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL_CLASS}>使用期間（自）</label>
                                        <input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} className={INPUT_CLASS} />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>使用期間（至）</label>
                                        <input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} className={INPUT_CLASS} />
                                    </div>
                                </div>
                            </section>

                            {/* 提出先（元請） */}
                            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-900">提出先（元請）</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL_CLASS}>元請会社名</label>
                                        <input
                                            type="text"
                                            value={header.primeContractor}
                                            onChange={(e) => updateHeader({ primeContractor: e.target.value })}
                                            className={INPUT_CLASS}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>所長名</label>
                                        <input
                                            type="text"
                                            value={header.primeSiteManager}
                                            onChange={(e) => updateHeader({ primeSiteManager: e.target.value })}
                                            className={INPUT_CLASS}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 自社情報 */}
                            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-900">自社情報</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL_CLASS}>会社名</label>
                                        <input
                                            type="text"
                                            value={header.companyName}
                                            onChange={(e) => updateHeader({ companyName: e.target.value })}
                                            className={INPUT_CLASS}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>次数</label>
                                        <select
                                            value={header.tier}
                                            onChange={(e) => updateHeader({ tier: e.target.value })}
                                            className={INPUT_CLASS}
                                        >
                                            <option value="">未設定</option>
                                            <option value="一次">一次</option>
                                            <option value="二次">二次</option>
                                            <option value="三次">三次</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>代表者名</label>
                                        <input
                                            type="text"
                                            value={header.companyRepresentative}
                                            onChange={(e) => updateHeader({ companyRepresentative: e.target.value })}
                                            className={INPUT_CLASS}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL_CLASS}>所在地</label>
                                        <input
                                            type="text"
                                            value={header.companyAddress}
                                            onChange={(e) => updateHeader({ companyAddress: e.target.value })}
                                            className={INPUT_CLASS}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 対象選択 */}
                            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-900">
                                    {isVehicle ? '車両を選択' : '機械を選択'}
                                    <span className="ml-2 text-xs font-normal text-slate-500">選択中 {selectedItems.length}台</span>
                                </h3>
                                {isCrane && (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                        この届はクレーン・車両系建設機械の区分の機械が対象です（1台につき1ページで出力されます）
                                    </p>
                                )}
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        value={itemSearch}
                                        onChange={(e) => setItemSearch(e.target.value)}
                                        placeholder={isVehicle ? '車名・登録番号で検索' : '機械名・型式で検索'}
                                        className={`${INPUT_CLASS} pl-9`}
                                    />
                                </div>
                                <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl p-2">
                                    {filteredCandidates.length === 0 ? (
                                        <p className="text-sm text-slate-400 text-center py-4">
                                            {isVehicle
                                                ? '車両がありません（設定 > 車両管理 で登録してください）'
                                                : '機械がありません（設定 > 車両・機械 安全情報 で登録してください）'}
                                        </p>
                                    ) : (
                                        <ul className="space-y-0.5">
                                            {filteredCandidates.map((c) => (
                                                <li key={c.id}>
                                                    <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedIdSet.has(c.id)}
                                                            onChange={() => toggleItem(c.id, c.defaultPerson)}
                                                            className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                                        />
                                                        <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">
                                                            {c.name}
                                                            {c.sub ? <span className="text-xs text-slate-500">（{c.sub}）</span> : null}
                                                        </span>
                                                        {isVehicle && !c.hasProfile && (
                                                            <span className="text-[10px] text-amber-600 shrink-0">安全情報未登録</span>
                                                        )}
                                                        {isCrane && !c.isCraneCategory && (
                                                            <span className="text-[10px] text-amber-600 shrink-0">一般区分</span>
                                                        )}
                                                    </label>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {/* 選択済み（並び順 = 記載順。行ごとに運転者/取扱者を入力） */}
                                {selectedItems.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold text-slate-500 mb-1">
                                            記載順（上下ボタンで並び替え・{personLabel}は行ごとに入力）
                                        </div>
                                        <ul className="space-y-1">
                                            {selectedItems.map((item, index) => {
                                                const snapshot = isVehicle ? resolveVehicleSnapshot(item) : resolveMachineSnapshot(item);
                                                const missing = snapshot
                                                    ? isVehicle
                                                        ? getVehicleTodokeMissingFields(snapshot as TodokeVehicleSnapshot)
                                                        : getMachineMissingFields(snapshot as MachineSnapshot)
                                                    : [];
                                                const qualWarning = craneQualWarning(item.personName);
                                                return (
                                                    <li
                                                        key={item.id}
                                                        className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                                                    >
                                                        <span className="text-xs text-slate-400 w-6 shrink-0">{index + 1}</span>
                                                        <span className="text-sm text-slate-800 flex-1 min-w-[120px] truncate">
                                                            {snapshot?.name ?? '（不明な対象）'}
                                                        </span>
                                                        <input
                                                            type="text"
                                                            value={item.personName}
                                                            onChange={(e) => setPersonName(index, e.target.value)}
                                                            placeholder={personLabel}
                                                            className="w-36 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                                                        />
                                                        {(missing.length > 0 || qualWarning) && (
                                                            <span
                                                                className="flex items-center gap-1 text-[10px] text-amber-600 shrink-0"
                                                                title={[...missing, ...(qualWarning ? [qualWarning] : [])].join('・')}
                                                            >
                                                                <AlertTriangle className="w-3.5 h-3.5" />
                                                                {missing.length > 0 ? `${missing.length}項目未入力` : ''}
                                                                {qualWarning ? '資格未確認' : ''}
                                                            </span>
                                                        )}
                                                        <div className="flex items-center shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => moveItem(index, -1)}
                                                                disabled={index === 0}
                                                                className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                                                aria-label="上へ"
                                                            >
                                                                <ArrowUp className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => moveItem(index, 1)}
                                                                disabled={index === selectedItems.length - 1}
                                                                className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                                                aria-label="下へ"
                                                            >
                                                                <ArrowDown className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => removeItem(index)}
                                                                className="p-1 text-slate-400 hover:text-red-600"
                                                                aria-label="外す"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </section>
                        </div>
                    )}
                </div>

                {/* ── 右: ライブプレビュー（lg+） ── */}
                {previewVisible && (
                    <div className="hidden lg:block lg:w-1/2 min-h-0 border border-slate-200 rounded-xl overflow-hidden">
                        <LivePdfPreview seed={previewSeed} renderPdf={() => renderSafetyDocumentBlob(docType, previewData)} />
                    </div>
                )}
            </div>
        </div>
    );
}
