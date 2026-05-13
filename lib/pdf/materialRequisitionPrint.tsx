import { renderToBuffer } from '@react-pdf/renderer';
import { prisma } from '@/lib/prisma';
import {
    MaterialRequisitionPrintPDF,
    type RequisitionPrintCategory,
    type RequisitionPrintData,
} from '@/components/pdf/MaterialRequisitionPrintPDF';
// フォント登録のため import（副作用）
import '@/components/pdf/styles';

const STATUS_LABELS: Record<string, string> = {
    draft: '下書き',
    confirmed: '確定',
    loaded: '積込完了',
};

/**
 * Prismaから対象IDの伝票を取得し、印刷用のPrintDataに整形する
 * 数量>0の品目のみ含める / カテゴリ単位でグルーピング
 * 認可チェック後に呼び出す前提（ここではしない）
 */
export async function buildPrintDataForRequisitions(
    requisitionIds: string[]
): Promise<RequisitionPrintData[]> {
    if (requisitionIds.length === 0) return [];

    const records = await prisma.materialRequisition.findMany({
        where: { id: { in: requisitionIds } },
        include: {
            items: {
                where: { quantity: { gt: 0 } },
                include: {
                    materialItem: { include: { category: true } },
                },
            },
        },
    });

    // 引数の順序を維持して並べる
    const recordById = new Map(records.map((r) => [r.id, r]));

    // プロジェクト名を一括取得
    const projectIds = [...new Set(records.map((r) => r.projectMasterId))];
    const projects = await prisma.projectMaster.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, title: true, name: true },
    });
    const projectMap = new Map(
        projects.map((p) => [p.id, p.name || p.title || '不明'])
    );

    const result: RequisitionPrintData[] = [];
    for (const id of requisitionIds) {
        const r = recordById.get(id);
        if (!r) continue;

        // カテゴリ単位にグルーピング（include済みの category.sortOrder をそのまま利用）
        const catMap = new Map<string, RequisitionPrintCategory>();
        const catOrder = new Map<string, number>();
        for (const item of r.items) {
            const cat = item.materialItem.category;
            if (!catMap.has(cat.id)) {
                catMap.set(cat.id, {
                    categoryId: cat.id,
                    categoryName: cat.name,
                    items: [],
                });
                catOrder.set(cat.id, cat.sortOrder);
            }
            catMap.get(cat.id)!.items.push({
                name: item.materialItem.name,
                spec: item.materialItem.spec,
                unit: item.materialItem.unit,
                quantity: item.quantity,
                sortOrder: item.materialItem.sortOrder,
            });
        }

        const categories = [...catMap.values()].sort(
            (a, b) =>
                (catOrder.get(a.categoryId) ?? 0) -
                (catOrder.get(b.categoryId) ?? 0)
        );

        // 品目はマスター登録順（sortOrder 昇順）で表示。同値は name で安定ソートする。
        for (const c of categories) {
            c.items.sort((a, b) => {
                const ao = a.sortOrder ?? 0;
                const bo = b.sortOrder ?? 0;
                if (ao !== bo) return ao - bo;
                return a.name.localeCompare(b.name, 'ja');
            });
        }

        result.push({
            id: r.id,
            projectTitle: projectMap.get(r.projectMasterId) || '不明',
            date: r.date.toISOString(),
            foremanName: r.foremanName || '',
            vehicleInfo: r.vehicleInfo,
            status: r.status,
            statusLabel: STATUS_LABELS[r.status] || r.status,
            notes: r.notes,
            typeLabel: r.type,
            categories,
        });
    }

    return result;
}

/**
 * 印刷PDFを Buffer として生成
 */
export async function renderMaterialRequisitionPrintPDF(
    requisitionIds: string[]
): Promise<Buffer> {
    const data = await buildPrintDataForRequisitions(requisitionIds);
    const buffer = await renderToBuffer(
        <MaterialRequisitionPrintPDF
            requisitions={data}
            generatedAt={new Date().toISOString()}
        />
    );
    return buffer;
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
 * 与えられた requisitionIds の各レコードについて評価し、不可なら ID を返す
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
        // 存在チェックのみ
        const exists = await prisma.materialRequisition.findMany({
            where: { id: { in: requisitionIds } },
            select: { id: true },
        });
        const existsSet = new Set(exists.map((r) => r.id));
        const missingIds = requisitionIds.filter((id) => !existsSet.has(id));
        return { allowed: missingIds.length === 0, deniedIds: [], missingIds };
    }

    // 一般ロール: 自分が職長(foremanId) または 作成者(createdBy) のもののみ
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
