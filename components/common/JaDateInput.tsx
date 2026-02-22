'use client';
import React from 'react';

interface JaDateInputProps {
    value: string; // '' または 'yyyy-mm-dd'
    onChange: (value: string) => void;
    selectClassName?: string;
    className?: string;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 11 }, (_, i) => CURRENT_YEAR - 3 + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function JaDateInput({ value, onChange, selectClassName, className }: JaDateInputProps) {
    const parts = value ? value.split('-') : ['', '', ''];
    const year = parts[0] || '';
    const month = parts[1] ? String(parseInt(parts[1])) : '';
    const day = parts[2] ? String(parseInt(parts[2])) : '';

    const handleChange = (y: string, m: string, d: string) => {
        if (y && m && d) {
            onChange(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
        } else {
            onChange('');
        }
    };

    const baseClass = selectClassName ?? 'px-2 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 text-sm';

    return (
        <div className={`flex items-center gap-1 ${className ?? ''}`}>
            <select
                value={year}
                onChange={(e) => handleChange(e.target.value, month, day)}
                className={baseClass}
            >
                <option value="">年</option>
                {YEARS.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
            <span className="text-sm text-gray-600">年</span>
            <select
                value={month}
                onChange={(e) => handleChange(year, e.target.value, day)}
                className={baseClass}
            >
                <option value="">月</option>
                {MONTHS.map(m => <option key={m} value={String(m)}>{m}</option>)}
            </select>
            <span className="text-sm text-gray-600">月</span>
            <select
                value={day}
                onChange={(e) => handleChange(year, month, e.target.value)}
                className={baseClass}
            >
                <option value="">日</option>
                {DAYS.map(d => <option key={d} value={String(d)}>{d}</option>)}
            </select>
            <span className="text-sm text-gray-600">日</span>
        </div>
    );
}
