'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { mockEmployees } from '@/data/mockEmployees';

interface CalendarDisplayContextType {
    displayedForemanIds: string[];
    isLoading: boolean;
    addForeman: (employeeId: string) => Promise<void>;
    removeForeman: (employeeId: string) => Promise<void>;
    getAvailableForemen: () => { id: string; name: string }[];
}

const CalendarDisplayContext = createContext<CalendarDisplayContextType | undefined>(undefined);

export function CalendarDisplayProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [displayedForemanIds, setDisplayedForemanIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Get default foreman IDs
    const getDefaultForemanIds = useCallback(() => {
        return mockEmployees.filter(e => e.id !== '1').map(e => e.id);
    }, []);

    // Fetch from API
    const fetchSettings = useCallback(async () => {
        if (status !== 'authenticated') {
            // Use default if not authenticated
            setDisplayedForemanIds(getDefaultForemanIds());
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/user-settings');
            if (response.ok) {
                const data = await response.json();
                if (data.displayedForemanIds && data.displayedForemanIds.length > 0) {
                    setDisplayedForemanIds(data.displayedForemanIds);
                } else {
                    // Use default if no settings
                    setDisplayedForemanIds(getDefaultForemanIds());
                }
            } else {
                setDisplayedForemanIds(getDefaultForemanIds());
            }
        } catch (error) {
            console.error('Failed to fetch user settings:', error);
            setDisplayedForemanIds(getDefaultForemanIds());
        } finally {
            setIsLoading(false);
        }
    }, [status, getDefaultForemanIds]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const saveSettings = useCallback(async (newIds: string[]) => {
        if (status !== 'authenticated') return;

        try {
            await fetch('/api/user-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayedForemanIds: newIds }),
            });
        } catch (error) {
            console.error('Failed to save user settings:', error);
        }
    }, [status]);

    const addForeman = useCallback(async (employeeId: string) => {
        if (!displayedForemanIds.includes(employeeId)) {
            const newIds = [...displayedForemanIds, employeeId];
            setDisplayedForemanIds(newIds);
            await saveSettings(newIds);
        }
    }, [displayedForemanIds, saveSettings]);

    const removeForeman = useCallback(async (employeeId: string) => {
        const newIds = displayedForemanIds.filter(id => id !== employeeId);
        setDisplayedForemanIds(newIds);
        await saveSettings(newIds);
    }, [displayedForemanIds, saveSettings]);

    const getAvailableForemen = useCallback(() => {
        return mockEmployees
            .filter(emp => emp.id !== '1' && !displayedForemanIds.includes(emp.id))
            .map(emp => ({ id: emp.id, name: emp.name }));
    }, [displayedForemanIds]);

    return (
        <CalendarDisplayContext.Provider value={{
            displayedForemanIds,
            isLoading,
            addForeman,
            removeForeman,
            getAvailableForemen,
        }}>
            {children}
        </CalendarDisplayContext.Provider>
    );
}

export function useCalendarDisplay() {
    const context = useContext(CalendarDisplayContext);
    if (!context) {
        throw new Error('useCalendarDisplay must be used within CalendarDisplayProvider');
    }
    return context;
}
