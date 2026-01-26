export interface BankAccount {
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
}

export interface CompanyInfo {
    id: string;
    name: string;
    postalCode: string;
    address: string;
    tel: string;
    fax?: string;
    email?: string;
    representative: string;
    sealImage?: string;
    licenseNumber?: string;      // 建設業許可番号
    registrationNumber?: string; // インボイス登録番号
    bankAccounts?: BankAccount[];
    createdAt: Date;
    updatedAt: Date;
}

export interface CompanyInfoInput {
    name: string;
    postalCode: string;
    address: string;
    tel: string;
    fax?: string;
    email?: string;
    representative: string;
    sealImage?: string;
    licenseNumber?: string;
    registrationNumber?: string;
    bankAccounts?: BankAccount[];
}
