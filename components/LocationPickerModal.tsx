'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap, MapMouseEvent } from '@vis.gl/react-google-maps';
import { X, Crosshair, Search, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? 'DEMO_MAP_ID';
const FALLBACK = { lat: 35.6762, lng: 139.6503 };
const DEFAULT_ZOOM = 16;

export interface LocationPickResult {
    lat: number;
    lng: number;
    prefecture: string;
    city: string;
    location: string;
}

interface LocationPickerModalProps {
    isOpen: boolean;
    initialPosition?: { lat: number; lng: number };
    onConfirm: (result: LocationPickResult) => void;
    onClose: () => void;
}

function parseFormattedAddress(result: google.maps.GeocoderResult) {
    const components = result.address_components ?? [];
    let prefecture = '';
    const cityBuckets: Array<{ priority: number; name: string }> = [];
    const locationParts: string[] = [];
    for (const c of components) {
        if (c.types.includes('administrative_area_level_1')) prefecture = c.long_name;
        else if (c.types.includes('locality')) cityBuckets.push({ priority: 0, name: c.long_name });
        else if (c.types.includes('sublocality_level_1')) cityBuckets.push({ priority: 1, name: c.long_name });
        else if (c.types.includes('sublocality_level_2')) cityBuckets.push({ priority: 2, name: c.long_name });
        else if (c.types.includes('sublocality_level_3')) cityBuckets.push({ priority: 3, name: c.long_name });
        else if (c.types.includes('sublocality_level_4')) cityBuckets.push({ priority: 4, name: c.long_name });
        else if (c.types.includes('premise') || c.types.includes('subpremise')) locationParts.push(c.long_name);
    }
    const city = cityBuckets.sort((a, b) => a.priority - b.priority).map(b => b.name).join('');
    const location = locationParts.join(' ');
    return { prefecture, city, location };
}

function CurrentLocationFab({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title="現在地"
            className="absolute top-4 left-4 z-20 w-11 h-11 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-700 hover:bg-slate-50 active:scale-95 transition"
        >
            <Crosshair className="w-5 h-5" />
        </button>
    );
}

function MapPanner({ target }: { target?: { lat: number; lng: number } }) {
    const map = useMap();
    const prev = useRef<{ lat: number; lng: number } | undefined>(undefined);
    useEffect(() => {
        if (!map || !target) return;
        if (target.lat !== prev.current?.lat || target.lng !== prev.current?.lng) {
            prev.current = target;
            map.panTo(target);
        }
    }, [map, target]);
    return null;
}

function MapContent({
    selected,
    setSelected,
    gpsPosition,
    addressLabel,
    panTarget,
}: {
    selected: { lat: number; lng: number };
    setSelected: (pos: { lat: number; lng: number }) => void;
    gpsPosition: { lat: number; lng: number } | null;
    addressLabel: string;
    panTarget?: { lat: number; lng: number };
}) {
    const handleMapClick = useCallback((e: MapMouseEvent) => {
        const latLng = e.detail.latLng;
        if (!latLng) return;
        setSelected({ lat: latLng.lat, lng: latLng.lng });
    }, [setSelected]);

    const handleMarkerDragEnd = useCallback((e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        setSelected({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }, [setSelected]);

    return (
        <Map
            defaultCenter={selected}
            defaultZoom={DEFAULT_ZOOM}
            gestureHandling="greedy"
            disableDefaultUI
            mapId={MAP_ID}
            onClick={handleMapClick}
            className="w-full h-full"
        >
            <MapPanner target={panTarget} />

            {gpsPosition && (
                <AdvancedMarker position={gpsPosition} clickable={false} zIndex={1}>
                    <div className="relative w-4 h-4">
                        <div className="absolute inset-0 bg-blue-500 rounded-full ring-2 ring-white shadow-md" />
                        <div className="absolute -inset-2 bg-blue-500/20 rounded-full animate-pulse" />
                    </div>
                </AdvancedMarker>
            )}

            <AdvancedMarker
                position={selected}
                draggable
                onDragEnd={handleMarkerDragEnd}
                zIndex={10}
            >
                <div style={{ fontSize: 38, lineHeight: 1, transform: 'translateY(-10%)', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))' }}>
                    📍
                </div>
            </AdvancedMarker>

            {addressLabel && (
                <InfoWindow position={selected} pixelOffset={[0, -44]} disableAutoPan headerDisabled>
                    <div className="px-1 py-0.5 text-xs text-slate-800 max-w-[240px] leading-snug">
                        {addressLabel}
                    </div>
                </InfoWindow>
            )}
        </Map>
    );
}

export function LocationPickerModal({ isOpen, initialPosition, onConfirm, onClose }: LocationPickerModalProps) {
    const [selected, setSelected] = useState<{ lat: number; lng: number }>(initialPosition ?? FALLBACK);
    const [panTarget, setPanTarget] = useState<{ lat: number; lng: number } | undefined>(undefined);
    const [gpsPosition, setGpsPosition] = useState<{ lat: number; lng: number } | null>(null);
    const [addressLabel, setAddressLabel] = useState('');
    const [parsedAddress, setParsedAddress] = useState<{ prefecture: string; city: string; location: string }>({ prefecture: '', city: '', location: '' });
    const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
    const [isGettingGps, setIsGettingGps] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const reverseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // モーダルオープン時に初期位置をリセット
    useEffect(() => {
        if (!isOpen) return;
        const pos = initialPosition ?? FALLBACK;
        setSelected(pos);
        setPanTarget(pos);
        setAddressLabel('');
        setParsedAddress({ prefecture: '', city: '', location: '' });
        setSearchQuery('');
    }, [isOpen, initialPosition]);

    // ピン移動 → 逆ジオコーディング（デバウンス）
    useEffect(() => {
        if (!isOpen) return;
        if (reverseDebounceRef.current) clearTimeout(reverseDebounceRef.current);
        reverseDebounceRef.current = setTimeout(async () => {
            if (!window.google?.maps?.Geocoder) return;
            setIsReverseGeocoding(true);
            try {
                const geocoder = new google.maps.Geocoder();
                const res = await geocoder.geocode({ location: selected, language: 'ja' });
                if (res.results?.length > 0) {
                    const top = res.results[0];
                    setAddressLabel(top.formatted_address ?? '');
                    setParsedAddress(parseFormattedAddress(top));
                }
            } catch {
                // ignore
            } finally {
                setIsReverseGeocoding(false);
            }
        }, 400);
        return () => { if (reverseDebounceRef.current) clearTimeout(reverseDebounceRef.current); };
    }, [selected, isOpen]);

    const getCurrentLocation = useCallback((opts?: { silent?: boolean }) => {
        const silent = opts?.silent ?? false;
        if (!navigator.geolocation) {
            if (!silent) toast.error('この端末ではGPSが利用できません');
            return;
        }
        setIsGettingGps(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setGpsPosition(p);
                setSelected(p);
                setPanTarget(p);
                setIsGettingGps(false);
            },
            (error) => {
                setIsGettingGps(false);
                if (silent) return;
                switch (error.code) {
                    case error.PERMISSION_DENIED: toast.error('位置情報の使用が許可されていません'); break;
                    case error.POSITION_UNAVAILABLE: toast.error('位置情報を取得できませんでした'); break;
                    case error.TIMEOUT: toast.error('位置情報の取得がタイムアウトしました'); break;
                    default: toast.error('位置情報の取得に失敗しました');
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    }, []);

    const handleGetCurrentLocation = useCallback(() => getCurrentLocation(), [getCurrentLocation]);

    // モーダルオープン時、initialPosition が無ければ自動で現在地を取得（失敗時は無音でFALLBACKのまま）
    useEffect(() => {
        if (!isOpen) return;
        if (initialPosition) return;
        getCurrentLocation({ silent: true });
    }, [isOpen, initialPosition, getCurrentLocation]);

    const handleSearch = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        const q = searchQuery.trim();
        if (!q) return;
        if (!window.google?.maps?.Geocoder) return;
        setIsSearching(true);
        try {
            const geocoder = new google.maps.Geocoder();
            const res = await geocoder.geocode({ address: q, language: 'ja', region: 'jp' });
            if (res.results?.length > 0) {
                const loc = res.results[0].geometry.location;
                const p = { lat: loc.lat(), lng: loc.lng() };
                setSelected(p);
                setPanTarget(p);
            } else {
                toast.error('場所が見つかりませんでした');
            }
        } catch {
            toast.error('検索に失敗しました');
        } finally {
            setIsSearching(false);
        }
    }, [searchQuery]);

    const handleConfirm = () => {
        onConfirm({
            lat: selected.lat,
            lng: selected.lng,
            prefecture: parsedAddress.prefecture,
            city: parsedAddress.city,
            location: parsedAddress.location,
        });
    };

    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    if (!isOpen || !mounted) return null;

    const modal = (
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
            {/* ヘッダー（ステータスバー回避のため safe-area-inset-top 分の余白を確保） */}
            <div
                className="flex items-center justify-between px-4 border-b border-slate-200 bg-white"
                style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8, minHeight: 56 }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    className="w-10 h-10 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-full"
                    aria-label="閉じる"
                >
                    <X className="w-6 h-6" />
                </button>
                <h2 className="text-base font-semibold text-slate-800">位置情報</h2>
                <button
                    type="button"
                    onClick={handleConfirm}
                    className="px-4 h-9 text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded-full"
                >
                    追加
                </button>
            </div>

            {/* 地図エリア */}
            <div className="relative flex-1 min-h-0">
                <APIProvider apiKey={API_KEY}>
                    <MapContent
                        selected={selected}
                        setSelected={setSelected}
                        gpsPosition={gpsPosition}
                        addressLabel={addressLabel}
                        panTarget={panTarget}
                    />
                </APIProvider>

                <CurrentLocationFab onClick={handleGetCurrentLocation} />

                {(isReverseGeocoding || isGettingGps) && (
                    <div className="absolute top-4 right-4 z-20 bg-white/90 px-3 py-1.5 rounded-full shadow flex items-center gap-1.5 text-xs text-slate-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {isGettingGps ? '現在地取得中...' : '住所取得中...'}
                    </div>
                )}
            </div>

            {/* 下部: 検索 */}
            <div className="border-t border-slate-200 bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
                <form onSubmit={handleSearch} className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 h-10 bg-slate-100 rounded-full">
                        <Search className="w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="住所・場所名で検索"
                            className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={isSearching || !searchQuery.trim()}
                        className="px-4 h-10 text-sm font-medium text-white bg-slate-700 disabled:bg-slate-300 rounded-full"
                    >
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : '検索'}
                    </button>
                </form>
            </div>
        </div>
    );

    return createPortal(modal, document.body);
}
