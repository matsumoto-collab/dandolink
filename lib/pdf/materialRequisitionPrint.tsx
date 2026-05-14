import { renderToBuffer } from '@react-pdf/renderer';
import { prisma } from '@/lib/prisma';
import { MaterialRequisitionSlipPDF } from '@/components/pdf/MaterialRequisitionSlipPDF';
// フォント登録のため import（副作用）
import '@/components/pdf/styles';

/**
 * 1伝票分のヘッダー情報＋数量参照関数を組み立てる
 */
async function buildSlipDataForRequisition(id: string): Promise<{
    foremanName: string;
    customerName: string;
    siteName: string;
    assemblyDate: string;
    demolitionDate: string;
    vehicles: [string, string, string];
    getQty: (categoryName: string, itemName: string, vehicleIndex: 0 | 1 | 2) => number;
} | null> {
    const r = await prisma.materialRequisition.findUnique({
        where: { id },
        include: {
            items: {
                include: {
                    materialItem: { include: { category: true } },
                },
            },
        },
    });
    if (!r) return null;

    // ProjectMaster (タイトル・顧客名)
    const project = await prisma.projectMaster.findUnique({
        where: { id: r.projectMasterId },
        select: { id: true, title: true, name: true, customerName: true, customerShortName: true },
    });

    // 組立日 / 解体日: 該当案件の ProjectAssignment.constructionType ('組立' / '解体') 最古日付を採用
    const dateAssignments = await prisma.projectAssignment.findMany({
        where: {
            projectMasterId: r.projectMasterId,
            constructionType: { in: ['組立', '解体'] },
        },
        orderBy: { date: 'asc' },
        select: { date: true, constructionType: true },
    });
    const fmt = (d: Date | undefined) => d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
    const assemblyDate = fmt(dateAssignments.find(a => a.constructionType === '組立')?.date);
    const demolitionDate = fmt(dateAssignments.find(a => a.constructionType === '解体')?.date);

    // 車両情報: JSON ({vehicles:["車両A","車両B","車両C"]}) 形式を試行、失敗時は単一テキストを 1列目に
    let vehicles: [string, string, string] = ['', '', ''];
    if (r.vehicleInfo) {
        try {
            const parsed = JSON.parse(r.vehicleInfo);
            if (parsed && Array.isArray(parsed.vehicles)) {
                vehicles = [
                    String(parsed.vehicles[0] ?? ''),
                    String(parsed.vehicles[1] ?? ''),
                    String(parsed.vehicles[2] ?? ''),
                ];
            } else {
                vehicles = [r.vehicleInfo, '', ''];
            }
        } catch {
            vehicles = [r.vehicleInfo, '', ''];
        }
    }

    // 数量マップ: key = "categoryName|itemName|vehicleIndex"
    const qtyMap = new Map<string, number>();
    for (const item of r.items) {
        if (item.quantity <= 0) continue;
        const cat = item.materialItem.category.name;
        const name = item.materialItem.name;
        // vehicleLabel: '0' / '1' / '2' のいずれかなら該当列、それ以外 (null や 旧データ) は 0 列目
        let idx: 0 | 1 | 2 = 0;
        if (item.vehicleLabel === '1') idx = 1;
        else if (item.vehicleLabel === '2') idx = 2;
        const key = `${cat}|${name}|${idx}`;
        qtyMap.set(key, (qtyMap.get(key) ?? 0) + item.quantity);
    }

    return {
        foremanName: r.foremanName || '',
        customerName: project?.customerShortName || project?.customerName || '',
        siteName: project?.name || project?.title || '',
        assemblyDate,
        demolitionDate,
        vehicles,
        getQty: (categoryName, itemName, vehicleIndex) => qtyMap.get(`${categoryName}|${itemName}|${vehicleIndex}`) ?? 0,
    };
}

/**
 * 印刷PDFを Buffer として生成
 * 複数IDが渡された場合、各IDを別ページとして連結
 */
export async function renderMaterialRequisitionPrintPDF(
    requisitionIds: string[]
): Promise<Buffer> {
    if (requisitionIds.length === 0) {
        // 空の場合はダミーPDF
        return Buffer.from(await renderToBuffer(
            <MaterialRequisitionSlipPDF
                foremanName="" customerName="" siteName=""
                assemblyDate="" demolitionDate=""
                vehicles={['', '', '']}
                getQty={() => 0}
            />
        ));
    }

    // 1件目を描画。複数件の場合は連結が必要だが、現状の React-PDF API では
    // 1 Document = 1 PDF。複数を連結するなら pdf-lib などが必要。
    // ここでは「単一伝票=1PDF」の仕様で、bulk POST 時は最初の1件のみ印刷する暫定実装。
    // (TODO: 全件を連結する場合は pdf-lib を導入)
    const first = requisitionIds[0];
    const data = await buildSlipDataForRequisition(first);
    if (!data) {
        return Buffer.from(await renderToBuffer(
            <MaterialRequisitionSlipPDF
                foremanName="" customerName="" siteName=""
                assemblyDate="" demolitionDate=""
                vehicles={['', '', '']}
                getQty={() => 0}
            />
        ));
    }
    return Buffer.from(await renderToBuffer(
        <MaterialRequisitionSlipPDF
            foremanName={data.foremanName}
            customerName={data.customerName}
            siteName={data.siteName}
            assemblyDate={data.assemblyDate}
            demolitionDate={data.demolitionDate}
            vehicles={data.vehicles}
            getQty={data.getQty}
        />
    ));
}

/**
 * Content-Disposition のファイル名（YYYYMMDD）
 */
export function buildPdfFileName(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `material-requisition-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.pdf`;
}

/**
 * 認可: 本人(foremanId / createdBy) または admin/manager のみアクセス可
 */
export async function checkRequisitionAccess(
    requisitionIds: string[],
    user: { id: string; role?: string | null }
): Promise<{ allowed: boolean; deniedIds: string[]; missingIds: string[] }> {
    if (requisitionIds.length === 0) {
        return { allowed: true, deniedIds: [], missingIds: [] };
    }

    const role = user.role ?? '';
    if (role === 'admin' || role === 'manager') {
        const exists = await prisma.materialRequisition.findMany({
            where: { id: { in: requisitionIds } },
            select: { id: true },
        });
        const existsSet = new Set(exists.map((r) => r.id));
        const missingIds = requisitionIds.filter((id) => !existsSet.has(id));
        return { allowed: missingIds.length === 0, deniedIds: [], missingIds };
    }

    const records = await prisma.materialRequisition.findMany({
        where: { id: { in: requisitionIds } },
        select: { id: true, foremanId: true, createdBy: true },
    });
    const recordMap = new Map(records.map((r) => [r.id, r]));
    const deniedIds: string[] = [];
    const missingIds: string[] = [];
    for (const id of requisitionIds) {
        const r = recordMap.get(id);
        if (!r) {
            missingIds.push(id);
            continue;
        }
        if (r.foremanId !== user.id && r.createdBy !== user.id) {
            deniedIds.push(id);
        }
    }
    return {
        allowed: deniedIds.length === 0 && missingIds.length === 0,
        deniedIds,
        missingIds,
    };
}
