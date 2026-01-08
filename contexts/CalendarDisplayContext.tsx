'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface ForemanUser {
    id: string;
    displayName: string;
    role: string;
}

interface CalendarDisplayContextType {
    displayedForemanIds: string[];
    isLoading: boolean;
    addForeman: (employeeId: string) => Promise<void>;
    removeForeman: (employeeId: string) => Promise<void>;
    moveForeman: (employeeId: string, direction: 'up' | 'down') => Promise<void>;
    getAvailableForemen: () => { id: string; name: string }[];
    allForemen: ForemanUser[];
    getForemanName: (id: string) => string;
}

const CalendarDisplayContext = createContext<CalendarDisplayContextType | undefined>(undefined);

export function CalendarDisplayProvider({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const [displayedForemanIds, setDisplayedForemanIds] = useState<string[]>([]);
    const [allForemen, setAllForemen] = useState<ForemanUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch all available foremen from API
    const fetchForemen = useCallback(async () => {
        try {
            const response = await fetch('/api/dispatch/foremen');
            if (response.ok) {
                const data = await response.json();
                setAllForemen(data);
            }
        } catch (error) {
            console.error('Failed to fetch foremen:', error);
        }
    }, []);

    // Fetch from API
    const fetchSettings = useCallback(async () => {
        if (status !== 'authenticated') {
            setIsLoading(false);
            return;
        }

        try {
            const response = await fetch('/api/user-settings');
            if (response.ok) {
                const data = await response.json();
                if (data.displayedForemanIds && data.displayedForemanIds.length > 0) {
                    setDisplayedForemanIds(data.displayedForemanIds);
                }
            }
        } catch (error) {
            console.error('Failed to fetch user settings:', error);
        } finally {
            setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        fetchForemen();
    }, [fetchForemen]);

    useEffect(() => {
        if (status === 'authenticated') {
            fetchSettings();
        } else {
            setIsLoading(false);
        }
    }, [status, fetchSettings]);

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

    const moveForeman = useCallback(async (employeeId: string, direction: 'up' | 'down') => {
        console.log('moveForeman called:', { employeeId, direction, displayedForemanIds });
        const currentIndex = displayedForemanIds.indexOf(employeeId);
        console.log('currentIndex:', currentIndex);
        if (currentIndex === -1) {
            console.log('Employee not found in displayedForemanIds');
            return;
        }

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        console.log('newIndex:', newIndex);
        if (newIndex < 0 || newIndex >= displayedForemanIds.length) {
            console.log('newIndex out of bounds');
            return;
        }

        const newIds = [...displayedForemanIds];
        [newIds[currentIndex], newIds[newIndex]] = [newIds[newIndex], newIds[currentIndex]];
        console.log('newIds after swap:', newIds);
        setDisplayedForemanIds(newIds);
        await saveSettings(newIds);
    }, [displayedForemanIds, saveSettings]);

    const getAvailableForemen = useCallback(() => {
        return allForemen
            .filter(user => !displayedForemanIds.includes(user.id))
            .map(user => ({ id: user.id, name: user.displayName }));
    }, [allForemen, displayedForemanIds]);

    const getForemanName = useCallback((id: string) => {
        const foreman = allForemen.find(f => f.id === id);
        return foreman?.displayName || '不明';
    }, [allForemen]);

    return (
        <CalendarDisplayContext.Provider value={{
            displayedForemanIds,
            isLoading,
            addForeman,
            removeForeman,
            moveForeman,
            getAvailableForemen,
            allForemen,
            getForemanName,
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
