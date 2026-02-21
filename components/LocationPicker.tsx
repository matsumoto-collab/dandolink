'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { APIProvider, Map, MapCameraChangedEvent, useMap } from '@vis.gl/react-google-maps';

interface LocationPickerProps {
    lat: number;
    lng: number;
    onLocationChange: (lat: number, lng: number) => void;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const DEFAULT_ZOOM = 15;

// GPS ボタン等で外部から座標が変わった時だけ地図を移動させる内部コンポーネント
function MapController({ lat, lng }: { lat: number; lng: number }) {
    const map = useMap();
    const prevRef = useRef({ lat, lng });

    useEffect(() => {
        if (!map) return;
        if (lat !== prevRef.current.lat || lng !== prevRef.current.lng) {
            prevRef.current = { lat, lng };
            map.panTo({ lat, lng });
        }
    }, [map, lat, lng]);

    return null;
}

export function LocationPicker({ lat, lng, onLocationChange }: LocationPickerProps) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 地図が止まったら中心座標を親へ通知
    const handleCameraChanged = useCallback(
        (e: MapCameraChangedEvent) => {
            const { lat: newLat, lng: newLng } = e.detail.center;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                onLocationChange(newLat, newLng);
            }, 300);
        },
        [onLocationChange]
    );

    return (
        <APIProvider apiKey={API_KEY}>
            <div className="relative border border-gray-200 rounded-lg overflow-hidden" style={{ height: 280 }}>
                <Map
                    defaultCenter={{ lat, lng }}
                    defaultZoom={DEFAULT_ZOOM}
                    gestureHandling="greedy"
                    disableDefaultUI={false}
                    onCameraChanged={handleCameraChanged}
                >
                    <MapController lat={lat} lng={lng} />
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
                地図をスクロールしてピンの位置を合わせてください
            </p>
        </APIProvider>
    );
}
