'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ScaffoldingSpec } from '@/types/calendar';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import { logger } from '@/lib/logger';
import {
    isSpecValueFilled,
    collectDefaultSpec,
    applyPresetToSpec,
    underlayDefaults,
    hasAnySpecValue,
} from '@/lib/scaffoldingSpec';

interface ScaffoldingSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
    /**
     * 新規作成フォームか。true のときだけ、まだ何も入力されていなければ
     * 足場仕様マスタの既定値を流し込む（編集中の案件を勝手に書き換えないため）。
     */
    isNew?: boolean;
}

/** 足場仕様テンプレート（/api/master-data/scaffolding-spec-presets）。 */
interface SpecPreset {
    id: string;
    name: string;
    spec: ScaffoldingSpec;
    /** 全社共有か（false = 自分専用）。 */
    shared: boolean;
    /** 自分が持ち主か（共有テンプレを作った本人でも false になり得る）。 */
    isOwn: boolean;
}

type ItemType = 'toggle' | 'segment' | 'text';

interface SpecItem {
    id: string;
    groupId: string;
    name: string;
    type: ItemType;
    options: string[] | null;
    hasText: boolean;
    legacyKey: string | null;
    /** 新規案件で最初から入っている値（null = 既定値なし）。 */
    defaultValue: boolean | string | null;
    sortOrder: number;
}

const TEXT_SUFFIX = '__text';

interface SpecGroup {
    id: string;
    name: string;
    sortOrder: number;
    items: SpecItem[];
}

// ========== パーツ ==========

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                checked ? 'bg-slate-700' : 'bg-slate-300'
            }`}
            aria-pressed={checked}
        >
            <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    checked ? 'translate-x-5' : 'translate-x-0.5'
                }`}
            />
        </button>
    );
}

function Segmented({
    options,
    value,
    onChange,
}: {
    options: string[];
    value: string | null;
    onChange: (v: string | null) => void;
}) {
    return (
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {options.map((opt) => {
                const active = value === opt;
                return (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => onChange(active ? null : opt)}
                        className={`min-w-[3rem] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {opt}
                    </button>
                );
            })}
        </div>
    );
}

function SpecCard({
    title,
    enabled,
    onToggle,
    children,
}: {
    title: string;
    enabled: boolean;
    onToggle: (v: boolean) => void;
    children?: React.ReactNode;
}) {
    return (
        <div className={`rounded-xl border p-3 transition-colors ${enabled ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${enabled ? 'text-slate-800' : 'text-slate-500'}`}>{title}</span>
                <Toggle checked={enabled} onChange={onToggle} />
            </div>
            {enabled && children && <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>}
        </div>
    );
}

// ========== メイン ==========

// 値読み取り: itemId キー → legacyKey の順でフォールバック
function readValue(spec: ScaffoldingSpec, item: SpecItem): boolean | string | null {
    if (spec[item.id] !== undefined) return spec[item.id];
    if (item.legacyKey && spec[item.legacyKey] !== undefined) return spec[item.legacyKey];
    return null;
}

export function ScaffoldingSection({ formData, setFormData, isNew = false }: ScaffoldingSectionProps) {
    const [groups, setGroups] = useState<SpecGroup[]>([]);
    const [presets, setPresets] = useState<SpecPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPresetId, setSelectedPresetId] = useState('');
    const [saveOpen, setSaveOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [saveShared, setSaveShared] = useState(false);
    const [saving, setSaving] = useState(false);
    // 既定値の流し込みは1回だけ（マスタ再取得や再レンダーで入力を上書きしないため）
    const defaultsAppliedRef = useRef(false);

    useEffect(() => {
        let mounted = true;
        Promise.all([
            fetch('/api/master-data/scaffolding-spec-groups', { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : []))
                .catch(() => []),
            fetch('/api/master-data/scaffolding-spec-presets', { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : []))
                .catch(() => []),
        ])
            .then(([g, p]) => {
                if (!mounted) return;
                setGroups(Array.isArray(g) ? g : []);
                setPresets(Array.isArray(p) ? p : []);
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, []);

    const updateValue = (itemId: string, value: boolean | string | null) => {
        setFormData({
            ...formData,
            scaffoldingSpec: { ...formData.scaffoldingSpec, [itemId]: value },
        });
    };

    const spec = formData.scaffoldingSpec;

    // 新規作成フォームで、まだ何も入力されていなければマスタの既定値を入れる。
    // 「ほぼ毎回同じ項目」を自動で埋めるのが目的なので、1文字でも入力済みなら何もしない。
    useEffect(() => {
        if (!isNew || loading || defaultsAppliedRef.current || groups.length === 0) return;
        if (hasAnySpecValue(formData.scaffoldingSpec)) {
            defaultsAppliedRef.current = true;
            return;
        }
        const defaults = collectDefaultSpec(groups);
        defaultsAppliedRef.current = true;
        if (Object.keys(defaults).length === 0) return;
        setFormData((prev) => ({
            ...prev,
            scaffoldingSpec: underlayDefaults(prev.scaffoldingSpec, defaults),
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isNew, loading, groups]);

    /**
     * テンプレートを適用する。
     * テンプレートに入っている項目だけを上書きし、入っていない項目は今の内容を残す
     * （途中まで入力してからテンプレを当てても、入力が消えないようにするため）。
     */
    const applyPreset = useCallback((presetId: string) => {
        const preset = presets.find((p) => p.id === presetId);
        if (!preset) return;
        setFormData((prev) => ({
            ...prev,
            scaffoldingSpec: applyPresetToSpec(prev.scaffoldingSpec, preset.spec),
        }));
        defaultsAppliedRef.current = true; // テンプレ適用後に既定値で上書きしない
        toast.success(`「${preset.name}」を反映しました`);
    }, [presets, setFormData]);

    /** いま画面に入っている内容をテンプレートとして保存する（未入力の項目は含めない）。 */
    const savePreset = useCallback(async () => {
        const name = newPresetName.trim();
        if (!name) {
            toast.error('テンプレート名を入力してください');
            return;
        }
        const payload: Record<string, boolean | string> = {};
        for (const [k, v] of Object.entries(formData.scaffoldingSpec ?? {})) {
            if (isSpecValueFilled(v)) payload[k] = v as boolean | string;
        }
        if (Object.keys(payload).length === 0) {
            toast.error('保存する内容がありません。足場仕様を1つ以上選んでください');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/master-data/scaffolding-spec-presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, spec: payload, shared: saveShared }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || 'テンプレートの保存に失敗しました');
            }
            const created: SpecPreset = await res.json();
            setPresets((prev) => [...prev, created]);
            setSelectedPresetId(created.id);
            setSaveOpen(false);
            setNewPresetName('');
            setSaveShared(false);
            toast.success('テンプレートに保存しました');
        } catch (e) {
            logger.error('Failed to save scaffolding preset:', e);
            toast.error(e instanceof Error ? e.message : 'テンプレートの保存に失敗しました');
        } finally {
            setSaving(false);
        }
    }, [newPresetName, formData.scaffoldingSpec, saveShared]);

    /** テンプレートを削除する（自分のもの／権限があるものだけボタンを出す）。 */
    const deletePreset = useCallback(async (presetId: string) => {
        const preset = presets.find((p) => p.id === presetId);
        if (!preset) return;
        if (!window.confirm(`テンプレート「${preset.name}」を削除します。よろしいですか？`)) return;
        try {
            const res = await fetch(`/api/master-data/scaffolding-spec-presets/${presetId}`, { method: 'DELETE' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || 'テンプレートの削除に失敗しました');
            }
            setPresets((prev) => prev.filter((p) => p.id !== presetId));
            setSelectedPresetId('');
            toast.success('テンプレートを削除しました');
        } catch (e) {
            logger.error('Failed to delete scaffolding preset:', e);
            toast.error(e instanceof Error ? e.message : 'テンプレートの削除に失敗しました');
        }
    }, [presets]);

    const selectedPreset = presets.find((p) => p.id === selectedPresetId);
    const ownPresets = presets.filter((p) => !p.shared);
    const sharedPresets = presets.filter((p) => p.shared);

    // サマリー生成
    const summaryChips: string[] = [];
    groups.forEach((g) => {
        g.items.forEach((item) => {
            const v = readValue(spec, item);
            const extraRaw = spec[item.id + TEXT_SUFFIX];
            const extra = typeof extraRaw === 'string' && extraRaw.trim() ? extraRaw.trim() : '';
            const suffix = item.hasText && extra ? ` (${extra})` : '';
            if (item.type === 'toggle' && v === true) summaryChips.push(item.name + suffix);
            else if (item.type === 'segment' && typeof v === 'string' && v) summaryChips.push(`${item.name}${v}${suffix}`);
            else if (item.type === 'text' && typeof v === 'string') summaryChips.push(v.trim() ? `${item.name}:${v.trim()}` : item.name);
        });
    });

    if (loading) {
        return <div className="text-sm text-slate-400 py-4">読み込み中...</div>;
    }

    if (groups.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                足場仕様の項目が登録されていません。設定画面から追加してください。
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* テンプレート（プリセット）。適用は「テンプレに入っている項目だけ」を反映し、
                入っていない項目は今の入力を残す。 */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor="scaffold-preset" className="shrink-0 text-sm font-medium text-slate-700">
                        テンプレート
                    </label>
                    <select
                        id="scaffold-preset"
                        value={selectedPresetId}
                        onChange={(e) => setSelectedPresetId(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    >
                        <option value="">選択してください</option>
                        {ownPresets.length > 0 && (
                            <optgroup label="自分のテンプレート">
                                {ownPresets.map((pr) => (
                                    <option key={pr.id} value={pr.id}>{pr.name}</option>
                                ))}
                            </optgroup>
                        )}
                        {sharedPresets.length > 0 && (
                            <optgroup label="全社共有">
                                {sharedPresets.map((pr) => (
                                    <option key={pr.id} value={pr.id}>{pr.name}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                    <div className="flex shrink-0 gap-2">
                        <button
                            type="button"
                            onClick={() => applyPreset(selectedPresetId)}
                            disabled={!selectedPresetId}
                            className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                            反映
                        </button>
                        {selectedPreset?.isOwn && (
                            <button
                                type="button"
                                onClick={() => deletePreset(selectedPresetId)}
                                title="このテンプレートを削除"
                                aria-label="このテンプレートを削除"
                                className="rounded-lg border border-slate-200 px-2.5 py-2 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setSaveOpen((v) => !v)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                            <Save className="h-4 w-4" />
                            保存
                        </button>
                    </div>
                </div>

                {presets.length === 0 && !saveOpen && (
                    <p className="mt-2 text-xs text-slate-500">
                        よく使う組み合わせを入力してから「保存」すると、次回から選ぶだけで反映できます。
                    </p>
                )}

                {saveOpen && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="mb-2 text-xs text-slate-600">
                            いま選んでいる内容をテンプレートとして保存します（未入力の項目は含まれません）。
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                                type="text"
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                                placeholder="例: 改修・一側足場"
                                maxLength={60}
                                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                            <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
                                <input
                                    type="checkbox"
                                    checked={saveShared}
                                    onChange={(e) => setSaveShared(e.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300"
                                />
                                全社共有にする
                            </label>
                            <button
                                type="button"
                                onClick={savePreset}
                                disabled={saving}
                                className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:bg-slate-300"
                            >
                                {saving ? '保存中...' : '保存する'}
                            </button>
                        </div>
                        <p className="mt-1.5 text-[11px] text-slate-500">
                            全社共有は管理者・マネージャーのみ作成できます。
                        </p>
                    </div>
                )}
            </div>

            {summaryChips.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Check className="h-3.5 w-3.5" />
                        選択中の仕様
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {summaryChips.map((chip) => (
                            <span key={chip} className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
                                {chip}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {groups.map((group) => (
                <div key={group.id}>
                    <h4 className="mb-2 text-sm font-semibold text-slate-800">{group.name}</h4>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {group.items.map((item) => {
                            const v = readValue(spec, item);
                            const extraRaw = spec[item.id + TEXT_SUFFIX];
                            const extraText = typeof extraRaw === 'string' ? extraRaw : '';

                            const extraInput = item.hasText ? (
                                <input
                                    type="text"
                                    value={extraText}
                                    onChange={(e) => updateValue(item.id + TEXT_SUFFIX, e.target.value)}
                                    placeholder="補足テキスト"
                                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                                />
                            ) : null;

                            if (item.type === 'toggle') {
                                return (
                                    <SpecCard
                                        key={item.id}
                                        title={item.name}
                                        enabled={v === true}
                                        onToggle={(on) => updateValue(item.id, on)}
                                    >
                                        {extraInput}
                                    </SpecCard>
                                );
                            }

                            if (item.type === 'segment') {
                                const opts = item.options ?? [];
                                const current = typeof v === 'string' ? v : null;
                                return (
                                    <SpecCard
                                        key={item.id}
                                        title={item.name}
                                        enabled={!!current}
                                        onToggle={(on) => updateValue(item.id, on ? opts[0] ?? null : null)}
                                    >
                                        <Segmented
                                            options={opts}
                                            value={current}
                                            onChange={(nv) => updateValue(item.id, nv)}
                                        />
                                        {extraInput}
                                    </SpecCard>
                                );
                            }

                            // text: enabled は「値が文字列として存在するか」で判定（空文字でもON扱い）
                            const isTextEnabled = typeof v === 'string';
                            const text = isTextEnabled ? (v as string) : '';
                            return (
                                <SpecCard
                                    key={item.id}
                                    title={item.name}
                                    enabled={isTextEnabled}
                                    onToggle={(on) => updateValue(item.id, on ? '' : null)}
                                >
                                    <input
                                        type="text"
                                        value={text}
                                        onChange={(e) => updateValue(item.id, e.target.value)}
                                        placeholder="入力"
                                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                                    />
                                </SpecCard>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
