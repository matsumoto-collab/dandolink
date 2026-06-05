/**
 * 顧客への完了連絡（LINE）に関する純粋ヘルパー。
 * - 工事種別名から「節目（組立/解体）」を判定
 * - 顧客向けの完了メッセージ文面を生成
 */

export type Milestone = 'assembly' | 'demolition';

export interface MilestoneInfo {
    milestone: Milestone;
    label: string; // 組立 / 解体
}

/**
 * 工事種別の「名前」から節目を判定する。
 * ConstructionType の id→name 解決は呼び出し側（DBアクセス可能な場所）で行い、ここには name を渡す。
 * 組立/解体 以外（常用・その他・未設定）は null（＝顧客通知の対象外）。
 */
export function milestoneFromConstructionTypeName(name?: string | null): MilestoneInfo | null {
    if (!name) return null;
    if (name.includes('組立')) return { milestone: 'assembly', label: '組立' };
    if (name.includes('解体')) return { milestone: 'demolition', label: '解体' };
    return null;
}

export interface BuildCompletionMessageArgs {
    companyName?: string | null;
    siteTitle: string; // 例: 佐藤様邸（仮設工事）
    milestoneLabel: string; // 組立 / 解体
    withPhotos?: boolean; // 写真を添付するか（文面に「写真を添付」を含めるか）
}

/**
 * 顧客向けの完了連絡 文面（編集可能なたたき台）。
 * 社内メモや職方名などの内部情報は一切含めない。
 */
export function buildCompletionMessage({
    companyName,
    siteTitle,
    milestoneLabel,
    withPhotos = true,
}: BuildCompletionMessageArgs): string {
    const company = (companyName && companyName.trim()) || '弊社';
    const lines = [
        `${company}です。いつもお世話になっております。`,
        `本日、${siteTitle}の${milestoneLabel}作業が完了いたしました。`,
    ];
    if (withPhotos) lines.push('写真を添付いたしますのでご確認ください。');
    lines.push('ご不明な点がございましたらお気軽にご連絡ください。');
    return lines.join('\n');
}
