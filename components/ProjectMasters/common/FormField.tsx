'use client';

import React, { ReactNode } from 'react';

interface FormFieldProps {
    label: string;
    required?: boolean;
    children: ReactNode;
}

export function FormField({ label, required = false, children }: FormFieldProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
                {label}
                {required && <span className="text-slate-500"> *</span>}
            </label>
            {children}
        </div>
    );
}
