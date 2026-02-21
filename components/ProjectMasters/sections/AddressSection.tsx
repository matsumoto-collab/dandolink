'use client';

import React, { useState } from 'react';
import { MapPin, Crosshair, ExternalLink, Loader2 } from 'lucide-react';
import { FormField } from '../common/FormField';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import toast from 'react-hot-toast';

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

// 緯度,経度の座標文字列かどうか判定
const isCoordinates = (value: string) => /^-?[\d.]+,-?[\d.]+$/.test(value.trim());

interface AddressSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function AddressSection({ formData, setFormData }: AddressSectionProps) {
    const { fetchAddress } = usePostalCodeAutofill();
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);

    const handlePostalCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/[^0-9]/g, '');
        setFormData({ ...formData, postalCode: value });

        if (value.length === 7) {
            const address = await fetchAddress(value);
            if (address) {
                setFormData(prev => ({
                    ...prev,
                    prefecture: address.prefecture,
                    city: address.city,
                }));
            }
        }
    };

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

                // まず座標を即セット
                setFormData(prev => ({ ...prev, plusCode: coordStr }));

                // 逆ジオコーディング（Nominatim API）で住所を自動入力
                try {
                    const res = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=ja`,
                        { headers: { 'User-Agent': 'DandoLink/1.0' } }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        const addr = data.address ?? {};
                        const prefecture = addr.state ?? '';
                        const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? '';
                        setFormData(prev => ({
                            ...prev,
                            plusCode: coordStr,
                            prefecture: prefecture || prev.prefecture,
                            city: city || prev.city,
                        }));
                        toast.success('現在地を取得しました');
                    } else {
                        toast.success('座標を取得しました（住所の自動入力に失敗）');
                    }
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
                        toast.error('位置情報の使用が許可されていません');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        toast.error('位置情報を取得できませんでした');
                        break;
                    case error.TIMEOUT:
                        toast.error('位置情報の取得がタイムアウトしました');
                        break;
                    default:
                        toast.error('位置情報の取得に失敗しました');
                }
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    const handleGeocodeAddress = async () => {
        const parts = [formData.prefecture, formData.city, formData.location].filter(Boolean);
        if (parts.length === 0) {
            toast.error('都道府県・市区町村・その他住所のいずれかを入力してください');
            return;
        }

        setIsGeocodingAddress(true);
        try {
            const query = parts.join(' ');
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&accept-language=ja&limit=1&countrycodes=jp`,
                { headers: { 'User-Agent': 'DandoLink/1.0' } }
            );
            if (!res.ok) throw new Error('API error');
            const results = await res.json();
            if (!results || results.length === 0) {
                toast.error('住所から座標を特定できませんでした。より詳細な住所を入力してください');
                return;
            }
            const { lat, lon } = results[0];
            const coordStr = `${parseFloat(lat).toFixed(6)},${parseFloat(lon).toFixed(6)}`;
            setFormData(prev => ({ ...prev, plusCode: coordStr }));
            toast.success('住所から座標を取得しました');
        } catch {
            toast.error('座標の取得に失敗しました');
        } finally {
            setIsGeocodingAddress(false);
        }
    };

    const getMapQuery = () => {
        if (formData.plusCode && isCoordinates(formData.plusCode)) {
            return formData.plusCode;
        }
        const parts = [formData.prefecture, formData.city, formData.location].filter(Boolean);
        return parts.join('');
    };

    const getGoogleMapsUrl = () => {
        const query = getMapQuery();
        if (!query) return null;
        if (isCoordinates(query)) {
            const [lat, lng] = query.split(',');
            return `https://www.google.com/maps?q=${lat},${lng}`;
        }
        return `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    };

    const mapQuery = getMapQuery();
    const googleMapsUrl = getGoogleMapsUrl();

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
            {/* 座標（現在地取得 / 住所から取得） */}
            <FormField label="座標（緯度,経度）">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={formData.plusCode}
                        onChange={(e) => setFormData({ ...formData, plusCode: e.target.value })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500"
                        placeholder="例: 35.689500,139.691700"
                    />
                </div>
                <div className="flex gap-2 mt-2">
                    <button
                        type="button"
                        onClick={handleGetCurrentLocation}
                        disabled={isGettingLocation || isGeocodingAddress}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 disabled:bg-slate-400 rounded-lg transition-colors whitespace-nowrap"
                        title="現在地をGPSで取得"
                    >
                        {isGettingLocation ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />取得中...</>
                        ) : (
                            <><Crosshair className="w-4 h-4" />現在地を取得</>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={handleGeocodeAddress}
                        disabled={isGettingLocation || isGeocodingAddress}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                        title="入力済みの住所から座標を取得"
                    >
                        {isGeocodingAddress ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />検索中...</>
                        ) : (
                            <><MapPin className="w-4 h-4" />住所から取得</>
                        )}
                    </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                    現場で取得できなかった場合は住所を入力後「住所から取得」を押してください
                </p>
            </FormField>
            {/* 地図プレビュー */}
            {mapQuery && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            <MapPin className="w-4 h-4" />
                            地図プレビュー
                        </label>
                        {googleMapsUrl && (
                            <a
                                href={googleMapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Google Mapsで開く
                            </a>
                        )}
                    </div>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <iframe
                            key={mapQuery}
                            title="Map Preview"
                            width="100%"
                            height="220"
                            loading="lazy"
                            style={{ border: 0 }}
                            src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
