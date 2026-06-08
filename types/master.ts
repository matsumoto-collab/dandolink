import { ConstructionTypeMaster } from '@/types/calendar';

export interface Vehicle {
    id: string;
    name: string;
    dailyRate?: number | null; // 1日あたりの車両費（円）。未設定は null
}

export interface Manager {
    id: string;
    name: string;
}

export interface MemberCountHistoryEntry {
    id: string;
    startDate: string; // ISO date string
    count: number;
}

export interface MasterData {
    vehicles: Vehicle[];
    managers: Manager[];
    constructionTypes: ConstructionTypeMaster[];
    totalMembers: number;
    memberCountHistory: MemberCountHistoryEntry[];
}
