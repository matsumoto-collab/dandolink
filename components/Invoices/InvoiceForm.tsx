'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useProjectMasters } from '@/hooks/useProjectMasters';
import { useCustomers } from '@/hooks/useCustomers';
import { useEstimates } from '@/hooks/useEstimates';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Invoice, InvoiceInput, InvoiceItem, BillingTitle } from '@/types/invoice';
import { Project } from '@/types/calendar';
import { CompanyInfo } from '@/types/company';
import { UnitPriceMaster } from '@/types/unitPrice';
import toast from 'react-hot-toast';
import { formatDateKey } from '@/utils/employeeUtils';
import { InlinePdfViewer } from '@/components/ui/InlinePdfViewer';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import { PdfPreviewToggle } from '@/components/ui/PdfPreviewToggle';
import { usePdfPreviewVisible } from '@/hooks/usePdfPreviewVisible';
import CustomerModal from '../Customers/CustomerModal';
import UnitPriceMasterModal from '../Estimates/UnitPriceMasterModal';
import ItemsEditor from '../Estimates/ItemsEditor';
import SummaryFooter from '../Estimates/SummaryFooter';
import ConditionNotes from '../Estimates/ConditionNotes';
import InvoiceHeader from './InvoiceHeader';
import { FileDown, Plus, List, Eye, X, Trash2, ChevronDown } from 'lucide-react';
import { logger } from '@/lib/logger';

interface InvoiceFormProps {
    initialData?: Partial<InvoiceInput>;
    onSubmit: (data: InvoiceInput) => Promise<void> | void;
    onCancel: () => void;
}

function getDefault30DaysLater(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return formatDateKey(date);
}

// 手入力（案件に紐付かない）セクションのキー。'_none' / '_none-<n>'。
const MANUAL_KEY_PREFIX = '_none';
function isManualKey(key?: string | null): boolean {
    return !!key && (key === MANUAL_KEY_PREFIX || key.startsWith(`${MANUAL_KEY_PREFIX}-`));
}

/**
 * 既存データ/新規から明細グループの初期状態を構築する。
 * - 案件セクション: キー = 案件ID（見出し未入力は表示側で案件マスタ名にフォールバック）
 * - 手入力セクション: キー = '_none' / '_none-<n>'。案件IDなしの明細を sectionTitle ごとに別セクションへ復元。
 */
function buildInitialGroups(initialData?: Partial<InvoiceInput>): {
    itemsByProject: Record<string, InvoiceItem[]>;
    sectionTitles: Record<string, string>;
    manualKeys: string[];
} {
    const itemsByProject: Record<string, InvoiceItem[]> = {};
    const sectionTitles: Record<string, string> = {};
    const manualKeys: string[] = [];
    const items = initialData?.items;
    if (items && items.length > 0) {
        const titleToManualKey = new Map<string, string>();
        for (const item of items) {
            const pmId = item.projectMasterId || initialData?.projectId;
            if (pmId) {
                if (!itemsByProject[pmId]) itemsByProject[pmId] = [];
                itemsByProject[pmId].push(item);
                const st = item.sectionTitle?.trim();
                if (st && sectionTitles[pmId] === undefined) sectionTitles[pmId] = st;
            } else {
                const st = item.sectionTitle?.trim() ?? '';
                let key = titleToManualKey.get(st);
                if (key === undefined) {
                    key = manualKeys.length === 0 ? MANUAL_KEY_PREFIX : `${MANUAL_KEY_PREFIX}-${manualKeys.length}`;
                    titleToManualKey.set(st, key);
                    manualKeys.push(key);
                    if (st) sectionTitles[key] = st;
                }
                if (!itemsByProject[key]) itemsByProject[key] = [];
                // 手入力セクションは projectMasterId をフォームのキーに合わせる（保存時に null へ戻す）
                itemsByProject[key].push({ ...item, projectMasterId: key });
            }
        }
    }
    // 新規（明細なし）かつ案件も未選択なら、手入力セクションを1つ用意して従来挙動を維持
    if (manualKeys.length === 0) {
        const preProjects = initialData?.projectMasterIds || (initialData?.projectId ? [initialData.projectId] : []);
        if (preProjects.length === 0 && Object.keys(itemsByProject).length === 0) {
            manualKeys.push(MANUAL_KEY_PREFIX);
        }
    }
    return { itemsByProject, sectionTitles, manualKeys };
}

export default function InvoiceForm({ initialData, onSubmit, onCancel }: InvoiceFormProps) {
    const { projectMasters, fetchProjectMasters } = useProjectMasters();
    const { customers, addCustomer, ensureDataLoaded } = useCustomers();
    const { estimates, ensureDataLoaded: ensureEstimatesLoaded } = useEstimates();

    // 請求項目マスタ
    const [billingTitles, setBillingTitles] = useState<BillingTitle[]>([]);

    useEffect(() => {
        fetchProjectMasters();
        ensureDataLoaded();
        ensureEstimatesLoaded();
        fetch('/api/master-data/billing-titles')
            .then(r => r.ok ? r.json() : [])
            .then(setBillingTitles)
            .catch(() => {});
    }, [fetchProjectMasters, ensureDataLoaded, ensureEstimatesLoaded]);

    // 基本情報
    const [customerId, setCustomerId] = useState(initialData?.customerId || '');
    const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
        initialData?.projectMasterIds || (initialData?.projectId ? [initialData.projectId] : [])
    );
    const [title, setTitle] = useState(initialData?.title || '');
    const [invoiceNumber, setInvoiceNumber] = useState(initialData?.invoiceNumber || '');
    const [dueDate, setDueDate] = useState(() => {
        if (initialData?.dueDate) return formatDateKey(new Date(initialData.dueDate));
        return getDefault30DaysLater();
    });
    const [issueDate, setIssueDate] = useState(() => {
        if (initialData?.createdAt) return formatDateKey(new Date(initialData.createdAt));
        return formatDateKey(new Date());
    });
    const [status, setStatus] = useState<InvoiceInput['status']>(initialData?.status || 'draft');
    const [paidDate, setPaidDate] = useState(() => {
        if (initialData?.paidDate) return formatDateKey(new Date(initialData.paidDate));
        return '';
    });
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isUnitPriceModalOpen, setIsUnitPriceModalOpen] = useState(false);
    const [unitPriceTargetPmId, setUnitPriceTargetPmId] = useState<string>('');

    // 明細グループ（案件セクション＋案件なしの手入力セクション）の初期状態を一度だけ構築。
    // 明細: グループごとに { [案件ID | 手入力キー]: InvoiceItem[] }
    const [itemsByProject, setItemsByProject] = useState<Record<string, InvoiceItem[]>>(
        () => buildInitialGroups(initialData).itemsByProject,
    );

    // 明細グループの見出し（この請求書だけのローカル上書き）。
    // キー: 案件ID または手入力キー（'_none' / '_none-<n>'）。未設定の案件は案件マスタ名にフォールバック。
    const [sectionTitles, setSectionTitles] = useState<Record<string, string>>(
        () => buildInitialGroups(initialData).sectionTitles,
    );

    // 案件に紐付かない手入力セクションのキー一覧（描画順）。「セクションを追加」で増やせる。
    const [manualKeys, setManualKeys] = useState<string[]>(
        () => buildInitialGroups(initialData).manualKeys,
    );

    // 顧客変更時にcustomerIdから案件を自動特定
    useEffect(() => {
        if (!customerId || initialData?.customerId) return;
        // 顧客変更でprojectIdsをリセット
        setSelectedProjectIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [customerId]);

    // 初回: customerId未設定で、projectMasterIdsがある場合にcustomerIdを逆引き
    useEffect(() => {
        if (customerId || selectedProjectIds.length === 0) return;
        const pm = projectMasters.find(p => selectedProjectIds.includes(p.id));
        if (pm?.customerId) {
            setCustomerId(pm.customerId);
        } else if (pm?.customerName) {
            const c = customers.find(c => c.name === pm.customerName || c.shortName === pm.customerName);
            if (c) setCustomerId(c.id);
        }
    }, [customerId, selectedProjectIds, projectMasters, customers]);

    // 顧客に紐付く案件一覧
    const customerProjects = React.useMemo(() => {
        if (!customerId) return [];
        const customer = customers.find(c => c.id === customerId);
        if (!customer) return [];
        return projectMasters
            .filter(pm => {
                if (pm.customerId === customerId) return true;
                if (pm.customerName === customer.name || pm.customerName === customer.shortName) return true;
                if (pm.customerShortName === customer.shortName || pm.customerShortName === customer.name) return true;
                return false;
            })
            .map(pm => ({ id: pm.id, title: pm.title }));
    }, [customerId, customers, projectMasters]);

    const handleToggleProject = useCallback((pmId: string) => {
        setSelectedProjectIds(prev => {
            if (prev.includes(pmId)) {
                // 案件を外す → その案件の明細も削除
                setItemsByProject(prevItems => {
                    const next = { ...prevItems };
                    delete next[pmId];
                    return next;
                });
                return prev.filter(id => id !== pmId);
            }
            return [...prev, pmId];
        });
    }, []);

    // 見積書から案件の明細を読み込み。
    // mode='category': カテゴリは合計1行で読込（categoryType='detail'）＝従来挙動。
    // mode='full':     カテゴリ見出し＋子明細を展開して読込（categoryType='inline'）。
    // いずれも子明細データ（children）は保持し、合計はカテゴリ amount で計上されるため変わらない。
    const loadFromEstimate = useCallback((pmId: string, mode: 'category' | 'full') => {
        const pmEstimates = estimates.filter(e => e.projectId === pmId);
        if (pmEstimates.length === 0) {
            toast.error('この案件に紐付く見積書がありません');
            return;
        }
        // 最新の見積書を使用
        const latest = pmEstimates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const items: InvoiceItem[] = latest.items.map(item => {
            const next: InvoiceItem = { ...item, projectMasterId: pmId };
            if (item.isCategory) {
                next.categoryType = mode === 'full' ? 'inline' : 'detail';
            }
            return next;
        });
        setItemsByProject(prev => ({ ...prev, [pmId]: items }));
        if (!title) {
            setTitle(latest.title.replace('見積書', '請求書'));
        }
        toast.success(
            `${latest.estimateNumber} の明細を読み込みました（${mode === 'full' ? '明細もすべて' : 'カテゴリのみ'}）`,
        );
    }, [estimates, title]);

    // 請求項目マスタから追加
    const addFromBillingTitle = useCallback((pmId: string, bt: BillingTitle) => {
        const qty = bt.quantity ?? 1;
        const newItem: InvoiceItem = {
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description: bt.name,
            specification: '',
            quantity: qty,
            unit: bt.unit || '式',
            unitPrice: 0,
            amount: 0,
            taxType: 'standard',
            notes: '',
            projectMasterId: pmId,
        };
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: [...(prev[pmId] || []), newItem],
        }));
    }, []);

    // 空の明細を追加
    const addEmptyItem = useCallback((pmId: string) => {
        const newItem: InvoiceItem = {
            id: `item-${Date.now()}`,
            description: '',
            specification: '',
            quantity: 0,
            unit: '',
            unitPrice: 0,
            amount: 0,
            taxType: 'standard',
            notes: '',
            projectMasterId: pmId,
        };
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: [...(prev[pmId] || []), newItem],
        }));
    }, []);

    // 単価マスタから追加
    const handleSelectFromMaster = (selectedMasters: UnitPriceMaster[]) => {
        const pmId = unitPriceTargetPmId;
        const newItems: InvoiceItem[] = selectedMasters.map(master => {
            const qty = master.quantity ?? 1;
            return {
            id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            description: master.description,
            specification: '',
            quantity: qty,
            unit: master.unit,
            unitPrice: master.unitPrice,
            amount: Math.round(qty * master.unitPrice),
            taxType: 'standard' as const,
            notes: '',
            projectMasterId: pmId,
        };
        });
        setItemsByProject(prev => {
            const existing = prev[pmId] || [];
            const nonEmpty = existing.filter(item => item.description.trim() !== '' || item.unitPrice > 0);
            return { ...prev, [pmId]: [...nonEmpty, ...newItems] };
        });
        setIsUnitPriceModalOpen(false);
    };

    // 明細操作（案件内）
    const updateItem = (pmId: string, id: string, field: string, value: unknown) => {
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: (prev[pmId] || []).map(item => {
                if (item.id === id) {
                    const updated = { ...item, [field]: value };
                    if (field === 'quantity' || field === 'unitPrice') {
                        updated.amount = Math.round(updated.quantity * updated.unitPrice);
                    }
                    return updated;
                }
                return item;
            }),
        }));
    };

    const removeItem = (pmId: string, id: string) => {
        setItemsByProject(prev => ({
            ...prev,
            [pmId]: (prev[pmId] || []).filter(item => item.id !== id),
        }));
    };

    const moveItemUp = (pmId: string, index: number) => {
        if (index === 0) return;
        setItemsByProject(prev => {
            const items = [...(prev[pmId] || [])];
            [items[index - 1], items[index]] = [items[index], items[index - 1]];
            return { ...prev, [pmId]: items };
        });
    };

    const moveItemDown = (pmId: string, index: number) => {
        setItemsByProject(prev => {
            const items = [...(prev[pmId] || [])];
            if (index >= items.length - 1) return prev;
            [items[index], items[index + 1]] = [items[index + 1], items[index]];
            return { ...prev, [pmId]: items };
        });
    };

    const reorderItems = (pmId: string, fromIndex: number, toIndex: number) => {
        setItemsByProject(prev => {
            const items = [...(prev[pmId] || [])];
            const [moved] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, moved);
            return { ...prev, [pmId]: items };
        });
    };

    const reorderChildItems = (pmId: string, parentId: string, fromIndex: number, toIndex: number) => {
        setItemsByProject(prev => {
            const items = (prev[pmId] || []).map(item => {
                if (item.id === parentId && item.children) {
                    const children = [...item.children];
                    const [moved] = children.splice(fromIndex, 1);
                    children.splice(toIndex, 0, moved);
                    return { ...item, children };
                }
                return item;
            });
            return { ...prev, [pmId]: items };
        });
    };

    // 手入力セクション（案件に紐付かない見出し付きブロック）を追加
    const addManualSection = useCallback(() => {
        setManualKeys(prev => {
            const used = new Set(prev);
            if (!used.has(MANUAL_KEY_PREFIX)) return [...prev, MANUAL_KEY_PREFIX];
            let n = 1;
            while (used.has(`${MANUAL_KEY_PREFIX}-${n}`)) n++;
            return [...prev, `${MANUAL_KEY_PREFIX}-${n}`];
        });
    }, []);

    // 手入力セクションを削除（その明細・見出しも破棄）
    const removeManualSection = useCallback((key: string) => {
        setManualKeys(prev => prev.filter(k => k !== key));
        setItemsByProject(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        setSectionTitles(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    // 全明細をフラット化（案件→手入力セクションの描画順を維持して連結）
    const allItems = React.useMemo(() => {
        const orderedKeys = [...selectedProjectIds, ...manualKeys];
        const seen = new Set(orderedKeys);
        const restKeys = Object.keys(itemsByProject).filter(k => !seen.has(k));
        return [...orderedKeys, ...restKeys].flatMap(key => itemsByProject[key] || []);
    }, [itemsByProject, selectedProjectIds, manualKeys]);

    // 明細に見出し(sectionTitle)を焼き付けたもの（保存・プレビュー用）。
    // 案件グループはユーザーが入力したときだけ上書き値を焼き付ける。
    // （未入力なら sectionTitle 無し → 表示側で案件マスタ名にフォールバック）
    const allItemsWithTitles = React.useMemo(() => {
        return allItems.map(item => {
            const key = item.projectMasterId || '_none';
            const raw = sectionTitles[key];
            const st = raw !== undefined && raw.trim() !== '' ? raw.trim() : undefined;
            return { ...item, sectionTitle: st };
        });
    }, [allItems, sectionTitles]);

    // 消費税率
    const TAX_RATE = 0.1;
    const subtotal = allItems.reduce((sum, item) => sum + item.amount, 0);
    const taxableAmount = allItems.filter(item => item.taxType === 'standard').reduce((sum, item) => sum + item.amount, 0);
    const tax = Math.floor(taxableAmount * TAX_RATE);
    const total = subtotal + tax;

    const [isSubmitting, setIsSubmitting] = useState(false);

    // lg+ で左右分割レイアウトを有効化
    const isLgScreen = useMediaQuery('(min-width: 1024px)');

    // PDFプレビューの表示/非表示（lg+ のみ。localStorage に永続化・画面ごとに独立）
    const { visible: previewVisible, toggle: togglePreview } = usePdfPreviewVisible('invoice-pdf-preview-visible');

    // PDFプレビュー用
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewPdfUrl, setPreviewPdfUrl] = useState('');
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
    const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);

    // 会社情報をフェッチ（プレビュー用）
    useEffect(() => {
        fetch('/api/master-data/company').then(r => r.json()).then(data => {
            if (data) setCompanyInfo(data);
        }).catch(() => {});
    }, []);

    // プレビューURLのクリーンアップ
    useEffect(() => {
        return () => {
            if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
        };
    }, [previewPdfUrl]);

    /** プレビュー用の一時 Invoice/Project/CompanyInfo を構築 */
    const buildPreviewTempData = useCallback(() => {
        const customer = customers.find(c => c.id === customerId);
        const firstPmId = selectedProjectIds[0];
        const firstPm = projectMasters.find(p => p.id === firstPmId);

        // 複数案件ヘッダー用
        const invoiceProjectMasters = selectedProjectIds
            .map(pmId => {
                const pm = projectMasters.find(p => p.id === pmId);
                return pm ? { id: pm.id, title: pm.title } : null;
            })
            .filter((x): x is { id: string; title: string } => x !== null);

        const tempInvoice: Invoice = {
            id: 'preview',
            projectId: firstPmId,
            customerId: customerId || undefined,
            invoiceNumber: invoiceNumber || '（自動採番）',
            title: title || '請求書',
            items: allItemsWithTitles.map(it => isManualKey(it.projectMasterId) ? { ...it, projectMasterId: undefined } : it),
            subtotal,
            tax,
            total,
            dueDate: new Date(dueDate),
            status,
            paidDate: paidDate ? new Date(paidDate) : undefined,
            notes: notes || undefined,
            createdAt: issueDate ? new Date(issueDate) : new Date(),
            updatedAt: new Date(),
            projectMasterIds: selectedProjectIds.length > 0 ? selectedProjectIds : undefined,
            projectMasters: invoiceProjectMasters.length > 0 ? invoiceProjectMasters : undefined,
        };

        const locationParts = firstPm
            ? [firstPm.prefecture, firstPm.city, firstPm.location].filter(Boolean).join('')
            : '';
        const tempProject: Project & { customerPostalCode?: string; customerAddress?: string } = {
            id: firstPmId || 'preview',
            title: firstPm?.title || title,
            startDate: new Date(),
            category: 'construction' as const,
            color: '#3B82F6',
            customer: customer?.name || '',
            customerHonorific: customer?.honorific || '御中',
            location: locationParts,
            customerPostalCode: customer?.postalCode || '',
            customerAddress: customer?.address || '',
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const effectiveCompanyInfo: CompanyInfo = companyInfo || {
            id: '', name: '', postalCode: '', address: '', tel: '', representative: '',
            createdAt: new Date(), updatedAt: new Date(),
        };

        return { tempInvoice, tempProject: tempProject as Project, effectiveCompanyInfo };
    }, [customers, customerId, selectedProjectIds, projectMasters, invoiceNumber, title, allItemsWithTitles, subtotal, tax, total, dueDate, status, paidDate, notes, issueDate, companyInfo]);

    // PDFプレビュー生成（手動・フルスクリーン用）
    const handlePreview = async () => {
        if (isGeneratingPreview) return;
        setIsGeneratingPreview(true);
        try {
            const { generateInvoicePDFBlobReact } = await import('@/utils/reactPdfGenerator');
            const { tempInvoice, tempProject, effectiveCompanyInfo } = buildPreviewTempData();
            const url = await generateInvoicePDFBlobReact(tempInvoice, tempProject, effectiveCompanyInfo, tempInvoice.projectMasters, { includeCopy: true, includeDetails: false });
            if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
            setPreviewPdfUrl(url);
            setIsPreviewOpen(true);
        } catch (error) {
            logger.error('プレビュー生成エラー:', error);
            toast.error('プレビューの生成に失敗しました');
        } finally {
            setIsGeneratingPreview(false);
        }
    };

    /** ライブプレビュー用 Blob 生成 */
    const buildLivePdfBlob = useCallback(async (): Promise<Blob | null> => {
        // 最低限タイトルが無いとプレビューが空になりがちなのでスキップ
        if (!title) return null;
        if (allItems.length === 0) return null;
        const { generateInvoicePDFBlobOnlyReact } = await import('@/utils/reactPdfGenerator');
        const { tempInvoice, tempProject, effectiveCompanyInfo } = buildPreviewTempData();
        return await generateInvoicePDFBlobOnlyReact(tempInvoice, tempProject, effectiveCompanyInfo, tempInvoice.projectMasters, { includeCopy: true, includeDetails: false });
    }, [title, allItems.length, buildPreviewTempData]);

    /** プレビュー再生成のトリガー (seed) */
    const livePreviewSignature = useMemo(() => {
        return JSON.stringify({
            customerId, selectedProjectIds, invoiceNumber, title, dueDate, issueDate, status, paidDate, notes,
            items: allItemsWithTitles,
            companyInfoId: companyInfo?.id ?? '',
        });
    }, [customerId, selectedProjectIds, invoiceNumber, title, dueDate, issueDate, status, paidDate, notes, allItemsWithTitles, companyInfo?.id]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title) { toast.error('タイトルは必須です'); return; }
        if (allItems.length === 0) { toast.error('明細を1つ以上入力してください'); return; }
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const data = {
                projectId: selectedProjectIds[0] || null,
                projectMasterIds: selectedProjectIds.length > 0 ? selectedProjectIds : [],
                customerId,
                invoiceNumber,
                title,
                items: allItemsWithTitles.map(item => isManualKey(item.projectMasterId) ? { ...item, projectMasterId: null } : item),
                subtotal,
                tax,
                total,
                dueDate: new Date(dueDate),
                status,
                paidDate: paidDate ? new Date(paidDate) : null,
                notes: notes || null,
                createdAt: issueDate ? new Date(issueDate) : undefined,
            } as InvoiceInput;
            await onSubmit(data);
        } finally {
            setIsSubmitting(false);
        }
    };

    // 請求項目マスタ選択ドロップダウン
    const [billingDropdownPmId, setBillingDropdownPmId] = useState<string | null>(null);
    const [estimateDropdownPmId, setEstimateDropdownPmId] = useState<string | null>(null);

    return (
        <form onSubmit={handleSubmit} className="lg:h-full lg:flex lg:flex-col lg:min-h-0">
            <div className="lg:flex-1 lg:flex lg:flex-col lg:min-h-0 lg:overflow-hidden">
                {/* lg+ ツールバー: プレビュー表示/非表示トグル（モバイルでは非表示・既存挙動を維持） */}
                <div className="hidden lg:flex lg:flex-shrink-0 lg:items-center lg:justify-end lg:gap-2 lg:px-6 lg:py-2 lg:border-b lg:border-slate-200 lg:bg-white">
                    <PdfPreviewToggle visible={previewVisible} onToggle={togglePreview} />
                </div>

                <div className="lg:flex-1 lg:flex lg:flex-row lg:min-h-0 lg:overflow-hidden">
                {/* 左カラム: フォーム入力 */}
                <div className={`space-y-5 md:space-y-6 lg:flex-1 lg:min-w-0 lg:overflow-y-auto lg:px-6 lg:py-4 lg:transition-all lg:duration-300 lg:ease-in-out ${previewVisible ? 'lg:basis-3/5' : 'lg:basis-full'}`}>
            <InvoiceHeader
                customerId={customerId} setCustomerId={setCustomerId}
                invoiceNumber={invoiceNumber} setInvoiceNumber={setInvoiceNumber}
                title={title} setTitle={setTitle}
                dueDate={dueDate} setDueDate={setDueDate}
                issueDate={issueDate} setIssueDate={setIssueDate}
                status={status} setStatus={(v) => setStatus(v as InvoiceInput['status'])}
                paidDate={paidDate} setPaidDate={setPaidDate}
                customers={customers}
                onOpenCustomerModal={() => setIsCustomerModalOpen(true)}
                selectedProjectIds={selectedProjectIds}
                onToggleProject={handleToggleProject}
                customerProjects={customerProjects}
            />

            {/* 案件ごとの明細セクション */}
            {selectedProjectIds.map(pmId => {
                const pm = projectMasters.find(p => p.id === pmId);
                const pmItems = itemsByProject[pmId] || [];
                const pmEstimates = estimates.filter(e => e.projectId === pmId);

                return (
                    <div key={pmId} className="border border-slate-200 rounded-xl">
                        {/* 案件ヘッダー */}
                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 rounded-t-xl">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                        明細の見出し（この請求書のみ・案件マスタは変更しません）
                                    </label>
                                    <input
                                        type="text"
                                        value={sectionTitles[pmId] !== undefined ? sectionTitles[pmId] : (pm?.title || '')}
                                        onChange={(e) => setSectionTitles(prev => ({ ...prev, [pmId]: e.target.value }))}
                                        placeholder={pm?.title || '見出しを入力'}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm font-semibold text-slate-800 bg-white"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2 sm:pt-5">
                                    {pmEstimates.length > 0 && (
                                        <div className="relative">
                                            <button
                                                type="button"
                                                onClick={() => setEstimateDropdownPmId(estimateDropdownPmId === pmId ? null : pmId)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                            >
                                                <FileDown className="w-3.5 h-3.5" />
                                                見積書から読込
                                                <ChevronDown className="w-3 h-3" />
                                            </button>
                                            {estimateDropdownPmId === pmId && (
                                                <div className="absolute right-0 z-50 mt-1 w-56 bg-white border border-slate-300 rounded-lg shadow-lg">
                                                    <ul className="py-1">
                                                        <li
                                                            className="px-4 py-2.5 hover:bg-slate-100 cursor-pointer"
                                                            onClick={() => { loadFromEstimate(pmId, 'category'); setEstimateDropdownPmId(null); }}
                                                        >
                                                            <div className="text-sm font-medium text-slate-800">カテゴリのみ</div>
                                                            <div className="text-[11px] text-slate-500">カテゴリを合計1行で読込（従来）</div>
                                                        </li>
                                                        <li
                                                            className="px-4 py-2.5 hover:bg-slate-100 cursor-pointer border-t border-slate-100"
                                                            onClick={() => { loadFromEstimate(pmId, 'full'); setEstimateDropdownPmId(null); }}
                                                        >
                                                            <div className="text-sm font-medium text-slate-800">明細もすべて</div>
                                                            <div className="text-[11px] text-slate-500">カテゴリ見出し＋子明細を展開</div>
                                                        </li>
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setBillingDropdownPmId(billingDropdownPmId === pmId ? null : pmId)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                        >
                                            <List className="w-3.5 h-3.5" />
                                            請求項目から追加
                                        </button>
                                        {billingDropdownPmId === pmId && billingTitles.length > 0 && (
                                            <div className="absolute right-0 z-50 mt-1 w-64 bg-white border border-slate-300 rounded-lg shadow-lg">
                                                <ul className="max-h-48 overflow-y-auto py-1">
                                                    {billingTitles.map(bt => (
                                                        <li
                                                            key={bt.id}
                                                            className="px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm"
                                                            onClick={() => {
                                                                addFromBillingTitle(pmId, bt);
                                                                setBillingDropdownPmId(null);
                                                            }}
                                                        >
                                                            {bt.name}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setUnitPriceTargetPmId(pmId);
                                            setIsUnitPriceModalOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                    >
                                        単価マスタ
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => addEmptyItem(pmId)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        行追加
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 明細 */}
                        <div className="p-4">
                            {pmItems.length === 0 ? (
                                <p className="text-sm text-slate-500 text-center py-4">
                                    明細がありません。上のボタンから追加してください。
                                </p>
                            ) : (
                                <ItemsEditor
                                    items={pmItems}
                                    onUpdate={(id, field, value) => updateItem(pmId, id, field as string, value)}
                                    onRemove={(id) => removeItem(pmId, id)}
                                    onMoveUp={(index) => moveItemUp(pmId, index)}
                                    onMoveDown={(index) => moveItemDown(pmId, index)}
                                    onReorder={(fromIndex, toIndex) => reorderItems(pmId, fromIndex, toIndex)}
                                    onReorderChildItem={(parentId, fromIndex, toIndex) => reorderChildItems(pmId, parentId, fromIndex, toIndex)}
                                    onAddItem={() => addEmptyItem(pmId)}
                                    onOpenUnitPriceModal={() => {
                                        setUnitPriceTargetPmId(pmId);
                                        setIsUnitPriceModalOpen(true);
                                    }}
                                    hideAddButtons={true}
                                />
                            )}
                        </div>
                    </div>
                );
            })}

            {/* 案件なしの手入力セクション（複数可・見出しごとに分かれる） */}
            {manualKeys.map((key, idx) => (
                <div key={key} className="border border-slate-200 rounded-xl">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 rounded-t-xl">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <label className="block text-[11px] font-medium text-slate-500 mb-1">
                                    明細の見出し（任意）{manualKeys.length > 1 ? `・セクション ${idx + 1}` : ''}
                                </label>
                                <input
                                    type="text"
                                    value={sectionTitles[key] ?? ''}
                                    onChange={(e) => setSectionTitles(prev => ({ ...prev, [key]: e.target.value }))}
                                    placeholder="例: 〇〇工事 / 品目名など"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm font-semibold text-slate-800 bg-white"
                                />
                            </div>
                            <div className="flex flex-wrap gap-2 sm:pt-5">
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setBillingDropdownPmId(billingDropdownPmId === key ? null : key)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                    >
                                        <List className="w-3.5 h-3.5" />
                                        請求項目から追加
                                    </button>
                                    {billingDropdownPmId === key && billingTitles.length > 0 && (
                                        <div className="absolute right-0 z-50 mt-1 w-64 bg-white border border-slate-300 rounded-lg shadow-lg">
                                            <ul className="max-h-48 overflow-y-auto py-1">
                                                {billingTitles.map(bt => (
                                                    <li
                                                        key={bt.id}
                                                        className="px-4 py-2 hover:bg-slate-100 cursor-pointer text-sm"
                                                        onClick={() => {
                                                            addFromBillingTitle(key, bt);
                                                            setBillingDropdownPmId(null);
                                                        }}
                                                    >
                                                        {bt.name}
                                                        {(bt.quantity != null || bt.unit) && (
                                                            <span className="ml-1 text-slate-400">
                                                                ({bt.quantity != null && bt.quantity}{bt.unit && ` ${bt.unit}`})
                                                            </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUnitPriceTargetPmId(key);
                                        setIsUnitPriceModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    単価マスタ
                                </button>
                                <button
                                    type="button"
                                    onClick={() => addEmptyItem(key)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    行追加
                                </button>
                                {(manualKeys.length > 1 || selectedProjectIds.length > 0) && (
                                    <button
                                        type="button"
                                        onClick={() => removeManualSection(key)}
                                        title="このセクションを削除"
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        削除
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="p-4">
                        {(itemsByProject[key] || []).length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">
                                明細がありません。上のボタンから追加してください。
                            </p>
                        ) : (
                            <ItemsEditor
                                items={itemsByProject[key] || []}
                                onUpdate={(id, field, value) => updateItem(key, id, field as string, value)}
                                onRemove={(id) => removeItem(key, id)}
                                onMoveUp={(index) => moveItemUp(key, index)}
                                onMoveDown={(index) => moveItemDown(key, index)}
                                onReorder={(fromIndex, toIndex) => reorderItems(key, fromIndex, toIndex)}
                                onReorderChildItem={(parentId, fromIndex, toIndex) => reorderChildItems(key, parentId, fromIndex, toIndex)}
                                onAddItem={() => addEmptyItem(key)}
                                onOpenUnitPriceModal={() => {
                                    setUnitPriceTargetPmId(key);
                                    setIsUnitPriceModalOpen(true);
                                }}
                                hideAddButtons={true}
                            />
                        )}
                    </div>
                </div>
            ))}

            {/* セクション（見出し）を追加 */}
            <button
                type="button"
                onClick={addManualSection}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-600 border border-dashed border-slate-300 rounded-xl hover:bg-slate-50 hover:border-slate-400 transition-colors"
            >
                <Plus className="w-4 h-4" />
                セクション（見出し）を追加
            </button>

            <ConditionNotes notes={notes} setNotes={setNotes} />

            {/* 合計エリア */}
            <div className="sticky bottom-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-white border-t border-slate-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
                <SummaryFooter subtotal={subtotal} tax={tax} total={total} />
            </div>

            {/* ボタン */}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4 mb-8 safe-area-bottom">
                <button type="button" onClick={onCancel} className="w-full sm:w-auto px-6 py-3 md:py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors text-base md:text-sm">
                    キャンセル
                </button>
                <button type="button" onClick={handlePreview} disabled={isGeneratingPreview} className="lg:hidden w-full sm:w-auto px-6 py-3 md:py-2.5 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition-colors text-base md:text-sm flex items-center justify-center gap-2">
                    <Eye className="w-4 h-4" />
                    {isGeneratingPreview ? '生成中...' : 'プレビュー'}
                </button>
                <button type="submit" disabled={isSubmitting} className="w-full sm:w-auto px-6 py-3 md:py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-700 active:bg-slate-900 transition-all shadow-md text-base md:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                    {isSubmitting ? '保存中...' : '保存'}
                </button>
            </div>
                </div>

                {/* 右カラム: リアルタイム PDF プレビュー (lg+ のみ・トグルで開閉) */}
                <div
                    className={`hidden lg:flex lg:flex-col lg:min-w-0 lg:bg-slate-50 lg:overflow-hidden lg:transition-all lg:duration-300 lg:ease-in-out ${previewVisible ? 'lg:basis-2/5 lg:opacity-100 lg:border-l lg:border-slate-200' : 'lg:basis-0 lg:opacity-0 lg:pointer-events-none'}`}
                    aria-hidden={!previewVisible}
                >
                    {isLgScreen && previewVisible && (
                        <LivePdfPreview
                            seed={livePreviewSignature}
                            renderPdf={buildLivePdfBlob}
                            debounceMs={700}
                        />
                    )}
                </div>
                </div>
            </div>

            {/* PDFプレビューオーバーレイ (lg未満の手動プレビューボタン用) */}
            {isPreviewOpen && previewPdfUrl && (
                <div className="fixed inset-0 z-[80] bg-black/70 flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200">
                        <h3 className="text-lg font-semibold text-slate-800">プレビュー</h3>
                        <button
                            type="button"
                            onClick={() => {
                                setIsPreviewOpen(false);
                                if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
                                setPreviewPdfUrl('');
                            }}
                            className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-auto bg-slate-100 flex justify-center">
                        <div className="w-full max-w-5xl h-full">
                            <InlinePdfViewer url={previewPdfUrl} />
                        </div>
                    </div>
                </div>
            )}

            <CustomerModal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)}
                onSubmit={(data) => { addCustomer(data); setIsCustomerModalOpen(false); }} title="新規顧客登録" />
            <UnitPriceMasterModal isOpen={isUnitPriceModalOpen} onClose={() => setIsUnitPriceModalOpen(false)} onSelect={handleSelectFromMaster} />
        </form>
    );
}
