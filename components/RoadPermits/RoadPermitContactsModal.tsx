'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { ROAD_PERMIT_CONTACTS_MAX } from '@/lib/roadPermit/contacts';
import type { RoadPermitContactPreset, RoadPermitSettingsResponse } from '@/types/roadPermit';
import { ROAD_PERMIT_INPUT_CLASS, errorMessage } from './roadPermitUi';

interface RoadPermitContactsModalProps {
    /** 今の候補（並び順） */
    contacts: RoadPermitContactPreset[];
    onClose: () => void;
    /** 保存できたとき（保存後の候補を渡す。閉じるのは親） */
    onSaved: (contacts: RoadPermitContactPreset[]) => void;
}

/** 編集中の 1 行（key は React の並べ替え用。保存には送らない） */
interface Row {
    key: number;
    name: string;
    phone: string;
}

let nextKey = 1;
const newRow = (name = '', phone = ''): Row => ({ key: nextKey++, name, phone });

/** 保存に送る形（前後の空白を取り、名前も電話も空の行は落とす） */
function toPayload(rows: Row[]): RoadPermitContactPreset[] {
    return rows
        .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() }))
        .filter((r) => r.name !== '' || r.phone !== '');
}

/**
 * 「担当者の候補」の登録画面（docs/指示書_道路申請_担当者の選択と住所.md §3.2）。
 * 名前・電話の行を 足す／消す／上下に並べ替え、「保存」で PUT /api/road-permits/settings に丸ごと送る。
 * 保存できたら road_permits_updated を送る（ほかの端末の一覧が候補ごと取り直す）。
 */
export default function RoadPermitContactsModal({ contacts, onClose, onSaved }: RoadPermitContactsModalProps) {
    const [rows, setRows] = useState<Row[]>(() =>
        contacts.length > 0 ? contacts.map((c) => newRow(c.name, c.phone)) : [newRow()],
    );
    const [saving, setSaving] = useState(false);
    // 二重押しを防ぐ同期ロック（state の反映を待たずに止める）
    const lockRef = useRef(false);

    const baseJson = useMemo(() => JSON.stringify(contacts), [contacts]);
    const isDirty = JSON.stringify(toPayload(rows)) !== baseJson;
    const canAdd = rows.length < ROAD_PERMIT_CONTACTS_MAX;

    const update = (key: number, patch: Partial<Pick<Row, 'name' | 'phone'>>) =>
        setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
    const move = (key: number, dir: -1 | 1) =>
        setRows((rs) => {
            const i = rs.findIndex((r) => r.key === key);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= rs.length) return rs;
            const next = rs.slice();
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });
    const add = () => setRows((rs) => (rs.length >= ROAD_PERMIT_CONTACTS_MAX ? rs : [...rs, newRow()]));

    const requestClose = useCallback(() => {
        if (lockRef.current) return;
        if (isDirty && !window.confirm('保存していない変更があります。閉じますか？')) return;
        onClose();
    }, [isDirty, onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            requestClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [requestClose]);

    const handleSave = async () => {
        if (lockRef.current) return;
        const payload = toPayload(rows);
        if (payload.some((r) => r.name === '')) {
            toast.error('名前が空の行があります。名前を入れるか、その行を消してください');
            return;
        }
        lockRef.current = true;
        setSaving(true);
        try {
            const res = await fetch('/api/road-permits/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contacts: payload }),
            });
            if (!res.ok) throw new Error(await errorMessage(res, '担当者の候補の保存に失敗しました'));
            const json = (await res.json()) as RoadPermitSettingsResponse;
            sendBroadcast('road_permits_updated', { settings: true });
            toast.success('担当者の候補を保存しました');
            onSaved(json.contacts);
        } catch (e) {
            logger.error('道路申請の担当者の候補の保存失敗:', e);
            toast.error(e instanceof Error ? e.message : '担当者の候補の保存に失敗しました');
        } finally {
            lockRef.current = false;
            setSaving(false);
        }
    };

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 pwa-modal-offset-safe">
            <div className="absolute inset-0 bg-black/50" onClick={requestClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="担当者の候補"
                className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg bg-white shadow-xl"
            >
                {/* ヘッダー */}
                <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-slate-900">担当者の候補</h2>
                        <p className="mt-0.5 text-xs text-slate-500">
                            申請の「基本」タブの 担当者・現場責任者 の「選ぶ」欄に、この順で出ます（{ROAD_PERMIT_CONTACTS_MAX}人まで）
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={requestClose}
                        title="閉じる"
                        aria-label="閉じる"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* 本文 */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <div className="mb-1 hidden grid-cols-[1fr_1fr_6.5rem] gap-2 text-xs font-medium text-slate-500 sm:grid">
                        <span>名前</span>
                        <span>電話</span>
                        <span className="text-right">並び替え・消す</span>
                    </div>
                    <ul className="space-y-2">
                        {rows.map((row, i) => (
                            <li key={row.key} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_1fr_6.5rem] sm:items-center sm:border-0 sm:p-0">
                                <input
                                    type="text"
                                    value={row.name}
                                    placeholder={`名前（例: 今井　公一郎）`}
                                    aria-label={`${i + 1}人目の名前`}
                                    onChange={(e) => update(row.key, { name: e.target.value })}
                                    className={ROAD_PERMIT_INPUT_CLASS}
                                />
                                <input
                                    type="tel"
                                    value={row.phone}
                                    placeholder="電話（例: 089-000-0000）"
                                    aria-label={`${i + 1}人目の電話`}
                                    onChange={(e) => update(row.key, { phone: e.target.value })}
                                    className={ROAD_PERMIT_INPUT_CLASS}
                                />
                                <div className="flex items-center justify-end gap-0.5">
                                    <button
                                        type="button"
                                        onClick={() => move(row.key, -1)}
                                        disabled={i === 0}
                                        title="上へ"
                                        aria-label="上へ"
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                    >
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => move(row.key, 1)}
                                        disabled={i === rows.length - 1}
                                        title="下へ"
                                        aria-label="下へ"
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                    >
                                        <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => remove(row.key)}
                                        title="この行を消す"
                                        aria-label="この行を消す"
                                        className="rounded-md p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                    {rows.length === 0 && <p className="py-2 text-center text-sm text-slate-500">候補はありません（「行を足す」で登録できます）</p>}
                    <div className="mt-3">
                        <Button type="button" variant="outline" size="sm" onClick={add} disabled={!canAdd} leftIcon={<Plus className="h-4 w-4" />}>
                            行を足す
                        </Button>
                    </div>
                </div>

                {/* フッター */}
                <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
                    <span className="text-xs text-slate-500">{isDirty ? '保存していない変更があります' : ''}</span>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={requestClose} disabled={saving}>
                            閉じる
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => void handleSave()}
                            disabled={saving || !isDirty}
                            isLoading={saving}
                            leftIcon={<Save className="h-4 w-4" />}
                        >
                            保存
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
