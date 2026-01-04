'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { mockEmployees } from '@/data/mockEmployees';

interface CalendarDisplayContextType {
    displayedForemanIds: string[];
    addForeman: (employeeId: string) => void;
    removeForeman: (employeeId: string) => void;
    getAvailableForemen: () => { id: string; name: string }[];
}

const CalendarDisplayContext = createContext<CalendarDisplayContextType | undefined>(undefined);

const STORAGE_KEY = 'calendar-displayed-foremen';

export function CalendarDisplayProvider({ children }: { children: React.ReactNode }) {
    const [displayedForemanIds, setDisplayedForemanIds] = useState<string[]>([]);
    const [isLoaded, setIsLoaded] = useState(false);

    // LocalStorageから読み込み
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const ids = JSON.parse(stored);
                setDisplayedForemanIds(ids);
            } catch (error) {
                console.error('Failed to parse displayed foremen:', error);
                // デフォルト: 全職長を表示
                setDisplayedForemanIds(mockEmployees.filter(e => e.id !== '1').map(e => e.id));
            }
        } else {
            // 初回起動時: 全職長を表示（備考行を除く）
            setDisplayedForemanIds(mockEmployees.filter(e => e.id !== '1').map(e => e.id));
        }
        setIsLoaded(true);
    }, []);

    // LocalStorageに保存（初回読み込み後のみ）
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(displayedForemanIds));
        }
    }, [displayedForemanIds, isLoaded]);

    const addForeman = (employeeId: string) => {
        if (!displayedForemanIds.includes(employeeId)) {
            setDisplayedForemanIds(prev => [...prev, employeeId]);
        }
    };

    const removeForeman = (employeeId: string) => {
        setDisplayedForemanIds(prev => prev.filter(id => id !== employeeId));
    };

    const getAvailableForemen = () => {
        return mockEmployees
            .filter(emp => emp.id !== '1' && !displayedForemanIds.includes(emp.id))
            .map(emp => ({ id: emp.id, name: emp.name }));
    };

    return (
        <CalendarDisplayContext.Provider value={{
            displayedForemanIds,
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
