import React, { useState, useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';

interface Member {
    id: string;
    displayName: string;
}

interface VacationSelectorProps {
    dateKey: string;
    selectedEmployeeIds: string[];
    onAddEmployee: (employeeId: string) => void;
    onRemoveEmployee: (employeeId: string) => void;
}

export default function VacationSelector({
    dateKey: _dateKey,
    selectedEmployeeIds,
    onAddEmployee,
    onRemoveEmployee,
}: VacationSelectorProps) {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [members, setMembers] = useState<Member[]>([]);

    // 全アクティブユーザーを取得
    useEffect(() => {
        let cancelled = false;
        fetch('/api/calendar/members')
            .then(res => res.ok ? res.json() : [])
            .then(data => { if (!cancelled) setMembers(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // 選択されていないメンバーのみを表示
    const availableMembers = members.filter(
        member => !selectedEmployeeIds.includes(member.id)
    );

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

    const handleSelectEmployee = (employeeId: string) => {
        onAddEmployee(employeeId);
        setIsDropdownOpen(false);
    };

    return (
        <div className="space-y-1">
            {/* 選択されたメンバーのバッジ表示 */}
            {selectedEmployeeIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {selectedEmployeeIds.map(memberId => {
                        const member = members.find(m => m.id === memberId);
                        if (!member) return null;

                        return (
                            <span
                                key={memberId}
                                className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-semibold"
                            >
                                {member.displayName}
                                <button
                                    onClick={() => onRemoveEmployee(memberId)}
                                    className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"
                                    title="削除"
                                    aria-label="削除"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}

            {/* メンバー追加ボタン */}
            <div className="relative" ref={dropdownRef}>
                <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 rounded transition-colors"
                    type="button"
                >
                    <Plus className="w-3 h-3" />
                    休暇を追加
                </button>

                {/* ドロップダウンメニュー */}
                {isDropdownOpen && availableMembers.length > 0 && (
                    <div className="absolute left-0 top-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto min-w-[120px]">
                        {availableMembers.map(member => (
                            <button
                                key={member.id}
                                onClick={() => handleSelectEmployee(member.id)}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors"
                                type="button"
                            >
                                {member.displayName}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
