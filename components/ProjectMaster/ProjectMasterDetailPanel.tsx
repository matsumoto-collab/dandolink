'use client';

import React from 'react';
import { ProjectMaster } from '@/types/calendar';
import { useMasterData } from '@/hooks/useMasterData';
import WorkHistoryDisplay from './WorkHistoryDisplay';
import ProjectProfitDisplay from './ProjectProfitDisplay';
import ProjectMasterFilesView from './ProjectMasterFilesView';

interface ProjectMasterDetailPanelProps {
    pm: ProjectMaster;
}

const CONSTRUCTION_CONTENT_LABELS: Record<string, string> = {
    new_construction: '新築',
    renovation: '改修',
    large_scale: '大規模',
    other: 'その他',
};

function formatDate(date: Date | string | undefined) {
    if (!date) return '-';
    const d = new Date(date);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function Field({ label, value }: { label: string; value?: string | null }) {
    return (
        <div>
            <dt className="text-xs text-gray-500 mb-0.5">{label}</dt>
            <dd className="text-sm font-medium text-gray-800">{value || '-'}</dd>
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-4 first:mt-0">
            {children}
        </h4>
    );
}

export default function ProjectMasterDetailPanel({ pm }: ProjectMasterDetailPanelProps) {
    const { managers } = useMasterData();

    // 案件責任者の名前を解決
    const createdByIds: string[] = Array.isArray(pm.createdBy)
        ? pm.createdBy
        : pm.createdBy
            ? (() => { try { return JSON.parse(pm.createdBy as string); } catch { return [pm.createdBy]; } })()
            : [];
    const managerNames = createdByIds
        .map(id => managers.find(m => m.id === id)?.name)
        .filter(Boolean)
        .join('、');

    const address = [pm.postalCode ? `〒${pm.postalCode}` : null, pm.prefecture, pm.city, pm.location]
        .filter(Boolean).join(' ');

    return (
        <div className="space-y-1">
            {/* 基本情報 */}
            <SectionTitle>基本情報</SectionTitle>
            <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-3">
                <Field label="元請け" value={pm.customerName} />
                <Field
                    label="工事内容"
                    value={pm.constructionContent ? CONSTRUCTION_CONTENT_LABELS[pm.constructionContent] : undefined}
                />
                <Field label="案件責任者" value={managerNames || undefined} />
                <Field
                    label="ステータス"
                    value={pm.status === 'active' ? '進行中' : pm.status === 'completed' ? '完了' : '中止'}
                />
            </dl>

            {/* 住所 */}
            {address && (
                <>
                    <SectionTitle>所在地</SectionTitle>
                    <dl className="grid grid-cols-1 gap-y-2">
                        <Field label="住所" value={address} />
                        {pm.plusCode && <Field label="Plusコード" value={pm.plusCode} />}
                    </dl>
                </>
            )}

            {/* 工事情報 */}
            <SectionTitle>工事情報</SectionTitle>
            <dl className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-3">
                <Field label="組立日" value={formatDate(pm.assemblyDate)} />
                <Field label="解体日" value={formatDate(pm.demolitionDate)} />
                <Field
                    label="予定組立人工"
                    value={pm.estimatedAssemblyWorkers != null ? `${pm.estimatedAssemblyWorkers}名` : undefined}
                />
                <Field
                    label="予定解体人工"
                    value={pm.estimatedDemolitionWorkers != null ? `${pm.estimatedDemolitionWorkers}名` : undefined}
                />
                <Field label="面積" value={pm.area != null ? `${pm.area}m²` : undefined} />
                <Field
                    label="請負金額"
                    value={pm.contractAmount != null ? `¥${pm.contractAmount.toLocaleString()}` : undefined}
                />
            </dl>

            {/* 備考 */}
            {pm.remarks && (
                <>
                    <SectionTitle>備考</SectionTitle>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3">
                        {pm.remarks}
                    </p>
                </>
            )}

            {/* 添付ファイル */}
            <SectionTitle>添付ファイル</SectionTitle>
            <ProjectMasterFilesView projectMasterId={pm.id} />

            {/* 作業履歴 */}
            <SectionTitle>作業履歴</SectionTitle>
            <WorkHistoryDisplay projectMasterId={pm.id} />

            {/* 利益サマリー */}
            <SectionTitle>利益サマリー</SectionTitle>
            <ProjectProfitDisplay projectMasterId={pm.id} />
        </div>
    );
}
