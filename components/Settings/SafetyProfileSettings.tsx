'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, FileUp, ImagePlus, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import SafetyProfileImportModal from './SafetyProfileImportModal';
import {
    BLOOD_TYPE_OPTIONS,
    EMPLOYMENT_INSURANCE_OPTIONS,
    GENDER_OPTIONS,
    HEALTH_INSURANCE_OPTIONS,
    PENSION_INSURANCE_OPTIONS,
    QUALIFICATION_CATEGORIES,
    SAFETY_TARGET_GROUP_LABELS,
    WORKER_ATTRIBUTES,
    WORKER_CATEGORY_OPTIONS,
    COMMON_QUALIFICATIONS,
    getQualificationCategoryLabel,
    getSafetyTargetGroup,
    type SafetyTargetGroup,
} from '@/lib/safetyDocuments';
import type { SafetyProfileDto, SafetyQualificationDto, SafetyTargetDto } from '@/types/safety';
import { logger } from '@/lib/logger';

/**
 * 設定 > 作業員 安全情報（S-1）。
 * Worker（職方）/ User（自社社員・協力会社）の安全書類用プロフィールを編集する。
 * タブ構成: 基本情報 / 連絡先 / 保険・建退共 / 資格・教育 / 健康（FR-1-4）。
 * ⚠️ 健康保険の記号番号・基礎年金番号・マイナンバーの入力欄を追加してはならない（要件§7.4）。
 */

const INPUT_CLASS =
    'w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-500 shadow-sm text-sm';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600 mb-1';

type FormTab = 'basic' | 'contact' | 'insurance' | 'qualifications' | 'health';

const FORM_TABS: { id: FormTab; label: string }[] = [
    { id: 'basic', label: '基本情報' },
    { id: 'contact', label: '連絡先' },
    { id: 'insurance', label: '保険・建退共' },
    { id: 'qualifications', label: '資格・教育' },
    { id: 'health', label: '健康' },
];

interface ProfileFormState {
    furigana: string;
    birthDate: string;
    gender: string;
    jobType: string;
    attributes: string[];
    hireDate: string;
    experienceYears: string;
    workerCategory: string;
    address: string;
    tel: string;
    familyContact: string;
    familyTel: string;
    healthCheckDate: string;
    bloodPressure: string;
    bloodType: string;
    specialHealthCheckDate: string;
    specialHealthCheckType: string;
    healthInsurance: string;
    pensionInsurance: string;
    employmentInsurance: string;
    employmentInsuranceLast4: string;
    rosaiSpecialInsurance: boolean | null;
    kentaikyo: boolean | null;
    chutaikyo: boolean | null;
    kentaikyoTechou: boolean | null;
    ccusId: string;
    notes: string;
}

const EMPTY_FORM: ProfileFormState = {
    furigana: '',
    birthDate: '',
    gender: '',
    jobType: '',
    attributes: [],
    hireDate: '',
    experienceYears: '',
    workerCategory: '',
    address: '',
    tel: '',
    familyContact: '',
    familyTel: '',
    healthCheckDate: '',
    bloodPressure: '',
    bloodType: '',
    specialHealthCheckDate: '',
    specialHealthCheckType: '',
    healthInsurance: '',
    pensionInsurance: '',
    employmentInsurance: '',
    employmentInsuranceLast4: '',
    rosaiSpecialInsurance: null,
    kentaikyo: null,
    chutaikyo: null,
    kentaikyoTechou: null,
    ccusId: '',
    notes: '',
};

const isoToDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

function dtoToForm(profile: SafetyProfileDto | null): ProfileFormState {
    if (!profile) return { ...EMPTY_FORM };
    return {
        furigana: profile.furigana ?? '',
        birthDate: isoToDateInput(profile.birthDate),
        gender: profile.gender ?? '',
        jobType: profile.jobType ?? '',
        attributes: profile.attributes ?? [],
        hireDate: isoToDateInput(profile.hireDate),
        experienceYears: profile.experienceYears != null ? String(profile.experienceYears) : '',
        workerCategory: profile.workerCategory ?? '',
        address: profile.address ?? '',
        tel: profile.tel ?? '',
        familyContact: profile.familyContact ?? '',
        familyTel: profile.familyTel ?? '',
        healthCheckDate: isoToDateInput(profile.healthCheckDate),
        bloodPressure: profile.bloodPressure ?? '',
        bloodType: profile.bloodType ?? '',
        specialHealthCheckDate: isoToDateInput(profile.specialHealthCheckDate),
        specialHealthCheckType: profile.specialHealthCheckType ?? '',
        healthInsurance: profile.healthInsurance ?? '',
        pensionInsurance: profile.pensionInsurance ?? '',
        employmentInsurance: profile.employmentInsurance ?? '',
        employmentInsuranceLast4: profile.employmentInsuranceLast4 ?? '',
        rosaiSpecialInsurance: profile.rosaiSpecialInsurance,
        kentaikyo: profile.kentaikyo,
        chutaikyo: profile.chutaikyo,
        kentaikyoTechou: profile.kentaikyoTechou,
        ccusId: profile.ccusId ?? '',
        notes: profile.notes ?? '',
    };
}

/** フォーム → PUT ボディ（空文字は API 側 zod が null に正規化する） */
function formToBody(form: ProfileFormState) {
    const years = form.experienceYears.trim();
    return {
        ...form,
        experienceYears: years === '' ? null : Number(years),
    };
}

/** 3値トグル（未設定 / 有 / 無） */
function TriStateSelect({ label, value, onChange }: {
    label: string;
    value: boolean | null;
    onChange: (v: boolean | null) => void;
}) {
    return (
        <div>
            <label className={LABEL_CLASS}>{label}</label>
            <select
                value={value === null ? '' : value ? 'yes' : 'no'}
                onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
                className={INPUT_CLASS}
            >
                <option value="">未設定</option>
                <option value="yes">有（加入）</option>
                <option value="no">無（未加入）</option>
            </select>
        </div>
    );
}

export default function SafetyProfileSettings() {
    const [targets, setTargets] = useState<SafetyTargetDto[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<FormTab>('basic');
    const [form, setForm] = useState<ProfileFormState>({ ...EMPTY_FORM });
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isImportOpen, setIsImportOpen] = useState(false);

    // 資格追加フォーム
    const [qualCategory, setQualCategory] = useState<string>('skill_training');
    const [qualName, setQualName] = useState('');
    const [qualLicenseNumber, setQualLicenseNumber] = useState('');
    const [qualAcquiredAt, setQualAcquiredAt] = useState('');
    const [qualExpiresAt, setQualExpiresAt] = useState('');
    const [qualImageFile, setQualImageFile] = useState<File | null>(null);
    const [isAddingQual, setIsAddingQual] = useState(false);

    // 選択対象の資格一覧（署名URL付き。統合一覧の qualifications には URL が無いため別取得）
    const [selectedQuals, setSelectedQuals] = useState<SafetyQualificationDto[] | null>(null);
    const [uploadingImageQid, setUploadingImageQid] = useState<string | null>(null);
    const rowImageInputRef = useRef<HTMLInputElement>(null);
    const rowImageTargetQidRef = useRef<string | null>(null);

    const fetchTargets = useCallback(async () => {
        try {
            const res = await fetch('/api/safety-profiles', { cache: 'no-store' });
            if (!res.ok) throw new Error();
            setTargets(await res.json());
        } catch {
            toast.error('対象一覧の取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTargets();
    }, [fetchTargets]);

    const selected = useMemo(
        () => targets.find((t) => t.key === selectedKey) ?? null,
        [targets, selectedKey]
    );
    const selectedProfileId = selected?.profile?.id;

    // 対象（のプロフィール）が変わったら署名URL付きの資格一覧を取得
    useEffect(() => {
        if (!selectedProfileId) {
            setSelectedQuals(null);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/safety-profiles/${selectedProfileId}/qualifications`, { cache: 'no-store' });
                if (!res.ok) throw new Error();
                const data = await res.json();
                if (!cancelled) setSelectedQuals(data);
            } catch {
                if (!cancelled) setSelectedQuals(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedProfileId]);

    const groupedTargets = useMemo(() => {
        const q = search.trim();
        const filtered = q
            ? targets.filter(
                  (t) => t.name.includes(q) || (t.profile?.furigana ?? '').includes(q) || (t.companyName ?? '').includes(q)
              )
            : targets;
        const groups: Record<SafetyTargetGroup, SafetyTargetDto[]> = { employee: [], worker: [], partner: [] };
        for (const t of filtered) groups[getSafetyTargetGroup(t.source, t.role)].push(t);
        return groups;
    }, [targets, search]);

    const selectTarget = (target: SafetyTargetDto) => {
        if (target.key === selectedKey) return;
        if (isDirty && !confirm('保存されていない変更があります。破棄して切り替えますか？')) return;
        setSelectedKey(target.key);
        setForm(dtoToForm(target.profile));
        setIsDirty(false);
        setActiveTab('basic');
    };

    const updateForm = (patch: Partial<ProfileFormState>) => {
        setForm((prev) => ({ ...prev, ...patch }));
        setIsDirty(true);
    };

    const toggleAttribute = (value: string) => {
        setForm((prev) => ({
            ...prev,
            attributes: prev.attributes.includes(value)
                ? prev.attributes.filter((a) => a !== value)
                : [...prev.attributes, value],
        }));
        setIsDirty(true);
    };

    /** プロフィール保存（upsert）。返却値で targets を更新し、保存後の profile を返す */
    const saveProfile = useCallback(
        async (target: SafetyTargetDto, body: ReturnType<typeof formToBody>): Promise<SafetyProfileDto | null> => {
            const param = target.source === 'worker' ? `workerId=${target.sourceId}` : `userId=${target.sourceId}`;
            const res = await fetch(`/api/safety-profiles?${param}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '保存に失敗しました');
            }
            const profile: SafetyProfileDto = await res.json();
            setTargets((prev) => prev.map((t) => (t.key === target.key ? { ...t, profile } : t)));
            return profile;
        },
        []
    );

    const handleSave = async () => {
        if (!selected) return;
        if (form.employmentInsuranceLast4 && !/^\d{4}$/.test(form.employmentInsuranceLast4)) {
            toast.error('雇用保険被保険者番号は下4桁（数字4文字）のみ入力してください');
            return;
        }
        setIsSaving(true);
        try {
            await saveProfile(selected, formToBody(form));
            setIsDirty(false);
            toast.success('安全情報を保存しました');
        } catch (error) {
            logger.error('安全プロフィール保存エラー:', error);
            toast.error(error instanceof Error ? error.message : '保存に失敗しました');
        } finally {
            setIsSaving(false);
        }
    };

    /** 資格証画像をアップロード（差し替え）して更新後の資格を返す */
    const uploadQualificationImage = async (
        profileId: string,
        qualificationId: string,
        file: File
    ): Promise<SafetyQualificationDto> => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/safety-profiles/${profileId}/qualifications/${qualificationId}/image`, {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error || '画像のアップロードに失敗しました');
        }
        return res.json();
    };

    /** selectedQuals と targets の両方へ資格の変更を反映する */
    const applyQualificationChange = (
        targetKey: string,
        updater: (prev: SafetyQualificationDto[]) => SafetyQualificationDto[]
    ) => {
        setSelectedQuals((prev) => (prev ? updater(prev) : prev));
        setTargets((prev) =>
            prev.map((t) =>
                t.key === targetKey && t.profile
                    ? { ...t, profile: { ...t.profile, qualifications: updater(t.profile.qualifications) } }
                    : t
            )
        );
    };

    /** 資格追加。プロフィール未作成なら先に現在のフォーム内容で upsert してから登録する */
    const handleAddQualification = async () => {
        if (!selected) return;
        if (!qualName.trim()) {
            toast.error('資格・教育名を入力してください');
            return;
        }
        setIsAddingQual(true);
        try {
            let profileId = selected.profile?.id;
            if (!profileId) {
                const profile = await saveProfile(selected, formToBody(form));
                profileId = profile?.id;
                setIsDirty(false);
            }
            if (!profileId) throw new Error('プロフィールの作成に失敗しました');

            const res = await fetch(`/api/safety-profiles/${profileId}/qualifications`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: qualCategory,
                    name: qualName.trim(),
                    licenseNumber: qualLicenseNumber.trim() || null,
                    acquiredAt: qualAcquiredAt || null,
                    expiresAt: qualExpiresAt || null,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '資格の登録に失敗しました');
            }
            let qualification: SafetyQualificationDto = await res.json();

            // 画像が選ばれていれば続けてアップロード（失敗しても資格自体は登録済みなので警告に留める）
            if (qualImageFile) {
                try {
                    qualification = await uploadQualificationImage(profileId, qualification.id, qualImageFile);
                } catch (imageError) {
                    logger.error('資格証画像アップロードエラー:', imageError);
                    toast.error('資格は登録しましたが、画像のアップロードに失敗しました');
                }
            }

            applyQualificationChange(selected.key, (prev) => [...prev, qualification]);
            setQualName('');
            setQualLicenseNumber('');
            setQualAcquiredAt('');
            setQualExpiresAt('');
            setQualImageFile(null);
            toast.success('資格を登録しました');
        } catch (error) {
            logger.error('資格登録エラー:', error);
            toast.error(error instanceof Error ? error.message : '資格の登録に失敗しました');
        } finally {
            setIsAddingQual(false);
        }
    };

    const handleDeleteQualification = async (qualificationId: string) => {
        if (!selected?.profile) return;
        if (!confirm('この資格を削除しますか？（資格証画像も削除されます）')) return;
        try {
            const res = await fetch(
                `/api/safety-profiles/${selected.profile.id}/qualifications/${qualificationId}`,
                { method: 'DELETE' }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '削除に失敗しました');
            }
            applyQualificationChange(selected.key, (prev) => prev.filter((q) => q.id !== qualificationId));
            toast.success('資格を削除しました');
        } catch (error) {
            logger.error('資格削除エラー:', error);
            toast.error(error instanceof Error ? error.message : '削除に失敗しました');
        }
    };

    /** 一覧行の「画像」ボタン → hidden input を開く */
    const openRowImagePicker = (qualificationId: string) => {
        rowImageTargetQidRef.current = qualificationId;
        rowImageInputRef.current?.click();
    };

    const handleRowImageSelected = async (file: File) => {
        const qid = rowImageTargetQidRef.current;
        if (!selected?.profile || !qid) return;
        setUploadingImageQid(qid);
        try {
            const updated = await uploadQualificationImage(selected.profile.id, qid, file);
            applyQualificationChange(selected.key, (prev) => prev.map((q) => (q.id === qid ? updated : q)));
            toast.success('資格証画像を保存しました');
        } catch (error) {
            logger.error('資格証画像アップロードエラー:', error);
            toast.error(error instanceof Error ? error.message : '画像のアップロードに失敗しました');
        } finally {
            setUploadingImageQid(null);
            rowImageTargetQidRef.current = null;
        }
    };

    const handleDeleteQualificationImage = async (qualificationId: string) => {
        if (!selected?.profile) return;
        if (!confirm('資格証画像を削除しますか？')) return;
        try {
            const res = await fetch(
                `/api/safety-profiles/${selected.profile.id}/qualifications/${qualificationId}/image`,
                { method: 'DELETE' }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || '画像の削除に失敗しました');
            }
            applyQualificationChange(selected.key, (prev) =>
                prev.map((q) =>
                    q.id === qualificationId
                        ? { ...q, imagePath: null, imageThumbPath: null, imageUrl: null, imageThumbUrl: null }
                        : q
                )
            );
            toast.success('資格証画像を削除しました');
        } catch (error) {
            logger.error('資格証画像削除エラー:', error);
            toast.error(error instanceof Error ? error.message : '画像の削除に失敗しました');
        }
    };

    const renderTargetGroup = (group: SafetyTargetGroup) => {
        const list = groupedTargets[group];
        if (list.length === 0) return null;
        return (
            <div key={group}>
                <div className="px-2 py-1.5 text-xs font-semibold text-slate-500 sticky top-0 bg-white">
                    {SAFETY_TARGET_GROUP_LABELS[group]}（{list.length}）
                </div>
                <ul>
                    {list.map((t) => (
                        <li key={t.key}>
                            <button
                                type="button"
                                onClick={() => selectTarget(t)}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                                    t.key === selectedKey
                                        ? 'bg-teal-50 text-teal-800 font-medium'
                                        : 'text-slate-700 hover:bg-slate-50'
                                }`}
                            >
                                <span className="flex-1 min-w-0 truncate">
                                    {t.name}
                                    {group === 'partner' && t.companyName ? (
                                        <span className="text-xs text-slate-400">（{t.companyName}）</span>
                                    ) : null}
                                </span>
                                {t.profile ? (
                                    <Check className="w-3.5 h-3.5 text-teal-600 shrink-0" aria-label="登録済み" />
                                ) : (
                                    <span className="w-3.5 h-3.5 shrink-0" />
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        );
    };

    return (
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">作業員 安全情報</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                        安全書類（作業員名簿など）に記載する情報を管理します。すべて任意入力です。
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<FileUp className="w-4 h-4" />}
                    onClick={() => setIsImportOpen(true)}
                >
                    Excelから取込
                </Button>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
                {/* ── 左: 対象一覧 ── */}
                <div className="lg:w-72 shrink-0">
                    <div className="relative mb-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="氏名・会社名で検索"
                            className={`${INPUT_CLASS} pl-9`}
                        />
                    </div>
                    <div className="border border-slate-200 rounded-xl p-1.5 max-h-[520px] overflow-y-auto bg-white">
                        {isLoading ? (
                            <p className="text-sm text-slate-400 text-center py-6">読み込み中...</p>
                        ) : (
                            <>
                                {renderTargetGroup('employee')}
                                {renderTargetGroup('worker')}
                                {renderTargetGroup('partner')}
                                {targets.length === 0 && (
                                    <p className="text-sm text-slate-400 text-center py-6">対象がありません</p>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* ── 右: フォーム ── */}
                <div className="flex-1 min-w-0">
                    {!selected ? (
                        <div className="flex flex-col items-center justify-center h-64 border border-dashed border-slate-300 rounded-xl text-slate-400 gap-2">
                            <AlertTriangle className="w-6 h-6" />
                            <p className="text-sm">左の一覧から作業員を選択してください</p>
                        </div>
                    ) : (
                        <div className="bg-white border border-slate-200 rounded-xl">
                            {/* 対象ヘッダー */}
                            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200">
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-slate-900">{selected.name}</div>
                                    <div className="text-xs text-slate-500">
                                        {SAFETY_TARGET_GROUP_LABELS[getSafetyTargetGroup(selected.source, selected.role)]}
                                        {selected.companyName ? ` ／ ${selected.companyName}` : ''}
                                        {isDirty && <span className="ml-2 text-amber-600">未保存の変更があります</span>}
                                    </div>
                                </div>
                                <Button size="sm" onClick={handleSave} isLoading={isSaving}>
                                    保存
                                </Button>
                            </div>

                            {/* タブ */}
                            <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
                                {FORM_TABS.map((tab) => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors ${
                                            activeTab === tab.id
                                                ? 'bg-teal-600 text-white font-medium'
                                                : 'text-slate-600 hover:bg-slate-100'
                                        }`}
                                    >
                                        {tab.label}
                                        {tab.id === 'qualifications' && selected.profile
                                            ? `（${selected.profile.qualifications.length}）`
                                            : ''}
                                    </button>
                                ))}
                            </div>

                            <div className="p-4">
                                {activeTab === 'basic' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className={LABEL_CLASS}>ふりがな</label>
                                            <input type="text" value={form.furigana} onChange={(e) => updateForm({ furigana: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>生年月日</label>
                                            <input type="date" value={form.birthDate} onChange={(e) => updateForm({ birthDate: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>性別</label>
                                            <select value={form.gender} onChange={(e) => updateForm({ gender: e.target.value })} className={INPUT_CLASS}>
                                                <option value="">未設定</option>
                                                {GENDER_OPTIONS.map((g) => (
                                                    <option key={g} value={g}>{g}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>職種</label>
                                            <input type="text" value={form.jobType} onChange={(e) => updateForm({ jobType: e.target.value })} placeholder="とび・足場 等" className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>雇入年月日</label>
                                            <input type="date" value={form.hireDate} onChange={(e) => updateForm({ hireDate: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>経験年数（職種の通算）</label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={80}
                                                value={form.experienceYears}
                                                onChange={(e) => updateForm({ experienceYears: e.target.value })}
                                                className={INPUT_CLASS}
                                            />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>区分</label>
                                            <select value={form.workerCategory} onChange={(e) => updateForm({ workerCategory: e.target.value })} className={INPUT_CLASS}>
                                                <option value="">未設定</option>
                                                {WORKER_CATEGORY_OPTIONS.map((c) => (
                                                    <option key={c} value={c}>{c}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>CCUS技能者ID</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={14}
                                                value={form.ccusId}
                                                onChange={(e) => updateForm({ ccusId: e.target.value.replace(/\D/g, '') })}
                                                placeholder="14桁の数字"
                                                className={INPUT_CLASS}
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className={LABEL_CLASS}>属性（該当するものを選択）</label>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                                {WORKER_ATTRIBUTES.map((attr) => (
                                                    <label key={attr.value} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={form.attributes.includes(attr.value)}
                                                            onChange={() => toggleAttribute(attr.value)}
                                                            className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                                        />
                                                        {attr.value}＝{attr.label}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <label className={LABEL_CLASS}>備考</label>
                                            <textarea value={form.notes} onChange={(e) => updateForm({ notes: e.target.value })} rows={2} className={INPUT_CLASS} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'contact' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="sm:col-span-2">
                                            <label className={LABEL_CLASS}>現住所</label>
                                            <input type="text" value={form.address} onChange={(e) => updateForm({ address: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>本人TEL</label>
                                            <input type="tel" value={form.tel} onChange={(e) => updateForm({ tel: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div />
                                        <div>
                                            <label className={LABEL_CLASS}>緊急連絡先（家族・続柄など）</label>
                                            <input type="text" value={form.familyContact} onChange={(e) => updateForm({ familyContact: e.target.value })} placeholder="例: 山田花子（妻）東京都…" className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>緊急連絡先TEL</label>
                                            <input type="tel" value={form.familyTel} onChange={(e) => updateForm({ familyTel: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'insurance' && (
                                    <div className="space-y-4">
                                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                            法令により健康保険の記号・番号、基礎年金番号は記載・保持できません。区分のみ登録します（雇用保険のみ下4桁可）。
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className={LABEL_CLASS}>健康保険</label>
                                                <select value={form.healthInsurance} onChange={(e) => updateForm({ healthInsurance: e.target.value })} className={INPUT_CLASS}>
                                                    <option value="">未設定</option>
                                                    {HEALTH_INSURANCE_OPTIONS.map((o) => (
                                                        <option key={o} value={o}>{o}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={LABEL_CLASS}>年金保険</label>
                                                <select value={form.pensionInsurance} onChange={(e) => updateForm({ pensionInsurance: e.target.value })} className={INPUT_CLASS}>
                                                    <option value="">未設定</option>
                                                    {PENSION_INSURANCE_OPTIONS.map((o) => (
                                                        <option key={o} value={o}>{o}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={LABEL_CLASS}>雇用保険</label>
                                                <select value={form.employmentInsurance} onChange={(e) => updateForm({ employmentInsurance: e.target.value })} className={INPUT_CLASS}>
                                                    <option value="">未設定</option>
                                                    {EMPLOYMENT_INSURANCE_OPTIONS.map((o) => (
                                                        <option key={o} value={o}>{o}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={LABEL_CLASS}>雇用保険被保険者番号（下4桁のみ）</label>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    maxLength={4}
                                                    value={form.employmentInsuranceLast4}
                                                    onChange={(e) => updateForm({ employmentInsuranceLast4: e.target.value.replace(/\D/g, '') })}
                                                    placeholder="例: 1234"
                                                    className={INPUT_CLASS}
                                                />
                                            </div>
                                            <TriStateSelect
                                                label="労災保険特別加入（一人親方等）"
                                                value={form.rosaiSpecialInsurance}
                                                onChange={(v) => updateForm({ rosaiSpecialInsurance: v })}
                                            />
                                            <div />
                                            <TriStateSelect label="建退共" value={form.kentaikyo} onChange={(v) => updateForm({ kentaikyo: v })} />
                                            <TriStateSelect label="中退共" value={form.chutaikyo} onChange={(v) => updateForm({ chutaikyo: v })} />
                                            <TriStateSelect label="建退共手帳の所有" value={form.kentaikyoTechou} onChange={(v) => updateForm({ kentaikyoTechou: v })} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'qualifications' && (() => {
                                    // 署名URL付きの一覧を優先（フォールバックは統合一覧由来 = 画像URLなし）
                                    const quals = selectedQuals ?? selected.profile?.qualifications ?? [];
                                    return (
                                        <div className="space-y-4">
                                            {/* 行画像アップロード用の hidden input（1つを使い回す） */}
                                            <input
                                                ref={rowImageInputRef}
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleRowImageSelected(file);
                                                    e.target.value = '';
                                                }}
                                            />

                                            {/* 登録済み一覧 */}
                                            {quals.length > 0 ? (
                                                <ul className="space-y-1.5">
                                                    {quals.map((q) => (
                                                        <li key={q.id} className="flex items-center gap-3 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                                                            {/* 資格証画像: サムネ（クリックで原寸を新規タブ表示）/ 未登録は追加ボタン */}
                                                            {q.imageThumbUrl ? (
                                                                <div className="relative shrink-0">
                                                                    <a
                                                                        href={q.imageUrl ?? undefined}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        title="資格証画像を表示"
                                                                    >
                                                                        {/* eslint-disable-next-line @next/next/no-img-element -- 署名URL(毎回変化)のため next/image 不適 */}
                                                                        <img
                                                                            src={q.imageThumbUrl}
                                                                            alt={`${q.name} 資格証`}
                                                                            className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                                                                        />
                                                                    </a>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleDeleteQualificationImage(q.id)}
                                                                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-slate-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center"
                                                                        aria-label="資格証画像を削除"
                                                                        title="画像を削除"
                                                                    >
                                                                        <X className="w-2.5 h-2.5" />
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openRowImagePicker(q.id)}
                                                                    disabled={uploadingImageQid === q.id}
                                                                    className="w-10 h-10 shrink-0 flex items-center justify-center border border-dashed border-slate-300 rounded-lg text-slate-400 hover:text-teal-600 hover:border-teal-400 transition-colors"
                                                                    title="資格証画像を追加"
                                                                    aria-label="資格証画像を追加"
                                                                >
                                                                    {uploadingImageQid === q.id ? (
                                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                                    ) : (
                                                                        <ImagePlus className="w-4 h-4" />
                                                                    )}
                                                                </button>
                                                            )}
                                                            <span className="text-[10px] px-2 py-0.5 bg-white border border-slate-200 rounded-full text-slate-600 shrink-0">
                                                                {getQualificationCategoryLabel(q.category)}
                                                            </span>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm text-slate-800 truncate">{q.name}</div>
                                                                {q.licenseNumber && (
                                                                    <div className="text-xs text-slate-500">No.{q.licenseNumber}</div>
                                                                )}
                                                            </div>
                                                            {q.acquiredAt && (
                                                                <span className="text-xs text-slate-500 shrink-0">取得 {q.acquiredAt.slice(0, 10)}</span>
                                                            )}
                                                            {q.expiresAt && (
                                                                <span className="text-xs text-slate-500 shrink-0">期限 {q.expiresAt.slice(0, 10)}</span>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteQualification(q.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                                                                aria-label="資格を削除"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <p className="text-sm text-slate-400">登録済みの資格・教育はありません</p>
                                            )}

                                            {/* 追加フォーム */}
                                            <div className="border-t border-slate-200 pt-4">
                                                <div className="text-xs font-semibold text-slate-600 mb-2">資格・教育を追加</div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                    <select value={qualCategory} onChange={(e) => setQualCategory(e.target.value)} className={INPUT_CLASS}>
                                                        {QUALIFICATION_CATEGORIES.map((c) => (
                                                            <option key={c.value} value={c.value}>{c.label}</option>
                                                        ))}
                                                    </select>
                                                    <input
                                                        type="text"
                                                        list="safety-qual-suggestions"
                                                        value={qualName}
                                                        onChange={(e) => {
                                                            setQualName(e.target.value);
                                                            // サジェスト選択時は種別も自動で合わせる（FR-1-5）
                                                            const hit = COMMON_QUALIFICATIONS.find((c) => c.name === e.target.value);
                                                            if (hit) setQualCategory(hit.category);
                                                        }}
                                                        placeholder="資格・教育名"
                                                        className={`${INPUT_CLASS} lg:col-span-2`}
                                                    />
                                                    <datalist id="safety-qual-suggestions">
                                                        {COMMON_QUALIFICATIONS.map((c) => (
                                                            <option key={c.name} value={c.name} />
                                                        ))}
                                                    </datalist>
                                                    <input
                                                        type="text"
                                                        value={qualLicenseNumber}
                                                        onChange={(e) => setQualLicenseNumber(e.target.value)}
                                                        placeholder="修了証・免許証の番号（任意）"
                                                        className={INPUT_CLASS}
                                                    />
                                                    <input type="date" value={qualAcquiredAt} onChange={(e) => setQualAcquiredAt(e.target.value)} title="取得日" className={INPUT_CLASS} />
                                                    <input type="date" value={qualExpiresAt} onChange={(e) => setQualExpiresAt(e.target.value)} title="有効期限" className={INPUT_CLASS} />
                                                </div>
                                                <div className="flex items-center gap-2 mt-2">
                                                    <label className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 cursor-pointer hover:bg-slate-50 min-w-0">
                                                        <ImagePlus className="w-4 h-4 shrink-0 text-slate-400" />
                                                        <span className="truncate max-w-[260px]">
                                                            {qualImageFile ? qualImageFile.name : '資格証画像を添付（任意）'}
                                                        </span>
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                setQualImageFile(e.target.files?.[0] ?? null);
                                                                e.target.value = '';
                                                            }}
                                                        />
                                                    </label>
                                                    {qualImageFile && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setQualImageFile(null)}
                                                            className="p-1.5 text-slate-400 hover:text-red-600"
                                                            aria-label="添付を取り消す"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    <div className="flex-1" />
                                                    <Button size="sm" leftIcon={<Plus className="w-4 h-4" />} onClick={handleAddQualification} isLoading={isAddingQual}>
                                                        追加
                                                    </Button>
                                                </div>
                                                <p className="text-[11px] text-slate-400 mt-1.5">
                                                    種別 / 名称（入力候補あり）/ 番号 / 取得日 / 有効期限。画像は1資格につき1枚（後から行の画像ボタンでも追加・差し替えできます）
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {activeTab === 'health' && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className={LABEL_CLASS}>最近の健康診断日（雇入時＋年1回）</label>
                                            <input type="date" value={form.healthCheckDate} onChange={(e) => updateForm({ healthCheckDate: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>血圧</label>
                                            <input type="text" value={form.bloodPressure} onChange={(e) => updateForm({ bloodPressure: e.target.value })} placeholder="例: 120-80" className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>血液型</label>
                                            <select value={form.bloodType} onChange={(e) => updateForm({ bloodType: e.target.value })} className={INPUT_CLASS}>
                                                <option value="">未設定</option>
                                                {BLOOD_TYPE_OPTIONS.map((b) => (
                                                    <option key={b} value={b}>{b}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div />
                                        <div>
                                            <label className={LABEL_CLASS}>特殊健康診断日（有害業務従事者）</label>
                                            <input type="date" value={form.specialHealthCheckDate} onChange={(e) => updateForm({ specialHealthCheckDate: e.target.value })} className={INPUT_CLASS} />
                                        </div>
                                        <div>
                                            <label className={LABEL_CLASS}>特殊健康診断の種類</label>
                                            <input type="text" value={form.specialHealthCheckType} onChange={(e) => updateForm({ specialHealthCheckType: e.target.value })} placeholder="じん肺 / 有機溶剤 / 石綿 等" className={INPUT_CLASS} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Excelインポート（FR-5） */}
            {isImportOpen && (
                <SafetyProfileImportModal
                    targets={targets}
                    onClose={() => setIsImportOpen(false)}
                    onImported={() => {
                        setIsImportOpen(false);
                        setIsLoading(true);
                        fetchTargets();
                    }}
                />
            )}
        </div>
    );
}
