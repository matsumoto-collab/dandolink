export interface VacationData {
    dateKey: string;           // 日付キー (YYYY-MM-DD)
    employeeIds: string[];     // 休暇中の職人IDリスト
    remarks: string;           // フリーテキスト備考
}

export interface VacationRecord {
    [dateKey: string]: {
        employeeIds: string[];
        remarks: string;
    };
}
