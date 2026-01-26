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
    representativeTitle?: string; // 肩書
    representative: string;       // 氏名
    sealImage?: string;           // 会社印（Base64）
    licenseNumber?: string;
    registrationNumber?: string;
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
    representativeTitle?: string;
    representative: string;
    sealImage?: string;
    licenseNumber?: string;
    registrationNumber?: string;
    bankAccounts?: BankAccount[];
}
