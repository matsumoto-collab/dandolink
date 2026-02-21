'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { APIProvider, Map, MapCameraChangedEvent } from '@vis.gl/react-google-maps';

interface LocationPickerProps {
    lat: number;
    lng: number;
    onLocationChange: (lat: number, lng: number) => void;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const DEFAULT_ZOOM = 15;

export function LocationPicker({ lat, lng, onLocationChange }: LocationPickerProps) {
    // 地図の中心座標（mapに渡す controlled center）
    const centerRef = useRef({ lat, lng });
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 外部からの座標変更（GPSボタン等）に追従するため center を更新
    // Map コンポーネントの center prop を直接制御することで地図を移動させる
    const [mapCenter, setMapCenter] = React.useState({ lat, lng });

    useEffect(() => {
        if (lat !== centerRef.current.lat || lng !== centerRef.current.lng) {
            centerRef.current = { lat, lng };
            setMapCenter({ lat, lng });
        }
    }, [lat, lng]);

    // 地図が動くたびに中心座標を取得し、停止後に親へ通知
    const handleCameraChanged = useCallback(
        (e: MapCameraChangedEvent) => {
            const { lat: newLat, lng: newLng } = e.detail.center;
            centerRef.current = { lat: newLat, lng: newLng };

            // 300ms 停止後に通知（逆ジオコーディングが頻発しないようデバウンス）
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                onLocationChange(newLat, newLng);
            }, 300);
        },
        [onLocationChange]
    );

    return (
        <APIProvider apiKey={API_KEY}>
            {/* 相対配置のラッパー：中央固定ピンを重ねるため */}
            <div className="relative border border-gray-200 rounded-lg overflow-hidden" style={{ height: 280 }}>
                <Map
                    zoom={DEFAULT_ZOOM}
                    center={mapCenter}
                    mapId="location-picker"
                    gestureHandling="greedy"
                    disableDefaultUI={false}
                    onCameraChanged={handleCameraChanged}
                />

                {/* 中央固定ピン（地図の上に絶対配置） */}
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
