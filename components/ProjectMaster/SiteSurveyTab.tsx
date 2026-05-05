// Phase 1 step 2: ハードコードL字サンプルを表示するプレビュー実装
// 次タスクでドラッグ式入力コントローラーを追加予定
'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileSearch, Plus } from 'lucide-react';
import { useDrawingStore } from '@/stores/siteSurveySlices/drawingSlice';
import { computeStats } from '@/utils/drawingMath';
import type { DrawingData } from '@/stores/siteSurveySlices/types';

const DrawingCanvas = dynamic(() => import('@/components/SiteSurvey/DrawingCanvas'), {
    ssr: false,
    loading: () => (
        <div className="w-full h-[480px] rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-sm text-slate-400">
            キャンバス読み込み中...
        </div>
    ),
});

// L字サンプル: 5m × 5m から右下の 2m × 2m を切り欠いた形
const SAMPLE_DATA: DrawingData = {
    version: '1.0',
    sections: [
        {
            id: 'section-1',
            name: '本棟',
            height: 8200,
            polygon: {
                points: [
                    { x: 0, y: 0 },
                    { x: 5000, y: 0 },
                    { x: 5000, y: 3000 },
                    { x: 3000, y: 3000 },
                    { x: 3000, y: 5000 },
                    { x: 0, y: 5000 },
                ],
                closed: true,
            },
            openings: [],
        },
    ],
    pins: [],
};

interface SiteSurveyTabProps {
    projectMasterId: string;
}

export default function SiteSurveyTab({ projectMasterId }: SiteSurveyTabProps) {
    const loadSampleData = useDrawingStore(s => s.loadSampleData);
    const data = useDrawingStore(s => s.data);
    const correction = useDrawingStore(s => s.correction);

    useEffect(() => {
        loadSampleData(SAMPLE_DATA);
    }, [loadSampleData]);

    const section = data.sections[0];
    const stats = section ? computeStats(section, correction) : null;

    const [canvasWidth, setCanvasWidth] = useState(600);
    const containerRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!containerRef.current) return;
        const update = () => {
            if (containerRef.current) {
                setCanvasWidth(Math.max(320, containerRef.current.clientWidth));
            }
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    return (
        <div className="py-4">
            <div className="flex items-center gap-3 mb-4">
                <FileSearch className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-semibold text-slate-900">現場調査</h3>
                <span className="ml-auto inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-400 shadow-sm">
                    プレビュー中
                </span>
            </div>

            <div ref={containerRef} className="w-full">
                <DrawingCanvas width={canvasWidth} height={480} />
            </div>

            {stats && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                    <StatCard label="外周" value={`${stats.perimeter.toFixed(2)} m`} />
                    <StatCard label="床面積" value={`${stats.floorArea.toFixed(2)} ㎡`} />
                    <StatCard label="足場面積" value={`${stats.scaffoldArea.toFixed(2)} ㎡`} />
                </div>
            )}

            <hr className="my-6 border-slate-200" />

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center">
                <p className="text-sm text-slate-600 mb-3">
                    現在表示しているのはサンプルL字図形です
                </p>
                <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-300 text-white text-sm font-medium cursor-not-allowed"
                >
                    <Plus className="w-4 h-4" />
                    新規作成
                </button>
                <p className="text-xs text-slate-400 mt-2">次のタスクで有効化されます</p>
            </div>

            <div className="mt-4 bg-white border border-slate-200 rounded-xl p-5">
                <h4 className="text-sm font-semibold text-slate-800 mb-3">この機能で何ができる？</h4>
                <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside">
                    <li>建物の形状をスマホで作図</li>
                    <li>自動で外周・床面積・足場掛面積を計算</li>
                    <li>ピン・メモで現場の特記事項を記録</li>
                    <li>セクション別の高さ・開口部を指定</li>
                    <li>案件詳細・見積書と一気通貫で連動</li>
                </ul>
            </div>

            <p className="mt-4 text-xs text-slate-400 text-center">
                ProjectMaster ID: {projectMasterId}
            </p>
        </div>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm text-center">
            <div className="text-xs text-slate-500 mb-0.5">{label}</div>
            <div className="text-base font-semibold text-teal-700">{value}</div>
        </div>
    );
}
