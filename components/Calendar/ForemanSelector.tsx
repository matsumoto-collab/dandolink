import React, { useState, useRef, useEffect } from 'react';
import { useCalendarDisplay } from '@/contexts/CalendarDisplayContext';
import { Plus } from 'lucide-react';

export default function ForemanSelector() {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { getAvailableForemen, addForeman } = useCalendarDisplay();

    const availableForemen = getAvailableForemen();

    // ドロップダウン外クリックで閉じる
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };

        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen]);

    const handleSelectForeman = (foremanId: string) => {
        addForeman(foremanId);
        setIsDropdownOpen(false);
    };

    if (availableForemen.length === 0) {
        return null; // 追加できる職長がない場合は何も表示しない
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-blue-200 hover:border-blue-300"
                type="button"
            >
                <Plus className="w-4 h-4" />
                職長を追加
            </button>

            {/* ドロップダウンメニュー */}
            {isDropdownOpen && (
                <div className="absolute left-0 bottom-full mb-2 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto min-w-[200px]">
                    {availableForemen.map(foreman => (
                        <button
                            key={foreman.id}
                            onClick={() => handleSelectForeman(foreman.id)}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 transition-colors"
                            type="button"
                        >
                            {foreman.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
