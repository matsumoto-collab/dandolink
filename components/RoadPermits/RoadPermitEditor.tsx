'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { Eye, FileDown, RefreshCw, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { LivePdfPreview } from '@/components/ui/LivePdfPreview';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { logger } from '@/lib/logger';
import { onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import { ROAD_PERMIT_FORMS, getRoadPermitForm } from '@/lib/roadPermit/forms';
import { enabledFormIdsOf, normalizeRoadPermitDocuments, normalizeRoadPermitValues } from '@/lib/roadPermit/defaults';
import { contactPresetIndexOf, isContactBlank } from '@/lib/roadPermit/contacts';
import { approxAreaOf, countDaysInclusive } from '@/lib/roadPermit/format';
import { isDrawingEmpty, normalizeRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import { occupancyFormPatch, type OccupancyApplyItem } from '@/lib/roadPermit/drawing/occupancy';
import { countSymbols, symbolMethodText } from '@/lib/roadPermit/symbols/counting';
import { toSymbolMap } from '@/lib/roadPermit/symbols/normalize';
import type { RoadPermitDrawing } from '@/types/roadPermitDrawing';
import type { RoadPermitSymbolDto, RoadPermitSymbolsResponse } from '@/types/roadPermitSymbol';
import {
    ROAD_PERMIT_STATUSES,
    ROAD_PERMIT_STATUS_LABELS,
    type RoadPermitCompanyDefaults,
    type RoadPermitContactPreset,
    type RoadPermitDocumentEntry,
    type RoadPermitDocuments,
    type RoadPermitDto,
    type RoadPermitFormId,
    type RoadPermitStatus,
    type RoadPermitValues,
} from '@/types/roadPermit';
import { ROAD_PERMIT_INPUT_CLASS, ROAD_PERMIT_STATUS_BADGE, errorMessage, parseDayCountInput, statusLabel } from './roadPermitUi';

// 図面タブ（作図画面）は konva を使うので、開いたときだけ読み込む（サーバーでは描かない）
const DrawingEditor = dynamic(() => import('./Drawing'), {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">図面を読み込んでいます…</div>,
});

interface RoadPermitEditorProps {
    permit: RoadPermitDto;
    /** 自社情報（「自社情報から入れ直す」に使う）。未登録なら null（ボタンを出さない） */
    company: RoadPermitCompanyDefaults | null;
    /** 担当者の候補（並び順）。0 件なら担当者・現場責任者の「選ぶ」欄を出さない */
    contacts: RoadPermitContactPreset[];
    onClose: () => void;
    /** 保存できたとき（画面は開いたまま） */
    onSaved: (dto: RoadPermitDto) => void;
}

/** 編集中の値（保存で PUT に送る形と同じ） */
interface EditorForm {
    title: string;
    status: RoadPermitStatus;
    values: RoadPermitValues;
    documents: RoadPermitDocuments;
    /** 図面（まだ描いていなければ null） */
    drawing: RoadPermitDrawing | null;
}

type TabKey = 'basic' | 'forms' | 'drawing' | 'submit';

const TABS: { key: TabKey; label: string }[] = [
    { key: 'basic', label: '基本' },
    { key: 'forms', label: '申請書' },
    { key: 'drawing', label: '図面' },
    { key: 'submit', label: '添付・提出' },
];

/** DB から来た値は欠けている欄があり得るので、必ず正規化してから持つ */
function toForm(p: RoadPermitDto): EditorForm {
    return {
        title: p.title,
        status: p.status,
        values: normalizeRoadPermitValues(p.values),
        documents: normalizeRoadPermitDocuments(p.documents),
        drawing: p.drawing ? normalizeRoadPermitDrawing(p.drawing) : null,
    };
}

const inputBase = ROAD_PERMIT_INPUT_CLASS;
const sectionBox = 'bg-white rounded-lg border border-slate-200 p-4';

/**
 * 道路申請の編集画面（指示書 §6.2）。タブは「基本」「申請書」「図面」「添付・提出」の 4 つ（「図面」は Phase 2a の作図画面）。
 * - 保存は「保存」ボタンだけ（自動保存はしない）。保存していない変更があれば、閉じる前に確かめる
 * - 「申請書」タブだけ、右側（lg 以上）にその場の PDF プレビューを出す。lg 未満は「プレビュー」ボタンで全画面
 */
export default function RoadPermitEditor({ permit, company, contacts, onClose, onSaved }: RoadPermitEditorProps) {
    const [form, setForm] = useState<EditorForm>(() => toForm(permit));
    // 保存済みの値（直しかけかどうかの判定に使う）
    const [baseJson, setBaseJson] = useState<string>(() => JSON.stringify(toForm(permit)));
    const [tab, setTab] = useState<TabKey>('basic');
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    // PDF に図面のページも入れるか（図形があるときだけ選べる。既定はオン）
    const [includeDrawing, setIncludeDrawing] = useState(true);
    const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
    // 二重押しを防ぐ同期ロック（state の反映を待たずに止める）
    const lockRef = useRef(false);
    const isLg = useMediaQuery('(min-width: 1024px)');

    // ---- 記号の一覧（図面の記号を描くため。null＝読み込み中・読めなければ空＝記号は ○ で出る） ----
    const [symbols, setSymbols] = useState<RoadPermitSymbolDto[] | null>(null);
    const symbolsSeqRef = useRef(0);
    const loadSymbols = useCallback(async () => {
        const seq = ++symbolsSeqRef.current;
        try {
            const res = await fetch('/api/road-permits/symbols', { cache: 'no-store' });
            if (!res.ok) throw new Error(await errorMessage(res, '記号を読み込めませんでした'));
            const json = (await res.json()) as Partial<RoadPermitSymbolsResponse>;
            if (seq !== symbolsSeqRef.current) return;
            setSymbols(Array.isArray(json.symbols) ? json.symbols : []);
        } catch (e) {
            if (seq !== symbolsSeqRef.current) return;
            logger.error('道路申請の記号の読み込み失敗:', e);
            toast.error('記号を読み込めませんでした（図面の記号は ○ で出ます）');
            setSymbols((prev) => prev ?? []);
        }
    }, []);
    useEffect(() => {
        void loadSymbols();
        // 記号の登録画面で変えたら読み直す
        const off = onBroadcast('road_permit_symbols_updated', () => {
            void loadSymbols();
        });
        return () => {
            off();
            // 閉じたあとに届いた応答は捨てる
            symbolsSeqRef.current++;
        };
    }, [loadSymbols]);

    // 別の申請に切り替わったら（コピーして作った直後など）入力欄を作り直す
    const permitIdRef = useRef(permit.id);
    useEffect(() => {
        if (permitIdRef.current === permit.id) return;
        permitIdRef.current = permit.id;
        const next = toForm(permit);
        setForm(next);
        setBaseJson(JSON.stringify(next));
        setTab('basic');
    }, [permit]);

    const isDirty = JSON.stringify(form) !== baseJson;
    const { values, documents } = form;
    const formIds = useMemo(() => enabledFormIdsOf(documents), [documents]);
    const hasPolice = formIds.some((id) => getRoadPermitForm(id).group === 'police');
    const hasMatsuyama = formIds.some((id) => getRoadPermitForm(id).group === 'matsuyama');

    // ---- 値の更新の小さなヘルパー ----
    const updateGroup = useCallback(<K extends keyof RoadPermitValues>(key: K, patch: Partial<RoadPermitValues[K]>) => {
        setForm((f) => ({ ...f, values: { ...f.values, [key]: { ...f.values[key], ...patch } } }));
    }, []);

    // 図面の「占用範囲」→ 申請書の占用物件（規模＝「別紙記入」・長さと幅は空・数量＝合計）。「約○㎡」は自動のまま触らない
    const applyOccupancy = useCallback(
        (items: OccupancyApplyItem[]) => {
            const patch = occupancyFormPatch(items);
            if (!patch) {
                toast.error('図面に占用範囲がありません');
                return;
            }
            const preview = `規模「${patch.scaleNote}」・長さと幅は空・数量 ${patch.quantity} ㎡（約 ${approxAreaOf(patch.quantity)} ㎡ は自動）`;
            const note = '数量が長いときは手で短くしてもかまいません（過去に 2.67962708 を 2.67 と書いた例あり）';
            if (!window.confirm(`申請書の占用物件に入れます。よろしいですか？\n\n${preview}\n\n${note}`)) return;
            updateGroup('occupancy', patch);
            toast.success('占用物件に入れました（保存すると残ります）');
        },
        [updateGroup],
    );

    const updateDoc = useCallback((formId: RoadPermitFormId, patch: Partial<RoadPermitDocumentEntry>) => {
        setForm((f) => ({
            ...f,
            documents: { ...f.documents, forms: f.documents.forms.map((d) => (d.formId === formId ? { ...d, ...patch } : d)) },
        }));
    }, []);

    // ---- 閉じる（直しかけなら確認） ----
    const requestClose = useCallback(() => {
        if (lockRef.current) return;
        if (isDirty && !window.confirm('保存していない変更があります。閉じますか？')) return;
        onClose();
    }, [isDirty, onClose]);

    // Esc で閉じる（全画面プレビューが開いていればそちらを閉じる）
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // 図面タブの Esc は「描きかけの中止」に使うので、編集画面は閉じない
            if (tab === 'drawing') return;
            e.stopPropagation();
            if (mobilePreviewOpen) setMobilePreviewOpen(false);
            else requestClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [mobilePreviewOpen, requestClose, tab]);

    // 直しかけのままブラウザのタブを閉じようとしたら確認する
    useEffect(() => {
        if (!isDirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    // ---- 保存 ----
    const handleSave = async () => {
        if (lockRef.current) return;
        if (form.title.trim() === '') {
            toast.error('名前を入れてください');
            setTab('basic');
            return;
        }
        lockRef.current = true;
        setSaving(true);
        try {
            const res = await fetch(`/api/road-permits/${encodeURIComponent(permit.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: form.title.trim(),
                    status: form.status,
                    values: form.values,
                    documents: form.documents,
                    // 図面はまだ描いていなければ送らない（送らない＝変えない）
                    ...(form.drawing ? { drawing: form.drawing } : {}),
                }),
            });
            if (!res.ok) throw new Error(await errorMessage(res, '保存に失敗しました'));
            const dto = (await res.json()) as RoadPermitDto;
            // サーバーが整えた値を新しい基準にする（直しかけの印を消す）
            const next = toForm(dto);
            setForm(next);
            setBaseJson(JSON.stringify(next));
            sendBroadcast('road_permits_updated', { id: dto.id });
            toast.success('保存しました');
            onSaved(dto);
        } catch (e) {
            logger.error('道路申請の保存失敗:', e);
            toast.error(e instanceof Error ? e.message : '保存に失敗しました');
        } finally {
            lockRef.current = false;
            setSaving(false);
        }
    };

    // ---- PDF ----
    const handleExportPdf = async () => {
        if (formIds.length === 0 || exporting) return;
        setExporting(true);
        try {
            const { exportRoadPermitPDF } = await import('@/utils/roadPermitPdf');
            await exportRoadPermitPDF({
                values,
                formIds,
                drawing: form.drawing,
                includeDrawing: includeDrawing && !isDrawingEmpty(form.drawing),
                symbols,
            });
        } catch (e) {
            logger.error('道路申請のPDF出力失敗:', e);
            toast.error(e instanceof Error ? e.message : 'PDF を出せませんでした');
        } finally {
            setExporting(false);
        }
    };

    // プレビューは入力値と出す様式が変わったときだけ作り直す
    const previewSeed = useMemo(() => JSON.stringify({ values, formIds }), [values, formIds]);
    const renderPdf = async () => {
        const { generateRoadPermitPdfBlob } = await import('@/utils/roadPermitPdf');
        return generateRoadPermitPdfBlob({ values, formIds });
    };
    const previewPane = <LivePdfPreview seed={previewSeed} renderPdf={renderPdf} />;
    const showSidePreview = tab === 'forms';

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-start pt-[4.5rem] pwa-modal-offset-safe lg:justify-center lg:pt-0">
            <div className="absolute inset-0 bg-black/50" onClick={requestClose} />

            <div
                role="dialog"
                aria-modal="true"
                aria-label="道路申請の編集"
                className="relative flex h-full w-full flex-1 flex-col bg-white lg:h-[92vh] lg:w-[96vw] lg:max-w-[1800px] lg:flex-none lg:rounded-lg lg:shadow-xl"
            >
                {/* ヘッダー */}
                <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 md:px-6">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-semibold text-slate-900">
                                道路申請<span className="mx-2 text-slate-300">|</span>
                                <span className="break-words">{permit.projectTitle ?? form.title}</span>
                            </h2>
                            <span
                                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ROAD_PERMIT_STATUS_BADGE[form.status] ?? ''}`}
                            >
                                {statusLabel(form.status)}
                            </span>
                            {isDirty && <span className="text-xs text-amber-700">保存していない変更があります</span>}
                        </div>
                        {!permit.projectTitle && permit.projectMasterId === null && (
                            <p className="mt-0.5 text-xs text-slate-500">案件が見つかりません（消された可能性があります）</p>
                        )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="lg:hidden"
                            onClick={() => setMobilePreviewOpen(true)}
                            disabled={formIds.length === 0}
                            leftIcon={<Eye className="h-4 w-4" />}
                        >
                            プレビュー
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => void handleSave()}
                            disabled={saving || !isDirty}
                            isLoading={saving}
                            leftIcon={<Save className="h-4 w-4" />}
                        >
                            保存
                        </Button>
                        <button
                            type="button"
                            onClick={requestClose}
                            title="閉じる"
                            aria-label="閉じる"
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* タブ */}
                <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-4 md:px-6">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                                tab === t.key
                                    ? 'border-teal-600 text-teal-700'
                                    : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* 本文: 申請書タブの lg 以上は 左＝入力（3/5）・右＝プレビュー（2/5） */}
                <div className="flex min-h-0 flex-1">
                    <div
                        className={`min-h-0 flex-1 overflow-y-auto bg-slate-50 ${
                            showSidePreview ? 'lg:w-3/5 lg:flex-none lg:border-r lg:border-slate-200' : ''
                        }`}
                    >
                        {/* 図面タブは高さいっぱい・余白なし（max-w-5xl の枠を外す） */}
                        {tab === 'drawing' && (
                            <div className="h-full">
                                <DrawingEditor
                                    key={permit.id}
                                    value={form.drawing}
                                    values={values}
                                    symbols={symbols}
                                    onChange={(drawing) => setForm((f) => ({ ...f, drawing }))}
                                    onApplyOccupancy={applyOccupancy}
                                />
                            </div>
                        )}
                        <div className={tab === 'drawing' ? 'hidden' : 'mx-auto max-w-5xl space-y-4 p-4 md:p-6'}>
                            {tab === 'basic' && (
                                <BasicTab
                                    key={permit.id}
                                    form={form}
                                    company={company}
                                    contacts={contacts}
                                    setTitle={(title) => setForm((f) => ({ ...f, title }))}
                                    updateGroup={updateGroup}
                                    updateDoc={updateDoc}
                                    onRefillApplicant={() => {
                                        if (!company) return;
                                        updateGroup('applicant', {
                                            postalCode: company.postalCode,
                                            address: company.address,
                                            companyName: company.name,
                                            representativeTitle: company.representativeTitle,
                                            representativeName: company.representative,
                                            tel: company.tel,
                                        });
                                        toast.success('自社情報から入れ直しました（保存すると残ります）');
                                    }}
                                />
                            )}
                            {tab === 'forms' && (
                                <FormsTab
                                    values={values}
                                    drawing={form.drawing}
                                    symbols={symbols}
                                    hasPolice={hasPolice}
                                    hasMatsuyama={hasMatsuyama}
                                    updateGroup={updateGroup}
                                    goBasic={() => setTab('basic')}
                                />
                            )}
                            {tab === 'submit' && (
                                <SubmitTab
                                    form={form}
                                    formIds={formIds}
                                    exporting={exporting}
                                    hasDrawing={!isDrawingEmpty(form.drawing)}
                                    includeDrawing={includeDrawing}
                                    onIncludeDrawing={setIncludeDrawing}
                                    onStatus={(status) => setForm((f) => ({ ...f, status }))}
                                    updateDoc={updateDoc}
                                    onExportPdf={() => void handleExportPdf()}
                                />
                            )}
                        </div>
                    </div>

                    {/* 右: ライブプレビュー（申請書タブの lg 以上だけ描く） */}
                    {showSidePreview && (
                        <div className="hidden min-h-0 lg:flex lg:w-2/5 lg:flex-col">{isLg === true && previewPane}</div>
                    )}
                </div>
            </div>

            {/* lg 未満: 全画面プレビュー */}
            {mobilePreviewOpen && (
                <div className="fixed inset-0 z-[110] flex flex-col bg-white lg:hidden">
                    <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
                        <h3 className="text-base font-semibold text-slate-900">プレビュー</h3>
                        <button
                            type="button"
                            onClick={() => setMobilePreviewOpen(false)}
                            title="閉じる"
                            aria-label="閉じる"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1">{isLg === false && previewPane}</div>
                </div>
            )}
        </div>,
        document.body,
    );
}

// ---------------------------------------------------------------------------
// 入力の部品
// ---------------------------------------------------------------------------

type UpdateGroup = <K extends keyof RoadPermitValues>(key: K, patch: Partial<RoadPermitValues[K]>) => void;
type UpdateDoc = (formId: RoadPermitFormId, patch: Partial<RoadPermitDocumentEntry>) => void;

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className={sectionBox}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
                {aside}
            </div>
            {children}
        </section>
    );
}

function Field({
    label,
    hint,
    className = '',
    children,
}: {
    label: string;
    hint?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <label className={`block text-sm ${className}`}>
            <span className="mb-1 block font-medium text-slate-700">{label}</span>
            {children}
            {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
        </label>
    );
}

function TextInput({
    value,
    onChange,
    type = 'text',
    placeholder,
    inputMode,
    readOnly,
}: {
    value: string;
    onChange?: (v: string) => void;
    type?: 'text' | 'date' | 'time' | 'tel';
    placeholder?: string;
    inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
    readOnly?: boolean;
}) {
    return (
        <input
            type={type}
            value={value}
            placeholder={placeholder}
            inputMode={inputMode}
            readOnly={readOnly}
            onChange={(e) => onChange?.(e.target.value)}
            className={inputBase}
        />
    );
}

function TextArea({ value, onChange, rows = 2 }: { value: string; onChange: (v: string) => void; rows?: number }) {
    return <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className={`${inputBase} resize-y`} />;
}

/**
 * 選択ボタン（押した方が teal で塗られる）。
 * allowEmpty のときは、選ばれている方をもう一度押すと未選択（''）に戻る。
 */
function ChoiceButtons<T extends string>({
    options,
    value,
    onChange,
    allowEmpty = false,
}: {
    options: { value: T; label: string }[];
    value: T | '';
    onChange: (v: T | '') => void;
    allowEmpty?: boolean;
}) {
    return (
        <div className="inline-flex flex-wrap gap-1.5">
            {options.map((o) => {
                const selected = value === o.value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(selected && allowEmpty ? '' : o.value)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                            selected
                                ? 'border-teal-600 bg-teal-600 text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-teal-100'
                        }`}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

type PresetChoice = 'auto' | 'free' | 'same';

/**
 * 担当者・現場責任者の「選ぶ」欄（指示書_道路申請_担当者の選択と住所 §3.3）。
 * 中身は 候補の名前（登録順）＋「自由入力」。sameAs があれば先頭に「担当者と同じ」（現場責任者の欄だけ）。
 * - 候補を選ぶ → その人の氏名・電話を欄に入れる（入ったあとも手で直せる）
 * - 「担当者と同じ」→ 担当者の氏名・連絡先をそのとき写すだけ（あとで担当者を変えても追いかけない）
 * - 「自由入力」→ 氏名・電話を空にして、手で入れてもらう
 * 表示は氏名・電話の今の値から決める（候補と同じなら候補。どれとも合わなければ「自由入力」）。
 * 「自由入力」「担当者と同じ」を選んだことは覚えておき、値がそのままの間はその表示を続ける。
 */
function ContactPresetSelect({
    contacts,
    value,
    sameAs,
    hint,
    onPick,
}: {
    contacts: RoadPermitContactPreset[];
    value: { name: string; phone: string };
    /** 「担当者と同じ」の元（現場責任者の欄だけ渡す）。無ければその選択肢を出さない */
    sameAs?: { name: string; phone: string };
    hint?: React.ReactNode;
    onPick: (next: { name: string; phone: string }) => void;
}) {
    const [choice, setChoice] = useState<PresetChoice>('auto');
    const matchIndex = contactPresetIndexOf(contacts, value);
    const sameAvailable = !!sameAs && !isContactBlank(sameAs);
    const equalsSameAs =
        sameAvailable && sameAs!.name.trim() === value.name.trim() && sameAs!.phone.trim() === value.phone.trim();

    let selected: string;
    if (choice === 'same' && equalsSameAs) selected = 'same';
    else if (choice === 'free' && matchIndex < 0) selected = 'free';
    else if (matchIndex >= 0) selected = String(matchIndex);
    else if (equalsSameAs) selected = 'same';
    else selected = 'free';

    const handleChange = (v: string) => {
        if (v === 'free') {
            setChoice('free');
            onPick({ name: '', phone: '' });
            return;
        }
        if (v === 'same') {
            if (!sameAs) return;
            setChoice('same');
            onPick({ name: sameAs.name, phone: sameAs.phone });
            return;
        }
        const c = contacts[Number(v)];
        if (!c) return;
        setChoice('auto');
        onPick({ name: c.name, phone: c.phone });
    };

    return (
        <Field label="選ぶ" hint={hint}>
            <select value={selected} onChange={(e) => handleChange(e.target.value)} className={`${inputBase} bg-white`}>
                {sameAs && (
                    <option value="same" disabled={!sameAvailable}>
                        担当者と同じ{sameAvailable ? '' : '（担当者が空です）'}
                    </option>
                )}
                {contacts.map((c, i) => (
                    <option key={`${i}-${c.name}-${c.phone}`} value={String(i)}>
                        {c.name || c.phone}
                    </option>
                ))}
                <option value="free">自由入力</option>
            </select>
        </Field>
    );
}

// ---------------------------------------------------------------------------
// 基本タブ
// ---------------------------------------------------------------------------

function BasicTab({
    form,
    company,
    contacts,
    setTitle,
    updateGroup,
    updateDoc,
    onRefillApplicant,
}: {
    form: EditorForm;
    company: RoadPermitCompanyDefaults | null;
    contacts: RoadPermitContactPreset[];
    setTitle: (v: string) => void;
    updateGroup: UpdateGroup;
    updateDoc: UpdateDoc;
    onRefillApplicant: () => void;
}) {
    const { values, documents } = form;
    const { applicant, contact, siteManager, site, period, road } = values;
    return (
        <>
            <Section title="名前">
                <TextInput value={form.title} onChange={setTitle} placeholder="例: ○○様邸 足場設置" />
            </Section>

            <Section title="出す様式">
                <div className="space-y-2">
                    {ROAD_PERMIT_FORMS.map((def) => {
                        const entry = documents.forms.find((d) => d.formId === def.id);
                        const checked = !!entry?.enabled;
                        return (
                            <label
                                key={def.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 ${
                                    checked ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white hover:bg-teal-100'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={!entry}
                                    onChange={(e) => updateDoc(def.id, { enabled: e.target.checked })}
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                />
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-slate-800">
                                        {def.name}
                                        <span className="ml-2 text-xs font-normal text-slate-500">（{def.authority}）</span>
                                    </span>
                                    <span className="block text-xs text-slate-500">{def.description}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
            </Section>

            <Section
                title="申請者"
                aside={
                    company ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onRefillApplicant}
                            leftIcon={<RefreshCw className="h-4 w-4" />}
                        >
                            自社情報から入れ直す
                        </Button>
                    ) : null
                }
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="郵便番号">
                        <TextInput
                            value={applicant.postalCode}
                            inputMode="numeric"
                            onChange={(v) => updateGroup('applicant', { postalCode: v })}
                        />
                    </Field>
                    <Field label="電話">
                        <TextInput type="tel" value={applicant.tel} onChange={(v) => updateGroup('applicant', { tel: v })} />
                    </Field>
                    <Field label="住所" className="sm:col-span-2">
                        <TextInput value={applicant.address} onChange={(v) => updateGroup('applicant', { address: v })} />
                    </Field>
                    <Field label="会社名" className="sm:col-span-2">
                        <TextInput value={applicant.companyName} onChange={(v) => updateGroup('applicant', { companyName: v })} />
                    </Field>
                    <Field label="代表者の肩書">
                        <TextInput
                            value={applicant.representativeTitle}
                            placeholder="例: 代表取締役"
                            onChange={(v) => updateGroup('applicant', { representativeTitle: v })}
                        />
                    </Field>
                    <Field label="代表者の氏名">
                        <TextInput
                            value={applicant.representativeName}
                            onChange={(v) => updateGroup('applicant', { representativeName: v })}
                        />
                    </Field>
                </div>
            </Section>

            <Section title="担当者">
                {contacts.length > 0 && (
                    <div className="mb-3">
                        <ContactPresetSelect
                            contacts={contacts}
                            value={contact}
                            hint="候補を選ぶと氏名・連絡先に入ります。入ったあとも手で直せます（候補は一覧の「担当者の候補」で登録）"
                            onPick={(next) => updateGroup('contact', next)}
                        />
                    </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="氏名">
                        <TextInput value={contact.name} onChange={(v) => updateGroup('contact', { name: v })} />
                    </Field>
                    <Field label="連絡先">
                        <TextInput type="tel" value={contact.phone} onChange={(v) => updateGroup('contact', { phone: v })} />
                    </Field>
                </div>
            </Section>

            <Section title="現場責任者（警察）">
                {contacts.length > 0 && (
                    <div className="mb-3">
                        <ContactPresetSelect
                            contacts={contacts}
                            value={siteManager}
                            sameAs={contact}
                            hint="「担当者と同じ」はそのとき写すだけです（あとで担当者を変えても追いかけません）。住所は手で直せます"
                            onPick={(next) => updateGroup('siteManager', next)}
                        />
                    </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="住所" className="sm:col-span-2">
                        <TextInput value={siteManager.address} onChange={(v) => updateGroup('siteManager', { address: v })} />
                    </Field>
                    <Field label="氏名">
                        <TextInput value={siteManager.name} onChange={(v) => updateGroup('siteManager', { name: v })} />
                    </Field>
                    <Field label="電話">
                        <TextInput type="tel" value={siteManager.phone} onChange={(v) => updateGroup('siteManager', { phone: v })} />
                    </Field>
                </div>
            </Section>

            <Section title="現場">
                <div className="grid grid-cols-1 gap-3">
                    <Field label="案件名">
                        <TextInput value={site.projectName} readOnly />
                    </Field>
                    <Field label="場所（地番まで）">
                        <TextInput value={site.location} onChange={(v) => updateGroup('site', { location: v })} />
                    </Field>
                </div>
            </Section>

            <PeriodSection period={period} updateGroup={updateGroup} />

            <Section title="道路">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="路線名" className="sm:col-span-2">
                        <TextInput
                            value={road.routeName}
                            placeholder="例: 南北66号線"
                            onChange={(v) => updateGroup('road', { routeName: v })}
                        />
                    </Field>
                    <div className="text-sm">
                        <span className="mb-1 block font-medium text-slate-700">車道・歩道</span>
                        <ChoiceButtons
                            allowEmpty
                            value={road.part}
                            onChange={(v) => updateGroup('road', { part: v })}
                            options={[
                                { value: 'roadway', label: '車道' },
                                { value: 'sidewalk', label: '歩道' },
                                { value: 'other', label: 'その他' },
                            ]}
                        />
                    </div>
                    <div className="text-sm">
                        <span className="mb-1 block font-medium text-slate-700">舗装</span>
                        <ChoiceButtons
                            allowEmpty
                            value={road.surface}
                            onChange={(v) => updateGroup('road', { surface: v })}
                            options={[
                                { value: 'paved', label: '舗装道' },
                                { value: 'gravel', label: '砂利道' },
                            ]}
                        />
                    </div>
                    <Field label="住宅地図のページ" hint="PDF では「P.（　）」の中に入ります">
                        <TextInput value={road.mapPage} onChange={(v) => updateGroup('road', { mapPage: v })} />
                    </Field>
                </div>
            </Section>
        </>
    );
}

/** 期間（工事期間・占用（使用）期間・時間・日数） */
function PeriodSection({ period, updateGroup }: { period: RoadPermitValues['period']; updateGroup: UpdateGroup }) {
    // 日数を手で直す欄を開いているか（手で直した数が入っていれば開いた状態で始める）
    const [manualOpen, setManualOpen] = useState(period.dayCount != null);
    const autoDays = countDaysInclusive(period.useFrom, period.useTo);

    return (
        <Section title="期間">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="工事期間 から">
                    <TextInput type="date" value={period.workFrom} onChange={(v) => updateGroup('period', { workFrom: v })} />
                </Field>
                <Field label="工事期間 まで">
                    <TextInput type="date" value={period.workTo} onChange={(v) => updateGroup('period', { workTo: v })} />
                </Field>
                <Field label="占用（使用）期間 から">
                    <TextInput type="date" value={period.useFrom} onChange={(v) => updateGroup('period', { useFrom: v })} />
                </Field>
                <Field label="占用（使用）期間 まで">
                    <TextInput type="date" value={period.useTo} onChange={(v) => updateGroup('period', { useTo: v })} />
                </Field>
                <Field label="時間 から">
                    <TextInput type="time" value={period.timeFrom} onChange={(v) => updateGroup('period', { timeFrom: v })} />
                </Field>
                <Field label="時間 まで">
                    <TextInput type="time" value={period.timeTo} onChange={(v) => updateGroup('period', { timeTo: v })} />
                </Field>
                <div className="text-sm sm:col-span-2">
                    <span className="mb-1 block font-medium text-slate-700">占用（使用）の日数</span>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-600">
                            自動: {autoDays != null ? `${autoDays}日間` : '（期間を入れると出ます）'}
                        </span>
                        {manualOpen ? (
                            <>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={period.dayCount == null ? '' : String(period.dayCount)}
                                    placeholder={autoDays != null ? String(autoDays) : ''}
                                    onChange={(e) => {
                                        const parsed = parseDayCountInput(e.target.value);
                                        // 数として読めない文字は受け付けない（空に戻すと自動）
                                        if (parsed === undefined) return;
                                        updateGroup('period', { dayCount: parsed });
                                    }}
                                    className={`${inputBase} w-24`}
                                />
                                <span className="text-slate-600">日間</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        updateGroup('period', { dayCount: null });
                                        setManualOpen(false);
                                    }}
                                    className="text-xs text-teal-700 underline hover:text-teal-800"
                                >
                                    自動に戻す
                                </button>
                            </>
                        ) : (
                            <Button type="button" variant="outline" size="sm" onClick={() => setManualOpen(true)}>
                                手で直す
                            </Button>
                        )}
                    </div>
                    <span className="mt-1 block text-xs text-slate-500">初日と最後の日を含めて数えます。空にすると自動に戻ります。</span>
                </div>
            </div>
        </Section>
    );
}

// ---------------------------------------------------------------------------
// 申請書タブ
// ---------------------------------------------------------------------------

function FormsTab({
    values,
    drawing,
    symbols,
    hasPolice,
    hasMatsuyama,
    updateGroup,
    goBasic,
}: {
    values: RoadPermitValues;
    /** 図面（「方法又は形態」に置いた記号の名前を入れるため） */
    drawing: RoadPermitDrawing | null;
    /** 記号の一覧（null＝読み込み中） */
    symbols: RoadPermitSymbolDto[] | null;
    hasPolice: boolean;
    hasMatsuyama: boolean;
    updateGroup: UpdateGroup;
    goBasic: () => void;
}) {
    if (!hasPolice && !hasMatsuyama) {
        return (
            <div className={`${sectionBox} space-y-3 text-center`}>
                <p className="text-sm text-slate-600">基本タブで出す様式を選んでください</p>
                <Button type="button" variant="outline" size="sm" onClick={goBasic}>
                    基本タブへ
                </Button>
            </div>
        );
    }
    const { police, matsuyama, occupancy } = values;
    const autoArea = approxAreaOf(occupancy.quantity);

    // 「方法又は形態」に図面に置いた記号の名前（「パイロン・コーンバー設置」。数は書かない＝凡例に出る）を入れる
    const fillMethodFromDrawing = () => {
        if (symbols === null) {
            toast.error('記号を読み込み中です。少し待ってからもう一度押してください');
            return;
        }
        const text = drawing ? symbolMethodText(countSymbols(drawing.entities, toSymbolMap(symbols), drawing.layers)) : '';
        if (!text) {
            toast.error('図面に数える記号がありません');
            return;
        }
        if (police.method.trim() !== '' && !window.confirm('今の文を置きかえます。よろしいですか？\n\n' + text)) return;
        updateGroup('police', { method: text });
    };

    return (
        <>
            {hasPolice && (
                <Section title="警察（道路使用許可申請書）">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="申請日" hint="空のときは「令和　年　月　日」と空けて印刷します">
                            <TextInput
                                type="date"
                                value={police.applicationDate}
                                onChange={(v) => updateGroup('police', { applicationDate: v })}
                            />
                        </Field>
                        <Field label="宛先の警察署名" hint="「殿」は付けずに入れてください（PDF で付けます）">
                            <TextInput
                                value={police.stationName}
                                placeholder="例: 松山東警察署長"
                                onChange={(v) => updateGroup('police', { stationName: v })}
                            />
                        </Field>
                        <Field label="道路使用の目的" className="sm:col-span-2">
                            <TextArea value={police.purpose} onChange={(v) => updateGroup('police', { purpose: v })} />
                        </Field>
                        <Field label="場所又は区間" className="sm:col-span-2">
                            <TextArea value={police.section} onChange={(v) => updateGroup('police', { section: v })} />
                        </Field>
                        {/* 見出しの横にボタンを置くので Field（label で包む）は使わない（ボタンが label の操作先にならないように） */}
                        <div className="block text-sm sm:col-span-2">
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-slate-700">方法又は形態</span>
                                <Button type="button" variant="outline" size="sm" onClick={fillMethodFromDrawing}>
                                    図面から入れる
                                </Button>
                            </div>
                            <TextArea value={police.method} rows={3} onChange={(v) => updateGroup('police', { method: v })} />
                            <span className="mt-1 block text-xs text-slate-500">
                                「図面から入れる」で、図面に置いた記号の名前（例: パイロン・コーンバー設置）を入れます。数は図面の凡例に出ます
                            </span>
                        </div>
                        <Field label="添付書類" className="sm:col-span-2">
                            <TextArea value={police.attachments} onChange={(v) => updateGroup('police', { attachments: v })} />
                        </Field>
                        <Field label="許可証の条件欄の文言" hint="警察が書く許可証の「条件」欄に印字します" className="sm:col-span-2">
                            <TextInput value={police.conditionText} onChange={(v) => updateGroup('police', { conditionText: v })} />
                        </Field>
                    </div>
                </Section>
            )}

            {hasMatsuyama && (
                <>
                    <Section title="松山市（道路占用）">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="申請日" hint="空のときは「令和　年　月　日」と空けて印刷します">
                                <TextInput
                                    type="date"
                                    value={matsuyama.applicationDate}
                                    onChange={(v) => updateGroup('matsuyama', { applicationDate: v })}
                                />
                            </Field>
                            <Field label="宛名（市長名）">
                                <TextInput value={matsuyama.mayorName} onChange={(v) => updateGroup('matsuyama', { mayorName: v })} />
                            </Field>
                            <div className="space-y-3 text-sm sm:col-span-2">
                                <p className="text-xs text-slate-500">PDF では選んだ方を ○ で囲みます</p>
                                <div className="flex flex-wrap gap-x-6 gap-y-3">
                                    <div>
                                        <span className="mb-1 block font-medium text-slate-700">許可申請・協議</span>
                                        <ChoiceButtons
                                            value={matsuyama.kind}
                                            onChange={(v) => v && updateGroup('matsuyama', { kind: v })}
                                            options={[
                                                { value: 'permit', label: '許可申請' },
                                                { value: 'consult', label: '協議' },
                                            ]}
                                        />
                                    </div>
                                    <div>
                                        <span className="mb-1 block font-medium text-slate-700">新規・変更</span>
                                        <ChoiceButtons
                                            value={matsuyama.newOrChange}
                                            onChange={(v) => v && updateGroup('matsuyama', { newOrChange: v })}
                                            options={[
                                                { value: 'new', label: '新規' },
                                                { value: 'change', label: '変更' },
                                            ]}
                                        />
                                    </div>
                                    <div>
                                        <span className="mb-1 block font-medium text-slate-700">道路法</span>
                                        <ChoiceButtons
                                            value={matsuyama.article}
                                            onChange={(v) => v && updateGroup('matsuyama', { article: v })}
                                            options={[
                                                { value: '32', label: '第32条' },
                                                { value: '35', label: '第35条' },
                                            ]}
                                        />
                                    </div>
                                </div>
                            </div>
                            {matsuyama.newOrChange === 'change' && (
                                <>
                                    <Field label="従前の許可番号">
                                        <TextInput
                                            value={matsuyama.previousPermitNo}
                                            onChange={(v) => updateGroup('matsuyama', { previousPermitNo: v })}
                                        />
                                    </Field>
                                    <Field label="従前の許可の年月日">
                                        <TextInput
                                            type="date"
                                            value={matsuyama.previousPermitDate}
                                            onChange={(v) => updateGroup('matsuyama', { previousPermitDate: v })}
                                        />
                                    </Field>
                                </>
                            )}
                            <Field label="添付書類" className="sm:col-span-2">
                                <TextArea
                                    value={matsuyama.attachments}
                                    rows={3}
                                    onChange={(v) => updateGroup('matsuyama', { attachments: v })}
                                />
                            </Field>
                        </div>
                    </Section>

                    <Section title="占用物件（松山市）">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="占用の目的" className="sm:col-span-2">
                                <TextInput value={occupancy.purpose} onChange={(v) => updateGroup('occupancy', { purpose: v })} />
                            </Field>
                            <Field label="名称">
                                <TextInput value={occupancy.name} onChange={(v) => updateGroup('occupancy', { name: v })} />
                            </Field>
                            <Field label="構造">
                                <TextInput value={occupancy.structure} onChange={(v) => updateGroup('occupancy', { structure: v })} />
                            </Field>
                            <Field
                                label="規模の文言"
                                hint="例: 別紙記入。長さ×幅を書くときは空にして、下の長さ・幅を入れてください"
                                className="sm:col-span-2"
                            >
                                <TextInput value={occupancy.scaleNote} onChange={(v) => updateGroup('occupancy', { scaleNote: v })} />
                            </Field>
                            <Field label="長さ（m）">
                                <TextInput
                                    value={occupancy.length}
                                    inputMode="decimal"
                                    onChange={(v) => updateGroup('occupancy', { length: v })}
                                />
                            </Field>
                            <Field label="幅（m）">
                                <TextInput
                                    value={occupancy.width}
                                    inputMode="decimal"
                                    onChange={(v) => updateGroup('occupancy', { width: v })}
                                />
                            </Field>
                            <Field label="数量（㎡）" hint="入れたとおりに印刷します（例: 0.9486）">
                                <TextInput
                                    value={occupancy.quantity}
                                    inputMode="decimal"
                                    onChange={(v) => updateGroup('occupancy', { quantity: v })}
                                />
                            </Field>
                            <Field
                                label="面積「約○㎡」"
                                hint={`空のときは自動（数量を切り上げ${autoArea ? `＝約${autoArea}㎡` : ''}）。手で直すと、その数を使います`}
                            >
                                <TextInput
                                    value={occupancy.areaApprox ?? ''}
                                    inputMode="decimal"
                                    placeholder={autoArea ? `自動: ${autoArea}` : '自動'}
                                    onChange={(v) => updateGroup('occupancy', { areaApprox: v.trim() === '' ? null : v })}
                                />
                            </Field>
                            <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                                <Field label="掘削 長さ">
                                    <TextInput
                                        value={occupancy.excavationLength}
                                        inputMode="decimal"
                                        onChange={(v) => updateGroup('occupancy', { excavationLength: v })}
                                    />
                                </Field>
                                <Field label="掘削 幅">
                                    <TextInput
                                        value={occupancy.excavationWidth}
                                        inputMode="decimal"
                                        onChange={(v) => updateGroup('occupancy', { excavationWidth: v })}
                                    />
                                </Field>
                                <Field label="掘削 面積">
                                    <TextInput
                                        value={occupancy.excavationArea}
                                        inputMode="decimal"
                                        onChange={(v) => updateGroup('occupancy', { excavationArea: v })}
                                    />
                                </Field>
                            </div>
                            <Field label="工事実施の方法">
                                <TextInput
                                    value={occupancy.constructionMethod}
                                    onChange={(v) => updateGroup('occupancy', { constructionMethod: v })}
                                />
                            </Field>
                            <Field label="道路の復旧方法">
                                <TextInput
                                    value={occupancy.restorationMethod}
                                    onChange={(v) => updateGroup('occupancy', { restorationMethod: v })}
                                />
                            </Field>
                        </div>
                    </Section>
                </>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// 添付・提出タブ
// ---------------------------------------------------------------------------

function SubmitTab({
    form,
    formIds,
    exporting,
    hasDrawing,
    includeDrawing,
    onIncludeDrawing,
    onStatus,
    updateDoc,
    onExportPdf,
}: {
    form: EditorForm;
    formIds: RoadPermitFormId[];
    exporting: boolean;
    /** 図面に図形が 1 つ以上あるか（無ければ「図面も入れる」を出さない） */
    hasDrawing: boolean;
    includeDrawing: boolean;
    onIncludeDrawing: (v: boolean) => void;
    onStatus: (s: RoadPermitStatus) => void;
    updateDoc: UpdateDoc;
    onExportPdf: () => void;
}) {
    // 出す様式だけ、カタログの順に並べる
    const entries = formIds
        .map((id) => form.documents.forms.find((d) => d.formId === id))
        .filter((d): d is RoadPermitDocumentEntry => !!d);

    return (
        <>
            <section className={`${sectionBox} flex flex-wrap items-end justify-between gap-3`}>
                <Field label="状態">
                    <select
                        value={form.status}
                        onChange={(e) => onStatus(e.target.value as RoadPermitStatus)}
                        className={`${inputBase} min-w-[10rem] bg-white`}
                    >
                        {ROAD_PERMIT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {ROAD_PERMIT_STATUS_LABELS[s]}
                            </option>
                        ))}
                    </select>
                </Field>
                <div className="flex flex-col items-end gap-1">
                    {hasDrawing && (
                        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                            <input
                                type="checkbox"
                                checked={includeDrawing}
                                onChange={(e) => onIncludeDrawing(e.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            />
                            図面も入れる
                        </label>
                    )}
                    <Button
                        type="button"
                        variant="primary"
                        onClick={onExportPdf}
                        disabled={formIds.length === 0 || exporting}
                        isLoading={exporting}
                        leftIcon={<FileDown className="h-4 w-4" />}
                    >
                        PDF を出す
                    </Button>
                    <span className="text-xs text-slate-500">
                        {formIds.length === 0 ? '基本タブで出す様式を選ぶと押せます' : '入力中の内容で作ります（保存はされません）'}
                    </span>
                </div>
            </section>

            {entries.length === 0 ? (
                <div className={`${sectionBox} text-center text-sm text-slate-600`}>基本タブで出す様式を選んでください</div>
            ) : (
                entries.map((entry) => {
                    const def = getRoadPermitForm(entry.formId);
                    return (
                        <Section key={entry.formId} title={def.name} aside={<span className="text-xs text-slate-500">申請先: {def.authority}</span>}>
                            <div className="space-y-4">
                                <div>
                                    <span className="mb-1 block text-sm font-medium text-slate-700">添付書類</span>
                                    {entry.attachmentChecks.length === 0 ? (
                                        <p className="text-xs text-slate-500">この様式に決まった添付書類はありません</p>
                                    ) : (
                                        <ul className="space-y-1">
                                            {entry.attachmentChecks.map((c, i) => (
                                                <li key={`${c.label}-${i}`}>
                                                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                                        <input
                                                            type="checkbox"
                                                            checked={c.done}
                                                            onChange={(e) =>
                                                                updateDoc(entry.formId, {
                                                                    attachmentChecks: entry.attachmentChecks.map((x, j) =>
                                                                        j === i ? { ...x, done: e.target.checked } : x,
                                                                    ),
                                                                })
                                                            }
                                                            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                                        />
                                                        <span className={c.done ? 'text-slate-400 line-through' : ''}>{c.label}</span>
                                                    </label>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <Field label="提出日">
                                        <TextInput
                                            type="date"
                                            value={entry.submittedDate}
                                            onChange={(v) => updateDoc(entry.formId, { submittedDate: v })}
                                        />
                                    </Field>
                                    <Field label="許可日">
                                        <TextInput
                                            type="date"
                                            value={entry.permittedDate}
                                            onChange={(v) => updateDoc(entry.formId, { permittedDate: v })}
                                        />
                                    </Field>
                                    <Field label="許可番号">
                                        <TextInput value={entry.permitNo} onChange={(v) => updateDoc(entry.formId, { permitNo: v })} />
                                    </Field>
                                    <Field label="許可期限">
                                        <TextInput
                                            type="date"
                                            value={entry.expiryDate}
                                            onChange={(v) => updateDoc(entry.formId, { expiryDate: v })}
                                        />
                                    </Field>
                                </div>
                            </div>
                        </Section>
                    );
                })
            )}
        </>
    );
}
