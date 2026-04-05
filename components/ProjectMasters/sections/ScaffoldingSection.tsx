'use client';

import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ScaffoldingSpec } from '@/types/calendar';
import { ProjectMasterFormData } from '../ProjectMasterForm';

interface ScaffoldingSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

type ItemType = 'toggle' | 'segment' | 'text';

interface SpecItem {
    id: string;
    groupId: string;
    name: string;
    type: ItemType;
    options: string[] | null;
    legacyKey: string | null;
    sortOrder: number;
}

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

export function ScaffoldingSection({ formData, setFormData }: ScaffoldingSectionProps) {
    const [groups, setGroups] = useState<SpecGroup[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        fetch('/api/master-data/scaffolding-spec-groups', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : []))
            .then((data) => {
                if (mounted) setGroups(data);
            })
            .catch(() => {})
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

    // サマリー生成
    const summaryChips: string[] = [];
    groups.forEach((g) => {
        g.items.forEach((item) => {
            const v = readValue(spec, item);
            if (item.type === 'toggle' && v === true) summaryChips.push(item.name);
            else if (item.type === 'segment' && typeof v === 'string' && v) summaryChips.push(`${item.name}${v}`);
            else if (item.type === 'text' && typeof v === 'string' && v.trim()) summaryChips.push(`${item.name}:${v}`);
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

                            if (item.type === 'toggle') {
                                return (
                                    <SpecCard
                                        key={item.id}
                                        title={item.name}
                                        enabled={v === true}
                                        onToggle={(on) => updateValue(item.id, on)}
                                    />
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
                                    </SpecCard>
                                );
                            }

                            // text
                            const text = typeof v === 'string' ? v : '';
                            return (
                                <SpecCard
                                    key={item.id}
                                    title={item.name}
                                    enabled={text.length > 0}
                                    onToggle={(on) => updateValue(item.id, on ? text || ' ' : '')}
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
