'use client';

import React from 'react';
import { Customer } from '@/types/customer';

interface TitleTemplate {
    id: string;
    label: string;
    format: string;
}

const TITLE_TEMPLATES: TitleTemplate[] = [
    { id: 'custom', label: 'カスタム（手動入力）', format: '' },
    { id: 'sama_kasetsu', label: '○○様 仮設工事', format: '{siteName}様 仮設工事' },
    { id: 'samatei_kasetsu', label: '○○様邸 仮設工事', format: '{siteName}様邸 仮設工事' },
    { id: 'sama_shinchiku', label: '○○様 新築工事', format: '{siteName}様 新築工事' },
    { id: 'samatei_shinchiku', label: '○○様邸 新築工事', format: '{siteName}様邸 新築工事' },
    { id: 'genba', label: '○○現場 仮設工事', format: '{siteName} 仮設工事' },
    { id: 'mitsumori', label: '○○ 見積書', format: '{siteName} 見積書' },
];

interface EstimateHeaderProps {
    projectId: string;
    setProjectId: (v: string) => void;
    estimateNumber: string;
    setEstimateNumber: (v: string) => void;
    selectedTemplate: string;
    setSelectedTemplate: (v: string) => void;
    title: string;
    setTitle: (v: string) => void;
    siteName: string;
    setSiteName: (v: string) => void;
    customerId: string;
    setCustomerId: (v: string) => void;
    validUntil: string;
    setValidUntil: (v: string) => void;
    status: string;
    setStatus: (v: string) => void;
    projects: { id: string; title: string; customer?: string | null }[];
    customers: Customer[];
    onOpenCustomerModal: () => void;
}

export default function EstimateHeader({
    projectId, setProjectId,
    estimateNumber, setEstimateNumber,
    selectedTemplate, setSelectedTemplate,
    title, setTitle,
    siteName, setSiteName,
    customerId, setCustomerId,
    validUntil, setValidUntil,
    status, setStatus,
    projects, customers,
    onOpenCustomerModal,
}: EstimateHeaderProps) {
    const handleTemplateChange = (templateId: string) => {
        setSelectedTemplate(templateId);
        const template = TITLE_TEMPLATES.find(t => t.id === templateId);
        if (template && template.format && siteName) {
            const generatedTitle = template.format.replace('{siteName}', siteName);
            setTitle(generatedTitle);
        }
    };

    const inputClass = "w-full px-3 py-3 md:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm";
    const labelClass = "block text-sm font-semibold text-gray-700 mb-1.5";

    return (
        <>
            {/* 基本情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-4">
                <div>
                    <label className={labelClass}>案件（オプション）</label>
                    <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
                        <option value="">案件を選択（任意）</option>
                        {projects.map(project => (
                            <option key={project.id} value={project.id}>
                                {project.title}{project.customer ? ` (${project.customer})` : ''}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">案件を選択すると現場名・元請会社が自動入力されます</p>
                </div>

                <div>
                    <label className={labelClass}>見積番号</label>
                    <input type="text" value={estimateNumber} onChange={(e) => setEstimateNumber(e.target.value)} className={inputClass} />
                </div>

                <div>
                    <label className={labelClass}>タイトルテンプレート</label>
                    <select value={selectedTemplate} onChange={(e) => handleTemplateChange(e.target.value)} className={inputClass}>
                        {TITLE_TEMPLATES.map(template => (
                            <option key={template.id} value={template.id}>{template.label}</option>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">テンプレートを選択すると、現場名を使ってタイトルが自動生成されます</p>
                </div>

                <div>
                    <label className={labelClass}>タイトル <span className="text-slate-500">*</span></label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => { setTitle(e.target.value); setSelectedTemplate('custom'); }}
                        className={inputClass}
                        required
                        placeholder="例: ○○現場 見積書"
                    />
                </div>
            </div>

            {/* 現場情報 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-4">
                <div>
                    <label className={labelClass}>現場名</label>
                    <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} className={inputClass} placeholder="案件を選択するか手動で入力" />
                </div>

                <div>
                    <label className={labelClass}>元請会社（顧客）</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={"flex-1 px-3 py-3 md:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm"}>
                            <option value="">選択してください</option>
                            {customers.map(customer => (
                                <option key={customer.id} value={customer.id}>{customer.name}</option>
                            ))}
                        </select>
                        <button type="button" onClick={onOpenCustomerModal} className="px-4 py-3 md:py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 active:bg-slate-900 transition-colors whitespace-nowrap text-sm font-medium">
                            + 新規顧客
                        </button>
                    </div>
                </div>

                <div>
                    <label className={labelClass}>有効期限（発行日より1ヶ月）</label>
                    <input
                        type={validUntil === '発行日より1ヶ月' ? 'text' : 'date'}
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        onFocus={(e) => {
                            if (validUntil === '発行日より1ヶ月') {
                                const date = new Date();
                                date.setMonth(date.getMonth() + 1);
                                setValidUntil(date.toISOString().split('T')[0]);
                                setTimeout(() => { e.target.type = 'date'; e.target.focus(); }, 0);
                            }
                        }}
                        className={inputClass}
                    />
                </div>

                <div>
                    <label className={labelClass}>ステータス</label>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                        <option value="draft">下書き</option>
                        <option value="sent">送付済み</option>
                        <option value="approved">承認済み</option>
                        <option value="rejected">却下</option>
                    </select>
                </div>
            </div>
        </>
    );
}
