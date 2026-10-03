'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import { JOYO_LIMITS } from '@/lib/joyoStatement';
import type { JoyoContractorDto, JoyoContractorsResponse } from '@/types/joyoStatement';
import JoyoContractorForm, { type JoyoContractorFormValues } from './JoyoContractorForm';
import { errorMessage, yen } from './joyoUi';

export type JoyoSettingsTab = 'contractors' | 'document';

interface JoyoSettingsModalProps {
    /** 今の書類の設定（一覧の GET で取ったもの） */
    settings: { title: string; footerNote: string };
    initialTab?: JoyoSettingsTab;
    /** 最初から「対象者を足す」を開く（一覧の［対象者を登録する］から開いたとき） */
    startWithNewContractor?: boolean;
    onClose: () => void;
    /** 一覧（GET）を取り直す。対象者・書類の設定を保存するたびに呼ぶ */
    onChanged: () => Promise<void>;
}

/** 下の注意書きの例文（［例文を入れる］で入れる2行） */
const FOOTER_EXAMPLE = [
    '本書の内容に誤りがある場合は、発行日から7日以内にご連絡ください。',
    'ご連絡がない場合は、記載内容のとおりご確認いただいたものとします。',
].join('\n');

/** 対象者の入力欄で直している相手。'new'＝新しく足す */
type FormTarget = { kind: 'new' } | { kind: 'edit'; contractor: JoyoContractorDto } | null;

/**
 * 対象者・書類の設定（指示書 8-3）。タブ「対象者」「書類」。
 */
export default function JoyoSettingsModal({
    settings,
    initialTab = 'contractors',
    startWithNewContractor = false,
    onClose,
    onChanged,
}: JoyoSettingsModalProps) {
    const [tab, setTab] = useState<JoyoSettingsTab>(initialTab);
    const [data, setData] = useState<JoyoContractorsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [formTarget, setFormTarget] = useState<FormTarget>(startWithNewContractor ? { kind: 'new' } : null);
    const formDirtyRef = useRef(false);

    // 書類タブの入力
    const [title, setTitle] = useState(settings.title);
    const [footerNote, setFooterNote] = useState(settings.footerNote);
    const [savingDoc, setSavingDoc] = useState(false);
    const docLockRef = useRef(false);
    const docDirty = title !== settings.title || footerNote !== settings.footerNote;

    const loadContractors = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await fetch('/api/joyo-statements/contractors', { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, '対象者の取得に失敗しました'));
            setData((await res.json()) as JoyoContractorsResponse);
        } catch (e) {
            logger.error('支払明細書の対象者取得失敗:', e);
            setLoadError(e instanceof Error ? e.message : '対象者の取得に失敗しました');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadContractors();
    }, [loadContractors]);

    const handleFormDirtyChange = useCallback((dirty: boolean) => {
        formDirtyRef.current = dirty;
    }, []);

    /** 直しかけを捨ててよいか */
    const confirmDiscard = useCallback(() => {
        const dirty = (formTarget !== null && formDirtyRef.current) || docDirty;
        if (!dirty) return true;
        return window.confirm('保存していない変更があります。破棄して続けますか？');
    }, [formTarget, docDirty]);

    const requestClose = useCallback(() => {
        if (savingDoc) return;
        if (!confirmDiscard()) return;
        onClose();
    }, [savingDoc, confirmDiscard, onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            requestClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [requestClose]);

    const closeForm = () => {
        if (formDirtyRef.current && !window.confirm('保存していない変更があります。破棄して戻りますか？')) return;
        formDirtyRef.current = false;
        setFormTarget(null);
    };

    /** 対象者の保存（POST / PATCH）。成功したら対象者と一覧を取り直す */
    const submitContractor = async (values: JoyoContractorFormValues): Promise<boolean> => {
        if (!formTarget) return false;
        const isNew = formTarget.kind === 'new';
        const common = {
            recipientName: values.recipientName,
            honorific: values.honorific,
            postalCode: values.postalCode,
            address: values.address,
            registrationNumber: values.registrationNumber,
            unitPrice: values.unitPrice,
            payeeId: values.payeeId,
            notes: values.notes,
        };
        try {
            const res = isNew
                ? await fetch('/api/joyo-statements/contractors', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...common, userId: values.userId }),
                  })
                : await fetch(`/api/joyo-statements/contractors/${formTarget.contractor.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ...common, isActive: values.isActive }),
                  });
            if (!res.ok) {
                toast.error(await errorMessage(res, isNew ? '登録に失敗しました' : '保存に失敗しました'));
                return false;
            }
            toast.success(isNew ? '対象者を登録しました' : '対象者を保存しました');
            formDirtyRef.current = false;
            setFormTarget(null);
            await Promise.all([loadContractors(), onChanged()]);
            return true;
        } catch (e) {
            logger.error('支払明細書の対象者保存失敗:', e);
            toast.error(isNew ? '登録に失敗しました' : '保存に失敗しました');
            return false;
        }
    };

    // ---- 書類タブ ----
    const footerLineCount = footerNote === '' ? 0 : footerNote.split('\n').length;
    const footerTooManyLines = footerLineCount > JOYO_LIMITS.footerLines;
    const titleMissing = title.trim() === '';

    const handleInsertExample = () => {
        if (footerNote.trim() !== '' && !window.confirm('いまの注意書きを例文に置き換えます。よろしいですか？')) return;
        setFooterNote(FOOTER_EXAMPLE);
    };

    const handleSaveDocument = async () => {
        if (docLockRef.current) return;
        if (titleMissing) {
            toast.error('書類の名前を入れてください');
            return;
        }
        if (footerTooManyLines) {
            toast.error(`下の注意書きは${JOYO_LIMITS.footerLines}行までです`);
            return;
        }
        docLockRef.current = true;
        setSavingDoc(true);
        try {
            const res = await fetch('/api/joyo-statements/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim(), footerNote: footerNote.replace(/\s+$/, '') }),
            });
            if (!res.ok) {
                toast.error(await errorMessage(res, '保存に失敗しました'));
                return;
            }
            toast.success('書類の設定を保存しました');
            const savedTitle = title.trim();
            const savedFooter = footerNote.replace(/\s+$/, '');
            setTitle(savedTitle);
            setFooterNote(savedFooter);
            await Promise.all([loadContractors(), onChanged()]);
        } catch (e) {
            logger.error('支払明細書の設定保存失敗:', e);
            toast.error('保存に失敗しました');
        } finally {
            docLockRef.current = false;
            setSavingDoc(false);
        }
    };

    const switchTab = (next: JoyoSettingsTab) => {
        if (next === tab) return;
        if (tab === 'contractors' && formTarget && formDirtyRef.current) {
            if (!window.confirm('保存していない変更があります。破棄してタブを切り替えますか？')) return;
            formDirtyRef.current = false;
            setFormTarget(null);
        }
        setTab(next);
    };

    if (typeof document === 'undefined') return null;

    const tabClass = (t: JoyoSettingsTab) =>
        `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
        }`;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-0 sm:p-4">
            <div className="absolute inset-0" onClick={requestClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="対象者・書類の設定"
                className="relative flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-lg sm:shadow-xl"
            >
                <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 md:px-6">
                    <h2 className="text-lg font-semibold text-slate-900">対象者・書類の設定</h2>
                    <button
                        type="button"
                        onClick={requestClose}
                        title="閉じる"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex flex-shrink-0 border-b border-slate-200 px-2 md:px-4">
                    <button type="button" className={tabClass('contractors')} onClick={() => switchTab('contractors')}>
                        対象者
                    </button>
                    <button type="button" className={tabClass('document')} onClick={() => switchTab('document')}>
                        書類
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
                    {tab === 'contractors' ? (
                        loading && !data ? (
                            <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                <span className="text-sm">読み込んでいます...</span>
                            </div>
                        ) : loadError && !data ? (
                            <div className="space-y-3 py-8 text-center">
                                <p className="text-sm text-red-600">{loadError}</p>
                                <Button type="button" variant="outline" size="sm" onClick={() => void loadContractors()}>
                                    もう一度読み込む
                                </Button>
                            </div>
                        ) : data && formTarget ? (
                            <JoyoContractorForm
                                key={formTarget.kind === 'new' ? 'new' : formTarget.contractor.id}
                                contractor={formTarget.kind === 'new' ? null : formTarget.contractor}
                                userOptions={data.userOptions}
                                payeeOptions={data.payeeOptions}
                                onSubmit={submitContractor}
                                onCancel={closeForm}
                                onDirtyChange={handleFormDirtyChange}
                            />
                        ) : data ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm text-slate-500">行を押すと直せます。</p>
                                    <Button
                                        type="button"
                                        variant="primary"
                                        size="sm"
                                        onClick={() => setFormTarget({ kind: 'new' })}
                                        leftIcon={<Plus className="h-4 w-4" />}
                                    >
                                        対象者を足す
                                    </Button>
                                </div>
                                {data.contractors.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-500">
                                        対象者がまだ登録されていません。［対象者を足す］から登録してください。
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                        <table className="w-full min-w-[640px] text-sm">
                                            <thead className="bg-slate-50 text-xs text-slate-500">
                                                <tr>
                                                    <th className="px-3 py-2 text-right font-medium">番号</th>
                                                    <th className="px-3 py-2 text-left font-medium">宛名</th>
                                                    <th className="px-3 py-2 text-left font-medium">出勤簿の名前</th>
                                                    <th className="px-3 py-2 text-right font-medium">単価</th>
                                                    <th className="px-3 py-2 text-left font-medium">振込先</th>
                                                    <th className="px-3 py-2 text-center font-medium">利用中</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {data.contractors.map((c) => (
                                                    <tr
                                                        key={c.id}
                                                        onClick={() => setFormTarget({ kind: 'edit', contractor: c })}
                                                        className={`cursor-pointer hover:bg-teal-100 ${c.isActive ? '' : 'text-slate-400'}`}
                                                    >
                                                        <td className="px-3 py-2 text-right tabular-nums">{c.code}</td>
                                                        <td className="px-3 py-2">
                                                            {c.recipientName}
                                                            <span className="ml-1 text-xs text-slate-400">{c.honorific}</span>
                                                        </td>
                                                        <td className="px-3 py-2">{c.userDisplayName || '（ユーザーが見つかりません）'}</td>
                                                        <td className="px-3 py-2 text-right tabular-nums">{yen(c.unitPrice)}</td>
                                                        <td className="px-3 py-2">
                                                            {c.payee ? (
                                                                <>
                                                                    {c.payee.name}
                                                                    {!c.payee.isActive && (
                                                                        <span className="ml-1 text-xs text-amber-700">（利用停止）</span>
                                                                    )}
                                                                    {c.payee.isActive && !c.payee.hasAccount && (
                                                                        <span className="ml-1 text-xs text-amber-700">（口座の登録なし）</span>
                                                                    )}
                                                                </>
                                                            ) : (
                                                                <span className="text-slate-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">{c.isActive ? '○' : '利用停止'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        ) : null
                    ) : (
                        <div className="space-y-5">
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-slate-700">
                                    書類の名前 <span className="text-red-500">*</span>
                                </span>
                                <input
                                    type="text"
                                    value={title}
                                    maxLength={JOYO_LIMITS.titleLength}
                                    onChange={(e) => setTitle(e.target.value)}
                                    disabled={savingDoc}
                                    placeholder="支払明細書"
                                    className={`w-full max-w-md rounded border px-2 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 ${
                                        titleMissing ? 'border-red-400 bg-red-50' : 'border-slate-300'
                                    }`}
                                />
                                <span className="mt-1 block text-xs text-slate-500">PDF の見出しに出ます。</span>
                            </label>

                            <div className="text-sm">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <span className="font-medium text-slate-700">下の注意書き</span>
                                    <Button type="button" variant="outline" size="sm" onClick={handleInsertExample} disabled={savingDoc}>
                                        例文を入れる
                                    </Button>
                                </div>
                                <textarea
                                    value={footerNote}
                                    maxLength={JOYO_LIMITS.footerLength}
                                    rows={JOYO_LIMITS.footerLines}
                                    onChange={(e) => setFooterNote(e.target.value)}
                                    disabled={savingDoc}
                                    className={`w-full rounded border px-2 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 ${
                                        footerTooManyLines ? 'border-red-400 bg-red-50' : 'border-slate-300'
                                    }`}
                                />
                                <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs">
                                    <span className="text-slate-500">
                                        空なら書類に出ません。{JOYO_LIMITS.footerLines}行・{JOYO_LIMITS.footerLength}文字まで。
                                    </span>
                                    <span className={footerTooManyLines ? 'text-red-600' : 'text-slate-400'}>
                                        {footerLineCount}／{JOYO_LIMITS.footerLines}行・{footerNote.length}／{JOYO_LIMITS.footerLength}文字
                                    </span>
                                </div>
                            </div>

                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                発行済みの明細には影響しません。
                            </p>

                            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        setTitle(settings.title);
                                        setFooterNote(settings.footerNote);
                                    }}
                                    disabled={savingDoc || !docDirty}
                                >
                                    元に戻す
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleSaveDocument}
                                    isLoading={savingDoc}
                                    disabled={!docDirty}
                                >
                                    保存する
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
