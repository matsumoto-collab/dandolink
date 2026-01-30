'use client';

import React from 'react';
import { ProjectMasterFormData } from '../ProjectMasterForm';

interface RemarksSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function RemarksSection({ formData, setFormData }: RemarksSectionProps) {
    return (
        <textarea
            value={formData.remarks}
            onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[100px]"
            placeholder="備考"
        />
    );
}
