import type { RoadPermitFormDef } from './types';

/**
 * ① 道路使用許可申請書（警察・別記様式第六・第十条関係）。
 * 全国共通の様式。宛先の署名だけ変わる（初期値は松山東警察署長・画面で直せる）。
 * 原本: docs/road-permit/forms/【松山警察署】道路使用許可警察署.doc（コミットしない）
 */
export const policeRoadUseForm: RoadPermitFormDef = {
    id: 'police-road-use',
    name: '道路使用許可申請書',
    authority: '松山東警察署',
    authorityShort: '松山東署',
    group: 'police',
    defaultRecipient: '松山東警察署長',
    defaultAttachments: '位置図・現地写真・平面図（保安図）',
    attachmentChecklist: ['位置図', '現地写真', '平面図（保安図）'],
    sortOrder: 10,
    description: '警察署へ出す。上半分が申請、下半分は警察が書く許可証の欄（空欄のまま印刷）',
};
