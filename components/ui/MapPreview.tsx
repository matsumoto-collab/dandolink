'use client';

import React, { useState } from 'react';

type MapType = 'm' | 'h'; // m=地図, h=航空写真+地名ラベル

interface MapPreviewProps {
    /** 検索クエリ（住所文字列 または "lat,lng" 座標） */
    mapQuery: string;
    /** iframe の高さ(px) */
    height?: number;
    /** ラッパー要素の追加クラス */
    className?: string;
}

export default function MapPreview({ mapQuery, height = 220, className = '' }: MapPreviewProps) {
    const [mapType, setMapType] = useState<MapType>('m');

    return (
        <div className={`relative border border-slate-200 rounded-xl overflow-hidden ${className}`}>
            <div className="absolute top-2 right-2 z-10 flex rounded-lg overflow-hidden shadow-sm ring-1 ring-slate-200">
                <button
                    type="button"
                    onClick={() => setMapType('m')}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${mapType === 'm' ? 'bg-slate-700 text-white' : 'bg-white/90 text-slate-600 hover:bg-white'}`}
                >
                    地図
                </button>
                <button
                    type="button"
                    onClick={() => setMapType('h')}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${mapType === 'h' ? 'bg-slate-700 text-white' : 'bg-white/90 text-slate-600 hover:bg-white'}`}
                >
                    航空写真
                </button>
            </div>
            <iframe
                key={`${mapQuery}|${mapType}`}
                title="Map Preview"
                width="100%"
                height={height}
                loading="lazy"
                style={{ border: 0, display: 'block' }}
                src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed&t=${mapType}`}
            />
        </div>
    );
}
