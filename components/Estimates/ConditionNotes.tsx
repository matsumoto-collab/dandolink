'use client';

import React from 'react';

const CONDITION_PRESETS = [
    '足場存置期間1ヶ月を含む',
    '運搬費含む',
    '諸経費含む',
    '養生費含む',
    '残材処分費含む',
    '本見積書の有効期限は発行日より30日間',
    '天候等により工期が変更になる場合があります',
    '追加作業が発生した場合は別途お見積りいたします',
];

interface ConditionNotesProps {
    notes: string;
    setNotes: (v: string) => void;
}

export default function ConditionNotes({ notes, setNotes }: ConditionNotesProps) {
    const addCondition = (condition: string) => {
        if (notes.includes(condition)) return;
        const separator = notes.trim() ? '\n' : '';
        setNotes(notes.trim() + separator + condition);
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">備考・見積条件</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {CONDITION_PRESETS.map((condition) => (
                    <button
                        key={condition}
                        type="button"
                        onClick={() => addCondition(condition)}
                        className={`px-2.5 py-1.5 text-xs rounded-full border transition-colors ${
                            notes.includes(condition)
                                ? 'bg-slate-200 border-slate-400 text-slate-600'
                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50 active:bg-gray-100'
                        }`}
                    >
                        {condition}
                    </button>
                ))}
            </div>
            <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full px-3 py-3 md:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-base md:text-sm"
                placeholder="見積条件・備考を入力...&#10;プリセットボタンをタップして追加できます"
            />
        </div>
    );
}
