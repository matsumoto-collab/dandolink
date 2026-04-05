'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { ScaffoldingSpec } from '@/types/calendar';
import { ProjectMasterFormData } from '../ProjectMasterForm';

interface ScaffoldingSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

// ============ 基本パーツ ============

// ON/OFFトグル
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

// セグメント選択（ピル型ラジオ）
function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: T[];
    value: T | null | '';
    onChange: (v: T | null) => void;
}) {
    return (
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {options.map((opt) => {
                const active = value === opt;
                return (
                    <button
                        key={opt}
                        type="button"
                        onClick={() => onChange(active ? null : opt)}
                        className={`min-w-[3rem] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                            active
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {opt}
                    </button>
                );
            })}
        </div>
    );
}

// 仕様カード（必要/不要トグル + ON時に中身展開）
interface SpecCardProps {
    title: string;
    enabled: boolean;
    onToggle: (v: boolean) => void;
    children?: React.ReactNode;
}

function SpecCard({ title, enabled, onToggle, children }: SpecCardProps) {
    return (
        <div
            className={`rounded-xl border p-3 transition-colors ${
                enabled ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <span
                    className={`text-sm font-medium ${
                        enabled ? 'text-slate-800' : 'text-slate-500'
                    }`}
                >
                    {title}
                </span>
                <Toggle checked={enabled} onChange={onToggle} />
            </div>
            {enabled && children && (
                <div className="mt-3 border-t border-slate-100 pt-3">{children}</div>
            )}
        </div>
    );
}

// テキスト入力（カード内用）
function InlineText({
    label,
    value,
    onChange,
    placeholder,
}: {
    label?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <div className="space-y-1">
            {label && <div className="text-xs text-slate-500">{label}</div>}
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
        </div>
    );
}

// セグメント + ラベル
function LabeledSegmented<T extends string>({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: T[];
    value: T | null;
    onChange: (v: T | null) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{label}</span>
            <Segmented options={options} value={value} onChange={onChange} />
        </div>
    );
}

// グループ見出し
function GroupHeading({ title, description }: { title: string; description?: string }) {
    return (
        <div className="mb-2">
            <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
            {description && (
                <p className="mt-0.5 text-xs text-slate-400">{description}</p>
            )}
        </div>
    );
}

// ============ メイン ============

export function ScaffoldingSection({ formData, setFormData }: ScaffoldingSectionProps) {
    const spec = formData.scaffoldingSpec;

    const updateSpec = <K extends keyof ScaffoldingSpec>(key: K, value: ScaffoldingSpec[K]) => {
        setFormData({
            ...formData,
            scaffoldingSpec: { ...formData.scaffoldingSpec, [key]: value },
        });
    };

    // 選択中サマリーチップ
    const summaryChips: string[] = [];
    if (spec.singleSideScaffold) summaryChips.push('一側足場');
    if (spec.mainScaffold) summaryChips.push('本足場');
    if (spec.outerHandrail) summaryChips.push(`外手摺${spec.outerHandrail}`);
    if (spec.innerHandrail) summaryChips.push(`内手摺${spec.innerHandrail}`);
    if (spec.fallPreventionHandrail) summaryChips.push(`落下防止${spec.fallPreventionHandrail}`);
    if (spec.baseboard) summaryChips.push(`巾木${spec.baseboard}`);
    if (spec.narrowNet) summaryChips.push('小幅ネット');
    if (spec.sheet) summaryChips.push('シート');
    if (spec.imageSheet) summaryChips.push(`イメージ${spec.imageSheet}`);
    if (spec.scaffoldSign) summaryChips.push('表示看板');
    if (spec.stairs) summaryChips.push('階段');
    if (spec.ladder) summaryChips.push('タラップ');
    if (spec.stairUnit) summaryChips.push('階段墜');
    if (spec.cornerAnti) summaryChips.push(`アンチ${spec.cornerAnti}`);
    if (spec.cushionCover) summaryChips.push('養生カバー');
    if (spec.spaceTube) summaryChips.push('スペースチューブ');
    if (spec.gableHandrail) summaryChips.push('切妻単管手摺');

    return (
        <div className="space-y-6">
            {/* 選択中サマリー */}
            {summaryChips.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Check className="h-3.5 w-3.5" />
                        選択中の仕様
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {summaryChips.map((chip) => (
                            <span
                                key={chip}
                                className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200"
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* グループ1: 足場構造・手摺 */}
            <div>
                <GroupHeading title="足場構造・手摺" description="足場本体と手摺・巾木まわりの仕様" />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <SpecCard
                        title="一側足場"
                        enabled={spec.singleSideScaffold}
                        onToggle={(v) => updateSpec('singleSideScaffold', v)}
                    />
                    <SpecCard
                        title="本足場"
                        enabled={spec.mainScaffold}
                        onToggle={(v) => updateSpec('mainScaffold', v)}
                    />
                    <SpecCard
                        title="外手摺"
                        enabled={!!spec.outerHandrail}
                        onToggle={(v) => updateSpec('outerHandrail', v ? '1本' : null)}
                    >
                        <Segmented
                            options={['1本', '2本']}
                            value={spec.outerHandrail}
                            onChange={(v) => updateSpec('outerHandrail', v as '1本' | '2本' | null)}
                        />
                    </SpecCard>
                    <SpecCard
                        title="内手摺"
                        enabled={!!spec.innerHandrail}
                        onToggle={(v) => updateSpec('innerHandrail', v ? spec.innerHandrail || '1' : '')}
                    >
                        <InlineText
                            label="本数"
                            value={spec.innerHandrail}
                            onChange={(v) => updateSpec('innerHandrail', v)}
                            placeholder="例: 2本"
                        />
                    </SpecCard>
                    <SpecCard
                        title="落下防止手摺"
                        enabled={!!spec.fallPreventionHandrail}
                        onToggle={(v) => updateSpec('fallPreventionHandrail', v ? '1本' : null)}
                    >
                        <Segmented
                            options={['1本', '2本', '3本']}
                            value={spec.fallPreventionHandrail}
                            onChange={(v) =>
                                updateSpec('fallPreventionHandrail', v as '1本' | '2本' | '3本' | null)
                            }
                        />
                    </SpecCard>
                    <SpecCard
                        title="巾木"
                        enabled={!!spec.baseboard}
                        onToggle={(v) => updateSpec('baseboard', v ? 'L型' : null)}
                    >
                        <Segmented
                            options={['L型', '木']}
                            value={spec.baseboard}
                            onChange={(v) => updateSpec('baseboard', v as 'L型' | '木' | null)}
                        />
                    </SpecCard>
                    <SpecCard
                        title="小幅ネット"
                        enabled={spec.narrowNet}
                        onToggle={(v) => updateSpec('narrowNet', v)}
                    />
                    <SpecCard
                        title="壁つなぎ"
                        enabled={!!spec.wallTie}
                        onToggle={(v) => updateSpec('wallTie', v ? spec.wallTie || ' ' : '')}
                    >
                        <InlineText
                            value={spec.wallTie}
                            onChange={(v) => updateSpec('wallTie', v)}
                            placeholder="仕様・本数など"
                        />
                    </SpecCard>
                </div>
            </div>

            {/* グループ2: シート・昇降設備 */}
            <div>
                <GroupHeading title="シート・昇降設備" description="養生シートと階段・タラップなど" />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <SpecCard
                        title="シート"
                        enabled={spec.sheet}
                        onToggle={(v) => updateSpec('sheet', v)}
                    >
                        <InlineText
                            label="シート種別（カヤシートの場合）"
                            value={spec.sheetType}
                            onChange={(v) => updateSpec('sheetType', v)}
                            placeholder="種別を入力"
                        />
                    </SpecCard>
                    <SpecCard
                        title="イメージシート"
                        enabled={!!spec.imageSheet}
                        onToggle={(v) => updateSpec('imageSheet', v ? '持参' : null)}
                    >
                        <Segmented
                            options={['持参', '現場']}
                            value={spec.imageSheet}
                            onChange={(v) => updateSpec('imageSheet', v as '持参' | '現場' | null)}
                        />
                    </SpecCard>
                    <SpecCard
                        title="足場表示看板"
                        enabled={spec.scaffoldSign}
                        onToggle={(v) => updateSpec('scaffoldSign', v)}
                    />
                    <SpecCard
                        title="階段"
                        enabled={spec.stairs}
                        onToggle={(v) => updateSpec('stairs', v)}
                    />
                    <SpecCard
                        title="タラップ"
                        enabled={spec.ladder}
                        onToggle={(v) => updateSpec('ladder', v)}
                    />
                    <SpecCard
                        title="階段墜"
                        enabled={spec.stairUnit}
                        onToggle={(v) => updateSpec('stairUnit', v)}
                    />
                    <SpecCard
                        title="1・2コマアンチ"
                        enabled={!!spec.cornerAnti}
                        onToggle={(v) => updateSpec('cornerAnti', v ? '400' : null)}
                    >
                        <LabeledSegmented
                            label="サイズ"
                            options={['400', '250']}
                            value={spec.cornerAnti}
                            onChange={(v) => updateSpec('cornerAnti', v as '400' | '250' | null)}
                        />
                    </SpecCard>
                </div>
            </div>

            {/* グループ3: 安全・養生オプション */}
            <div>
                <GroupHeading title="安全・養生オプション" description="親綱・養生材などその他安全設備" />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <SpecCard
                        title="親綱"
                        enabled={!!spec.parentRope}
                        onToggle={(v) => updateSpec('parentRope', v ? spec.parentRope || ' ' : '')}
                    >
                        <InlineText
                            value={spec.parentRope}
                            onChange={(v) => updateSpec('parentRope', v)}
                            placeholder="仕様・本数など"
                        />
                    </SpecCard>
                    <SpecCard
                        title="養生カバークッション"
                        enabled={spec.cushionCover}
                        onToggle={(v) => updateSpec('cushionCover', v)}
                    />
                    <SpecCard
                        title="スペースチューブ"
                        enabled={spec.spaceTube}
                        onToggle={(v) => updateSpec('spaceTube', v)}
                    />
                    <SpecCard
                        title="切妻単管手摺"
                        enabled={spec.gableHandrail}
                        onToggle={(v) => updateSpec('gableHandrail', v)}
                    />
                </div>
            </div>
        </div>
    );
}
