'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Loading from '@/components/ui/Loading';
import PartnerScheduleView from './PartnerScheduleView';

const WeeklyCalendar = dynamic(() => import('@/components/Calendar/WeeklyCalendar'), {
    loading: () => (
        <div className="flex items-center justify-center h-full">
            <Loading />
        </div>
    ),
});

interface PartnerScheduleScreenProps {
    /** 既存 partnerMode を WeeklyCalendar に渡すための id (= partner なら自分.id, partner_member なら companyId) */
    weeklyPartnerId: string;
}

export default function PartnerScheduleScreen({ weeklyPartnerId }: PartnerScheduleScreenProps) {
    const [tab, setTab] = useState<'daily' | 'weekly'>('daily');

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex-shrink-0 flex border-b border-slate-200 bg-white">
                <button
                    onClick={() => setTab('daily')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'daily'
                        ? 'border-slate-800 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                >
                    直近
                </button>
                <button
                    onClick={() => setTab('weekly')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'weekly'
                        ? 'border-slate-800 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                >
                    週間
                </button>
            </div>
            <div className="flex-1 min-h-0">
                {tab === 'daily' ? (
                    <PartnerScheduleView />
                ) : (
                    <WeeklyCalendar partnerMode={true} partnerId={weeklyPartnerId} />
                )}
            </div>
        </div>
    );
}
