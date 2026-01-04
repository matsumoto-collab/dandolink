'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { VacationRecord } from '@/types/vacation';

interface VacationContextType {
    getVacationEmployees: (dateKey: string) => string[];
    setVacationEmployees: (dateKey: string, employeeIds: string[]) => void;
    addVacationEmployee: (dateKey: string, employeeId: string) => void;
    removeVacationEmployee: (dateKey: string, employeeId: string) => void;
    getRemarks: (dateKey: string) => string;
    setRemarks: (dateKey: string, remarks: string) => void;
}

const VacationContext = createContext<VacationContextType | undefined>(undefined);

export function VacationProvider({ children }: { children: React.ReactNode }) {
    const [vacations, setVacations] = useState<VacationRecord>({});
    const [isLoaded, setIsLoaded] = useState(false);

    // LocalStorageから読み込み
    useEffect(() => {
        const stored = localStorage.getItem('calendar-vacations');
        if (stored) {
            try {
                setVacations(JSON.parse(stored));
            } catch (error) {
                console.error('Failed to parse vacation data:', error);
            }
        }
        setIsLoaded(true);
    }, []);

    // LocalStorageに保存（初回読み込み後のみ）
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('calendar-vacations', JSON.stringify(vacations));
        }
    }, [vacations, isLoaded]);

    const getVacationEmployees = (dateKey: string): string[] => {
        return vacations[dateKey]?.employeeIds || [];
    };

    const setVacationEmployees = (dateKey: string, employeeIds: string[]) => {
        setVacations(prev => ({
            ...prev,
            [dateKey]: {
                employeeIds,
                remarks: prev[dateKey]?.remarks || '',
            },
        }));
    };

    const addVacationEmployee = (dateKey: string, employeeId: string) => {
        const current = getVacationEmployees(dateKey);
        if (!current.includes(employeeId)) {
            setVacationEmployees(dateKey, [...current, employeeId]);
        }
    };

    const removeVacationEmployee = (dateKey: string, employeeId: string) => {
        const current = getVacationEmployees(dateKey);
        setVacationEmployees(dateKey, current.filter(id => id !== employeeId));
    };

    const getRemarks = (dateKey: string): string => {
        return vacations[dateKey]?.remarks || '';
    };

    const setRemarks = (dateKey: string, remarks: string) => {
        setVacations(prev => ({
            ...prev,
            [dateKey]: {
                employeeIds: prev[dateKey]?.employeeIds || [],
                remarks,
            },
        }));
    };

    return (
        <VacationContext.Provider value={{
            getVacationEmployees,
            setVacationEmployees,
            addVacationEmployee,
            removeVacationEmployee,
            getRemarks,
            setRemarks,
        }}>
            {children}
        </VacationContext.Provider>
    );
}

export function useVacation() {
    const context = useContext(VacationContext);
    if (!context) {
        throw new Error('useVacation must be used within VacationProvider');
    }
    return context;
}
