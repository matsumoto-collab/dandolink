'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin } from 'lucide-react';
import { FormField } from '../common/FormField';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';
import { ProjectMasterFormData } from '../ProjectMasterForm';
import type { LocationPickResult } from '@/components/LocationPickerModal';
import MapPreview from '@/components/ui/MapPreview';

const LocationPickerModal = dynamic(
    () => import('@/components/LocationPickerModal').then(m => m.LocationPickerModal),
    { ssr: false }
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

const LS_KEY = 'dandolink_last_location';
function saveLastLocation(lat: number, lng: number) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ lat, lng })); } catch { /* ignore */ }
}

interface AddressSectionProps {
    formData: ProjectMasterFormData;
    setFormData: React.Dispatch<React.SetStateAction<ProjectMasterFormData>>;
}

export function AddressSection({ formData, setFormData }: AddressSectionProps) {
    const { fetchAddress } = usePostalCodeAutofill();
    const [isMapModalOpen, setIsMapModalOpen] = useState(false);
    // 最後の更新元: 'map'=モーダルで選択 / 'text'=手入力。mapなら座標で iframe 表示（番地まで正確）
    const [lastSource, setLastSource] = useState<'map' | 'text'>(
        formData.latitude != null && formData.longitude != null ? 'map' : 'text'
    );

    // iframe プレビュー用: 住所入力をデバウンスして反映
    const [iframeQuery, setIframeQuery] = useState(
        [formData.prefecture, formData.city, formData.location].filter(Boolean).join('')
    );
    const iframeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const query = [formData.prefecture, formData.city, formData.location].filter(Boolean).join('');
        if (iframeDebounceRef.current) clearTimeout(iframeDebounceRef.current);
        iframeDebounceRef.current = setTimeout(() => setIframeQuery(query), 800);
        return () => { if (iframeDebounceRef.current) clearTimeout(iframeDebounceRef.current); };
    }, [formData.prefecture, formData.city, formData.location]);

    const markTextEdited = () => setLastSource('text');

    const handlePostalCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value.replace(/[^0-9]/g, '');
        setFormData(prev => ({ ...prev, postalCode: value }));
        if (value.length === 7) {
            const address = await fetchAddress(value);
            if (address) {
                setFormData(prev => ({ ...prev, prefecture: address.prefecture, city: address.city }));
            }
        }
    };

    const handleMapConfirm = (result: LocationPickResult) => {
        const coordStr = `${result.lat.toFixed(6)},${result.lng.toFixed(6)}`;
        setFormData(prev => ({
            ...prev,
            latitude: result.lat,
            longitude: result.lng,
            plusCode: coordStr,
            prefecture: result.prefecture || prev.prefecture,
            city: result.city || prev.city,
            location: result.location || prev.location,
        }));
        saveLastLocation(result.lat, result.lng);
        setLastSource('map');
        setIsMapModalOpen(false);
    };

    const initialPosition = formData.latitude != null && formData.longitude != null
        ? { lat: formData.latitude, lng: formData.longitude }
        : undefined;

    // map由来なら座標優先（番地まで正確）、text由来なら住所テキストを優先
    const coordStr = formData.latitude != null && formData.longitude != null
        ? `${formData.latitude},${formData.longitude}`
        : '';
    const iframePreviewQuery = lastSource === 'map' && coordStr
        ? coordStr
        : (iframeQuery || coordStr);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="郵便番号">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={formData.postalCode}
                            onChange={handlePostalCodeChange}
                            maxLength={7}
                            className="w-40 px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                            placeholder="例: 1600023"
                        />
                        <span className="text-sm text-slate-500">市区町村が自動で入力されます</span>
                    </div>
                </FormField>
                <FormField label="都道府県">
                    <select
                        value={formData.prefecture}
                        onChange={(e) => { markTextEdited(); setFormData(prev => ({ ...prev, prefecture: e.target.value })); }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
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
                    onChange={(e) => { markTextEdited(); setFormData(prev => ({ ...prev, city: e.target.value })); }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                    placeholder="例: 新宿区西新宿"
                />
            </FormField>

            <FormField label="その他住所">
                <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => { markTextEdited(); setFormData(prev => ({ ...prev, location: e.target.value })); }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-500 shadow-sm"
                    placeholder="番地、建物名など"
                />
            </FormField>

            {/* 地図セクション */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <MapPin className="w-4 h-4" />
                        位置情報
                    </label>
                    <button
                        type="button"
                        onClick={() => setIsMapModalOpen(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors"
                    >
                        <MapPin className="w-4 h-4" />
                        地図から選ぶ
                    </button>
                </div>

                {iframePreviewQuery ? (
                    <MapPreview mapQuery={iframePreviewQuery} height={240} />
                ) : (
                    <div className="h-[180px] bg-slate-50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 text-slate-400 select-none">
                        <MapPin className="w-8 h-8" />
                        <p className="text-sm">住所を入力するか「地図から選ぶ」をタップ</p>
                    </div>
                )}

                {formData.latitude != null && (
                    <p className="text-xs text-slate-500 mt-1">
                        座標: {formData.latitude.toFixed(6)}, {formData.longitude?.toFixed(6)}
                    </p>
                )}
            </div>

            <LocationPickerModal
                isOpen={isMapModalOpen}
                initialPosition={initialPosition}
                onConfirm={handleMapConfirm}
                onClose={() => setIsMapModalOpen(false)}
            />
        </div>
    );
}
