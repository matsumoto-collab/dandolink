'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, Loader2, FileText, Image as ImageIcon, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Download, CheckCircle2, XCircle, Trash2, Plus, X, Search } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { CashbookEntry, CashbookListResponse } from '@/types/cashbook';
import type { ExpenseCategoryRef } from '@/types/receipt';
import { sortCashbookEntries, cashbookDisplayDate, cashbookSortKey } from '@/lib/cashbookSort';
import BankStatementsTab from '@/components/Cashbook/BankStatementsTab';

const TABS = [
    { id: 'ledger', label: '出納帳' },
    { id: 'bank', label: '銀行入金明細' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Vercel のリクエストボディ上限（約4.5MB）。圧縮後の画像・PDF がこれを超えたら送信前に弾く。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// 残高はマイナスになり得るため符号を前に出して表示する
const yen = (n: number) => (n < 0 ? `-¥${Math.abs(n).toLocaleString()}` : `¥${n.toLocaleString()}`);
const fmtDate = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
// ローカル(JST)の 'YYYY-MM-DD'（date input と同じ書式）
const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// 検索用の正規化（全半角・かな種別・空白のゆれを吸収）
const normSearch = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

type UploadStatus = 'compressing' | 'uploading' | 'done' | 'error';
interface UploadRow { name: string; status: UploadStatus; message?: string }

// クライアント側の前処理。画像は圧縮（失敗時は原本）、PDFは無加工。上限超過はエラーで返す。
async function prepareFile(file: File): Promise<{ blob: Blob; name: string } | { error: string }> {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);

    if (isPdf) {
        if (file.size > MAX_UPLOAD_BYTES) return { error: 'PDFは4MB以下にしてください' };
        return { blob: file, name: file.name };
    }
    if (isImg) {
        let blob: Blob = file;
        if (file.size > 1024 * 1024) {
            try {
                blob = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 2000, useWebWorker: true, initialQuality: 0.8 });
            } catch {
                blob = file; // HEIC 等で圧縮に失敗したら原本を送る（サーバの sharp が変換）
            }
        }
        if (blob.size > MAX_UPLOAD_BYTES) return { error: '画像が大きすぎます（4MB以下にしてください）' };
        return { blob, name: file.name };
    }
    return { error: '対応していないファイル形式です（画像・PDF）' };
}

export default function CashbookPage() {
    // 「銀行入金明細」はメニューを増やさずこのページ内のタブとして持つ（権限は canAccessCashbook を共用）
    const [activeTab, setActiveTab] = useState<TabId>('ledger');
    const [entries, setEntries] = useState<CashbookEntry[]>([]);
    const [openingBalance, setOpeningBalance] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<CashbookEntry | null>(null);
    const [categories, setCategories] = useState<ExpenseCategoryRef[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);

    const today = new Date();
    const [scope, setScope] = useState<'month' | 'all'>('month');
    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    // 読み込み済みの表示範囲（月/全期間）。スピナーへの差し替えは「未読み込みの範囲を開いた時」だけにし、
    // 同一範囲の再取得（行追加・削除・精算日変更など）ではテーブルを出したままにする
    // （スピナーに差し替えるとコンテンツ高が潰れ、スクロールがページ先頭に戻ってしまうため）
    const [loadedRangeKey, setLoadedRangeKey] = useState<string | null>(null);
    // 「精算日として登録」に使う日付（既定=今日・固定なので同じ日付を続けて使える）。未精算バッジのタップで各行に適用
    const [settleDate, setSettleDate] = useState(() => toYmd(new Date()));
    // 精算方法（現金/振込）。振込精算は現金が動いていないため現金残高の計算から除外される
    const [settleMethod, setSettleMethod] = useState<'cash' | 'transfer'>('cash');

    // 検索・絞り込み（ロード済みの行をクライアント側で絞る）
    const [searchText, setSearchText] = useState('');
    const [filterApplicant, setFilterApplicant] = useState('');
    const [filterCategoryId, setFilterCategoryId] = useState('');
    const [filterSettleStatus, setFilterSettleStatus] = useState<'' | 'settled' | 'unsettled' | 'settled_cash' | 'settled_transfer'>('');
    const [filterSettledOn, setFilterSettledOn] = useState('');
    const hasActiveFilters = Boolean(searchText.trim() || filterApplicant || filterCategoryId || filterSettleStatus || filterSettledOn);
    const clearFilters = () => {
        setSearchText('');
        setFilterApplicant('');
        setFilterCategoryId('');
        setFilterSettleStatus('');
        setFilterSettledOn('');
    };

    const fetchEntries = useCallback(async () => {
        const rangeKey = scope === 'all' ? 'all' : `${year}-${month}`;
        setIsLoading(true);
        try {
            const url = scope === 'all' ? '/api/cashbook?scope=all' : `/api/cashbook?scope=month&year=${year}&month=${month}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
                const data: CashbookListResponse = await res.json();
                setEntries(data.entries);
                setOpeningBalance(Number(data.openingBalance || 0));
            } else {
                setEntries([]);
                setOpeningBalance(0);
            }
        } catch (e) {
            logger.error('Failed to fetch cashbook:', e);
            setEntries([]);
            setOpeningBalance(0);
        } finally {
            setLoadedRangeKey(rangeKey);
            setIsLoading(false);
        }
    }, [scope, year, month]);

    useEffect(() => {
        fetchEntries();
    }, [fetchEntries]);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/master-data/expense-categories');
                if (res.ok) setCategories(await res.json());
            } catch (e) {
                logger.error('category fetch failed', e);
            }
        })();
    }, []);

    const goPrev = () => {
        if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
    };
    const goNext = () => {
        if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
    };
    const goToday = () => {
        const t = new Date();
        setYear(t.getFullYear());
        setMonth(t.getMonth() + 1);
    };

    // 行追加の既定日付: 表示中の月が今月なら今日、過去/未来の月ならその月の1日
    const defaultDateForNew = () => {
        const t = new Date();
        if (scope === 'all' || (t.getFullYear() === year && t.getMonth() + 1 === month)) return toYmd(t);
        return `${year}-${String(month).padStart(2, '0')}-01`;
    };

    const addRow = async (entryType: 'in' | 'out') => {
        try {
            const res = await fetch('/api/cashbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: defaultDateForNew(), entryType }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            await fetchEntries();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '行の追加に失敗しました');
        }
    };

    // セル編集のオートセーブ。成功したら該当行だけ差し替え、日付が表示月の外に出たときは再取得する。
    const applyPatch = async (id: string, patch: Record<string, unknown>) => {
        setSavingId(id);
        try {
            const res = await fetch(`/api/cashbook/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            const updated: CashbookEntry = await res.json();
            // 表示月の判定は清算日優先（settledAt ?? date）。日付・清算日の変更で月外に出たら再取得して行を外す
            if (scope === 'month' && ('date' in patch || 'settledAt' in patch)) {
                const displayYmd = updated.settledAt ?? updated.date;
                const d = new Date(displayYmd);
                if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month) {
                    toast.success(`${fmtDate(displayYmd)} へ移動しました（表示中の月の外）`);
                    await fetchEntries();
                    return;
                }
            }
            setEntries((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '保存に失敗しました');
            setEntries((prev) => [...prev]); // 入力セルを保存済みの値に戻すための再レンダー
        } finally {
            setSavingId(null);
        }
    };

    const deleteRow = async (entry: CashbookEntry) => {
        const label = `${fmtDate(entry.date)} ${entry.description ?? ''} ${yen(Number(entry.amount || 0))}`.trim();
        if (!confirm(`この行を削除しますか？\n${label}`)) return;
        setSavingId(entry.id);
        try {
            const res = await fetch(`/api/cashbook/${entry.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.error);
            }
            toast.success('削除しました');
            await fetchEntries();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : '削除に失敗しました');
        } finally {
            setSavingId(null);
        }
    };

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const arr = Array.from(files);
        setUploading(true);
        setUploadRows(arr.map((f) => ({ name: f.name, status: 'compressing' as UploadStatus })));

        const updateRow = (i: number, patch: Partial<UploadRow>) => setUploadRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

        let ok = 0;
        let cursor = 0;
        // 並列度2のワーカープール（抽出込みで1件5〜15秒かかるため）
        const worker = async () => {
            for (;;) {
                const i = cursor++;
                if (i >= arr.length) return;
                const file = arr[i];
                updateRow(i, { status: 'compressing' });
                const prepared = await prepareFile(file);
                if ('error' in prepared) {
                    updateRow(i, { status: 'error', message: prepared.error });
                    continue;
                }
                updateRow(i, { status: 'uploading' });
                try {
                    const fd = new FormData();
                    fd.append('file', prepared.blob, prepared.name);
                    const res = await fetch('/api/cashbook/upload', { method: 'POST', body: fd });
                    if (res.ok) {
                        // 1枚の画像から複数の領収書が分割されることがある（返り値は作成された出金行の配列）
                        const data = await res.json().catch(() => null);
                        const n = Array.isArray(data) ? data.length : 1;
                        ok += n;
                        updateRow(i, { status: 'done', message: n > 1 ? `${n}件を認識` : undefined });
                    } else {
                        const e = await res.json().catch(() => ({}));
                        updateRow(i, { status: 'error', message: e.error || '取り込みに失敗しました' });
                    }
                } catch {
                    updateRow(i, { status: 'error', message: '取り込みに失敗しました' });
                }
            }
        };
        await Promise.all([worker(), worker()]);

        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        if (ok > 0) {
            toast.success(`${ok}件の出金行を作成しました`);
            fetchEntries();
        }
    };

    // 表示順は清算日優先（settledAt ?? date）→手動並び順（sortOrder ?? seq）→seq。
    // API も同じ順で返すが、セル編集後の行差し替えでも正しい位置に並ぶようクライアントでも常にソートする。
    const sortedEntries = useMemo(() => sortCashbookEntries(entries), [entries]);

    // 差引残高つきの表示行（表示順どおりに累計）。
    // 振込精算の行は現金が動いていないため累計に含めず、残高セルは「—」（balance=null）にする
    const rowsWithBalance = useMemo(() => {
        let bal = scope === 'month' ? openingBalance : 0;
        return sortedEntries.map((entry) => {
            if (entry.settleMethod === 'transfer') {
                return { entry, balance: null as number | null };
            }
            const amt = Number(entry.amount || 0);
            bal += entry.entryType === 'in' ? amt : -amt;
            return { entry, balance: bal as number | null };
        });
    }, [sortedEntries, openingBalance, scope]);

    // 絞り込み後の表示行。差引残高は全行ベースの正しい値を保持したまま行だけ絞る
    // （絞り込んだ行だけで累計すると残高が意味を持たなくなるため）
    const filteredRows = useMemo(() => {
        if (!hasActiveFilters) return rowsWithBalance;
        const q = normSearch(searchText);
        return rowsWithBalance.filter(({ entry }) => {
            if (q) {
                const hay = normSearch(`${entry.description ?? ''} ${entry.applicantName ?? ''} ${entry.expenseCategory?.name ?? ''}`);
                if (!hay.includes(q)) return false;
            }
            if (filterApplicant && (entry.applicantName ?? '') !== filterApplicant) return false;
            if (filterCategoryId && entry.expenseCategoryId !== filterCategoryId) return false;
            if (filterSettleStatus === 'settled' && !entry.settledAt) return false;
            if (filterSettleStatus === 'unsettled' && entry.settledAt) return false;
            if (filterSettleStatus === 'settled_cash' && !(entry.settledAt && entry.settleMethod !== 'transfer')) return false;
            if (filterSettleStatus === 'settled_transfer' && !(entry.settledAt && entry.settleMethod === 'transfer')) return false;
            if (filterSettledOn && (entry.settledAt ? entry.settledAt.slice(0, 10) : '') !== filterSettledOn) return false;
            return true;
        });
    }, [rowsWithBalance, hasActiveFilters, searchText, filterApplicant, filterCategoryId, filterSettleStatus, filterSettledOn]);

    // 氏名フィルタの選択肢（ロード済みの行から重複なしで生成）
    const applicantOptions = useMemo(() => {
        const set = new Set<string>();
        for (const e of entries) if (e.applicantName) set.add(e.applicantName);
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
    }, [entries]);

    // 行の上下移動（同じ表示日の中のみ）。移動先は隣接行との中間値を sortOrder に設定する。
    // 並びの隣接判定は全行リストで行う（絞り込み表示中は移動ボタン自体を無効化している）
    const moveRow = (entryId: string, dir: -1 | 1) => {
        const index = sortedEntries.findIndex((e) => e.id === entryId);
        if (index < 0) return;
        const row = sortedEntries[index];
        const neighbor = sortedEntries[index + dir];
        if (!row || !neighbor) return;
        if (cashbookDisplayDate(neighbor) !== cashbookDisplayDate(row)) return;
        const beyond = sortedEntries[index + dir * 2];
        const nKey = cashbookSortKey(neighbor);
        const sameGroupBeyond = beyond && cashbookDisplayDate(beyond) === cashbookDisplayDate(row);
        const newOrder = sameGroupBeyond ? (nKey + cashbookSortKey(beyond)) / 2 : nKey + dir;
        applyPatch(row.id, { sortOrder: newOrder });
    };

    const totalIn = useMemo(() => entries.reduce((s, e) => s + (e.entryType === 'in' ? Number(e.amount || 0) : 0), 0), [entries]);
    const totalOut = useMemo(() => entries.reduce((s, e) => s + (e.entryType === 'out' ? Number(e.amount || 0) : 0), 0), [entries]);
    // 振込精算分（現金残高の計算外）。残高は現金で動いた分だけで計算する
    const totalInTransfer = useMemo(() => entries.reduce((s, e) => s + (e.entryType === 'in' && e.settleMethod === 'transfer' ? Number(e.amount || 0) : 0), 0), [entries]);
    const totalOutTransfer = useMemo(() => entries.reduce((s, e) => s + (e.entryType === 'out' && e.settleMethod === 'transfer' ? Number(e.amount || 0) : 0), 0), [entries]);
    const closingBalance = (scope === 'month' ? openingBalance : 0) + (totalIn - totalInTransfer) - (totalOut - totalOutTransfer);
    // 絞り込み中の合計（表示中の行だけを合算）
    const filteredTotalIn = useMemo(() => filteredRows.reduce((s, { entry }) => s + (entry.entryType === 'in' ? Number(entry.amount || 0) : 0), 0), [filteredRows]);
    const filteredTotalOut = useMemo(() => filteredRows.reduce((s, { entry }) => s + (entry.entryType === 'out' ? Number(entry.amount || 0) : 0), 0), [filteredRows]);
    const filteredTotalOutTransfer = useMemo(() => filteredRows.reduce((s, { entry }) => s + (entry.entryType === 'out' && entry.settleMethod === 'transfer' ? Number(entry.amount || 0) : 0), 0), [filteredRows]);

    const exportCsv = () => {
        const header = ['日付', '費目', '摘要', '氏名', '入金額', '出金額', '差引残高', '清算日', '精算方法'];
        const rows: string[][] = [];
        // 絞り込み中は表示中の行だけを出力（前月繰越行は全行表示のときのみ意味を持つ）
        if (scope === 'month' && !hasActiveFilters) {
            rows.push(['', '', '前月繰越', '', '', '', String(openingBalance), '', '']);
        }
        for (const { entry, balance } of filteredRows) {
            rows.push([
                fmtDate(entry.date),
                entry.expenseCategory?.name ?? '',
                entry.description ?? '',
                entry.applicantName ?? '',
                entry.entryType === 'in' ? String(Number(entry.amount || 0)) : '',
                entry.entryType === 'out' ? String(Number(entry.amount || 0)) : '',
                balance == null ? '' : String(balance),
                entry.settledAt ? fmtDate(entry.settledAt) : '',
                entry.settledAt ? (entry.settleMethod === 'transfer' ? '振込' : '現金') : '',
            ]);
        }
        const csv = '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = scope === 'all' ? '現金出納帳_全期間.csv' : `現金出納帳_${year}-${String(month).padStart(2, '0')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="h-full flex flex-col max-w-[1500px] mx-auto w-full min-w-0">
            <div className="shrink-0 mb-4">
                <h2 className="text-xl font-bold text-slate-900">現金出納帳</h2>
                <p className="text-sm text-slate-500 mt-1">
                    {activeTab === 'ledger'
                        ? '入金・出金を記帳して残高を管理します。出金は領収書（画像・PDF）の取り込みでも作成できます。'
                        : '銀行の入金明細（画像・PDF・CSV）を対象年月ごとに保管します。'}
                </p>
            </div>

            {/* タブ */}
            <div className="shrink-0 flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-full sm:w-fit">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {activeTab === 'ledger' && (<>
            {/* アップロードゾーン（出金行の作成） */}
            <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                className={`shrink-0 mb-4 rounded-xl border-2 border-dashed p-4 sm:p-6 text-center transition-colors ${dragOver ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50'}`}
            >
                <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-1">領収書（画像・PDF）を取り込むと、AIが読み取って出金行を自動で作成します</p>
                <p className="text-xs text-slate-400 mb-3">日付・金額・摘要・費目は取り込み後にそのまま表で修正できます。</p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2">
                    {/* スマホでは撮影を主ボタンに（基本はスマホで撮影するため） */}
                    <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={uploading}
                        className="sm:hidden w-full px-4 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
                        {uploading ? '取り込み中…' : '写真を撮影'}
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="w-full sm:w-auto px-4 py-3 sm:py-2.5 rounded-xl transition-colors font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 sm:bg-teal-600 sm:text-white sm:border-transparent sm:hover:bg-teal-700"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? '取り込み中…' : 'ファイルを選択'}
                    </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            </div>

            {/* アップロード進捗 */}
            {uploadRows.length > 0 && (
                <div className="shrink-0 mb-4 rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">取り込み状況</span>
                        {!uploading && (
                            <button onClick={() => setUploadRows([])} className="text-xs text-slate-400 hover:text-slate-600">閉じる</button>
                        )}
                    </div>
                    <div className="space-y-1 max-h-40 overflow-auto">
                        {uploadRows.map((r, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                                {r.status === 'done' ? (
                                    <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                                ) : r.status === 'error' ? (
                                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                ) : (
                                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />
                                )}
                                <span className="truncate text-slate-700">{r.name}</span>
                                <span className={`ml-auto shrink-0 text-xs ${r.status === 'error' ? 'text-red-500' : 'text-slate-400'}`}>
                                    {r.status === 'compressing' ? '準備中…' : r.status === 'uploading' ? 'AI読み取り中…' : r.status === 'done' ? (r.message ?? '完了') : r.message}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ツールバー: 表示範囲＋行追加＋CSV */}
            <div className="shrink-0 mb-4 flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm shrink-0">
                    <button onClick={() => setScope('month')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${scope === 'month' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>月別</button>
                    <button onClick={() => setScope('all')} className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${scope === 'all' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>全期間</button>
                </div>
                {scope === 'month' ? (
                    <div className="flex items-center gap-2">
                        <button onClick={goPrev} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="前月"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
                        <div className="min-w-[110px] px-1 text-center text-base sm:text-lg font-semibold text-slate-800 whitespace-nowrap">{year}年{month}月</div>
                        <button onClick={goNext} className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm hover:bg-slate-50" title="翌月"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
                        <button onClick={goToday} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">今月</button>
                    </div>
                ) : (
                    <span className="text-sm text-slate-500">すべての期間を表示中</span>
                )}
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
                    <button onClick={() => addRow('in')} className="flex-1 sm:flex-none justify-center rounded-xl bg-teal-600 text-white px-3 py-2 text-sm font-medium hover:bg-teal-700 inline-flex items-center gap-1.5">
                        <Plus className="w-4 h-4" />入金行を追加
                    </button>
                    <button onClick={() => addRow('out')} className="flex-1 sm:flex-none justify-center rounded-xl bg-teal-600 text-white px-3 py-2 text-sm font-medium hover:bg-teal-700 inline-flex items-center gap-1.5">
                        <Plus className="w-4 h-4" />出金行を追加
                    </button>
                    <button onClick={exportCsv} disabled={entries.length === 0} className="w-full sm:w-auto justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 inline-flex items-center gap-1.5 disabled:opacity-50">
                        <Download className="w-4 h-4" />CSV出力
                    </button>
                </div>
            </div>

            {/* 精算日として登録＋検索。テーブル内スクロール方式になったため常に画面内に見える（sticky不要） */}
            <div className="shrink-0 mb-2 flex flex-wrap items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 shadow-sm">
                    <span className="text-xs font-semibold text-emerald-800 whitespace-nowrap">精算日として登録</span>
                    <input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    <button type="button" onClick={() => setSettleDate(toYmd(new Date()))} className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100">今日</button>
                    {/* 精算方法（現金/振込）。振込は現金残高の計算に入らない */}
                    <div className="inline-flex rounded-lg border border-emerald-200 bg-white p-0.5">
                        <button
                            type="button"
                            onClick={() => setSettleMethod('cash')}
                            className={`px-2 py-1 text-xs rounded-md transition-colors ${settleMethod === 'cash' ? 'bg-emerald-600 text-white' : 'text-emerald-700 hover:bg-emerald-50'}`}
                            title="現金で精算（残高に反映）"
                        >
                            現金
                        </button>
                        <button
                            type="button"
                            onClick={() => setSettleMethod('transfer')}
                            className={`px-2 py-1 text-xs rounded-md transition-colors ${settleMethod === 'transfer' ? 'bg-blue-600 text-white' : 'text-blue-700 hover:bg-blue-50'}`}
                            title="振込で精算（現金残高には入れない）"
                        >
                            振込
                        </button>
                    </div>
                </div>
                {/* 検索・絞り込み */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm flex-1 min-w-0">
                    <div className="relative flex-1 min-w-[9rem]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            placeholder="摘要・氏名・費目で検索"
                            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </div>
                    <select
                        value={filterApplicant}
                        onChange={(e) => setFilterApplicant(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        aria-label="氏名で絞り込み"
                    >
                        <option value="">氏名：すべて</option>
                        {applicantOptions.map((name) => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                    <select
                        value={filterCategoryId}
                        onChange={(e) => setFilterCategoryId(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        aria-label="費目で絞り込み"
                    >
                        <option value="">費目：すべて</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <select
                        value={filterSettleStatus}
                        onChange={(e) => setFilterSettleStatus(e.target.value as '' | 'settled' | 'unsettled')}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                        aria-label="精算状態で絞り込み"
                    >
                        <option value="">精算：すべて</option>
                        <option value="unsettled">未精算</option>
                        <option value="settled">精算済み</option>
                        <option value="settled_cash">現金精算</option>
                        <option value="settled_transfer">振込精算</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
                        精算日
                        <input
                            type="date"
                            value={filterSettledOn}
                            onChange={(e) => setFilterSettledOn(e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
                            aria-label="精算日で絞り込み"
                        />
                    </label>
                    {hasActiveFilters && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                        >
                            <X className="w-3.5 h-3.5" />クリア（{filteredRows.length}件表示中）
                        </button>
                    )}
                </div>
            </div>
            <p className="shrink-0 mb-3 px-1 text-xs text-emerald-700/80">行の「未精算」をタップすると、選択中の方法（現金/振込）とこの日付で精算されます。清算日を入れた行はその月のページに移り、残高も清算日の順で計算されます。振込精算は現金が動かないため差引残高には入りません（行のバッジで現金⇄振込を切替できます）。</p>

            {/* 帳簿テーブル（テーブル内スクロール方式: ヘッダーと合計行は常に見える）。
                スピナーは未読み込みの範囲を開いた時のみ。同一範囲の再取得中は
                テーブルを出したままにしてスクロール位置を保つ */}
            {isLoading && loadedRangeKey !== (scope === 'all' ? 'all' : `${year}-${month}`) ? (
                <div className="flex-1 min-h-[280px] flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
            ) : (
                <div className="flex-1 min-h-[280px] flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="flex-1 overflow-auto">
                        <table className="min-w-[1200px] w-full divide-y divide-slate-200">
                            <thead className="bg-slate-100 sticky top-0 z-10">
                                <tr>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[136px]">日付</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[130px]">費目</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700">摘要</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[110px]">氏名</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[112px]">入金額</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[112px]">出金額</th>
                                    <th className="px-3 py-3 text-right text-xs font-bold text-slate-700 w-[124px]">差引残高</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-700 w-[200px]">清算日</th>
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-700 w-[56px]">証憑</th>
                                    <th className="px-1 py-3 w-[60px]"><span className="sr-only">並び替え</span></th>
                                    <th className="px-1 py-3 w-[44px]"><span className="sr-only">削除</span></th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-100">
                                {scope === 'month' && !hasActiveFilters && (
                                    <tr className="bg-slate-50">
                                        <td className="px-3 py-2.5 text-sm text-slate-500 whitespace-nowrap">—</td>
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5 text-sm font-medium text-slate-600">前月繰越</td>
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5" />
                                        <td className={`px-3 py-2.5 text-right text-sm font-semibold whitespace-nowrap ${openingBalance < 0 ? 'text-red-600' : 'text-slate-700'}`}>{yen(openingBalance)}</td>
                                        <td className="px-3 py-2.5" />
                                        <td className="px-3 py-2.5" />
                                        <td className="px-1 py-2.5" />
                                        <td className="px-1 py-2.5" />
                                    </tr>
                                )}
                                {filteredRows.length === 0 && (
                                    <tr>
                                        <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                                            <FileText className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                                            {hasActiveFilters
                                                ? '絞り込み条件に一致する記帳がありません。条件を変えるか「クリア」してください。'
                                                : <>{scope === 'month' ? 'この月の記帳はまだありません。' : 'まだ記帳がありません。'}「入金行を追加」または領収書の取り込みから始めてください。</>}
                                        </td>
                                    </tr>
                                )}
                                {filteredRows.map(({ entry, balance }, i) => (
                                    <CashbookRow
                                        key={entry.id}
                                        entry={entry}
                                        balance={balance}
                                        categories={categories}
                                        saving={savingId === entry.id}
                                        canMoveUp={!hasActiveFilters && i > 0 && cashbookDisplayDate(filteredRows[i - 1].entry) === cashbookDisplayDate(entry)}
                                        canMoveDown={!hasActiveFilters && i < filteredRows.length - 1 && cashbookDisplayDate(filteredRows[i + 1].entry) === cashbookDisplayDate(entry)}
                                        onMoveUp={() => moveRow(entry.id, -1)}
                                        onMoveDown={() => moveRow(entry.id, 1)}
                                        onSettle={() => applyPatch(entry.id, { settledAt: settleDate, settleMethod })}
                                        onPatch={(patch) => applyPatch(entry.id, patch)}
                                        onDelete={() => deleteRow(entry)}
                                        onOpenImage={() => setLightbox(entry)}
                                    />
                                ))}
                            </tbody>
                            {filteredRows.length > 0 && (
                                <tfoot>
                                    {/* 合計行はテーブル下端に固定（スクロールせず常に見える）。
                                        border はsticky時に追従しないため inset shadow で線を引く */}
                                    <tr className="[&>td]:sticky [&>td]:bottom-0 [&>td]:bg-slate-50 [&>td]:shadow-[inset_0_2px_0_0_#e2e8f0]">
                                        <td colSpan={4} className="px-3 py-3 text-right text-sm font-semibold text-slate-600">
                                            {hasActiveFilters ? `絞り込み合計（${filteredRows.length}件）` : scope === 'month' ? `${month}月合計` : '合計'}
                                        </td>
                                        <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">{yen(hasActiveFilters ? filteredTotalIn : totalIn)}</td>
                                        <td className="px-3 py-3 text-right whitespace-nowrap">
                                            <div className="text-sm font-bold text-slate-900">{yen(hasActiveFilters ? filteredTotalOut : totalOut)}</div>
                                            {(hasActiveFilters ? filteredTotalOutTransfer : totalOutTransfer) > 0 && (
                                                <div className="text-[11px] text-blue-600" title="振込精算分は現金残高の計算に入りません">
                                                    うち振込 {yen(hasActiveFilters ? filteredTotalOutTransfer : totalOutTransfer)}
                                                </div>
                                            )}
                                        </td>
                                        {hasActiveFilters ? (
                                            <td className="px-3 py-3 text-right text-sm text-slate-400 whitespace-nowrap" title="差引残高は絞り込みなしの全行で計算されます">—</td>
                                        ) : (
                                            <td className={`px-3 py-3 text-right text-sm font-bold whitespace-nowrap ${closingBalance < 0 ? 'text-red-600' : 'text-slate-900'}`}>{yen(closingBalance)}</td>
                                        )}
                                        <td colSpan={4} />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            )}
            </>)}

            {activeTab === 'bank' && <BankStatementsTab />}

            {/* 証憑画像のライトボックス */}
            {lightbox?.signedUrl && (
                <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
                    <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="閉じる">
                        <X className="w-6 h-6" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox.signedUrl} alt={lightbox.fileName ?? '証憑'} className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </div>
    );
}

// 1行分。セルの blur / 選択でそのまま保存する（行単位オートセーブ）。
function CashbookRow({ entry, balance, categories, saving, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onSettle, onPatch, onDelete, onOpenImage }: {
    entry: CashbookEntry;
    /** 差引残高。null=振込精算（現金が動いていないため残高に影響しない） */
    balance: number | null;
    categories: ExpenseCategoryRef[];
    saving: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onSettle: () => void;
    onPatch: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onOpenImage: () => void;
}) {
    const amount = Number(entry.amount || 0);
    const dateYmd = entry.date.slice(0, 10);
    const settledYmd = entry.settledAt ? entry.settledAt.slice(0, 10) : null;
    const isPdf = entry.mimeType === 'application/pdf' || entry.sourceType === 'pdf';

    return (
        <tr className={`hover:bg-slate-50 ${saving ? 'opacity-60' : ''}`}>
            {/* 日付 */}
            <td className="px-2 py-1.5 whitespace-nowrap">
                <input
                    type="date"
                    key={`d-${entry.id}-${dateYmd}`}
                    defaultValue={dateYmd}
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value;
                        if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== dateYmd) onPatch({ date: v });
                        else if (!v) e.target.value = dateYmd; // 空にされたら元へ戻す
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 費目 */}
            <td className="px-2 py-1.5">
                <select
                    value={entry.expenseCategoryId ?? ''}
                    disabled={saving}
                    onChange={(e) => onPatch({ expenseCategoryId: e.target.value || null })}
                    className="w-full rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-700 bg-transparent focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                    <option value="">—</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </td>
            {/* 摘要 */}
            <td className="px-2 py-1.5">
                <input
                    type="text"
                    key={`t-${entry.id}-${entry.description ?? ''}`}
                    defaultValue={entry.description ?? ''}
                    placeholder="摘要を入力"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (entry.description ?? '')) onPatch({ description: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full min-w-[180px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-800 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 氏名（申請者） */}
            <td className="px-2 py-1.5">
                <input
                    type="text"
                    key={`a-${entry.id}-${entry.applicantName ?? ''}`}
                    defaultValue={entry.applicantName ?? ''}
                    placeholder="氏名"
                    disabled={saving}
                    onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (entry.applicantName ?? '')) onPatch({ applicantName: v });
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className="w-full min-w-[90px] rounded-lg border border-transparent hover:border-slate-200 px-2 py-1.5 text-sm text-slate-800 bg-transparent placeholder:text-slate-300 focus:bg-white focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            </td>
            {/* 入金額 / 出金額（反対側に入力すると行の向きごと移す） */}
            <AmountCell
                active={entry.entryType === 'in'}
                amount={amount}
                saving={saving}
                onCommit={(n) => onPatch(entry.entryType === 'in' ? { amount: n } : { entryType: 'in', amount: n })}
            />
            <AmountCell
                active={entry.entryType === 'out'}
                amount={amount}
                saving={saving}
                onCommit={(n) => onPatch(entry.entryType === 'out' ? { amount: n } : { entryType: 'out', amount: n })}
            />
            {/* 差引残高（振込精算の行は現金が動いていないため「—」） */}
            {balance == null ? (
                <td className="px-3 py-1.5 text-right text-sm text-slate-300 whitespace-nowrap" title="振込精算のため現金残高に影響しません">—</td>
            ) : (
                <td className={`px-3 py-1.5 text-right text-sm font-semibold whitespace-nowrap ${balance < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                    {yen(balance)}
                </td>
            )}
            {/* 清算日（実際に現金が動いた日）。未精算バッジのタップで「精算日として登録」の日付を適用 */}
            <td className="px-2 py-1.5">
                {settledYmd ? (
                    <div className="flex items-center gap-0.5">
                        <input
                            type="date"
                            key={`s-${entry.id}-${settledYmd}`}
                            defaultValue={settledYmd}
                            disabled={saving}
                            onBlur={(e) => {
                                const v = e.target.value;
                                if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== settledYmd) onPatch({ settledAt: v });
                                else if (!v) e.target.value = settledYmd; // 空にされたら元へ戻す（クリアは×ボタンで）
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            className="w-full rounded-lg border border-transparent hover:border-emerald-200 px-1.5 py-1.5 text-sm text-emerald-800 bg-transparent focus:bg-white focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {/* 精算方法バッジ（タップで現金⇄振込を切替。振込は現金残高の計算外） */}
                        <button
                            onClick={() => onPatch({ settleMethod: entry.settleMethod === 'transfer' ? 'cash' : 'transfer' })}
                            disabled={saving}
                            title={entry.settleMethod === 'transfer' ? '振込精算（現金残高に影響しません）。タップで現金精算に切替' : '現金精算。タップで振込精算に切替'}
                            className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                                entry.settleMethod === 'transfer'
                                    ? 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                                    : 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200'
                            }`}
                        >
                            {entry.settleMethod === 'transfer' ? '振込' : '現金'}
                        </button>
                        <button
                            onClick={() => onPatch({ settledAt: null })}
                            disabled={saving}
                            title="清算日を消す（未精算に戻す）"
                            className="shrink-0 px-1 text-slate-300 hover:text-slate-600"
                        >
                            ✕
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={onSettle}
                        disabled={saving}
                        title="タップで「精算日として登録」の日付を清算日に入れる"
                        className="w-full px-2 py-1 text-xs font-semibold rounded-full border bg-slate-100 text-slate-600 border-slate-200 hover:bg-emerald-100 hover:text-emerald-700 hover:border-emerald-200 transition-colors"
                    >
                        未精算
                    </button>
                )}
            </td>
            {/* 証憑 */}
            <td className="px-2 py-1.5 text-center">
                {!entry.fileName ? (
                    <span className="text-slate-300 text-sm">—</span>
                ) : isPdf ? (
                    entry.signedUrl ? (
                        <a href={entry.signedUrl} target="_blank" rel="noreferrer" title={entry.fileName} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                            <FileText className="w-4 h-4" />
                        </a>
                    ) : (
                        <FileText className="w-4 h-4 text-slate-300 inline-block" />
                    )
                ) : (
                    <button onClick={onOpenImage} title={entry.fileName ?? undefined} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 overflow-hidden hover:ring-2 hover:ring-teal-400">
                        {entry.thumbnailSignedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={entry.thumbnailSignedUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                            <ImageIcon className="w-4 h-4 text-slate-400" />
                        )}
                    </button>
                )}
            </td>
            {/* 並び替え（同じ表示日の中のみ↑↓で移動・差引残高もその順で再計算） */}
            <td className="px-1 py-1.5 text-center whitespace-nowrap">
                <button
                    onClick={onMoveUp}
                    disabled={saving || !canMoveUp}
                    title={canMoveUp ? '上へ移動' : undefined}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                >
                    <ChevronUp className="w-4 h-4" />
                </button>
                <button
                    onClick={onMoveDown}
                    disabled={saving || !canMoveDown}
                    title={canMoveDown ? '下へ移動' : undefined}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            </td>
            {/* 削除 */}
            <td className="px-1 py-1.5 text-center">
                {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400 inline-block" />
                ) : (
                    <button onClick={onDelete} title="この行を削除" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </td>
        </tr>
    );
}

// 金額セル。クリックで編集し、blur / Enter で確定（Escape で破棄）。
// active=false（反対側）のセルに入力すると、onCommit 側で entryType ごと入れ替える。
function AmountCell({ active, amount, saving, onCommit }: {
    active: boolean;
    amount: number;
    saving: boolean;
    onCommit: (n: number) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');

    const start = () => {
        if (saving) return;
        setDraft(active && amount !== 0 ? String(amount) : '');
        setEditing(true);
    };
    const commit = () => {
        setEditing(false);
        const cleaned = draft.replace(/[^\d]/g, '');
        if (cleaned === '') return; // 空のまま抜けたら変更なし
        const n = Number(cleaned);
        if (!Number.isFinite(n) || n < 0) return;
        if (active && n === amount) return;
        onCommit(n);
    };

    return (
        <td className="px-2 py-1.5 text-right">
            {editing ? (
                <input
                    autoFocus
                    type="text"
                    inputMode="numeric"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') { setDraft(''); setEditing(false); }
                    }}
                    className="w-full rounded-lg border border-teal-400 bg-white px-2 py-1.5 text-sm text-right text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
            ) : (
                <button
                    onClick={start}
                    disabled={saving}
                    className={`w-full min-h-[34px] rounded-lg px-2 py-1.5 text-sm text-right hover:bg-slate-100 ${active ? 'font-semibold text-slate-900' : 'text-slate-300'}`}
                >
                    {active ? `¥${amount.toLocaleString()}` : ''}
                </button>
            )}
        </td>
    );
}
