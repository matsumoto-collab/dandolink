import { useState } from 'react';

/**
 * LocalStorageを扱うカスタムフック
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
    // 初期値を取得
    const [storedValue, setStoredValue] = useState<T>(() => {
        if (typeof window === 'undefined') {
            return initialValue;
        }

        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item, dateReviver) : initialValue;
        } catch (error) {
            console.error(`Error loading ${key} from localStorage:`, error);
            return initialValue;
        }
    });

    // 値を保存
    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);

            if (typeof window !== 'undefined') {
                window.localStorage.setItem(key, JSON.stringify(valueToStore));
            }
        } catch (error) {
            console.error(`Error saving ${key} to localStorage:`, error);
        }
    };

    return [storedValue, setValue] as const;
}

/**
 * JSON.parseでDate型を復元するためのreviver関数
 */
function dateReviver(_key: string, value: unknown): unknown {
    if (typeof value === 'string') {
        // ISO 8601形式の日付文字列を検出
        const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        if (dateRegex.test(value)) {
            return new Date(value);
        }
    }
    return value;
}
