'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { canEditEquipment } from '@/lib/equipment';
import { VehiclesPanel } from './VehiclesPanel';
import { ToolsPanel } from './ToolsPanel';

type TabKey = 'vehicles' | 'tools';

/**
 * 機材台帳。車両と電動工具を同じ仕組みで管理する。
 * - 車検・保険の期限（画面で色分け。通知は出さない）
 * - 整備・修理の履歴と、見積書・請求書の写真
 * - 使用履歴（車両は日々の配置から自動、電動工具は持出しの手入力）
 * 登録・編集は管理者とマネージャーのみ。それ以外のロールは閲覧のみ（協力会社には出さない）。
 */
export default function EquipmentPage() {
    const { data: session } = useSession();
    const canEdit = canEditEquipment(session?.user as { role?: string } | undefined);
    const [tab, setTab] = useState<TabKey>('vehicles');

    const tabs: { key: TabKey; label: string }[] = [
        { key: 'vehicles', label: '車両' },
        { key: 'tools', label: '電動工具' },
    ];

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-4 md:p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-4">
                    <h1 className="text-xl font-semibold text-slate-800 md:text-2xl">機材台帳</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        車検・保険の期限、修理の履歴と書類の写真、使用履歴をまとめて管理します。
                    </p>
                </div>

                <div className="mb-4 flex gap-1 border-b border-slate-200">
                    {tabs.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                                tab === t.key
                                    ? 'border-teal-600 text-teal-700'
                                    : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'vehicles' ? <VehiclesPanel canEdit={canEdit} /> : <ToolsPanel canEdit={canEdit} />}
            </div>
        </div>
    );
}
