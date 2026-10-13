'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Copy, FolderOpen, Loader2, MoreHorizontal, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Loading from '@/components/ui/Loading';
import ProjectMasterSearchModal from '@/components/ProjectMasterSearchModal';
import { logger } from '@/lib/logger';
import { onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import type { ProjectMaster } from '@/types/calendar';
import {
    ROAD_PERMIT_STATUSES,
    ROAD_PERMIT_STATUS_LABELS,
    type RoadPermitDto,
    type RoadPermitListItem,
    type RoadPermitStatus,
    type RoadPermitsListResponse,
} from '@/types/roadPermit';
import RoadPermitEditor from './RoadPermitEditor';
import RoadPermitContactsModal from './RoadPermitContactsModal';
import {
    ROAD_PERMIT_STATUS_BADGE,
    errorMessage,
    formatUpdatedDate,
    formatUsePeriod,
    reiwaOrDash,
    statusLabel,
} from './roadPermitUi';

/** 案件を選ぶ画面の開き方（新しく作る／この申請をコピーして作る） */
type PickMode = { kind: 'new' } | { kind: 'copy'; fromId: string };

/**
 * 道路申請（道路使用許可・道路占用許可の申請書）の一覧（指示書 docs/指示書_道路申請_Phase1.md §6.1）。
 * - 使えるのは admin・manager だけ（API も 403）
 * - 行を押す → 1 件を取り直してから編集画面を開く
 * - 別の端末で保存・作成・削除されたら（road_permits_updated）一覧を取り直す（担当者の候補も一緒に取り直る）
 * - 「担当者の候補」ボタン → 候補の登録画面（担当者・現場責任者の「選ぶ」欄の中身）
 */
export default function RoadPermitsPage() {
    const { data: session } = useSession();
    // DB のロールは大文字が混ざることがあるので、小文字にそろえてから判定する
    const role = (session?.user?.role ?? '').toLowerCase();
    const canView = role === 'admin' || role === 'manager';

    const [statusFilter, setStatusFilter] = useState<RoadPermitStatus | ''>('');
    const [data, setData] = useState<RoadPermitsListResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [editing, setEditing] = useState<RoadPermitDto | null>(null);
    const [pickMode, setPickMode] = useState<PickMode | null>(null);
    const [contactsOpen, setContactsOpen] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    // 絞り込みを続けて変えたとき、古い応答で上書きしないための番号
    const requestSeqRef = useRef(0);
    // 作成・削除・開くの二重押しを防ぐ同期ロック（state の反映を待たずに止める）
    const lockRef = useRef(false);

    const fetchList = useCallback(
        async (status: RoadPermitStatus | '') => {
            if (!canView) return;
            const seq = ++requestSeqRef.current;
            setLoading(true);
            try {
                const params = new URLSearchParams();
                if (status) params.set('status', status);
                const qs = params.toString();
                const res = await fetch(`/api/road-permits${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(await errorMessage(res, '道路申請の一覧の取得に失敗しました'));
                const json = (await res.json()) as RoadPermitsListResponse;
                if (seq !== requestSeqRef.current) return;
                setData(json);
                setLoadError(null);
            } catch (e) {
                if (seq !== requestSeqRef.current) return;
                logger.error('道路申請の一覧取得失敗:', e);
                const msg = e instanceof Error ? e.message : '道路申請の一覧の取得に失敗しました';
                setLoadError(msg);
                toast.error(msg);
            } finally {
                if (seq === requestSeqRef.current) setLoading(false);
            }
        },
        [canView],
    );

    useEffect(() => {
        void fetchList(statusFilter);
    }, [fetchList, statusFilter]);

    const reload = useCallback(() => fetchList(statusFilter), [fetchList, statusFilter]);

    // 別の端末の変更を受けて取り直す。続けて届いても 500ms にまとめ、画面が見えているときだけ取りに行く
    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    useEffect(() => {
        if (!canView) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const off = onBroadcast('road_permits_updated', () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                if (document.visibilityState === 'visible') void reloadRef.current();
            }, 500);
        });
        return () => {
            off();
            if (timer) clearTimeout(timer);
        };
    }, [canView]);

    /** 1 件を取り直してから編集画面を開く（一覧の値は古いことがあるため） */
    const openPermit = useCallback(async (id: string) => {
        if (lockRef.current) return;
        lockRef.current = true;
        setBusyId(id);
        try {
            const res = await fetch(`/api/road-permits/${encodeURIComponent(id)}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, '申請の読み込みに失敗しました'));
            const dto = (await res.json()) as RoadPermitDto;
            setEditing(dto);
        } catch (e) {
            logger.error('道路申請の取得失敗:', e);
            toast.error(e instanceof Error ? e.message : '申請の読み込みに失敗しました');
        } finally {
            lockRef.current = false;
            setBusyId(null);
        }
    }, []);

    /** 案件を選んだあと: 新しく作る（コピー元があればその値を写す） */
    const handlePickProject = useCallback(
        async (pm: ProjectMaster) => {
            const mode = pickMode;
            setPickMode(null);
            if (!mode || lockRef.current) return;
            lockRef.current = true;
            const fromId = mode.kind === 'copy' ? mode.fromId : undefined;
            setBusyId(fromId ?? 'new');
            try {
                const res = await fetch('/api/road-permits', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fromId ? { projectMasterId: pm.id, fromId } : { projectMasterId: pm.id }),
                });
                if (!res.ok) throw new Error(await errorMessage(res, '申請の作成に失敗しました'));
                const dto = (await res.json()) as RoadPermitDto;
                setEditing(dto);
                // 新しく作ったときも、ほかの端末の一覧へ知らせる
                sendBroadcast('road_permits_updated', { id: dto.id });
                toast.success(fromId ? 'コピーして作りました' : '作りました');
                void reload();
            } catch (e) {
                logger.error('道路申請の作成失敗:', e);
                toast.error(e instanceof Error ? e.message : '申請の作成に失敗しました');
            } finally {
                lockRef.current = false;
                setBusyId(null);
            }
        },
        [pickMode, reload],
    );

    const handleDelete = useCallback(
        async (item: RoadPermitListItem) => {
            if (lockRef.current) return;
            if (!window.confirm('この申請を削除しますか？（一覧から消えます）')) return;
            lockRef.current = true;
            setBusyId(item.id);
            try {
                const res = await fetch(`/api/road-permits/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                if (!res.ok) throw new Error(await errorMessage(res, '申請の削除に失敗しました'));
                sendBroadcast('road_permits_updated', { id: item.id });
                toast.success('削除しました');
                void reload();
            } catch (e) {
                logger.error('道路申請の削除失敗:', e);
                toast.error(e instanceof Error ? e.message : '申請の削除に失敗しました');
            } finally {
                lockRef.current = false;
                setBusyId(null);
            }
        },
        [reload],
    );

    if (!canView) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center">
                <p className="text-slate-500">権限がありません</p>
            </div>
        );
    }

    const permits = data?.permits ?? [];

    return (
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1800px] flex-col gap-3">
            {/* 見出し・絞り込み・新しく作る */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-xl font-bold text-slate-900">道路申請</h1>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <span>状態</span>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as RoadPermitStatus | '')}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        >
                            <option value="">すべて</option>
                            {ROAD_PERMIT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                    {ROAD_PERMIT_STATUS_LABELS[s]}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setContactsOpen(true)}
                        disabled={!data}
                        leftIcon={<Users className="h-4 w-4" />}
                    >
                        担当者の候補
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={() => setPickMode({ kind: 'new' })}
                        disabled={busyId !== null}
                        isLoading={busyId === 'new'}
                        leftIcon={<Plus className="h-4 w-4" />}
                    >
                        新しく作る
                    </Button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                {!data && loading ? (
                    <div className="flex h-full items-center justify-center">
                        <Loading text="道路申請を読み込み中..." />
                    </div>
                ) : !data && loadError ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white py-10 text-center">
                        <p className="text-sm text-red-600">{loadError}</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
                            もう一度読み込む
                        </Button>
                    </div>
                ) : data && permits.length === 0 ? (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
                        <p className="text-slate-600">
                            {statusFilter ? `「${ROAD_PERMIT_STATUS_LABELS[statusFilter]}」の申請はありません` : 'まだ申請がありません'}
                        </p>
                        {!statusFilter && (
                            <p className="text-xs text-slate-400">右上の「新しく作る」から、案件を選んで作ります。</p>
                        )}
                    </div>
                ) : data ? (
                    <div className="relative">
                        {loading && (
                            <div className="pointer-events-none sticky top-2 z-20 flex justify-center">
                                <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1 text-xs text-slate-600 shadow">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    更新中...
                                </div>
                            </div>
                        )}

                        {/* md 以上: 表 */}
                        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
                            <table className="w-full min-w-[820px] text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-500">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium">現場</th>
                                        <th className="px-3 py-2 text-left font-medium">申請先</th>
                                        <th className="px-3 py-2 text-left font-medium">状態</th>
                                        <th className="px-3 py-2 text-left font-medium">占用期間</th>
                                        <th className="px-3 py-2 text-left font-medium">許可期限</th>
                                        <th className="px-3 py-2 text-left font-medium">更新日</th>
                                        <th className="px-3 py-2" aria-label="操作" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {permits.map((item) => (
                                        <tr
                                            key={item.id}
                                            onClick={() => void openPermit(item.id)}
                                            className="cursor-pointer align-top hover:bg-teal-100"
                                        >
                                            <td className="px-3 py-2.5">
                                                <div className="font-medium text-slate-900">{item.projectTitle ?? item.title}</div>
                                                {item.projectTitle && item.title && item.title !== item.projectTitle && (
                                                    <div className="text-xs text-slate-400">{item.title}</div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-700">{authoritiesText(item)}</td>
                                            <td className="px-3 py-2.5">
                                                <StatusBadge status={item.status} />
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                                                {formatUsePeriod(item.useFrom, item.useTo)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{reiwaOrDash(item.expiryDate)}</td>
                                            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-500">
                                                {formatUpdatedDate(item.updatedAt)}
                                            </td>
                                            <td className="px-3 py-2.5 text-right">
                                                <RowMenu
                                                    busy={busyId === item.id}
                                                    disabled={busyId !== null}
                                                    onOpen={() => void openPermit(item.id)}
                                                    onCopy={() => setPickMode({ kind: 'copy', fromId: item.id })}
                                                    onDelete={() => void handleDelete(item)}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* md 未満: カード（表が横にはみ出さないように） */}
                        <ul className="space-y-2 md:hidden">
                            {permits.map((item) => (
                                <li
                                    key={item.id}
                                    onClick={() => void openPermit(item.id)}
                                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm active:bg-teal-100"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="break-words font-medium text-slate-900">{item.projectTitle ?? item.title}</div>
                                            <div className="mt-0.5 text-xs text-slate-500">申請先: {authoritiesText(item)}</div>
                                        </div>
                                        <div className="flex flex-shrink-0 items-center gap-1">
                                            <StatusBadge status={item.status} />
                                            <RowMenu
                                                busy={busyId === item.id}
                                                disabled={busyId !== null}
                                                onOpen={() => void openPermit(item.id)}
                                                onCopy={() => setPickMode({ kind: 'copy', fromId: item.id })}
                                                onDelete={() => void handleDelete(item)}
                                            />
                                        </div>
                                    </div>
                                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                                        <dt className="text-slate-400">占用期間</dt>
                                        <dd className="text-slate-700">{formatUsePeriod(item.useFrom, item.useTo)}</dd>
                                        <dt className="text-slate-400">許可期限</dt>
                                        <dd className="text-slate-700">{reiwaOrDash(item.expiryDate)}</dd>
                                        <dt className="text-slate-400">更新日</dt>
                                        <dd className="tabular-nums text-slate-700">{formatUpdatedDate(item.updatedAt)}</dd>
                                    </dl>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>

            <ProjectMasterSearchModal
                isOpen={pickMode !== null}
                onClose={() => setPickMode(null)}
                onSelect={(pm) => void handlePickProject(pm)}
                onCreateNew={() => {
                    // 案件の新規作成は「案件一覧」の画面で行う（ここで作ると入力が足りない案件ができるため）
                    toast('案件は『案件一覧』から作ってください');
                    setPickMode(null);
                }}
            />

            {contactsOpen && data && (
                <RoadPermitContactsModal
                    contacts={data.contacts}
                    onClose={() => setContactsOpen(false)}
                    onSaved={(contacts) => {
                        // 保存後の候補をそのまま持つ（一覧を取り直さなくても、次に開く申請の「選ぶ」欄に出る）
                        setData((d) => (d ? { ...d, contacts } : d));
                        setContactsOpen(false);
                    }}
                />
            )}

            {editing && (
                <RoadPermitEditor
                    permit={editing}
                    company={data?.company ?? null}
                    contacts={data?.contacts ?? []}
                    onClose={() => setEditing(null)}
                    onSaved={(dto) => {
                        setEditing(dto);
                        void reload();
                    }}
                />
            )}
        </div>
    );
}

/** 申請先の表記（「松山東署＋松山市」。空なら「—」） */
function authoritiesText(item: RoadPermitListItem): string {
    return item.authorities.length > 0 ? item.authorities.join('＋') : '—';
}

function StatusBadge({ status }: { status: RoadPermitStatus }) {
    return (
        <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${ROAD_PERMIT_STATUS_BADGE[status] ?? ''}`}>
            {statusLabel(status)}
        </span>
    );
}

/**
 * 行の右端の「…」メニュー（開く・この申請をコピーして作る・削除）。
 * 表は横スクロールの枠の中にあるので、メニューは body に出して画面の位置に固定する（枠で切れないように）。
 */
function RowMenu({
    busy,
    disabled,
    onOpen,
    onCopy,
    onDelete,
}: {
    busy: boolean;
    disabled: boolean;
    onOpen: () => void;
    onCopy: () => void;
    onDelete: () => void;
}) {
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const close = () => setPos(null);

    // スクロール・画面の大きさが変わったら閉じる（位置がずれるため）
    useEffect(() => {
        if (!pos) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
        };
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        document.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [pos]);

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (pos) {
            close();
            return;
        }
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPos({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    };

    const run = (fn: () => void) => (e: React.MouseEvent) => {
        e.stopPropagation();
        close();
        fn();
    };

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={toggle}
                disabled={disabled}
                title="メニュー"
                aria-label="メニュー"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-700 disabled:opacity-50"
            >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
            </button>
            {pos &&
                typeof document !== 'undefined' &&
                createPortal(
                    <>
                        <div
                            className="fixed inset-0 z-[70]"
                            onClick={(e) => {
                                e.stopPropagation();
                                close();
                            }}
                        />
                        <div
                            role="menu"
                            className="fixed z-[71] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
                            style={{ top: pos.top, right: pos.right }}
                        >
                            <button
                                type="button"
                                role="menuitem"
                                onClick={run(onOpen)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-teal-100"
                            >
                                <FolderOpen className="h-4 w-4 text-slate-400" />
                                開く
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={run(onCopy)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-teal-100"
                            >
                                <Copy className="h-4 w-4 text-slate-400" />
                                この申請をコピーして作る
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={run(onDelete)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                            >
                                <Trash2 className="h-4 w-4" />
                                削除
                            </button>
                        </div>
                    </>,
                    document.body,
                )}
        </>
    );
}
