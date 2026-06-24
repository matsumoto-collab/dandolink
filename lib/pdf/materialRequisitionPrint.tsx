import { renderToBuffer } from '@react-pdf/renderer';
import { prisma } from '@/lib/prisma';
import { MaterialRequisitionSlipPDF, MaterialRequisitionSlipMultiPDF, type MaterialRequisitionSlipPDFProps } from '@/components/pdf/MaterialRequisitionSlipPDF';
import { parseRequisitionNotes } from '@/lib/materials/catalog';
// フォント登録のため import（副作用）
import '@/components/pdf/styles';

/**
 * 1伝票分のヘッダー情報＋数量参照関数を組み立てる
 */
async function buildSlipDataForRequisition(id: string): Promise<MaterialRequisitionSlipPDFProps | null> {
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

    // ProjectMaster (タイトル・顧客名・敬称)
    const project = await prisma.projectMaster.findUnique({
        where: { id: r.projectMasterId },
        select: { id: true, title: true, name: true, customerName: true, customerShortName: true, honorific: true },
    });

    // notes-JSON（記入者 / 組立解体日 / シート / 自由欄）。旧プレーン notes は memo として読まれる
    const parsedNotes = parseRequisitionNotes(r.notes);

    // 組立日 / 解体日: notes 優先 → 無ければ ProjectAssignment.constructionType ('組立'/'解体') 最古日付
    const dateAssignments = await prisma.projectAssignment.findMany({
        where: {
            projectMasterId: r.projectMasterId,
            constructionType: { in: ['組立', '解体'] },
        },
        orderBy: { date: 'asc' },
        select: { date: true, constructionType: true },
    });
    const fmt = (d: Date | undefined) => d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
    // notes の日付は YYYY-MM-DD（date input 由来）。PDF 表記に合わせ M/D へ整形（解釈不能はそのまま）
    const fmtYmdToMd = (s: string): string => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return m ? `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}` : s;
    };
    const assemblyDate = parsedNotes.assemblyDate
        ? fmtYmdToMd(parsedNotes.assemblyDate)
        : fmt(dateAssignments.find(a => a.constructionType === '組立')?.date);
    const demolitionDate = parsedNotes.demolitionDate
        ? fmtYmdToMd(parsedNotes.demolitionDate)
        : fmt(dateAssignments.find(a => a.constructionType === '解体')?.date);

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
        writerName: parsedNotes.writerName || r.foremanName || '',
        customerName: project?.customerShortName || project?.customerName || '',
        honorific: project?.honorific || '',
        siteName: project?.title || project?.name || '',
        assemblyDate,
        demolitionDate,
        vehicles,
        // 表示は notes.cells（書いたとおりの文字）を最優先、無ければ DB 数量を文字化
        getQty: (categoryName, itemName, vehicleIndex) => {
            const cellText = parsedNotes.cells?.[`${categoryName}|${itemName}`]?.[vehicleIndex];
            if (cellText && cellText.trim() !== '') return cellText;
            const n = qtyMap.get(`${categoryName}|${itemName}|${vehicleIndex}`) ?? 0;
            return n > 0 ? String(n) : '';
        },
        sheets: parsedNotes.sheets,
        freeForm: parsedNotes.freeForm,
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
                getQty={() => ''}
            />
        ));
    }

    // 各 ID 分の SlipPDFProps を組み立てる (順序維持)
    const slips: MaterialRequisitionSlipPDFProps[] = [];
    for (const id of requisitionIds) {
        const data = await buildSlipDataForRequisition(id);
        if (data) slips.push(data);
    }

    if (slips.length === 0) {
        // 該当データなし → 空ページ1枚
        return Buffer.from(await renderToBuffer(
            <MaterialRequisitionSlipPDF
                foremanName="" customerName="" siteName=""
                assemblyDate="" demolitionDate=""
                vehicles={['', '', '']}
                getQty={() => ''}
            />
        ));
    }

    if (slips.length === 1) {
        return Buffer.from(await renderToBuffer(<MaterialRequisitionSlipPDF {...slips[0]} />));
    }

    return Buffer.from(await renderToBuffer(<MaterialRequisitionSlipMultiPDF slips={slips} />));
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
