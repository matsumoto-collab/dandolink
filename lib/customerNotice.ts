/**
 * 顧客への連絡（LINE）に関する純粋ヘルパー。
 * - 工事種別名から「節目（組立/解体）」を判定（補助用途）
 * - 顧客向けの開始/完了メッセージ文面を生成
 */

export type Milestone = 'assembly' | 'demolition';

export interface MilestoneInfo {
    milestone: Milestone;
    label: string; // 組立 / 解体
}

/**
 * 工事種別の「名前」から節目を判定する。組立/解体 以外は null。
 * （顧客通知の対象判定には使わず、写真カテゴリ等の補助用途で利用）
 */
export function milestoneFromConstructionTypeName(name?: string | null): MilestoneInfo | null {
    if (!name) return null;
    if (name.includes('組立')) return { milestone: 'assembly', label: '組立' };
    if (name.includes('解体')) return { milestone: 'demolition', label: '解体' };
    return null;
}

/**
 * 顧客向けメッセージに使う作業ラベル。
 * 組立/解体はそのまま、それ以外（常用・その他・未設定）は汎用の「作業」。
 */
export function workLabelFromConstructionTypeName(name?: string | null): string {
    if (name?.includes('組立')) return '組立作業';
    if (name?.includes('解体')) return '解体作業';
    return '作業';
}

export type NoticePhase = 'start' | 'complete';

export interface BuildCustomerMessageArgs {
    phase: NoticePhase;
    companyName?: string | null;
    siteTitle: string; // 例: 佐藤様邸（仮設工事）
    workLabel: string; // 例: 組立作業 / 解体作業 / 作業
    withPhotos?: boolean; // 完了時に写真添付の一文を入れるか
}

/**
 * 顧客向けの連絡文面（編集可能なたたき台）。
 * 社内メモや職方名などの内部情報は一切含めない。
 */
export function buildCustomerMessage({
    phase,
    companyName,
    siteTitle,
    workLabel,
    withPhotos = false,
}: BuildCustomerMessageArgs): string {
    const company = (companyName && companyName.trim()) || '弊社';
    if (phase === 'start') {
        return [
            `${company}です。いつもお世話になっております。`,
            `本日、${siteTitle}の${workLabel}を開始いたしました。`,
            '作業完了後に改めてご連絡いたします。',
            '本日もどうぞよろしくお願いいたします。',
        ].join('\n');
    }
    const lines = [
        `${company}です。いつもお世話になっております。`,
        `本日、${siteTitle}の${workLabel}が完了いたしました。`,
    ];
    if (withPhotos) lines.push('写真を添付いたしますのでご確認ください。');
    lines.push('ご不明な点がございましたらお気軽にご連絡ください。');
    return lines.join('\n');
}
