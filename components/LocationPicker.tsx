'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';

interface LocationPickerProps {
    lat: number;
    lng: number;
    onLocationChange: (lat: number, lng: number) => void;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const DEFAULT_ZOOM = 15;

export function LocationPicker({ lat, lng, onLocationChange }: LocationPickerProps) {
    const [markerPos, setMarkerPos] = useState({ lat, lng });
    // 外部からの座標変更（GPSボタン等）に追従
    const prevLatRef = useRef(lat);
    const prevLngRef = useRef(lng);

    useEffect(() => {
        if (lat !== prevLatRef.current || lng !== prevLngRef.current) {
            setMarkerPos({ lat, lng });
            prevLatRef.current = lat;
            prevLngRef.current = lng;
        }
    }, [lat, lng]);

    const handleDragEnd = useCallback(
        (e: google.maps.MapMouseEvent) => {
            if (!e.latLng) return;
            const newLat = e.latLng.lat();
            const newLng = e.latLng.lng();
            setMarkerPos({ lat: newLat, lng: newLng });
            onLocationChange(newLat, newLng);
        },
        [onLocationChange]
    );

    return (
        <APIProvider apiKey={API_KEY}>
            <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ height: 280 }}>
                <Map
                    defaultZoom={DEFAULT_ZOOM}
                    center={markerPos}
                    mapId="location-picker"
                    disableDefaultUI={false}
                    gestureHandling="greedy"
                >
                    <AdvancedMarker
                        position={markerPos}
                        draggable
                        onDragEnd={handleDragEnd}
                        title="ドラッグして場所を指定"
                    >
                        {/* 赤いピン */}
                        <div style={{ fontSize: 36, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
                            📍
                        </div>
                    </AdvancedMarker>
                </Map>
            </div>
            <p className="text-xs text-gray-400 mt-1">
                ピンをドラッグして場所を調整できます
            </p>
        </APIProvider>
    );
}
