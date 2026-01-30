'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ScaffoldingSpec } from '@/types/calendar';
import { ProjectMasterFormData } from '../ProjectMasterForm';

interface ScaffoldingSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

// チェックボックスフィールド
interface CheckboxFieldProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    labelWidth?: string;
}

function CheckboxField({ label, checked, onChange, labelWidth = 'w-24' }: CheckboxFieldProps) {
    return (
        <div className="flex items-center gap-2">
            <span className={`text-sm text-gray-600 ${labelWidth}`}>{label}</span>
            <label className="flex items-center gap-1 cursor-pointer">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-sm">必要</span>
            </label>
        </div>
    );
}

// ラジオボタンフィールド
interface RadioFieldProps {
    label: string;
    name: string;
    options: string[];
    value: string;
    onChange: (value: string) => void;
    labelWidth?: string;
}

function RadioField({ label, name, options, value, onChange, labelWidth = 'w-24' }: RadioFieldProps) {
    return (
        <div className="flex items-center gap-2">
            <span className={`text-sm text-gray-600 ${labelWidth}`}>{label}</span>
            <div className="flex gap-2">
                {options.map(opt => (
                    <label key={opt} className="flex items-center gap-1 cursor-pointer">
                        <input
                            type="radio"
                            name={name}
                            checked={value === opt}
                            onChange={() => onChange(opt)}
                            className="w-4 h-4"
                        />
                        <span className="text-sm">{opt}</span>
                    </label>
                ))}
            </div>
        </div>
    );
}

// テキストフィールド
interface TextFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    labelWidth?: string;
    colSpan?: string;
}

function TextField({ label, value, onChange, placeholder, labelWidth = 'w-24', colSpan = '' }: TextFieldProps) {
    return (
        <div className={`flex items-center gap-2 ${colSpan}`}>
            <span className={`text-sm text-gray-600 ${labelWidth}`}>{label}</span>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                placeholder={placeholder || label}
            />
        </div>
    );
}

// サブセクションコンポーネント
interface SubSectionProps {
    title: string;
    isExpanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
    hasBorder?: boolean;
}

function SubSection({ title, isExpanded, onToggle, children, hasBorder = true }: SubSectionProps) {
    return (
        <div className={hasBorder ? 'border-b pb-4' : ''}>
            <button
                type="button"
                onClick={onToggle}
                className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"
            >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {title}
            </button>
            {isExpanded && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4">
                    {children}
                </div>
            )}
        </div>
    );
}

export function ScaffoldingSection({ formData, setFormData }: ScaffoldingSectionProps) {
    const [expandedSubSections, setExpandedSubSections] = useState({
        section1: true,
        section2: false,
        section3: false,
    });

    const updateSpec = <K extends keyof ScaffoldingSpec>(key: K, value: ScaffoldingSpec[K]) => {
        setFormData({
            ...formData,
            scaffoldingSpec: { ...formData.scaffoldingSpec, [key]: value }
        });
    };

    const spec = formData.scaffoldingSpec;

    return (
        <div className="space-y-4">
            {/* 項目1 */}
            <SubSection
                title="項目1"
                isExpanded={expandedSubSections.section1}
                onToggle={() => setExpandedSubSections(prev => ({ ...prev, section1: !prev.section1 }))}
            >
                <CheckboxField
                    label="一側足場"
                    checked={spec.singleSideScaffold}
                    onChange={(v) => updateSpec('singleSideScaffold', v)}
                />
                <CheckboxField
                    label="本足場"
                    checked={spec.mainScaffold}
                    onChange={(v) => updateSpec('mainScaffold', v)}
                />
                <RadioField
                    label="外手摺"
                    name="outerHandrail"
                    options={['1本', '2本']}
                    value={spec.outerHandrail ?? ''}
                    onChange={(v) => updateSpec('outerHandrail', v as '1本' | '2本')}
                />
                <TextField
                    label="内手摺"
                    value={spec.innerHandrail}
                    onChange={(v) => updateSpec('innerHandrail', v)}
                    placeholder="本"
                />
                <RadioField
                    label="落下防止手摺"
                    name="fallPreventionHandrail"
                    options={['1本', '2本', '3本']}
                    value={spec.fallPreventionHandrail ?? ''}
                    onChange={(v) => updateSpec('fallPreventionHandrail', v as '1本' | '2本' | '3本')}
                />
                <RadioField
                    label="巾木"
                    name="baseboard"
                    options={['L型', '木']}
                    value={spec.baseboard ?? ''}
                    onChange={(v) => updateSpec('baseboard', v as 'L型' | '木')}
                />
                <CheckboxField
                    label="小幅ネット"
                    checked={spec.narrowNet}
                    onChange={(v) => updateSpec('narrowNet', v)}
                />
                <TextField
                    label="壁つなぎ"
                    value={spec.wallTie}
                    onChange={(v) => updateSpec('wallTie', v)}
                    colSpan="md:col-span-2"
                />
            </SubSection>

            {/* 項目2 */}
            <SubSection
                title="項目2"
                isExpanded={expandedSubSections.section2}
                onToggle={() => setExpandedSubSections(prev => ({ ...prev, section2: !prev.section2 }))}
            >
                <CheckboxField
                    label="シート"
                    checked={spec.sheet}
                    onChange={(v) => updateSpec('sheet', v)}
                />
                <TextField
                    label="シート種別※カヤシートの場合"
                    value={spec.sheetType}
                    onChange={(v) => updateSpec('sheetType', v)}
                    labelWidth="w-32"
                    colSpan="md:col-span-2"
                />
                <RadioField
                    label="イメージシート"
                    name="imageSheet"
                    options={['持参', '現場']}
                    value={spec.imageSheet ?? ''}
                    onChange={(v) => updateSpec('imageSheet', v as '持参' | '現場')}
                />
                <CheckboxField
                    label="足場表示看板"
                    checked={spec.scaffoldSign}
                    onChange={(v) => updateSpec('scaffoldSign', v)}
                />
                <CheckboxField
                    label="階段"
                    checked={spec.stairs}
                    onChange={(v) => updateSpec('stairs', v)}
                />
                <CheckboxField
                    label="タラップ"
                    checked={spec.ladder}
                    onChange={(v) => updateSpec('ladder', v)}
                />
                <CheckboxField
                    label="階段墜"
                    checked={spec.stairUnit}
                    onChange={(v) => updateSpec('stairUnit', v)}
                />
                <RadioField
                    label="1・2コマアンチ"
                    name="cornerAnti"
                    options={['400', '250']}
                    value={spec.cornerAnti ?? ''}
                    onChange={(v) => updateSpec('cornerAnti', v as '400' | '250')}
                />
            </SubSection>

            {/* 項目3 */}
            <SubSection
                title="項目3"
                isExpanded={expandedSubSections.section3}
                onToggle={() => setExpandedSubSections(prev => ({ ...prev, section3: !prev.section3 }))}
                hasBorder={false}
            >
                <TextField
                    label="親綱"
                    value={spec.parentRope}
                    onChange={(v) => updateSpec('parentRope', v)}
                    colSpan="md:col-span-2"
                />
                <CheckboxField
                    label="養生カバークッション"
                    checked={spec.cushionCover}
                    onChange={(v) => updateSpec('cushionCover', v)}
                    labelWidth="w-32"
                />
                <CheckboxField
                    label="スペースチューブ"
                    checked={spec.spaceTube}
                    onChange={(v) => updateSpec('spaceTube', v)}
                />
                <CheckboxField
                    label="切妻単管手摺"
                    checked={spec.gableHandrail}
                    onChange={(v) => updateSpec('gableHandrail', v)}
                />
            </SubSection>
        </div>
    );
}
