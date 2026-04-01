'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useCalendar } from '@/hooks/useCalendar';
import { useProjects } from '@/hooks/useProjects';
import { useMasterData } from '@/hooks/useMasterData';
import { useVacation } from '@/hooks/useVacation';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
import { useCalendarStore } from '@/stores/calendarStore';
import { generateEmployeeRows } from '@/utils/employeeUtils';
import { addDays } from '@/utils/dateUtils';
import { CalendarEvent, Employee } from '@/types/calendar';
import Loading from '@/components/ui/Loading';
import OverviewCalendarView from './OverviewCalendarView';

export interface CalendarNavigation {
    goToPreviousWeek: () => void;
    goToNextWeek: () => void;
    goToPreviousDay: () => void;
    goToNextDay: () => void;
    goToToday: () => void;
}

interface OverviewCalendarProps {
    onNavigationReady?: (nav: CalendarNavigation) => void;
}

export default function OverviewCalendar({ onNavigationReady }: OverviewCalendarProps) {
    const { status } = useSession();
    const { projects, fetchForDateRange, isInitialized, forceRefreshRange } = useProjects();
    const { getTotalMembersForDate } = useMasterData();
    const { getVacationEmployees } = useVacation();
    const { displayedForemanIds, allForemen, isLoading: isCalendarLoading } = useCalendarDisplay();

    const [isMounted, setIsMounted] = useState(false);
    const events: CalendarEvent[] = useMemo(() => projects as CalendarEvent[], [projects]);

    const { currentDate, weekDays, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday } = useCalendar(events);

    useEffect(() => { setIsMounted(true); }, []);

    useEffect(() => {
        if (onNavigationReady) {
            onNavigationReady({ goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday });
        }
    }, [onNavigationReady, goToPreviousWeek, goToNextWeek, goToPreviousDay, goToNextDay, goToToday]);

    useEffect(() => {
        if (status === 'authenticated' && isMounted) {
            const weekStart = new Date(currentDate);
            const weekEnd = addDays(weekStart, 6);
            const rangeStart = addDays(weekStart, -7);
            const rangeEnd = addDays(weekEnd, 7);
            fetchForDateRange(rangeStart, rangeEnd);
        }
    }, [currentDate, status, isMounted, fetchForDateRange]);

    // Polling
    useEffect(() => {
        if (status !== 'authenticated' || !isMounted) return;
        const intervalId = setInterval(() => {
            const weekStart = new Date(currentDate);
            const weekEnd = addDays(weekStart, 6);
            const rangeStart = addDays(weekStart, -7);
            const rangeEnd = addDays(weekEnd, 7);
            forceRefreshRange(rangeStart, rangeEnd);
        }, 5000);
        return () => clearInterval(intervalId);
    }, [status, isMounted, currentDate, forceRefreshRange]);

    // Use displayedForemanIds order (same as calendar tab)
    const employeeRows = useMemo(() => {
        const employees: Employee[] = displayedForemanIds
            .map(id => allForemen.find(f => f.id === id))
            .filter((f): f is typeof allForemen[0] => f !== undefined)
            .map(f => ({ id: f.id, name: f.displayName }));
        return generateEmployeeRows(employees, events, weekDays);
    }, [events, weekDays, displayedForemanIds, allForemen]);

    const memberAdjustments = useCalendarStore((state) => state.memberAdjustments);
    const getMemberAdjustmentCb = useCallback((dateKey: string) => {
        return memberAdjustments[dateKey] || 0;
    }, [memberAdjustments]);

    if (!isMounted || isCalendarLoading || !isInitialized) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
                <Loading size="lg" text="一覧を読み込み中..." />
            </div>
        );
    }

    return (
        <OverviewCalendarView
            weekDays={weekDays}
            events={events}
            employeeRows={employeeRows}
            getTotalMembersForDate={getTotalMembersForDate}
            getVacationEmployees={getVacationEmployees}
            getMemberAdjustment={getMemberAdjustmentCb}
            goToPreviousWeek={goToPreviousWeek}
            goToNextWeek={goToNextWeek}
            goToPreviousDay={goToPreviousDay}
            goToNextDay={goToNextDay}
            goToToday={goToToday}
        />
    );
}
