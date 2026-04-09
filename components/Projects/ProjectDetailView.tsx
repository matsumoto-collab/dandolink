'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Project, DEFAULT_CONSTRUCTION_TYPE_COLORS, DEFAULT_CONSTRUCTION_TYPE_LABELS } from '@/types/calendar';
import { useMasterData } from '@/hooks/useMasterData';
import ProjectMasterFilesView from '@/components/ProjectMaster/ProjectMasterFilesView';
import ScaffoldingSpecDisplay from '@/components/ProjectMaster/ScaffoldingSpecDisplay';
import WorkHistoryDisplay from '@/components/ProjectMaster/WorkHistoryDisplay';
import { ExternalLink } from 'lucide-react';
import { logger } from '@/lib/logger';

const isCoordinates = (value: string) => /^-?[\d.]+,-?[\d.]+$/.test(value.trim());

interface ManagerUser {
    id: string;
    displayName: string;
}

interface ProjectDetailViewProps {
    project: Project;
    onClose: () => void;
}

export default function ProjectDetailView({ project, onClose }: ProjectDetailViewProps) {
    const [managerMap, setManagerMap] = useState<Record<string, string>>({});
    const [isLoadingManagers, setIsLoadingManagers] = useState(true);
    const [locationData, setLocationData] = useState<{
        prefecture?: string;
        city?: string;
        location?: string;
        plusCode?: string;
    } | null>(null);
    const { constructionTypes, vehicles } = useMasterData();
    const [workerMap, setWorkerMap] = useState<Record<string, string>>({});
    const [isLoadingWorkers, setIsLoadingWorkers] = useState(false);

    // 手配確定メンバー名を取得
    useEffect(() => {
        if (!project.isDispatchConfirmed || !project.confirmedWorkerIds?.length) return;
        setIsLoadingWorkers(true);
        fetch('/api/dispatch/workers', { cache: 'no-store' })
            .then(res => res.ok ? res.json() : [])
            .then((workers: { id: string; displayName: string }[]) => {
                const map: Record<string, string> = {};
                workers.forEach(w => { map[w.id] = w.displayName; });
                setWorkerMap(map);
            })
            .catch(() => {})
            .finally(() => setIsLoadingWorkers(false));
    }, [project.isDispatchConfirmed, project.confirmedWorkerIds]);

    // 工事種別の色と名前を取得
    const constructionTypeInfo = useMemo(() => {
        const ct = project.constructionType;
        if (!ct) {
            return { color: '#a8c8e8', label: '未設定' };
        }
        // マスターデータから検索（IDまたはレガシーコード）
        const masterType = constructionTypes.find(t => t.id === ct || t.name === ct);
        if (masterType) {
            return { color: masterType.color, label: masterType.name };
        }
        // デフォルト値（後方互換性）
        return {
            color: DEFAULT_CONSTRUCTION_TYPE_COLORS[ct] || '#a8c8e8',
            label: DEFAULT_CONSTRUCTION_TYPE_LABELS[ct] || ct,
        };
    }, [project.constructionType, constructionTypes]);

    // 案件担当者を配列として扱う
    const managers = Array.isArray(project.createdBy)
        ? project.createdBy
        : project.createdBy
            ? [project.createdBy]
            : [];

    // マネージャー名を取得
    useEffect(() => {
        const fetchManagers = async () => {
            try {
                const res = await fetch('/api/users');
                if (res.ok) {
                    const data = await res.json();
                    const map: Record<string, string> = {};
                    data.forEach((user: ManagerUser) => {
                        map[user.id] = user.displayName;
                    });
                    setManagerMap(map);
                }
            } catch {
                logger.error('担当者名の取得に失敗しました');
            } finally {
                setIsLoadingManagers(false);
            }
        };
        if (managers.length > 0) {
            fetchManagers();
        } else {
            setIsLoadingManagers(false);
        }
    }, [managers.length]);

    // 案件マスターの住所情報を取得
    useEffect(() => {
        if (!project.projectMasterId) return;
        fetch(`/api/project-masters/${project.projectMasterId}`, { cache: 'no-store' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) {
                    setLocationData({
                        prefecture: data.prefecture,
                        city: data.city,
                        location: data.location,
                        plusCode: data.plusCode,
                    });
                }
            })
            .catch(() => {});
    }, [project.projectMasterId]);

    // ステータスの表示設定
    const statusConfig = {
        confirmed: { label: '確定', color: 'bg-slate-100 text-slate-700' },
        pending: { label: '保留', color: 'bg-slate-100 text-slate-600' },
        completed: { label: '完了', color: 'bg-slate-100 text-slate-700' },
        cancelled: { label: '中止', color: 'bg-slate-100 text-slate-700' },
    };

    const status = project.status ? statusConfig[project.status] : null;

    return (
        <div className="space-y-6">
            {/* ヘッダー情報 */}
            <div className="border-b border-slate-200 pb-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <h3 className="text-2xl font-bold text-slate-900">{project.title}</h3>
                        {project.customer && (
                            <p className="text-lg text-slate-600 mt-1">{project.customer}</p>
                        )}
                    </div>
                    {status && (
                        <span className={`px-3 py-1 text-sm rounded-full font-medium ${status.color}`}>
                            {status.label}
                        </span>
                    )}
                </div>
            </div>

            {/* 詳細情報 */}
            <div className="space-y-4">
                {/* 案件担当者 */}
                {managers.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            案件担当者
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {isLoadingManagers ? (
                                <span className="text-sm text-slate-500">読み込み中...</span>
                            ) : (
                                managers.filter(manager => managerMap[manager]).map((manager, index) => (
                                    <span
                                        key={index}
                                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700"
                                    >
                                        {managerMap[manager]}
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 工事種別 */}
                {project.constructionType && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            工事種別
                        </label>
                        <span
                            className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium text-slate-900"
                            style={{
                                backgroundColor: `${constructionTypeInfo.color}30`,
                                border: `2px solid ${constructionTypeInfo.color}`
                            }}
                        >
                            {constructionTypeInfo.label}
                        </span>
                    </div>
                )}

                {/* メンバー数 */}
                {((project.memberCount ?? 0) > 0 || (project.workers && project.workers.length > 0)) && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            メンバー数
                        </label>
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            <span className="text-base text-slate-900 font-medium">{project.memberCount || project.workers?.length || 0}名</span>
                        </div>
                    </div>
                )}

                {/* 手配確定メンバー */}
                {project.isDispatchConfirmed && project.confirmedWorkerIds && project.confirmedWorkerIds.length > 0 && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            手配確定メンバー
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {isLoadingWorkers ? (
                                <span className="text-sm text-slate-500">読み込み中...</span>
                            ) : (
                                project.confirmedWorkerIds.filter(id => workerMap[id]).map((id) => (
                                    <span
                                        key={id}
                                        className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800"
                                    >
                                        {workerMap[id]}
                                    </span>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* 車両（手配確定時の車両を優先、なければ登録時の車両） */}
                {(() => {
                    const displayVehicles: string[] = project.confirmedVehicleIds?.length
                        ? project.confirmedVehicleIds.map(id => vehicles.find(v => v.id === id)?.name || id)
                        : (project.trucks || []) as string[];
                    return displayVehicles.length > 0 ? (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            車両
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {displayVehicles.map((name, index) => (
                                <span
                                    key={index}
                                    className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-800"
                                >
                                    <svg className="w-4 h-4 mr-1.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    {name}
                                </span>
                            ))}
                        </div>
                    </div>
                    ) : null;
                })()}

                {/* 地図 */}
                {locationData && (() => {
                    const mapQuery = (() => {
                        if (locationData.plusCode && isCoordinates(locationData.plusCode)) return locationData.plusCode;
                        const parts = [locationData.prefecture, locationData.city, locationData.location].filter(Boolean);
                        return parts.join('');
                    })();
                    if (!mapQuery) return null;
                    const googleMapsUrl = isCoordinates(mapQuery)
                        ? `https://www.google.com/maps?q=${mapQuery}`
                        : `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}`;
                    return (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-slate-700">所在地</label>
                                <a
                                    href={googleMapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Google Mapsで開く
                                </a>
                            </div>
                            {(() => {
                                const addressParts = [locationData.prefecture, locationData.city, locationData.location].filter(Boolean);
                                return addressParts.length > 0 ? (
                                    <p className="text-sm text-slate-700 mb-2">{addressParts.join(' ')}</p>
                                ) : null;
                            })()}
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
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
                        </div>
                    );
                })()}

                {/* 開始日 */}
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        日付
                    </label>
                    <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-base text-slate-900">
                            {project.startDate.toLocaleDateString('ja-JP', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                weekday: 'short'
                            })}
                        </span>
                    </div>
                </div>

                {/* 備考 */}
                {project.remarks && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            備考
                        </label>
                        <div className="bg-slate-50 rounded-md p-3 border border-slate-200">
                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{project.remarks}</p>
                        </div>
                    </div>
                )}

                {/* 足場仕様 */}
                {project.projectMasterId && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            足場仕様
                        </label>
                        <ScaffoldingSpecDisplay projectMasterId={project.projectMasterId} />
                    </div>
                )}

                {/* 画像フォルダ */}
                {project.projectMasterId && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            画像フォルダ
                        </label>
                        <ProjectMasterFilesView projectMasterId={project.projectMasterId} />
                    </div>
                )}

                {/* 作業履歴 */}
                {project.projectMasterId && (
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            作業履歴
                        </label>
                        <WorkHistoryDisplay projectMasterId={project.projectMasterId} />
                    </div>
                )}
            </div>

            {/* 閉じるボタン */}
            <div className="pt-4 border-t border-slate-200">
                <button
                    onClick={onClose}
                    className="w-full px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors font-medium"
                >
                    閉じる
                </button>
            </div>
        </div>
    );
}
