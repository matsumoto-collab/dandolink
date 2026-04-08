'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Crosshair, Loader2 } from 'lucide-react';
import { FormField } from '../common/FormField';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import toast from 'react-hot-toast';

const LocationPicker = dynamic(
    () => import('@/components/LocationPicker').then(m => m.LocationPicker),
    { ssr: false, loading: () => <div className="h-[280px] bg-slate-100 rounded-lg animate-pulse" /> }
);

const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

const FALLBACK = { lat: 35.6762, lng: 139.6503 };

const LS_KEY = 'dandolink_last_location';

function saveLastLocation(lat: number, lng: number) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ lat, lng })); } catch { /* ignore */ }
}

type InputMode = 'address' | 'map';

interface AddressSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function AddressSection({ formData, setFormData }: AddressSectionProps) {
    const { fetchAddress } = usePostalCodeAutofill();
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
    const [showMap, setShowMap] = useState(false);
    const [forcedCenter, setForcedCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);
    const [inputMode, setInputMode] = useState<InputMode>(() => {
        const hasAddressFields = !!(formData.postalCode || formData.prefecture || formData.city || formData.location);
        const hasCoords = formData.latitude != null && formData.longitude != null;
        return (!hasAddressFields && hasCoords) ? 'map' : 'address';
    });
    // lat/lngのみで住所フィールドが空の場合は地図モードに切り替え
    useEffect(() => {
        const hasAddressFields = !!(formData.postalCode || formData.prefecture || formData.city || formData.location);
        const hasCoords = formData.latitude != null && formData.longitude != null;
        if (!hasAddressFields && hasCoords) {
            setInputMode('map');
        } else if (hasAddressFields) {
            setInputMode('address');
        }
    }, [formData.postalCode, formData.prefecture, formData.city, formData.location, formData.latitude, formData.longitude]);

    // 住所モード用: iframe に渡すクエリ（デバウンス済み）
    const [iframeQuery, setIframeQuery] = useState(
        [formData.prefecture, formData.city, formData.location].filter(Boolean).join('')
    );
    const iframeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipReverseGeocodeRef = useRef(false);

    // 住所フィールド変更時に iframe クエリをデバウンス更新（住所モードのみ）
    useEffect(() => {
        if (inputMode !== 'address') return;
        const query = [formData.prefecture, formData.city, formData.location].filter(Boolean).join('');
        if (iframeDebounceRef.current) clearTimeout(iframeDebounceRef.current);
        iframeDebounceRef.current = setTimeout(() => setIframeQuery(query), 800);
        return () => { if (iframeDebounceRef.current) clearTimeout(iframeDebounceRef.current); };
    }, [formData.prefecture, formData.city, formData.location, inputMode]);

    // 地図モード用
    const hasAddress = !!(formData.postalCode || formData.prefecture || formData.city || formData.location);
    const hasCoords = formData.latitude != null && formData.longitude != null;
    const mapVisible = showMap || hasAddress || hasCoords;

    const defaultCenter = {
        lat: formData.latitude ?? FALLBACK.lat,
        lng: formData.longitude ?? FALLBACK.lng,
    };

    // formatted_address から都道府県・市区町村・その他住所を分割するヘルパー
    const parseFormattedAddress = useCallback((result: google.maps.GeocoderResult) => {
        const components = result.address_components ?? [];
        let prefecture = '';
        for (const c of components) {
            if (c.types.includes('administrative_area_level_1')) {
                prefecture = c.long_name;
                break;
            }
        }
        const formatted = result.formatted_address ?? '';
        let city = '';
        let location = '';
        if (prefecture && formatted.includes(prefecture)) {
            const afterPref = formatted.split(prefecture)[1] ?? '';
            // 丁目・番地の区切りを探す（数字の直前で分割）
            const match = afterPref.match(/^(.+?)(\d+丁目.*)$/);
            if (match) {
                city = match[1];
                location = match[2];
            } else {
                const numMatch = afterPref.match(/^(.+?)(\d+.*)$/);
                if (numMatch) {
                    city = numMatch[1];
                    location = numMatch[2];
                } else {
                    city = afterPref;
                }
            }
        }
        return { prefecture, city, location };
    }, []);

    // Google Maps JavaScript API Geocoder 逆ジオコーディング（座標 → 住所）※地図モードのみ使用
    const reverseGeocode = useCallback(async (lat: number, lng: number) => {
        if (!window.google?.maps) return;
        setIsReverseGeocoding(true);
        try {
            const geocoder = new google.maps.Geocoder();
            const response = await geocoder.geocode({ location: { lat, lng }, language: 'ja' });
            if (response.results?.length > 0) {
                const { prefecture, city, location } = parseFormattedAddress(response.results[0]);
                setFormData(prev => ({
                    ...prev,
                    prefecture: prefecture || prev.prefecture,
                    city: city || prev.city,
                    location: location || prev.location,
                }));
            }
        } catch {
            // 住所自動入力は失敗しても問題なし
        } finally {
            setIsReverseGeocoding(false);
        }
    }, [setFormData, parseFormattedAddress]);

    // Google Maps JavaScript API Geocoder 前方ジオコーディング（住所 → 座標）※地図モードのみ使用
    const forwardGeocode = useCallback(async (query: string) => {
        if (!window.google?.maps) return;
        try {
            const geocoder = new google.maps.Geocoder();
            const response = await geocoder.geocode({ address: query, language: 'ja', region: 'jp' });
            if (response.results?.length > 0) {
                const loc = response.results[0].geometry.location;
                const lat = loc.lat();
                const lng = loc.lng();
                const coordStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, plusCode: coordStr }));
                skipReverseGeocodeRef.current = true;
                setForcedCenter({ lat, lng });
            }
        } catch {
            // ジオコーディング失敗は無視
        }
    }, [setFormData]);

    // 地図の中心が変わったら座標を反映（地図モード: 逆ジオコーディングも実行）
    const handleLocationChange = useCallback(async (lat: number, lng: number) => {
        const coordStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
        setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, plusCode: coordStr }));
        if (skipReverseGeocodeRef.current) {
            skipReverseGeocodeRef.current = false;
            return;
        }
        if (inputMode === 'map') {
            await reverseGeocode(lat, lng);
        }
    }, [setFormData, reverseGeocode, inputMode]);

    // 現在地ボタン（地図モードで使用）
    const handleGetCurrentLocation = () => {
        if (!navigator.geolocation) {
            toast.error('この端末ではGPSが利用できません');
            return;
        }
        setIsGettingLocation(true);
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                const coordStr = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
                setFormData(prev => ({ ...prev, latitude, longitude, plusCode: coordStr }));
                skipReverseGeocodeRef.current = true;
                setForcedCenter({ lat: latitude, lng: longitude });
                setShowMap(true);
                saveLastLocation(latitude, longitude);
                try {
                    await reverseGeocode(latitude, longitude);
                    toast.success('現在地を取得しました');
                } catch {
                    toast.success('座標を取得しました（住所の自動入力に失敗）');
                } finally {
                    setIsGettingLocation(false);
                }
            },
            (error) => {
                setIsGettingLocation(false);
                switch (error.code) {
                    case error.PERMISSION_DENIED: toast.error('位置情報の使用が許可されていません'); break;
                    case error.POSITION_UNAVAILABLE: toast.error('位置情報を取得できませんでした'); break;
                    case error.TIMEOUT: toast.error('位置情報の取得がタイムアウトしました'); break;
                    default: toast.error('位置情報の取得に失敗しました');
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    const handlePostalCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, postalCode: value }));
        if (value.length === 7) {
            const address = await fetchAddress(value);
            if (address) {
                setFormData(prev => ({ ...prev, prefecture: address.prefecture, city: address.city }));
                // 地図モードのみ座標も更新
                if (inputMode === 'map') {
                    await forwardGeocode(`${address.prefecture}${address.city}`);
                }
            }
        }
    };

    return (
        <div className="space-y-4">
            {/* 入力モード切り替え */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
                <button
                    type="button"
                    onClick={() => setInputMode('address')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        inputMode === 'address'
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    住所から入力
                </button>
                <button
                    type="button"
                    onClick={() => setInputMode('map')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        inputMode === 'map'
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    地図・現在地から入力
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="郵便番号">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={formData.postalCode}
                            onChange={handlePostalCodeChange}
                            maxLength={7}
                            className="w-40 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 1600023"
                        />
                        <span className="text-sm text-slate-500">市区町村が自動で入力されます</span>
                    </div>
                </FormField>
                <FormField label="都道府県">
                    <select
                        value={formData.prefecture}
                        onChange={(e) => setFormData(prev => ({ ...prev, prefecture: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    >
                        <option value="">選択してください</option>
                        {PREFECTURES.map(pref => (
                            <option key={pref} value={pref}>{pref}</option>
                        ))}
                    </select>
                </FormField>
            </div>

            <FormField label="市区町村">
                <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    placeholder="例: 新宿区西新宿"
                />
            </FormField>

            <FormField label="その他住所">
                <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    placeholder="番地、建物名など"
                />
            </FormField>

            {/* 地図エリア */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    {inputMode === 'map' && (
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <MapPin className="w-4 h-4" />
                            位置情報
                            {isReverseGeocoding && (
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                    <Loader2 className="w-3 h-3 animate-spin" />住所を取得中...
                                </span>
                            )}
                        </label>
                    )}
                    {inputMode === 'map' && (
                        <button
                            type="button"
                            onClick={handleGetCurrentLocation}
                            disabled={isGettingLocation}
                            title="現在地を取得して地図を表示"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 disabled:bg-slate-400 rounded-lg transition-colors"
                        >
                            {isGettingLocation
                                ? <><Loader2 className="w-4 h-4 animate-spin" />取得中...</>
                                : <><Crosshair className="w-4 h-4" />現在地</>
                            }
                        </button>
                    )}
                </div>

                {inputMode === 'address' ? (
                    /* 住所モード: Google Maps iframe プレビュー */
                    iframeQuery ? (
                        <div className="border border-slate-300 rounded-lg overflow-hidden">
                            <iframe
                                width="100%"
                                height="280"
                                style={{ border: 0 }}
                                src={`https://maps.google.com/maps?q=${encodeURIComponent(iframeQuery)}&output=embed`}
                                title="地図プレビュー"
                                allowFullScreen
                            />
                        </div>
                    ) : (
                        <div className="h-[200px] bg-slate-50 border border-slate-200 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-slate-400 select-none">
                            <MapPin className="w-8 h-8" />
                            <p className="text-sm">住所を入力すると地図が表示されます</p>
                        </div>
                    )
                ) : (
                    /* 地図モード: インタラクティブ LocationPicker */
                    <>
                        <p className="text-xs text-slate-500 mb-2">
                            地図をドラッグすると都道府県・市区町村が自動で入力されます
                        </p>
                        {mapVisible ? (
                            <LocationPicker
                                defaultCenter={defaultCenter}
                                forcedCenter={forcedCenter}
                                onLocationChange={handleLocationChange}
                            />
                        ) : (
                            <div className="h-[200px] bg-slate-50 border border-slate-200 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 text-slate-400 select-none">
                                <MapPin className="w-8 h-8" />
                                <p className="text-sm">住所を入力すると地図が表示されます</p>
                                <p className="text-xs">または「現在地」ボタンで現在地から入力できます</p>
                            </div>
                        )}
                        {formData.latitude != null && (
                            <p className="text-xs text-slate-500 mt-1">
                                座標: {formData.latitude.toFixed(6)}, {formData.longitude?.toFixed(6)}
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
