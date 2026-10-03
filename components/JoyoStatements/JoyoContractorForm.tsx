'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { JOYO_LIMITS } from '@/lib/joyoStatement';
import type { JoyoContractorDto, JoyoContractorsResponse } from '@/types/joyoStatement';
import JoyoNumberInput from './JoyoNumberInput';

/** POST / PATCH に送る値（PATCH では userId を送らない） */
export interface JoyoContractorFormValues {
    userId: string;
    recipientName: string;
    honorific: '御中' | '様';
    postalCode: string | null;
    address: string | null;
    registrationNumber: string | null;
    unitPrice: number;
    payeeId: string | null;
    isActive: boolean;
    notes: string | null;
}

interface JoyoContractorFormProps {
    /** 直す対象者。null＝新しく足す */
    contractor: JoyoContractorDto | null;
    userOptions: JoyoContractorsResponse['userOptions'];
    payeeOptions: JoyoContractorsResponse['payeeOptions'];
    /** 保存。成功なら true（呼び出し側で API を呼び、一覧を取り直す） */
    onSubmit: (values: JoyoContractorFormValues) => Promise<boolean>;
    onCancel: () => void;
    /** 直しかけかどうかを親に知らせる（設定を閉じるときの確認に使う） */
    onDirtyChange: (dirty: boolean) => void;
}

/** 全角の英数字を半角に直し、空白とハイフンを落とす（登録番号の「Ｔ１２３…」を通すため） */
function normalizeRegistrationNumber(raw: string): string {
    return raw
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[\s　\-－ー]/g, '')
        .toUpperCase();
}

/** 頭の「〒」と空白を落とす（PDF 側で〒を付けるので二重にしない） */
function normalizePostalCode(raw: string): string {
    return raw.trim().replace(/^〒\s*/, '').trim();
}

function initialValues(c: JoyoContractorDto | null): JoyoContractorFormValues {
    return {
        userId: c?.userId ?? '',
        recipientName: c?.recipientName ?? '',
        honorific: c?.honorific === '様' ? '様' : '御中',
        postalCode: c?.postalCode ?? '',
        address: c?.address ?? '',
        registrationNumber: c?.registrationNumber ?? '',
        unitPrice: c?.unitPrice ?? 0,
        payeeId: c?.payeeId ?? null,
        isActive: c?.isActive ?? true,
        notes: c?.notes ?? '',
    };
}

const inputBase =
    'w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100';

/**
 * 対象者の入力欄（指示書 8-3 の表）。
 * 出勤簿の名前は登録後に変えられない。振込先は振込先マスターから選ぶだけで、ここから新しく作らない。
 */
export default function JoyoContractorForm({
    contractor,
    userOptions,
    payeeOptions,
    onSubmit,
    onCancel,
    onDirtyChange,
}: JoyoContractorFormProps) {
    const isNew = contractor === null;
    const [values, setValues] = useState<JoyoContractorFormValues>(() => initialValues(contractor));
    const [initialJson] = useState(() => JSON.stringify(initialValues(contractor)));
    const [saving, setSaving] = useState(false);
    const [showInvalid, setShowInvalid] = useState(false);
    // 二重押しを防ぐ同期ロック
    const lockRef = useRef(false);

    const dirty = JSON.stringify(values) !== initialJson;
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    const set = <K extends keyof JoyoContractorFormValues>(key: K, v: JoyoContractorFormValues[K]) =>
        setValues((prev) => ({ ...prev, [key]: v }));

    // 選んでいる振込先。選択肢に無い＝利用停止（または消された）振込先
    const selectedPayee = useMemo(
        () => (values.payeeId ? payeeOptions.find((p) => p.id === values.payeeId) ?? null : null),
        [values.payeeId, payeeOptions],
    );
    const payeeInactive = !!values.payeeId && !selectedPayee;
    const inactivePayeeLabel = contractor?.payee && contractor.payee.id === values.payeeId ? contractor.payee.name : '';

    const regNo = normalizeRegistrationNumber(values.registrationNumber ?? '');
    const regNoInvalid = regNo !== '' && !/^T\d{13}$/.test(regNo);
    const recipientMissing = (values.recipientName ?? '').trim() === '';
    const userMissing = isNew && !values.userId;

    const handleSubmit = async () => {
        if (lockRef.current) return;
        if (userMissing || recipientMissing || regNoInvalid) {
            setShowInvalid(true);
            toast.error(
                userMissing
                    ? '出勤簿の名前を選んでください'
                    : recipientMissing
                      ? '宛名を入れてください'
                      : 'インボイスの登録番号は T＋数字13桁で入れてください',
            );
            return;
        }
        lockRef.current = true;
        setSaving(true);
        try {
            const postal = normalizePostalCode(values.postalCode ?? '');
            const address = (values.address ?? '').trim();
            const notes = (values.notes ?? '').trim();
            await onSubmit({
                ...values,
                recipientName: values.recipientName.trim(),
                postalCode: postal || null,
                address: address || null,
                registrationNumber: regNo || null,
                notes: notes || null,
            });
        } finally {
            lockRef.current = false;
            setSaving(false);
        }
    };

    const payeeLabel = (p: JoyoContractorsResponse['payeeOptions'][number]) =>
        `${p.name}${p.bankLabel ? `（${p.bankLabel}）` : ''}${p.hasAccount ? '' : '（口座の登録なし）'}`;

    return (
        <div className="space-y-4">
            <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            >
                <ArrowLeft className="h-4 w-4" />
                対象者の一覧へ戻る
            </button>
            <h3 className="text-base font-semibold text-slate-900">
                {isNew ? '対象者を足す' : `対象者を直す（番号 ${contractor.code}）`}
            </h3>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* 出勤簿の名前 */}
                <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block font-medium text-slate-700">
                        出勤簿の名前 <span className="text-red-500">*</span>
                    </span>
                    {isNew ? (
                        <>
                            <select
                                value={values.userId}
                                onChange={(e) => set('userId', e.target.value)}
                                disabled={saving}
                                className={`${inputBase} ${showInvalid && userMissing ? 'border-red-400 bg-red-50' : ''}`}
                            >
                                <option value="">（選んでください）</option>
                                {userOptions.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.displayName}
                                    </option>
                                ))}
                            </select>
                            {userOptions.length === 0 && (
                                <p className="mt-1 text-xs text-amber-700">選べるユーザーがいません（登録済みの人は出ません）。</p>
                            )}
                            <p className="mt-1 text-xs text-slate-500">登録したあとは変えられません。</p>
                        </>
                    ) : (
                        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-700">
                            {contractor.userDisplayName || '（ユーザーが見つかりません）'}
                        </div>
                    )}
                </label>

                {/* 宛名・敬称 */}
                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">
                        宛名 <span className="text-red-500">*</span>
                    </span>
                    <input
                        type="text"
                        value={values.recipientName}
                        maxLength={JOYO_LIMITS.recipientNameLength}
                        onChange={(e) => set('recipientName', e.target.value)}
                        disabled={saving}
                        placeholder="屋号または氏名"
                        className={`${inputBase} ${showInvalid && recipientMissing ? 'border-red-400 bg-red-50' : ''}`}
                    />
                </label>
                <div className="text-sm">
                    <span className="mb-1 block font-medium text-slate-700">敬称</span>
                    <div className="flex items-center gap-4 py-1.5">
                        {(['御中', '様'] as const).map((h) => (
                            <label key={h} className="inline-flex items-center gap-1.5">
                                <input
                                    type="radio"
                                    name="joyo-honorific"
                                    checked={values.honorific === h}
                                    onChange={() => set('honorific', h)}
                                    disabled={saving}
                                    className="h-4 w-4 border-slate-300 text-teal-600 focus:ring-teal-500"
                                />
                                {h}
                            </label>
                        ))}
                    </div>
                </div>

                {/* 郵便番号・住所 */}
                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">郵便番号</span>
                    <input
                        type="text"
                        value={values.postalCode ?? ''}
                        maxLength={10}
                        onChange={(e) => set('postalCode', e.target.value)}
                        disabled={saving}
                        placeholder="123-4567（〒は付けない）"
                        className={inputBase}
                    />
                </label>
                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">住所</span>
                    <input
                        type="text"
                        value={values.address ?? ''}
                        maxLength={JOYO_LIMITS.addressLength}
                        onChange={(e) => set('address', e.target.value)}
                        disabled={saving}
                        className={inputBase}
                    />
                </label>

                {/* 登録番号 */}
                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">インボイスの登録番号</span>
                    <input
                        type="text"
                        value={values.registrationNumber ?? ''}
                        maxLength={20}
                        onChange={(e) => set('registrationNumber', e.target.value)}
                        disabled={saving}
                        placeholder="T1234567890123（無ければ空）"
                        className={`${inputBase} ${showInvalid && regNoInvalid ? 'border-red-400 bg-red-50' : ''}`}
                    />
                    <span className="mt-1 block text-xs text-slate-500">入れると、PDF の宛名の下に出ます。</span>
                    {regNoInvalid && (
                        <span className="mt-0.5 block text-xs text-red-600">T＋数字13桁で入れてください。</span>
                    )}
                </label>

                {/* 単価 */}
                <label className="block text-sm">
                    <span className="mb-1 block font-medium text-slate-700">
                        単価（1日・税込） <span className="text-red-500">*</span>
                    </span>
                    <div className="flex items-center gap-1">
                        <span className="text-slate-500">¥</span>
                        <JoyoNumberInput
                            value={values.unitPrice}
                            onChange={(v) => set('unitPrice', v)}
                            min={0}
                            max={JOYO_LIMITS.maxUnitPrice}
                            comma
                            maxLength={9}
                            disabled={saving}
                            ariaLabel="単価（1日・税込）"
                            className="w-40"
                        />
                    </div>
                    <span className="mt-1 block text-xs text-slate-500">
                        変えると、これから作る明細に使われます。保存済みの明細は変わりません。
                    </span>
                </label>

                {/* 振込先 */}
                <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block font-medium text-slate-700">振込先</span>
                    <select
                        value={values.payeeId ?? ''}
                        onChange={(e) => set('payeeId', e.target.value || null)}
                        disabled={saving}
                        className={`${inputBase} ${payeeInactive ? 'border-amber-400 bg-amber-50' : ''}`}
                    >
                        <option value="">（選ばない）</option>
                        {payeeInactive && values.payeeId && (
                            <option value={values.payeeId}>{`${inactivePayeeLabel || '登録されていた振込先'}（利用停止）`}</option>
                        )}
                        {payeeOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                                {payeeLabel(p)}
                            </option>
                        ))}
                    </select>
                    <span className="mt-1 block text-xs text-slate-500">『支払予定に追加』で使います。</span>
                    {payeeInactive && (
                        <span className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            いま登録されている振込先は利用停止になっています。選び直してください。
                        </span>
                    )}
                    {selectedPayee && !selectedPayee.hasAccount && (
                        <span className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            この振込先には口座が登録されていません。口座の入っている振込先を選ぶか、『振込先マスター』で口座を入れてください。
                        </span>
                    )}
                </label>

                {/* 利用中（直すときだけ） */}
                {!isNew && (
                    <label className="flex items-start gap-2 text-sm text-slate-700 md:col-span-2">
                        <input
                            type="checkbox"
                            checked={values.isActive}
                            onChange={(e) => set('isActive', e.target.checked)}
                            disabled={saving}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span>
                            利用中
                            <span className="block text-xs text-slate-500">
                                外すと一覧に出なくなります（その月の明細がある月は出ます）。
                            </span>
                        </span>
                    </label>
                )}

                {/* メモ */}
                <label className="block text-sm md:col-span-2">
                    <span className="mb-1 block font-medium text-slate-700">メモ</span>
                    <textarea
                        value={values.notes ?? ''}
                        maxLength={500}
                        rows={2}
                        onChange={(e) => set('notes', e.target.value)}
                        disabled={saving}
                        className={inputBase}
                    />
                </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
                    キャンセル
                </Button>
                <Button type="button" variant="primary" onClick={handleSubmit} isLoading={saving}>
                    {isNew ? '登録する' : '保存する'}
                </Button>
            </div>
        </div>
    );
}
