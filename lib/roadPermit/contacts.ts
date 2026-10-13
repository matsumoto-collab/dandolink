/**
 * 道路申請の「担当者の候補」（RoadPermitSetting.contacts・docs/指示書_道路申請_担当者の選択と住所.md §3.1）。
 * 純粋関数だけ（DB は読まない）。サーバーからも画面からも使う。
 *
 * - normalizeRoadPermitContacts … DB の JSON → 型どおりの並び（前後の空白を取る・名前も電話も空の行は落とす・上限まで）
 * - contactPresetIndexOf        … 氏名・電話が候補のどれと同じか（画面の「選ぶ」欄の表示に使う）
 * - isContactBlank              … 氏名も電話も空か（既定値の組み立てで「前回が空」を判定する）
 */
import type { RoadPermitContactPreset } from '@/types/roadPermit';

/** 候補の上限（画面の行数と API の入力チェックで同じ数を使う） */
export const ROAD_PERMIT_CONTACTS_MAX = 20;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 氏名も電話も空（空白だけ）か */
export function isContactBlank(value: { name: string; phone: string }): boolean {
    return value.name.trim() === '' && value.phone.trim() === '';
}

/**
 * DB の JSON（RoadPermitSetting.contacts）→ 候補の並び。
 * 配列でなければ空。要素は { name, phone } の形に直し、名前も電話も空の行は落とす。並び順は保つ。
 */
export function normalizeRoadPermitContacts(raw: unknown): RoadPermitContactPreset[] {
    if (!Array.isArray(raw)) return [];
    const out: RoadPermitContactPreset[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const name = str(o.name);
        const phone = str(o.phone);
        if (name === '' && phone === '') continue;
        out.push({ name, phone });
        if (out.length >= ROAD_PERMIT_CONTACTS_MAX) break;
    }
    return out;
}

/**
 * 氏名・電話（前後の空白を除いて）が候補のどれかと同じなら、その番号（0 始まり）。無ければ -1。
 * 氏名も電話も空なら、候補に空の行は無いので -1。
 */
export function contactPresetIndexOf(contacts: readonly RoadPermitContactPreset[], value: { name: string; phone: string }): number {
    const name = value.name.trim();
    const phone = value.phone.trim();
    if (name === '' && phone === '') return -1;
    return contacts.findIndex((c) => c.name === name && c.phone === phone);
}
