'use client';

import React, { useEffect, useState, useMemo, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Hammer, Users, Truck, Wrench, ClipboardCheck, UserCircle, CheckCircle } from 'lucide-react';
import { CalendarEvent } from '@/types/calendar';
import { useMasterStore, selectVehicles, selectTools, selectConstructionTypes } from '@/stores/masterStore';
import { resolveEventVehicleNames, resolveEventToolNames } from './vehicleNames';
import { logger } from '@/lib/logger';

interface EventCardHoverPreviewProps {
    event: CalendarEvent;
    /** ホバー対象のカードの位置（getBoundingClientRect） */
    anchorRect: DOMRect;
}

interface PreviewProject extends CalendarEvent {
    createdBy?: string | string[];
    vehicles?: string[];
    tools?: string[];
    confirmedWorkerIds?: string[];
    confirmedVehicleIds?: string[];
    confirmedToolIds?: string[];
    isDispatchConfirmed?: boolean;
}

// ── ユーザー名解決（モジュールローカルキャッシュ） ──
let usersPromise: Promise<Map<string, string>> | null = null;
const usersCache: Map<string, string> = new Map();

function loadUsers(): Promise<Map<string, string>> {
    if (!usersPromise) {
        usersPromise = fetch('/api/dispatch/workers', { cache: 'no-store' })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((arr: Array<{ id: string; displayName?: string }>) => {
                arr.forEach(u => usersCache.set(u.id, u.displayName ?? u.id));
                return usersCache;
            })
            .catch(err => {
                logger.error('Failed to load user names for preview:', err);
                usersPromise = null; // 次回の取得を許可
                return usersCache;
            });
    }
    return usersPromise;
}

export default function EventCardHoverPreview({ event, anchorRect }: EventCardHoverPreviewProps) {
    const project = event as PreviewProject;
    const constructionTypes = useMasterStore(selectConstructionTypes);
    const vehicles = useMasterStore(selectVehicles);
    const toolMaster = useMasterStore(selectTools);

    const [users, setUsers] = useState<Map<string, string>>(usersCache);

    useEffect(() => {
        let cancelled = false;
        loadUsers().then(map => {
            if (!cancelled) setUsers(new Map(map));
        });
        return () => { cancelled = true; };
    }, []);

    const constructionTypeName = useMemo(() => {
        if (!project.constructionType) return '未設定';
        return constructionTypes.find(t => t.id === project.constructionType)?.name ?? '未設定';
    }, [project.constructionType, constructionTypes]);

    const createdByNames = useMemo<string[]>(() => {
        const raw = project.createdBy;
        if (!raw) return [];
        const ids = Array.isArray(raw) ? raw : [raw];
        return ids.map(id => users.get(id) ?? '不明').filter(Boolean);
    }, [project.createdBy, users]);

    const isConfirmed = !!project.isDispatchConfirmed;

    const confirmedWorkerNames = useMemo<string[]>(() => {
        if (!isConfirmed || !project.confirmedWorkerIds?.length) return [];
        return project.confirmedWorkerIds.map(id => users.get(id) ?? '不明');
    }, [isConfirmed, project.confirmedWorkerIds, users]);

    const vehicleNames = useMemo<string[]>(
        () => resolveEventVehicleNames(project, vehicles),
        [project, vehicles]
    );

    const toolNames = useMemo<string[]>(
        () => resolveEventToolNames(project, toolMaster),
        [project, toolMaster]
    );

    // 位置計算: カードの右側に置く。画面右に収まらなければ左側へ。
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ top: number; left: number; placement: 'right' | 'left' | 'below' }>({
        top: anchorRect.top,
        left: anchorRect.right + 8,
        placement: 'right',
    });

    useLayoutEffect(() => {
        const el = popoverRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 8;

        let placement: 'right' | 'left' | 'below' = 'right';
        let left = anchorRect.right + margin;
        let top = anchorRect.top;

        // 右側がはみ出すなら左
        if (left + rect.width > vw - margin) {
            placement = 'left';
            left = anchorRect.left - rect.width - margin;
        }
        // 左もはみ出すなら下
        if (left < margin) {
            placement = 'below';
            left = Math.max(margin, Math.min(anchorRect.left, vw - rect.width - margin));
            top = anchorRect.bottom + margin;
        }
        // 縦方向のはみ出し補正
        if (top + rect.height > vh - margin) {
            top = Math.max(margin, vh - rect.height - margin);
        }
        if (top < margin) top = margin;

        setPos({ top, left, placement });
    }, [anchorRect.top, anchorRect.left, anchorRect.right, anchorRect.bottom]);

    // 表示要素
    const titleLabel = (event as { name?: string; honorific?: string; siteShortName?: string }).name
        ? `${(event as { name?: string }).name}${(event as { honorific?: string }).honorific ?? ''}${(event as { siteShortName?: string }).siteShortName ? ' ' + (event as { siteShortName?: string }).siteShortName : ''}`
        : event.title;

    const node = (
        <div
            ref={popoverRef}
            className="fixed z-[80] w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-200 bg-white shadow-2xl pointer-events-none"
            style={{ top: pos.top, left: pos.left }}
            role="tooltip"
        >
            {/* ヘッダー */}
            <div
                className="rounded-t-xl px-3 py-2 border-b border-slate-100"
                style={{ backgroundColor: event.color }}
            >
                <div className="font-bold text-slate-900 text-sm leading-tight truncate">{titleLabel}</div>
                {event.customer && (
                    <div className="text-sm text-slate-700 truncate mt-0.5">{event.customer}</div>
                )}
            </div>

            <div className="px-3 py-2.5 space-y-2 text-xs">
                {/* 工事種別 */}
                <Row icon={<Hammer className="w-3.5 h-3.5 text-slate-400" />} label="工事種別">
                    <span className="text-slate-700 font-medium">{constructionTypeName}</span>
                </Row>

                {/* 案件担当者 */}
                <Row icon={<UserCircle className="w-3.5 h-3.5 text-slate-400" />} label="案件担当">
                    {createdByNames.length === 0 ? (
                        <span className="text-slate-400">未設定</span>
                    ) : (
                        <span className="text-slate-700">{createdByNames.join(' / ')}</span>
                    )}
                </Row>

                {/* メンバー */}
                <Row
                    icon={<Users className="w-3.5 h-3.5 text-slate-400" />}
                    label={isConfirmed ? '確定メンバー' : 'メンバー'}
                    badge={isConfirmed ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                            <CheckCircle className="w-2.5 h-2.5" />確定
                        </span>
                    ) : undefined}
                >
                    {isConfirmed && confirmedWorkerNames.length > 0 ? (
                        <span className="text-slate-700 leading-snug">
                            {confirmedWorkerNames.join('、')}
                            <span className="text-slate-400 ml-1">（{confirmedWorkerNames.length}人）</span>
                        </span>
                    ) : (
                        <span className="text-slate-700 font-medium">{event.memberCount ?? 0}人</span>
                    )}
                </Row>

                {/* 車両 */}
                <Row
                    icon={<Truck className="w-3.5 h-3.5 text-slate-400" />}
                    label="車両"
                    badge={isConfirmed && project.confirmedVehicleIds?.length ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                            <CheckCircle className="w-2.5 h-2.5" />確定
                        </span>
                    ) : undefined}
                >
                    {vehicleNames.length === 0 ? (
                        <span className="text-slate-400">なし</span>
                    ) : (
                        <span className="text-slate-700 leading-snug">{vehicleNames.join('、')}</span>
                    )}
                </Row>

                {/* 電動工具（選んでいる案件だけ表示。使わない班のカードに空行を増やさない） */}
                {toolNames.length > 0 && (
                    <Row
                        icon={<Wrench className="w-3.5 h-3.5 text-slate-400" />}
                        label="電動工具"
                        badge={isConfirmed && project.confirmedToolIds?.length ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                                <CheckCircle className="w-2.5 h-2.5" />確定
                            </span>
                        ) : undefined}
                    >
                        <span className="text-slate-700 leading-snug">{toolNames.join('、')}</span>
                    </Row>
                )}

                {/* 手配確定済みアイコン（メタ情報） */}
                {isConfirmed && (
                    <div className="flex items-center gap-1 text-[10px] text-emerald-700 pt-1 border-t border-slate-100">
                        <ClipboardCheck className="w-3 h-3" />
                        <span>手配確定済み</span>
                    </div>
                )}
            </div>
        </div>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(node, document.body);
}

function Row({
    icon,
    label,
    badge,
    children,
}: {
    icon: React.ReactNode;
    label: string;
    badge?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-start gap-2">
            <div className="mt-0.5 flex-shrink-0">{icon}</div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</span>
                    {badge}
                </div>
                <div className="mt-0.5">{children}</div>
            </div>
        </div>
    );
}
