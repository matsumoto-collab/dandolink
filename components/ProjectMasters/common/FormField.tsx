'use client';

import React, { ReactNode } from 'react';

interface FormFieldProps {
    label: string;
    required?: boolean;
    error?: string;
    fieldId?: string;
    children: ReactNode;
}

export function FormField({ label, required = false, error, fieldId, children }: FormFieldProps) {
    const errorClass = error
        ? '[&_input]:!border-red-400 [&_select]:!border-red-400 [&_textarea]:!border-red-400 [&>div:first-of-type]:!border-red-400'
        : '';
    return (
        <div
            data-field-id={fieldId}
            tabIndex={fieldId && error ? -1 : undefined}
            className="scroll-mt-24 focus:outline-none"
            aria-invalid={error ? true : undefined}
        >
            <label className="block text-sm font-medium text-slate-700 mb-1">
                {label}
                {required && <span className="text-slate-500"> *</span>}
            </label>
            <div className={errorClass}>
                {children}
            </div>
            {error && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
