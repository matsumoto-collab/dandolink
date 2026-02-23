'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { APIProvider, Map, MapCameraChangedEvent, useMap } from '@vis.gl/react-google-maps';

interface LocationPickerProps {
    /** 初期表示位置（マウント時のみ使用・以降は地図を自由操作） */
    defaultCenter: { lat: number; lng: number };
    /** GPSボタン等で地図を強制移動させたい時にセット（変更を検知してpanTo） */
    forcedCenter?: { lat: number; lng: number };
    onLocationChange: (lat: number, lng: number) => void;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const DEFAULT_ZOOM = 15;

/** forcedCenter の変化を検知して地図を移動させる */
function MapController({ forcedCenter }: { forcedCenter?: { lat: number; lng: number } }) {
    const map = useMap();
    // undefined で初期化することで、マウント時点で forcedCenter が設定済みでも必ず panTo を実行する
    const prevRef = useRef<{ lat: number; lng: number } | undefined>(undefined);

    useEffect(() => {
        if (!map || !forcedCenter) return;
        if (
            forcedCenter.lat !== prevRef.current?.lat ||
            forcedCenter.lng !== prevRef.current?.lng
        ) {
            prevRef.current = forcedCenter;
            map.panTo(forcedCenter);
        }
    }, [map, forcedCenter]);

    return null;
}

export function LocationPicker({ defaultCenter, forcedCenter, onLocationChange }: LocationPickerProps) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCameraChanged = useCallback(
        (e: MapCameraChangedEvent) => {
            const { lat, lng } = e.detail.center;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                onLocationChange(lat, lng);
            }, 300);
        },
        [onLocationChange]
    );

    return (
        <APIProvider apiKey={API_KEY}>
            <div className="relative border border-gray-200 rounded-lg overflow-hidden" style={{ height: 280 }}>
                <Map
                    defaultCenter={defaultCenter}
                    defaultZoom={DEFAULT_ZOOM}
                    gestureHandling="cooperative"
                    disableDefaultUI={false}
                    onCameraChanged={handleCameraChanged}
                >
                    <MapController forcedCenter={forcedCenter} />
                </Map>

                {/* 中央固定ピン */}
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -100%)',
                        fontSize: 40,
                        lineHeight: 1,
                        pointerEvents: 'none',
                        filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))',
                        zIndex: 10,
                    }}
                >
                    📍
                </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">
                地図をドラッグしてピンの位置を合わせてください（ズーム: Ctrl+スクロール）
            </p>
        </APIProvider>
    );
}
