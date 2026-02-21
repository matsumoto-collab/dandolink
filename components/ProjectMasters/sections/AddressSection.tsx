'use client';

import React, { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Crosshair, Loader2 } from 'lucide-react';
import { FormField } from '../common/FormField';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import toast from 'react-hot-toast';

// LocationPickerはクライアント専用（SSR無効）
const LocationPicker = dynamic(
    () => import('@/components/LocationPicker').then(m => m.LocationPicker),
    { ssr: false, loading: () => <div className="h-[280px] bg-gray-100 rounded-lg animate-pulse" /> }
);

// 都道府県リスト
const PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

// デフォルト座標（東京）
const DEFAULT_LAT = 35.6762;
const DEFAULT_LNG = 139.6503;

interface AddressSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function AddressSection({ formData, setFormData }: AddressSectionProps) {
    const { fetchAddress } = usePostalCodeAutofill();
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);

    // 現在フォームに設定されている座標（なければデフォルト東京）
    const mapLat = formData.latitude ?? DEFAULT_LAT;
    const mapLng = formData.longitude ?? DEFAULT_LNG;

    const handlePostalCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/[^0-9]/g, '');
        setFormData({ ...formData, postalCode: value });
        if (value.length === 7) {
            const address = await fetchAddress(value);
            if (address) {
                setFormData(prev => ({ ...prev, prefecture: address.prefecture, city: address.city }));
            }
        }
    };

    // Nominatim 逆ジオコーディング
    const reverseGeocode = useCallback(async (lat: number, lng: number) => {
        setIsReverseGeocoding(true);
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`,
                { headers: { 'User-Agent': 'DandoLink/1.0' }, cache: 'no-store' }
            );
            if (res.ok) {
                const data = await res.json();
                const addr = data.address ?? {};
                const prefecture = addr.state ?? '';
                const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? '';
                setFormData(prev => ({
                    ...prev,
                    prefecture: prefecture || prev.prefecture,
                    city: city || prev.city,
                }));
            }
        } catch {
            // 住所自動入力は失敗しても問題なし
        } finally {
            setIsReverseGeocoding(false);
        }
    }, [setFormData]);

    // ピンドラッグ完了時
    const handleLocationChange = useCallback(async (lat: number, lng: number) => {
        const coordStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
        setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, plusCode: coordStr }));
        await reverseGeocode(lat, lng);
    }, [setFormData, reverseGeocode]);

    // GPS取得ボタン
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
                    case error.PERMISSION_DENIED:
                        toast.error('位置情報の使用が許可されていません'); break;
                    case error.POSITION_UNAVAILABLE:
                        toast.error('位置情報を取得できませんでした'); break;
                    case error.TIMEOUT:
                        toast.error('位置情報の取得がタイムアウトしました'); break;
                    default:
                        toast.error('位置情報の取得に失敗しました');
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 郵便番号 */}
                <FormField label="郵便番号">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={formData.postalCode}
                            onChange={handlePostalCodeChange}
                            maxLength={7}
                            className="w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                            placeholder="例: 1600023"
                        />
                        <span className="text-sm text-gray-500">市区町村が自動で入力されます</span>
                    </div>
                </FormField>
                {/* 都道府県 */}
                <FormField label="都道府県">
                    <select
                        value={formData.prefecture}
                        onChange={(e) => setFormData({ ...formData, prefecture: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    >
                        <option value="">選択してください</option>
                        {PREFECTURES.map(pref => (
                            <option key={pref} value={pref}>{pref}</option>
                        ))}
                    </select>
                </FormField>
            </div>

            {/* 市区町村 */}
            <FormField label="市区町村">
                <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    placeholder="例: 新宿区西新宿"
                />
            </FormField>

            {/* その他住所 */}
            <FormField label="その他住所">
                <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                    placeholder="番地、建物名など"
                />
            </FormField>

            {/* インタラクティブ地図 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <MapPin className="w-4 h-4" />
                        位置情報
                        {isReverseGeocoding && (
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                                <Loader2 className="w-3 h-3 animate-spin" />住所を取得中...
                            </span>
                        )}
                    </label>
                    <button
                        type="button"
                        onClick={handleGetCurrentLocation}
                        disabled={isGettingLocation}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 disabled:bg-slate-400 rounded-lg transition-colors whitespace-nowrap"
                    >
                        {isGettingLocation ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />取得中...</>
                        ) : (
                            <><Crosshair className="w-4 h-4" />現在地を取得</>
                        )}
                    </button>
                </div>

                <LocationPicker
                    lat={mapLat}
                    lng={mapLng}
                    onLocationChange={handleLocationChange}
                />

                {/* 座標表示（読み取り専用） */}
                {formData.latitude != null && (
                    <p className="text-xs text-gray-500 mt-1">
                        座標: {formData.latitude.toFixed(6)}, {formData.longitude?.toFixed(6)}
                    </p>
                )}
            </div>
        </div>
    );
}
