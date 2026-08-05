// 銀行入金明細（現金出納帳ページ内の「銀行入金明細」タブ）の型。API レスポンスに対応。
// AI読み取りはせず、対象年月・任意メモつきのファイル置き場として持つだけ。

export interface BankStatement {
    id: string;
    /** 対象年月（'YYYY-MM'）。一覧はこの値で降順にグルーピングする */
    targetMonth: string;
    memo: string | null;
    fileName: string;
    mimeType: string;
    fileSize: number;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    createdAt: string;
}
