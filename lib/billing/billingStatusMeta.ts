/**
 * 請求ステータス（'none'|'unbilled'|'partial'|'full'）の表示メタ。
 * 案件一覧の「請求」セルと請求待ちボードの案件行バッジで文言・配色を共有する。
 */
import type { BillingStatus } from '@/lib/billing/billingStatus';

export interface BillingStatusMeta {
    /** 案件一覧セルの短い表記（—/未/一部/済）。 */
    short: string;
    /** バッジ・メニューで使う文言（契約未設定/未請求/一部請求/請求済）。 */
    label: string;
    /** ツールチップ。 */
    title: string;
    /** 案件一覧セル（ボタン）の配色。 */
    cellClassName: string;
    /** ボード行バッジ（丸ピル）の配色。 */
    badgeClassName: string;
    showCheck: boolean;
}

export const BILLING_STATUS_META: Record<BillingStatus, BillingStatusMeta> = {
    none: {
        short: '—',
        label: '契約未設定',
        title: '契約金額・見積なし（判定の基準額が決まりません）',
        cellClassName: 'bg-white text-slate-300 border border-slate-200',
        badgeClassName: 'bg-slate-100 text-slate-500',
        showCheck: false,
    },
    unbilled: {
        short: '未',
        label: '未請求',
        title: '未請求（クリックで請求書を作成）',
        cellClassName: 'bg-white text-slate-400 border border-slate-200 hover:border-slate-400 hover:text-slate-600',
        badgeClassName: 'bg-slate-100 text-slate-600',
        showCheck: false,
    },
    partial: {
        short: '一部',
        label: '一部請求',
        title: '一部請求済（クリックで請求書を確認・追加）',
        cellClassName: 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200',
        badgeClassName: 'bg-amber-100 text-amber-700',
        showCheck: false,
    },
    full: {
        short: '済',
        label: '請求済',
        title: '全額請求済（クリックで請求書を確認）',
        cellClassName: 'bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700 shadow-sm',
        badgeClassName: 'bg-emerald-100 text-emerald-700',
        showCheck: true,
    },
};

/** 手動上書きに指定できる値（自動判定に戻す＝null）。 */
export const BILLING_OVERRIDE_CHOICES: Array<{ value: 'unbilled' | 'partial' | 'full'; label: string }> = [
    { value: 'unbilled', label: '未請求' },
    { value: 'partial', label: '一部請求' },
    { value: 'full', label: '請求済' },
];
