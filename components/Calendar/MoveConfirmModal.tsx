'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, Truck, Users, ArrowRight, Check, ChevronLeft, Minus, Plus } from 'lucide-react';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import type { PendingMove } from '@/hooks/useDragAndDrop';
import type { Vehicle } from '@/types/master';

interface MoveConfirmModalProps {
    isOpen: boolean;
    pendingMove: PendingMove | null;
    eventTitle?: string;
    fromForemanName?: string;
    toForemanName?: string;
    /** その日に空いている車両（null=読み込み中） */
    availableVehicles: Vehicle[] | null;
    /** 参考表示用（グレーアウト・選択不可） */
    inUseVehicles: { id: string; name: string; usedBy: string }[];
    onConfirmKeep: () => void;
    onConfirmReassign: (trucks: string[], memberCount: number) => void;
    onCancel: () => void;
}

function formatJaDate(d: Date): string {
    return new Date(d).toLocaleDateString('ja-JP', {
        month: 'long',
        day: 'numeric',
        weekday: 'short',
    });
}

export default function MoveConfirmModal({
    isOpen,
    pendingMove,
    eventTitle,
    fromForemanName,
    toForemanName,
    availableVehicles,
    inUseVehicles,
    onConfirmKeep,
    onConfirmReassign,
    onCancel,
}: MoveConfirmModalProps) {
    const modalRef = useModalKeyboard(isOpen, onCancel);

    const [view, setView] = useState<'confirm' | 'reassign'>('confirm');
    const [selectedTrucks, setSelectedTrucks] = useState<string[]>([]);
    const [memberCountInput, setMemberCountInput] = useState<string>('0');

    // モーダルを開くたびに確認ビューへ戻し、人数を現在値で初期化
    useEffect(() => {
        if (!isOpen) return;
        setView('confirm');
        setMemberCountInput(String(pendingMove?.currentMemberCount ?? 0));
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const availableNames = useMemo(
        () => new Set((availableVehicles ?? []).map((v) => v.name)),
        [availableVehicles]
    );

    // 「再選択する」へ。元々使っていた車両のうち、空いているものを初期選択
    const goReassign = () => {
        const current = pendingMove?.currentTrucks ?? [];
        setSelectedTrucks(current.filter((name) => availableNames.has(name)));
        setView('reassign');
    };

    const toggleTruck = (name: string) => {
        setSelectedTrucks((prev) =>
            prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
        );
    };

    const adjustMember = (delta: number) => {
        const cur = parseInt(memberCountInput, 10);
        const base = Number.isNaN(cur) ? (pendingMove?.currentMemberCount ?? 0) : cur;
        setMemberCountInput(String(Math.max(0, base + delta)));
    };

    const handleReassignOk = () => {
        const parsed = parseInt(memberCountInput, 10);
        const memberCount = Number.isNaN(parsed)
            ? pendingMove?.currentMemberCount ?? 0
            : Math.max(0, parsed);
        onConfirmReassign(selectedTrucks, memberCount);
    };

    if (!isOpen || !pendingMove) return null;

    const currentTrucksLabel =
        pendingMove.currentTrucks.length > 0
            ? pendingMove.currentTrucks.join('、')
            : '（なし）';

    return (
        <div className="fixed inset-0 lg:left-48 z-[70] flex flex-col items-center justify-start pt-[4rem] pwa-modal-offset-safe lg:justify-center lg:pt-0 lg:bg-black/50">
            <div className="absolute inset-0 bg-black/50 hidden lg:block" onClick={onCancel} />

            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className="relative bg-white flex flex-col w-full h-full lg:h-auto lg:max-h-[90vh] flex-1 lg:flex-none lg:rounded-lg lg:shadow-xl lg:max-w-md lg:mx-4 overflow-hidden"
            >
                {/* ヘッダー */}
                <div className="flex-shrink-0 flex items-center justify-between bg-slate-50 border-b border-slate-200 px-6 py-4">
                    <h2 className="text-lg font-semibold text-slate-700">
                        {view === 'confirm' ? '移動の確認' : '車両・人数の再選択'}
                    </h2>
                    <button
                        onClick={onCancel}
                        className="p-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                        aria-label="閉じる"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* コンテンツ */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                    {view === 'confirm' ? (
                        <>
                            <p className="text-base font-semibold text-slate-800 mb-3">
                                {eventTitle || '案件'}
                            </p>

                            <div className="bg-slate-50 rounded-lg p-4 mb-4 text-sm text-slate-700 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="px-2 py-1 bg-white border border-slate-200 rounded-md">
                                        {formatJaDate(pendingMove.fromDate)}
                                        {fromForemanName ? ` / ${fromForemanName}` : ''}
                                    </span>
                                    <ArrowRight className="w-4 h-4 text-slate-400" />
                                    <span className="px-2 py-1 bg-white border border-slate-200 rounded-md font-medium">
                                        {formatJaDate(pendingMove.toDate)}
                                        {toForemanName ? ` / ${toForemanName}` : ''}
                                    </span>
                                </div>
                                <p>
                                    <span className="font-medium">現在の車両:</span> {currentTrucksLabel}
                                </p>
                                <p>
                                    <span className="font-medium">現在の人数:</span>{' '}
                                    {pendingMove.currentMemberCount}名
                                </p>
                            </div>

                            <p className="text-sm text-slate-500 mb-4">
                                車両・人数の情報をどうしますか？
                            </p>

                            <div className="space-y-3">
                                <button
                                    onClick={onConfirmKeep}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
                                >
                                    <Check className="w-5 h-5" />
                                    <span>そのまま引き継ぐ</span>
                                </button>
                                <button
                                    onClick={goReassign}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors"
                                >
                                    <Truck className="w-5 h-5" />
                                    <span>再選択する</span>
                                </button>
                                <button
                                    onClick={onCancel}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                    <span>キャンセル（移動しない）</span>
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* 車両選択 */}
                            <div className="mb-5">
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                                    <Truck className="w-4 h-4" />
                                    車両（{formatJaDate(pendingMove.toDate)} に空いている車両）
                                </label>

                                {availableVehicles === null ? (
                                    <p className="text-center text-slate-500 py-6 border border-slate-200 rounded-lg">
                                        空き車両を確認中...
                                    </p>
                                ) : availableVehicles.length === 0 && inUseVehicles.length === 0 ? (
                                    <p className="text-center text-slate-500 py-6 border border-slate-200 rounded-lg">
                                        車両マスターに車両が登録されていません
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {availableVehicles.map((v) => {
                                            const checked = selectedTrucks.includes(v.name);
                                            return (
                                                <label
                                                    key={v.id}
                                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${checked
                                                        ? 'bg-slate-800 text-white border-slate-800'
                                                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleTruck(v.name)}
                                                        className="w-4 h-4 accent-slate-800"
                                                    />
                                                    <span className="text-sm">{v.name}</span>
                                                </label>
                                            );
                                        })}

                                        {inUseVehicles.map((v) => (
                                            <div
                                                key={v.id}
                                                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                                                title="他で使用中のため選択できません"
                                            >
                                                <span className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        disabled
                                                        className="w-4 h-4"
                                                    />
                                                    <span className="text-sm line-through">{v.name}</span>
                                                </span>
                                                <span className="text-xs whitespace-nowrap">
                                                    使用中（{v.usedBy}）
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* 人数 */}
                            <div className="mb-2">
                                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                                    <Users className="w-4 h-4" />
                                    人数
                                </label>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => adjustMember(-1)}
                                        className="w-11 h-11 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:scale-95 transition"
                                        aria-label="人数を減らす"
                                    >
                                        <Minus className="w-5 h-5" />
                                    </button>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        value={memberCountInput}
                                        onChange={(e) => setMemberCountInput(e.target.value)}
                                        className="w-20 text-center px-2 py-2.5 border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-slate-500"
                                    />
                                    <span className="text-sm text-slate-500">名</span>
                                    <button
                                        type="button"
                                        onClick={() => adjustMember(1)}
                                        className="w-11 h-11 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:scale-95 transition"
                                        aria-label="人数を増やす"
                                    >
                                        <Plus className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* フッター（再選択ビューのみ操作ボタン） */}
                {view === 'reassign' && (
                    <div className="flex-shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 safe-area-bottom">
                        <button
                            onClick={() => setView('confirm')}
                            className="flex items-center gap-1.5 px-4 py-2 text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            戻る
                        </button>
                        <button
                            onClick={handleReassignOk}
                            disabled={availableVehicles === null}
                            className="flex items-center gap-2 px-5 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                            <Check className="w-4 h-4" />
                            OK
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
