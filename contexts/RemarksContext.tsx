'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface RemarksData {
    [dateKey: string]: string; // dateKey (YYYY-MM-DD) -> remark text
}

interface RemarksContextType {
    remarks: RemarksData;
    setRemark: (dateKey: string, text: string) => void;
    getRemark: (dateKey: string) => string;
}

const RemarksContext = createContext<RemarksContextType | undefined>(undefined);

const STORAGE_KEY = 'yusystem_calendar_remarks';

export function RemarksProvider({ children }: { children: ReactNode }) {
    const [remarks, setRemarks] = useState<RemarksData>({});
    const [isLoaded, setIsLoaded] = useState(false);

    // Load from LocalStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setRemarks(JSON.parse(stored));
            } catch (error) {
                console.error('Failed to load remarks:', error);
            }
        }
        setIsLoaded(true);
    }, []);

    // Save to LocalStorage whenever remarks change (after initial load)
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(remarks));
        }
    }, [remarks, isLoaded]);

    const setRemark = (dateKey: string, text: string) => {
        setRemarks(prev => ({
            ...prev,
            [dateKey]: text,
        }));
    };

    const getRemark = (dateKey: string): string => {
        return remarks[dateKey] || '';
    };

    return (
        <RemarksContext.Provider value={{ remarks, setRemark, getRemark }}>
            {children}
        </RemarksContext.Provider>
    );
}

export function useRemarks() {
    const context = useContext(RemarksContext);
    if (context === undefined) {
        throw new Error('useRemarks must be used within a RemarksProvider');
    }
    return context;
}
