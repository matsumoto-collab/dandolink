import type { RoadPermitFormDef } from './types';

/** 松山市の添付書類の欄の文言（提出用・受け取り用で共通） */
export const MATSUYAMA_ATTACHMENTS_TEXT =
    'ア.警察署長の道路使用許可書の写　イ.位置図・平面図・断面図・立面図・外　ウ.着工前写真';

/**
 * 添付書類のチェックリスト（「添付・提出」タブ）。新しく作る申請から出る。
 * 既にある申請のチェックリストは保存してある並びのまま（normalizeRoadPermitDocuments）なので、ここに足しても変わらない。
 * 四国ガスの協議: 松山市の許可 3 件とも許可の数日前に四国ガスの「協議済」印があった（雄伸工業が持って行く。2026-10-14）
 */
export const MATSUYAMA_ATTACHMENT_CHECKLIST = [
    'ア. 警察署長の道路使用許可書の写',
    'イ. 位置図',
    'イ. 平面図',
    'イ. 断面図',
    'イ. 立面図',
    'ウ. 着工前写真',
    '四国ガスの協議（協議済の印をもらう）',
] as const;

/** 宛名（道路管理者）の初期値。市長が変わったら画面で直す（§14-3） */
export const MATSUYAMA_MAYOR_DEFAULT = '松山市長　野志　克仁';

/**
 * ② 道路占用 許可申請書／協議書（松山市・提出用）。
 * 原本: docs/road-permit/forms/【松山市役所】道路占用許可表紙　提出.doc（コミットしない）
 */
export const matsuyamaOccupancyApplyForm: RoadPermitFormDef = {
    id: 'matsuyama-occupancy-apply',
    name: '道路占用 許可申請書／協議書',
    authority: '松山市',
    authorityShort: '松山市',
    group: 'matsuyama',
    defaultRecipient: MATSUYAMA_MAYOR_DEFAULT,
    defaultAttachments: MATSUYAMA_ATTACHMENTS_TEXT,
    attachmentChecklist: MATSUYAMA_ATTACHMENT_CHECKLIST,
    sortOrder: 20,
    description: '松山市へ出す表紙（提出用）。下水道サービス課・河川水路課・公営企業局の検認欄つき',
};
