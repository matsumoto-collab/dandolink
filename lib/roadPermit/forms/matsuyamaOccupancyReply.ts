import type { RoadPermitFormDef } from './types';
import { MATSUYAMA_ATTACHMENTS_TEXT, MATSUYAMA_ATTACHMENT_CHECKLIST, MATSUYAMA_MAYOR_DEFAULT } from './matsuyamaOccupancyApply';

/**
 * ③ 道路占用 許可書／回答書（松山市・受け取り用）。
 * ② と同じ値を原本の配置で入れる。下の「第　号／令和　年　月　日／許可する／道路管理者 松山市長」は市が書く欄
 * （番号は空けて印刷する。§14-1）。
 * 原本: docs/road-permit/forms/【松山市役所】道路占用許可表紙　受け取り.doc（コミットしない）
 */
export const matsuyamaOccupancyReplyForm: RoadPermitFormDef = {
    id: 'matsuyama-occupancy-reply',
    name: '道路占用 許可書／回答書',
    authority: '松山市',
    authorityShort: '松山市',
    group: 'matsuyama',
    defaultRecipient: MATSUYAMA_MAYOR_DEFAULT,
    defaultAttachments: MATSUYAMA_ATTACHMENTS_TEXT,
    attachmentChecklist: MATSUYAMA_ATTACHMENT_CHECKLIST,
    sortOrder: 30,
    description: '松山市から受け取る用の表紙。提出用と同じ内容で、下に市が書く許可の欄がある',
};
