'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useMasterData } from '@/hooks/useMasterData';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';

interface VehicleModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function VehicleModal({ isOpen, onClose }: VehicleModalProps) {
    const { addVehicle } = useMasterData();
    const [vehicleName, setVehicleName] = useState('');
    const modalRef = useModalKeyboard(isOpen, onClose);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!vehicleName.trim()) {
            return;
        }

        addVehicle(vehicleName.trim());
        setVehicleName('');
        onClose();
    };

    const handleCancel = () => {
        setVehicleName('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 lg:left-64 z-[60] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50"
                onClick={handleCancel}
            />

            {/* Modal */}
            <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">車両を追加</h2>
                    <button
                        onClick={handleCancel}
                        className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            車両名 <span className="text-slate-500">*</span>
                        </label>
                        <input
                            type="text"
                            required
                            value={vehicleName}
                            onChange={(e) => setVehicleName(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 3t(1234)"
                            autoFocus
                        />
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 mt-6">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors"
                        >
                            保存
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
