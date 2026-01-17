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
    const [settingsLoaded, setSettingsLoaded] = useState(false);
    const [hasSavedSettings, setHasSavedSettings] = useState(false);

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
                    setHasSavedSettings(true);
                }
            }
        } catch (error) {
            console.error('Failed to fetch user settings:', error);
        } finally {
            setSettingsLoaded(true);
            setIsLoading(false);
        }
    }, [status]);

    // 認証済みの場合のみデータを取得
    useEffect(() => {
        if (status === 'authenticated') {
            fetchForemen();
            fetchSettings();
        } else {
            setIsLoading(false);
        }
    }, [status, fetchForemen, fetchSettings]);

    // 設定が未保存で職長データが読み込まれたら、全職長を初期表示
    useEffect(() => {
        if (settingsLoaded && !hasSavedSettings && allForemen.length > 0 && displayedForemanIds.length === 0) {
            const allForemanIds = allForemen.map(f => f.id);
            setDisplayedForemanIds(allForemanIds);
        }
    }, [settingsLoaded, hasSavedSettings, allForemen, displayedForemanIds.length]);

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
        const currentIndex = displayedForemanIds.indexOf(employeeId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= displayedForemanIds.length) return;

        const newIds = [...displayedForemanIds];
        [newIds[currentIndex], newIds[newIndex]] = [newIds[newIndex], newIds[currentIndex]];
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
