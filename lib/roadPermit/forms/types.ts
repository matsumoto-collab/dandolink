import type { RoadPermitFormId } from '@/types/roadPermit';

/**
 * 様式（書類）のカタログの 1 件。
 * Phase 4 で様式を足すときは、lib/roadPermit/forms/ に 1 ファイル足して index.ts の一覧に並べるだけにする。
 * PDF の部品は components/pdf/roadPermit/ に様式ごとに 1 ファイル。
 */
export interface RoadPermitFormDef {
    id: RoadPermitFormId;
    /** 書類の名前（例: 道路使用許可申請書） */
    name: string;
    /** 申請先（例: 松山東警察署） */
    authority: string;
    /** 申請先の短い表記（一覧の「申請先」列。例: 松山東署） */
    authorityShort: string;
    /** どのまとまりの欄を使うか（police = values.police、matsuyama = values.matsuyama） */
    group: 'police' | 'matsuyama';
    /** 宛名の初期値（警察署名・市長名）。画面で直せる */
    defaultRecipient: string;
    /** 添付書類の欄の文言の初期値 */
    defaultAttachments: string;
    /** 添付書類のチェックリスト（「添付・提出」タブ） */
    attachmentChecklist: readonly string[];
    /** 一覧・PDF の並び順 */
    sortOrder: number;
    /** 画面に出す補足 */
    description: string;
}
