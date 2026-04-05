'use client';

import React, { useEffect, useState } from 'react';
import { ScaffoldingSpec } from '@/types/calendar';

type SpecItem = {
    id: string;
    groupId: string;
    name: string;
    type: 'toggle' | 'segment' | 'text';
    options: string[] | null;
    legacyKey: string | null;
    sortOrder: number;
};

type SpecGroup = {
    id: string;
    name: string;
    sortOrder: number;
    items: SpecItem[];
};

function readValue(spec: ScaffoldingSpec | undefined | null, item: SpecItem): boolean | string | null {
    if (!spec) return null;
    if (spec[item.id] !== undefined) return spec[item.id];
    if (item.legacyKey && spec[item.legacyKey] !== undefined) return spec[item.legacyKey];
    return null;
}

interface Props {
    /** 既に取得済みの scaffoldingSpec を渡す場合 */
    spec?: ScaffoldingSpec | null;
    /** projectMasterId から取得する場合 */
    projectMasterId?: string;
}

export default function ScaffoldingSpecDisplay({ spec: specProp, projectMasterId }: Props) {
    const [groups, setGroups] = useState<SpecGroup[]>([]);
    const [spec, setSpec] = useState<ScaffoldingSpec | null | undefined>(specProp);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const promises: Promise<unknown>[] = [
            fetch('/api/master-data/scaffolding-spec-groups', { cache: 'no-store' })
                .then((r) => (r.ok ? r.json() : []))
                .then((d) => { if (mounted) setGroups(d); }),
        ];
        if (specProp === undefined && projectMasterId) {
            promises.push(
                fetch(`/api/project-masters/${projectMasterId}`, { cache: 'no-store' })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((d) => { if (mounted) setSpec(d?.scaffoldingSpec ?? null); })
            );
        }
        Promise.all(promises).finally(() => { if (mounted) setLoading(false); });
        return () => { mounted = false; };
    }, [specProp, projectMasterId]);

    if (loading) return <p className="text-sm text-slate-400">読み込み中...</p>;

    const groupsWithValues = groups
        .map((g) => {
            const chips: string[] = [];
            g.items.forEach((item) => {
                const v = readValue(spec, item);
                if (item.type === 'toggle' && v === true) chips.push(item.name);
                else if (item.type === 'segment' && typeof v === 'string' && v) chips.push(`${item.name} ${v}`);
                else if (item.type === 'text' && typeof v === 'string') chips.push(v.trim() ? `${item.name}: ${v.trim()}` : item.name);
            });
            return { group: g, chips };
        })
        .filter((g) => g.chips.length > 0);

    if (groupsWithValues.length === 0) {
        return <p className="text-sm text-slate-400">設定なし</p>;
    }

    return (
        <div className="space-y-3">
            {groupsWithValues.map(({ group, chips }) => (
                <div key={group.id}>
                    <div className="text-xs text-slate-500 mb-1">{group.name}</div>
                    <div className="flex flex-wrap gap-1.5">
                        {chips.map((chip) => (
                            <span key={chip} className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200">
                                {chip}
                            </span>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
