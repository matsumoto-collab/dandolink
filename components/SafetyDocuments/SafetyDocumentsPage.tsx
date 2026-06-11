'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, Copy, Download, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import SagyoinMeiboWizard from './SagyoinMeiboWizard';
import TodokeWizard from './TodokeWizard';
import {
    SAFETY_DOCUMENT_TYPES,
    SAFETY_DOCUMENT_TYPE_LABELS,
    getSafetyDocumentTargetCount,
} from '@/lib/safetyDocuments';
import { exportSafetyDocumentPDF } from '@/utils/safetyDocumentPdf';
import type { SafetyDocumentDto } from '@/types/safety';
import { logger } from '@/lib/logger';

type TodokeType = 'vehicle_todoke' | 'kikai_todoke' | 'crane_todoke';

const CREATE_MENU: { type: string; label: string; description: string }[] = [
    { type: SAFETY_DOCUMENT_TYPES.sagyoinMeibo, label: '作業員名簿', description: '全建統一様式第5号 準拠' },
    { type: SAFETY_DOCUMENT_TYPES.vehicleTodoke, label: '工事・通勤用車両届', description: '車両・保険・運転者の一覧' },
    { type: SAFETY_DOCUMENT_TYPES.kikaiTodoke, label: '持込機械等使用届', description: '持込機械の一覧' },
    { type: SAFETY_DOCUMENT_TYPES.craneTodoke, label: '移動式クレーン等使用届', description: 'クレーン・車両系建設機械（1台1葉）' },
];

/**
 * 安全書類（グリーンファイル）一覧 + 作成ウィザード（S-2 / S-3）。
 * admin / manager 専用（MainContent 側でロールガード済み・API側も requireManagerOrAbove）。
 */
export default function SafetyDocumentsPage() {
    const [documents, setDocuments] = useState<SafetyDocumentDto[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [view, setView] = useState<'list' | 'wizard'>('list');
    const [wizardType, setWizardType] = useState<string>(SAFETY_DOCUMENT_TYPES.sagyoinMeibo);
    const [editingDoc, setEditingDoc] = useState<SafetyDocumentDto | null>(null);
    const [duplicateSource, setDuplicateSource] = useState<SafetyDocumentDto | null>(null);
    const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
    const createMenuRef = useRef<HTMLDivElement>(null);

    // 作成メニューの外側クリックで閉じる
    useEffect(() => {
        if (!isCreateMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (createMenuRef.current && !createMenuRef.current.contains(e.target as Node)) {
                setIsCreateMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isCreateMenuOpen]);

    const fetchDocuments = useCallback(async () => {
        try {
            const res = await fetch('/api/safety-documents', { cache: 'no-store' });
            if (!res.ok) throw new Error('一覧の取得に失敗しました');
            setDocuments(await res.json());
        } catch (error) {
            logger.error('安全書類一覧取得エラー:', error);
            toast.error('安全書類一覧の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    const filteredDocuments = useMemo(() => {
        const q = search.trim();
        if (!q) return documents;
        return documents.filter(
            (d) =>
                d.title.includes(q) ||
                (d.projectMaster?.title ?? '').includes(q) ||
                (d.data.header.siteName ?? '').includes(q)
        );
    }, [documents, search]);

    const openCreate = (type: string) => {
        setWizardType(type);
        setEditingDoc(null);
        setDuplicateSource(null);
        setIsCreateMenuOpen(false);
        setView('wizard');
    };

    const openEdit = (doc: SafetyDocumentDto) => {
        setWizardType(doc.type);
        setEditingDoc(doc);
        setDuplicateSource(null);
        setView('wizard');
    };

    const openDuplicate = (doc: SafetyDocumentDto) => {
        setWizardType(doc.type);
        setEditingDoc(null);
        setDuplicateSource(doc);
        setView('wizard');
    };

    const handleDelete = async (doc: SafetyDocumentDto) => {
        if (!confirm(`「${doc.title}」を削除しますか？\n（削除後も保存データは5年間保持されます）`)) return;
        try {
            const res = await fetch(`/api/safety-documents/${doc.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '削除に失敗しました');
            }
            toast.success('安全書類を削除しました');
            fetchDocuments();
        } catch (error) {
            logger.error('安全書類削除エラー:', error);
            toast.error(error instanceof Error ? error.message : '削除に失敗しました');
        }
    };

    /** 一覧から直接PDF出力（保存済みスナップショットから生成 = FR-4-2） */
    const handleExportPdf = async (doc: SafetyDocumentDto) => {
        try {
            await exportSafetyDocumentPDF(doc.type, doc.data, doc.title);
        } catch {
            toast.error('PDFの出力に失敗しました');
        }
    };

    const handleWizardSaved = () => {
        setView('list');
        setEditingDoc(null);
        setDuplicateSource(null);
        fetchDocuments();
    };

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

    if (view === 'wizard') {
        if (wizardType === SAFETY_DOCUMENT_TYPES.sagyoinMeibo) {
            return (
                <SagyoinMeiboWizard
                    editingDoc={editingDoc}
                    duplicateSource={duplicateSource}
                    onSaved={handleWizardSaved}
                    onCancel={() => setView('list')}
                />
            );
        }
        return (
            <TodokeWizard
                docType={wizardType as TodokeType}
                editingDoc={editingDoc}
                duplicateSource={duplicateSource}
                onSaved={handleWizardSaved}
                onCancel={() => setView('list')}
            />
        );
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* ヘッダー */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-teal-600" />
                    安全書類
                </h2>
                <p className="hidden sm:block text-xs text-slate-500 flex-1 min-w-0">
                    作業員名簿・車両届・持込機械届などのグリーンファイルを作成・管理します
                </p>
                <div className="relative" ref={createMenuRef}>
                    <Button
                        size="sm"
                        leftIcon={<Plus className="w-4 h-4" />}
                        rightIcon={<ChevronDown className="w-4 h-4" />}
                        onClick={() => setIsCreateMenuOpen((v) => !v)}
                    >
                        新規作成
                    </Button>
                    {isCreateMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5">
                            {CREATE_MENU.map((item) => (
                                <button
                                    key={item.type}
                                    type="button"
                                    onClick={() => openCreate(item.type)}
                                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-teal-50 transition-colors"
                                >
                                    <div className="text-sm font-medium text-slate-800">{item.label}</div>
                                    <div className="text-[11px] text-slate-500">{item.description}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 検索 */}
            <div className="relative mb-3 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="タイトル・案件名・現場名で検索"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm text-sm"
                />
            </div>

            {/* 一覧 */}
            <div className="flex-1 min-h-0 overflow-auto bg-white border border-slate-200 rounded-xl">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40 text-slate-400 text-sm">読み込み中...</div>
                ) : filteredDocuments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                        <FileText className="w-8 h-8" />
                        <p className="text-sm">
                            {documents.length === 0
                                ? '安全書類はまだありません。「新規作成」から書類の種類を選んで作成してください。'
                                : '検索条件に一致する書類がありません'}
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                            <tr className="text-left text-xs text-slate-500">
                                <th className="px-4 py-3 font-medium">タイトル</th>
                                <th className="px-4 py-3 font-medium hidden md:table-cell">種別</th>
                                <th className="px-4 py-3 font-medium hidden lg:table-cell">案件</th>
                                <th className="px-4 py-3 font-medium text-center">対象</th>
                                <th className="px-4 py-3 font-medium hidden sm:table-cell">提出日</th>
                                <th className="px-4 py-3 font-medium hidden xl:table-cell">更新日</th>
                                <th className="px-4 py-3 font-medium text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredDocuments.map((doc) => (
                                <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50">
                                    <td className="px-4 py-2.5">
                                        <button
                                            type="button"
                                            onClick={() => openEdit(doc)}
                                            className="text-left font-medium text-slate-800 hover:text-teal-700 hover:underline"
                                        >
                                            {doc.title}
                                        </button>
                                    </td>
                                    <td className="px-4 py-2.5 hidden md:table-cell text-slate-600">
                                        {SAFETY_DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type}
                                    </td>
                                    <td className="px-4 py-2.5 hidden lg:table-cell text-slate-600 max-w-[240px] truncate">
                                        {doc.projectMaster?.title ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-center text-slate-600 tabular-nums">
                                        {getSafetyDocumentTargetCount(doc.type, doc.data)}
                                        {doc.type === SAFETY_DOCUMENT_TYPES.sagyoinMeibo ? '名' : '台'}
                                    </td>
                                    <td className="px-4 py-2.5 hidden sm:table-cell text-slate-600 tabular-nums">
                                        {doc.data.header.submitDate || '—'}
                                    </td>
                                    <td className="px-4 py-2.5 hidden xl:table-cell text-slate-500 tabular-nums">
                                        {formatDate(doc.updatedAt)}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-0.5">
                                            <IconButton size="sm" aria-label="PDF出力" title="PDF出力" onClick={() => handleExportPdf(doc)}>
                                                <Download className="w-4 h-4" />
                                            </IconButton>
                                            <IconButton size="sm" aria-label="編集" title="編集" onClick={() => openEdit(doc)}>
                                                <Pencil className="w-4 h-4" />
                                            </IconButton>
                                            <IconButton size="sm" aria-label="複製" title="複製して新規作成" onClick={() => openDuplicate(doc)}>
                                                <Copy className="w-4 h-4" />
                                            </IconButton>
                                            <IconButton
                                                size="sm"
                                                aria-label="削除"
                                                title="削除"
                                                className="hover:bg-red-50 hover:text-red-600"
                                                onClick={() => handleDelete(doc)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </IconButton>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
