'use client';

/**
 * 設定 ＞「評価ポイント」タブの「ありがとう」の欄（管理者だけ）。
 * 使う／使わない と 1回あたりの点数。読む・保存は GET・PUT /api/evaluation-points/thanks/settings（admin のみ）。
 * 決まりごと（送れる回数など）は lib/evaluationThanks.ts。ここでは説明の言葉として出すだけ。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { logger } from '@/lib/logger';
import { initBroadcastChannel, sendBroadcast } from '@/lib/broadcastChannel';
import { errorMessageOf } from '@/components/EvaluationPoints/evaluationPointsClient';
import { THANKS_API, parseThanksPointsInput, type ThanksSettingData } from '@/components/EvaluationPoints/evaluationThanksClient';

const SETTINGS_URL = `${THANKS_API}/settings`;

const ENABLE_CONFIRM = '「使う」にすると、作業員・職長のメニューにも「評価ポイント」が出て、ありがとうを送れるようになります。よろしいですか？';

export default function EvaluationThanksSettings() {
    const [isActive, setIsActive] = useState(false);
    /** 保存されている「使う」（オフ → オンのときだけ確認を挟むため） */
    const [savedActive, setSavedActive] = useState(false);
    const [pointsText, setPointsText] = useState('1');
    const [isLoading, setIsLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);

    // 送っているあいだは、ほかの操作を受け付けない（state だけだと、描き直される前の2回目の押下を止められない）
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);

    const apply = (body: Partial<ThanksSettingData>) => {
        const active = body.isActive === true;
        setIsActive(active);
        setSavedActive(active);
        setPointsText(typeof body.pointsPerThanks === 'number' ? String(body.pointsPerThanks) : '1');
    };

    const fetchSetting = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch(SETTINGS_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            apply((await res.json()) as Partial<ThanksSettingData>);
            setLoadFailed(false);
        } catch (error) {
            logger.error('Failed to fetch evaluation thanks setting:', error);
            setLoadFailed(true);
            toast.error('「ありがとう」の設定の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        // 保存したことを、開いている評価ポイントの画面へ知らせるため（何回呼んでも初期化は1回）
        initBroadcastChannel();
        fetchSetting();
    }, [fetchSetting]);

    const handleSave = async () => {
        const points = parseThanksPointsInput(pointsText);
        if (points === null) {
            toast.error('点数は 0〜9999 の整数で入れてください');
            return;
        }
        if (busyRef.current) return;
        if (isActive && !savedActive && !window.confirm(ENABLE_CONFIRM)) return;
        busyRef.current = true;
        setBusy(true);
        try {
            const res = await fetch(SETTINGS_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive, pointsPerThanks: points }),
            });
            if (!res.ok) {
                toast.error(await errorMessageOf(res, '「ありがとう」の設定の保存に失敗しました'));
                return;
            }
            apply((await res.json()) as Partial<ThanksSettingData>);
            toast.success('『ありがとう』の設定を保存しました');
            // 開いている評価ポイントの画面を読み直させる
            sendBroadcast('evaluation_points_updated', {});
        } catch (error) {
            logger.error('Failed to save evaluation thanks setting:', error);
            toast.error('「ありがとう」の設定の保存に失敗しました');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    return (
        <section className="min-w-0">
            <div className="mb-4">
                <h3 className="text-lg font-semibold text-slate-900">ありがとう</h3>
                <p className="text-sm text-slate-500 mt-1">社員どうしが、相手を選んで『ありがとう』を送れます。もらった数が、評価ポイントに入ります。</p>
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-500 space-y-0.5">
                    <li>自分には送れません</li>
                    <li>同じ人には、1日1回まで</li>
                    <li>1人が1日に送れるのは、3回まで</li>
                    <li>送れるのは、その日の分だけ</li>
                </ul>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-700"></div>
                </div>
            ) : loadFailed ? (
                <div className="text-center py-8 text-slate-500">
                    <p>設定を読めませんでした</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => fetchSetting()}>
                        読み直す
                    </Button>
                </div>
            ) : (
                <div className="p-3 md:p-4 rounded-xl border border-slate-200 bg-white space-y-4">
                    {/* スイッチ */}
                    <div className="flex items-start gap-3">
                        <button
                            type="button"
                            role="switch"
                            id="evaluation-thanks-active"
                            aria-checked={isActive}
                            aria-labelledby="evaluation-thanks-active-label"
                            onClick={() => setIsActive((v) => !v)}
                            disabled={busy}
                            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 ${
                                isActive ? 'bg-teal-600' : 'bg-slate-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                                    isActive ? 'translate-x-5' : 'translate-x-0.5'
                                }`}
                            />
                        </button>
                        <div className="min-w-0">
                            <label
                                id="evaluation-thanks-active-label"
                                htmlFor="evaluation-thanks-active"
                                className="block text-sm font-medium text-slate-900 cursor-pointer"
                            >
                                『ありがとう』を使う
                            </label>
                            <p className="text-sm text-slate-500 mt-1">
                                オンにすると、作業員・職長・マネージャー・管理者が、メニュー『評価ポイント』から、ありがとうを送れるようになります。
                            </p>
                        </div>
                    </div>

                    {/* 1回あたりの点数 */}
                    <div className="text-sm">
                        <label htmlFor="evaluation-thanks-points" className="text-slate-700">
                            1回あたりの点数
                        </label>
                        <div className="mt-1 flex items-center gap-2">
                            <input
                                id="evaluation-thanks-points"
                                type="text"
                                inputMode="numeric"
                                value={pointsText}
                                onChange={(e) => setPointsText(e.target.value)}
                                disabled={busy}
                                className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm text-right tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-slate-100"
                            />
                            <span className="text-slate-700">点</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            点数を変えると、変えたあとに送られた分から、新しい点数になります（すでに送られた分は変わりません）。
                        </p>
                    </div>

                    <div>
                        <Button variant="primary" onClick={handleSave} isLoading={busy}>
                            保存
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
