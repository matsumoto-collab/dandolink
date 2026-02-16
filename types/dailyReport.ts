// 日報関連の型定義

export interface DailyReportWorkItem {
    id?: string;
    dailyReportId?: string;
    assignmentId: string;
    startTime?: string | null;  // 作業開始時間 (例: "08:00")
    endTime?: string | null;    // 作業終了時間 (例: "17:00")
    // 表示用（APIから取得時）
    assignment?: {
        id: string;
        date: Date;
        projectMaster?: {
            id: string;
            title: string;
            customerName?: string;
        };
    };
}

export interface DailyReport {
    id: string;
    foremanId: string;
    date: Date;
    morningLoadingMinutes: number;  // 朝積込（分）
    eveningLoadingMinutes: number;  // 夕積込（分）
    earlyStartMinutes: number;      // 早出（分）- 保留
    overtimeMinutes: number;        // 残業（分）- 保留
    notes?: string;
    workItems: DailyReportWorkItem[];
    createdAt: Date;
    updatedAt: Date;
}

export interface DailyReportInput {
    foremanId: string;
    date: string | Date;
    morningLoadingMinutes?: number;
    eveningLoadingMinutes?: number;
    earlyStartMinutes?: number;
    overtimeMinutes?: number;
    notes?: string;
    workItems: {
        assignmentId: string;
        startTime?: string;
        endTime?: string;
    }[];
}
