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
    getMeiboMissingFields,
    getSafetyTargetGroup,
    SAFETY_TARGET_GROUP_LABELS,
    type MeiboHeader,
    type MeiboWorkerSnapshot,
    type SafetySource,
    type SagyoinMeiboData,
    type SafetyTargetGroup,
} from '@/lib/safetyDocuments';
import { targetToWorkerSnapshot, todayJstIsoDate } from '@/lib/safetyClient';
import {
    exportSagyoinMeiboPDF,
    printSagyoinMeiboPDF,
    renderSagyoinMeiboBlob,
} from '@/utils/sagyoinMeiboPdf';
import type { SafetyDocumentDto, SafetyTargetDto } from '@/types/safety';
import { logger } from '@/lib/logger';

interface MemberRef {
    source: SafetySource;
    sourceId: string;
}

interface ProjectOption {
    id: string;
    title: string;
}

interface SagyoinMeiboWizardProps {
    /** 編集対象（null = 新規作成） */
    editingDoc: SafetyDocumentDto | null;
    /** 複製元（新規作成扱い。ヘッダー・メンバー構成のみ引き継ぎ、スナップショットは最新値で再取得） */
    duplicateSource: SafetyDocumentDto | null;
    onSaved: () => void;
    onCancel: () => void;
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

export default function SagyoinMeiboWizard({
    editingDoc,
    duplicateSource,
    onSaved,
    onCancel,
}: SagyoinMeiboWizardProps) {
    const initialDoc = editingDoc ?? duplicateSource;

    const [currentDoc, setCurrentDoc] = useState<SafetyDocumentDto | null>(editingDoc);
    const [targets, setTargets] = useState<SafetyTargetDto[]>([]);
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const [title, setTitle] = useState(
        editingDoc ? editingDoc.title : duplicateSource ? `${duplicateSource.title}（複製）` : ''
    );
    const [projectId, setProjectId] = useState<string | null>(initialDoc?.projectId ?? null);
    const [header, setHeader] = useState<MeiboHeader>(
        initialDoc ? { ...EMPTY_HEADER, ...initialDoc.data.header } : { ...EMPTY_HEADER, submitDate: todayJstIsoDate() }
    );
    const [selectedRefs, setSelectedRefs] = useState<MemberRef[]>(
        initialDoc ? initialDoc.data.workers.map((w) => ({ source: w.source, sourceId: w.sourceId })) : []
    );

    const [memberSearch, setMemberSearch] = useState('');
    const [partnerOpen, setPartnerOpen] = useState(false);

    const { visible: previewVisible, toggle: togglePreview } = usePdfPreviewVisible(
        'dandolink:pdfPreview:safetyMeibo'
    );

    // 編集時: 保存済みスナップショットは据え置きで表示する（FR-4-2。複製は最新値で取り直すため含めない）
    const existingWorkerMap = useMemo(() => {
        const map = new Map<string, MeiboWorkerSnapshot>();
        if (currentDoc) {
            for (const w of currentDoc.data.workers) map.set(w.key, w);
        }
        return map;
    }, [currentDoc]);

    const targetMap = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);

    // 初期データ（対象一覧・案件一覧・自社情報）を並列フェッチ
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [targetsRes, projectsRes, companyRes] = await Promise.all([
                    fetch('/api/safety-profiles', { cache: 'no-store' }),
                    fetch('/api/project-masters?status=active', { cache: 'no-store' }),
                    fetch('/api/master-data/company', { cache: 'no-store' }),
                ]);
                if (cancelled) return;

                if (targetsRes.ok) setTargets(await targetsRes.json());
                if (projectsRes.ok) {
                    const data = await projectsRes.json();
                    const list = Array.isArray(data) ? data : data?.data ?? [];
                    setProjects(list.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })));
                }
                if (companyRes.ok) {
                    const company = await companyRes.json();
                    if (company) {
                        // 自社情報は未入力のフィールドにだけ補完する（編集・複製時の保存値を上書きしない）
                        setHeader((prev) => ({
                            ...prev,
                            companyName: prev.companyName || company.name || '',
                            companyRepresentative: prev.companyRepresentative || company.representative || '',
                            companyAddress: prev.companyAddress || company.address || '',
                        }));
                    }
                }
            } catch (error) {
                logger.error('安全書類ウィザード初期データ取得エラー:', error);
                toast.error('データの取得に失敗しました');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const updateHeader = (patch: Partial<MeiboHeader>) => setHeader((prev) => ({ ...prev, ...patch }));

    const handleProjectSelect = (id: string) => {
        setProjectId(id || null);
        const project = projects.find((p) => p.id === id);
        if (project) updateHeader({ siteName: project.title });
    };

    /** 選択中メンバーの表示用スナップショット（編集時は保存済みを優先 = 保存結果と一致） */
    const resolveSnapshot = React.useCallback(
        (ref: MemberRef): MeiboWorkerSnapshot | null => {
            const key = `${ref.source}:${ref.sourceId}`;
            const existing = existingWorkerMap.get(key);
            if (existing) return existing;
            const target = targetMap.get(key);
            return target ? targetToWorkerSnapshot(target) : null;
        },
        [existingWorkerMap, targetMap]
    );

    const previewData = useMemo<SagyoinMeiboData>(
        () => ({
            header,
            workers: selectedRefs
                .map(resolveSnapshot)
                .filter((w): w is MeiboWorkerSnapshot => w !== null),
        }),
        [header, selectedRefs, resolveSnapshot]
    );
    const previewSeed = useMemo(() => JSON.stringify(previewData), [previewData]);

    // グループ別の選択候補（FR-2-2: 初期表示は自社系・協力会社は折りたたみ）
    const groupedTargets = useMemo(() => {
        const q = memberSearch.trim();
        const filtered = q
            ? targets.filter(
                  (t) => t.name.includes(q) || (t.profile?.furigana ?? '').includes(q) || (t.companyName ?? '').includes(q)
              )
            : targets;
        const groups: Record<SafetyTargetGroup, SafetyTargetDto[]> = { employee: [], worker: [], partner: [] };
        for (const t of filtered) groups[getSafetyTargetGroup(t.source, t.role)].push(t);
        return groups;
    }, [targets, memberSearch]);

    const selectedKeySet = useMemo(
        () => new Set(selectedRefs.map((r) => `${r.source}:${r.sourceId}`)),
        [selectedRefs]
    );

    const toggleMember = (target: SafetyTargetDto) => {
        const key = target.key;
        setSelectedRefs((prev) => {
            if (prev.some((r) => `${r.source}:${r.sourceId}` === key)) {
                return prev.filter((r) => `${r.source}:${r.sourceId}` !== key);
            }
            return [...prev, { source: target.source, sourceId: target.sourceId }];
        });
    };

    const moveMember = (index: number, delta: -1 | 1) => {
        setSelectedRefs((prev) => {
            const next = [...prev];
            const to = index + delta;
            if (to < 0 || to >= next.length) return prev;
            [next[index], next[to]] = [next[to], next[index]];
            return next;
        });
    };

    const removeMember = (index: number) => {
        setSelectedRefs((prev) => prev.filter((_, i) => i !== index));
    };

    const effectiveTitle = () =>
        title.trim() || `${header.siteName ? `${header.siteName} ` : ''}作業員名簿`;

    const handleSave = async () => {
        if (!header.submitDate) {
            toast.error('提出日を入力してください');
            return;
        }
        if (selectedRefs.length === 0) {
            toast.error('作業員を1名以上選択してください');
            return;
        }
        setIsSaving(true);
        try {
            const isUpdate = !!currentDoc;
            const body = isUpdate
                ? { projectId, title: effectiveTitle(), header, members: selectedRefs }
                : { type: 'sagyoin_meibo', projectId, title: effectiveTitle(), header, members: selectedRefs };
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

    // FR-4-3: マスターの最新値でスナップショットを再取得（編集時のみ）
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
                toast(`マスターから削除済みの ${notFoundKeys.length} 名は保存時の内容のままです`, { icon: '⚠️' });
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
            await exportSagyoinMeiboPDF(previewData, effectiveTitle());
        } catch {
            toast.error('PDFの出力に失敗しました');
        }
    };

    const handlePrint = async () => {
        try {
            await printSagyoinMeiboPDF(previewData);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '印刷用PDFを開けませんでした');
        }
    };

    const renderGroup = (group: SafetyTargetGroup) => {
        const list = groupedTargets[group];
        if (list.length === 0) return null;
        const items = (
            <ul className="space-y-0.5">
                {list.map((t) => {
                    const checked = selectedKeySet.has(t.key);
                    return (
                        <li key={t.key}>
                            <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleMember(t)}
                                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                />
                                <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">
                                    {t.name}
                                    {group === 'partner' && t.companyName ? (
                                        <span className="text-xs text-slate-500">（{t.companyName}）</span>
                                    ) : null}
                                </span>
                                {!t.profile && (
                                    <span className="text-[10px] text-amber-600 shrink-0">安全情報未登録</span>
                                )}
                            </label>
                        </li>
                    );
                })}
            </ul>
        );

        // 協力会社は折りたたみ（初期表示は自社系のみ。FR-2-2）
        if (group === 'partner') {
            return (
                <div key={group}>
                    <button
                        type="button"
                        onClick={() => setPartnerOpen((v) => !v)}
                        className="w-full text-left px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
                    >
                        {partnerOpen ? '▼' : '▶'} {SAFETY_TARGET_GROUP_LABELS[group]}（{list.length}名）
                    </button>
                    {partnerOpen && items}
                </div>
            );
        }
        return (
            <div key={group}>
                <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                    {SAFETY_TARGET_GROUP_LABELS[group]}（{list.length}名）
                </div>
                {items}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* ツールバー */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="w-4 h-4" />} onClick={onCancel}>
                    一覧へ戻る
                </Button>
                <h2 className="text-lg font-semibold text-slate-900 flex-1 min-w-0 truncate">
                    {currentDoc ? '作業員名簿の編集' : '作業員名簿の作成'}
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
                                        placeholder="空欄の場合は「現場名 作業員名簿」を自動設定"
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
                                        <label className={LABEL_CLASS}>提出日（年齢算出の基準日）</label>
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

                            {/* 作業員選択 */}
                            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                                <h3 className="text-sm font-semibold text-slate-900">
                                    作業員を選択
                                    <span className="ml-2 text-xs font-normal text-slate-500">
                                        選択中 {selectedRefs.length}名
                                    </span>
                                </h3>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        type="text"
                                        value={memberSearch}
                                        onChange={(e) => setMemberSearch(e.target.value)}
                                        placeholder="氏名・ふりがな・会社名で検索"
                                        className={`${INPUT_CLASS} pl-9`}
                                    />
                                </div>
                                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl p-2">
                                    {renderGroup('employee')}
                                    {renderGroup('worker')}
                                    {renderGroup('partner')}
                                    {targets.length === 0 && (
                                        <p className="text-sm text-slate-400 text-center py-4">対象がありません</p>
                                    )}
                                </div>

                                {/* 選択済み（並び順 = 名簿の記載順） */}
                                {selectedRefs.length > 0 && (
                                    <div>
                                        <div className="text-xs font-semibold text-slate-500 mb-1">
                                            記載順（上下ボタンで並び替え）
                                        </div>
                                        <ul className="space-y-1">
                                            {selectedRefs.map((ref, index) => {
                                                const snapshot = resolveSnapshot(ref);
                                                const missing = snapshot ? getMeiboMissingFields(snapshot) : [];
                                                return (
                                                    <li
                                                        key={`${ref.source}:${ref.sourceId}`}
                                                        className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                                                    >
                                                        <span className="text-xs text-slate-400 w-6 shrink-0">
                                                            {index + 1}
                                                        </span>
                                                        <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">
                                                            {snapshot?.name ?? '（不明な対象）'}
                                                        </span>
                                                        {missing.length > 0 && (
                                                            <span
                                                                className="flex items-center gap-1 text-[10px] text-amber-600 shrink-0"
                                                                title={`未入力: ${missing.join('・')}`}
                                                            >
                                                                <AlertTriangle className="w-3.5 h-3.5" />
                                                                {missing.length}項目未入力
                                                            </span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => moveMember(index, -1)}
                                                            disabled={index === 0}
                                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                                            aria-label="上へ"
                                                        >
                                                            <ArrowUp className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => moveMember(index, 1)}
                                                            disabled={index === selectedRefs.length - 1}
                                                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                                            aria-label="下へ"
                                                        >
                                                            <ArrowDown className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeMember(index)}
                                                            className="p-1 text-slate-400 hover:text-red-600"
                                                            aria-label="外す"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
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
                        <LivePdfPreview seed={previewSeed} renderPdf={() => renderSagyoinMeiboBlob(previewData)} />
                    </div>
                )}
            </div>
        </div>
    );
}
