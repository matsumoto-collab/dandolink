'use client';

import React, { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleSectionProps {
    title: string;
    isExpanded: boolean;
    onToggle: () => void;
    children: ReactNode;
}

export function CollapsibleSection({ title, isExpanded, onToggle, children }: CollapsibleSectionProps) {
    return (
        <div className="border border-gray-200 rounded-lg">
            <button
                type="button"
                onClick={onToggle}
                className={`w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors ${isExpanded ? 'rounded-t-lg' : 'rounded-lg'}`}
            >
                <span className="font-bold text-gray-800">{title}</span>
                {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
            {isExpanded && (
                <div className="p-4">
                    {children}
                </div>
            )}
        </div>
    );
}
