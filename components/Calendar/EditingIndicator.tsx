'use client';

import React from 'react';
import { EditingUser } from '@/types/calendar';
import { Edit3 } from 'lucide-react';

interface EditingIndicatorProps {
    users: EditingUser[];
    compact?: boolean;
}

export default function EditingIndicator({ users, compact = false }: EditingIndicatorProps) {
    if (users.length === 0) return null;

    const displayNames = users.map(u => u.name).join(', ');

    if (compact) {
        return (
            <div
                className="absolute top-0.5 right-0.5 z-10 flex items-center gap-0.5 px-1 py-0.5 bg-slate-100 rounded text-[10px] text-slate-700"
                title={`${displayNames}が編集中`}
            >
                <Edit3 className="w-2.5 h-2.5 animate-pulse" />
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-600">
            <Edit3 className="w-4 h-4 animate-pulse" />
            <span>
                {users.length === 1
                    ? `${displayNames}さんが編集中`
                    : `${users.length}人が編集中`}
            </span>
        </div>
    );
}
