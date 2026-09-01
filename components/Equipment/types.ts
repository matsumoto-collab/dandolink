/** 機材台帳（車両・電動工具）の画面で使う型。API のレスポンス形をそのまま写している。 */

export interface VehicleProfile {
    vehicleType: string | null;
    registrationNumber: string | null;
    usage: string | null;
    inspectionExpiry: string | null;
    jibaisekiCompany: string | null;
    jibaisekiExpiry: string | null;
    insuranceCompany: string | null;
    insuranceExpiry: string | null;
    insurancePersonal: string | null;
    insuranceObjective: string | null;
    insurancePassenger: string | null;
    defaultDriverName: string | null;
    notes: string | null;
}

export interface EquipmentVehicle {
    id: string;
    name: string;
    isActive: boolean;
    dailyRate: number | null;
    profile: VehicleProfile | null;
    maintenance: {
        count: number;
        totalAmount: number;
        lastDate: string | null;
    };
}

export interface MaintenanceFile {
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    createdAt: string;
}

export interface MaintenanceRecord {
    id: string;
    targetType: 'vehicle' | 'tool';
    targetId: string;
    date: string;
    category: string;
    title: string;
    vendor: string | null;
    amount: number | null;
    odometer: number | null;
    nextDueDate: string | null;
    note: string | null;
    createdByName: string | null;
    createdAt: string;
    files: MaintenanceFile[];
}

export interface VehicleUsage {
    id: string;
    date: string;
    projectMasterId: string;
    projectName: string;
    foremanName: string;
    workerNames: string[];
}

/** ISO文字列を「2026/09/01」に。空なら '—'。 */
export function fmtDate(v: string | null | undefined): string {
    if (!v) return '—';
    return v.slice(0, 10).replace(/-/g, '/');
}

/** ISO文字列を input[type=date] の値（YYYY-MM-DD）に。 */
export function toDateInput(v: string | null | undefined): string {
    return v ? v.slice(0, 10) : '';
}

export function fmtYen(v: number | null | undefined): string {
    return v == null ? '—' : `¥${v.toLocaleString()}`;
}

export interface ToolCategory {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
}

export interface EquipmentTool {
    id: string;
    categoryId: string;
    categoryName: string;
    name: string;
    status: string;
    maker: string | null;
    modelNumber: string | null;
    serialNumber: string | null;
    purchaseDate: string | null;
    purchasePrice: number | null;
    holderId: string | null;
    holderName: string;
    projectMasterId: string | null;
    projectName: string;
    destinationNote: string | null;
    checkedOutAt: string | null;
    note: string | null;
    isActive: boolean;
    maintenance: {
        count: number;
        totalAmount: number;
        lastDate: string | null;
    };
}

export interface ToolLog {
    id: string;
    action: string;
    status: string;
    projectName: string | null;
    destinationNote: string | null;
    holderName: string | null;
    note: string | null;
    createdByName: string | null;
    createdAt: string;
}

/** ISO文字列を「2026/09/01 14:30」に。 */
export function fmtDateTime(v: string | null | undefined): string {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    }).format(d);
}
