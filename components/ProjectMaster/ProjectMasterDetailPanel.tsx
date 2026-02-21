'use client';

import React, { useState, useEffect } from 'react';
import { ProjectMaster } from '@/types/calendar';
import WorkHistoryDisplay from './WorkHistoryDisplay';
import ProjectProfitDisplay from './ProjectProfitDisplay';
import ProjectMasterFilesView from './ProjectMasterFilesView';
import { ExternalLink } from 'lucide-react';

const isCoordinates = (value: string) => /^-?[\d.]+,-?[\d.]+$/.test(value.trim());

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
    const [userMap, setUserMap] = useState<Record<string, string>>({});

    useEffect(() => {
        fetch('/api/users')
            .then(res => res.ok ? res.json() : [])
            .then((users: Array<{ id: string; displayName: string }>) => {
                const map: Record<string, string> = {};
                users.forEach(u => { map[u.id] = u.displayName; });
                setUserMap(map);
            })
            .catch(() => {});
    }, []);

    // 案件責任者の名前を解決
    const createdByIds: string[] = Array.isArray(pm.createdBy)
        ? pm.createdBy
        : pm.createdBy
            ? (() => { try { return JSON.parse(pm.createdBy as string); } catch { return [pm.createdBy]; } })()
            : [];
    const managerNames = createdByIds
        .map(id => userMap[id])
        .filter(Boolean)
        .join('、');

    const address = [pm.postalCode ? `〒${pm.postalCode}` : null, pm.prefecture, pm.city, pm.location]
        .filter(Boolean).join(' ');

    const mapQuery = (() => {
        if (pm.plusCode && isCoordinates(pm.plusCode)) return pm.plusCode;
        const parts = [pm.prefecture, pm.city, pm.location].filter(Boolean);
        return parts.join('');
    })();

    const googleMapsUrl = (() => {
        if (!mapQuery) return null;
        if (isCoordinates(mapQuery)) {
            const [lat, lng] = mapQuery.split(',');
            return `https://www.google.com/maps?q=${lat},${lng}`;
        }
        return `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}`;
    })();

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
            {(address || mapQuery) && (
                <>
                    <SectionTitle>所在地</SectionTitle>
                    {address && (
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-gray-800">{address}</p>
                            {googleMapsUrl && (
                                <a
                                    href={googleMapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 transition-colors whitespace-nowrap ml-2"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Google Mapsで開く
                                </a>
                            )}
                        </div>
                    )}
                    {mapQuery && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <iframe
                                key={mapQuery}
                                title="Map Preview"
                                width="100%"
                                height="220"
                                loading="lazy"
                                style={{ border: 0 }}
                                src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                            />
                        </div>
                    )}
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
