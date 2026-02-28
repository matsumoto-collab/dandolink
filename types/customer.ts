// 担当者情報
export interface ContactPerson {
    id: string;
    name: string;
    email?: string;
    phone?: string;
}

// 顧客の型定義
export interface Customer {
    id: string;
    name: string;              // 会社名
    shortName?: string;        // 略称
    honorific: string;         // 敬称（御中/様）
    contactPersons: ContactPerson[]; // 担当者（複数）
    email?: string;            // 代表メールアドレス
    phone?: string;            // 代表電話番号
    fax?: string;              // FAX番号
    address?: string;          // 住所
    notes?: string;            // 備考
    createdAt: Date;
    updatedAt: Date;
}

// 顧客作成時の入力データ
export type CustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>;
