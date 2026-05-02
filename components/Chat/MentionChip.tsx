'use client';

import React from 'react';
import type { MentionToken } from '@/lib/chat/mentionParser';
import { useNavigation } from '@/contexts/NavigationContext';
import { useRouter } from 'next/navigation';

interface MentionChipProps {
    token: MentionToken;
    onMine?: boolean;
}

export default function MentionChip({ token, onMine = false }: MentionChipProps) {
    const { setActivePage } = useNavigation();
    const router = useRouter();

    const handleClick = () => {
        if (token.type === 'project') {
            setActivePage('project-masters');
            router.push(`/?page=project-masters&pmId=${token.targetId}`);
        }
    };

    const colorClass = (() => {
        if (token.type === 'role') {
            return onMine
                ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
                : 'bg-amber-50 text-amber-800 ring-1 ring-amber-200';
        }
        if (token.type === 'project') {
            return onMine
                ? 'bg-sky-100 text-sky-900 ring-1 ring-sky-300 cursor-pointer hover:bg-sky-200'
                : 'bg-sky-50 text-sky-800 ring-1 ring-sky-200 cursor-pointer hover:bg-sky-100';
        }
        // user
        return onMine
            ? 'bg-white/30 text-white ring-1 ring-white/40'
            : 'bg-teal-50 text-teal-800 ring-1 ring-teal-200';
    })();

    const prefix = token.type === 'project' ? '#' : '@';
    const label = token.type === 'role' ? token.label : token.label;

    return (
        <span
            onClick={token.type === 'project' ? handleClick : undefined}
            className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[12px] font-medium ${colorClass}`}
        >
            {prefix}{label}
        </span>
    );
}
