/**
 * 「協力業者由来の人/班」を判定する統一ヘルパー。
 *
 * 実運用には複数の登録パターンが混在する:
 *   - 協力会社のメンバー: role='partner_member', companyId=代表ユーザーID
 *   - 協力会社の代表者:   role='partner',        companyId=null（自分自身が会社）
 *   - 自社 role + 協力会社所属（ハイブリッド）: role='worker' 等, companyId 持ち
 *
 * Phase 6c で `isPartner = !!companyId` 単独判定だと代表者を取りこぼすことが
 * 判明したため、この 3 パターンをまとめて扱うヘルパーを用意した。
 */

export interface PartnerInfo {
    isPartner: boolean;
    role: string | null;
}

/**
 * 当該ユーザーが「協力業者由来」かを判定。
 * - companyId 紐づきあり (isPartner=true)
 * - role が 'partner' または 'partner_member'（大文字も許容）
 * のいずれかなら true。
 */
export function isPartnerEntity(info: PartnerInfo | null | undefined): boolean {
    if (!info) return false;
    if (info.isPartner) return true;
    const role = info.role?.toLowerCase();
    return role === 'partner' || role === 'partner_member';
}

/**
 * 表示用の「協力会社名」を返す。
 * - companyDisplayName があればそれ（partner_member 系: 親会社の表示名）
 * - role==='partner' の代表者ユーザーは自分自身が会社なので displayName を使う
 * - それ以外は空文字
 */
export function getPartnerCompanyName(
    info: { displayName: string; companyDisplayName: string | null; role: string | null } | null | undefined,
): string {
    if (!info) return '';
    if (info.companyDisplayName) return info.companyDisplayName;
    if (info.role?.toLowerCase() === 'partner') return info.displayName;
    return '';
}
