import React, { useState, useRef, useEffect } from 'react';
import { useCalendarDisplay } from '@/hooks/useCalendarDisplay';
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

    const hasAvailableForemen = availableForemen.length > 0;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors border ${hasAvailableForemen
                        ? 'text-blue-600 hover:bg-blue-50 border-blue-200 hover:border-blue-300'
                        : 'text-gray-400 bg-gray-50 border-gray-200 cursor-not-allowed'
                    }`}
                type="button"
                disabled={!hasAvailableForemen}
                title={hasAvailableForemen ? '職長を追加' : '全ての職長が表示されています'}
            >
                <Plus className="w-4 h-4" />
                職長を追加
            </button>

            {/* ドロップダウンメニュー */}
            {isDropdownOpen && hasAvailableForemen && (
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
