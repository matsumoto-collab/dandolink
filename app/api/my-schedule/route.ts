import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';
import { normalizeConstructionContent } from '@/lib/constructionContent';

/**
 * GET /api/my-schedule - マイ工程用の案件別工程データ取得
 *
 * Query params:
 *   startDate: YYYY-MM-DD
 *   endDate: YYYY-MM-DD
 *   managerId: (optional) 担当者IDで絞り込み（adminのみ使用可）
 *
 * Returns: 案件ごとに集計された工事種別・日付・担当者情報
 */
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        const userId = session!.user.id;
        if (!['admin', 'manager'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const filterManagerId = searchParams.get('managerId');

        if (!startDate || !endDate) {
            return errorResponse('startDate と endDate は必須です', 400);
        }

        // 指定期間のassignmentsを取得（projectMaster含む）
        const assignments = await prisma.projectAssignment.findMany({
            where: {
                date: {
                    gte: new Date(startDate),
                    lte: new Date(endDate),
                },
                // 過去データ（DandoLink 導入前の作業履歴）はマイ工程には出さない
                isBackfilled: false,
            },
            include: {
                projectMaster: {
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        honorific: true,
                        customerName: true,
                        constructionSuffixId: true,
                        constructionContent: true,
                        createdBy: true,
                        status: true,
                    },
                },
            },
            orderBy: { date: 'asc' },
        });

        // 担当者リスト（admin/manager）を取得
        const managers = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['admin', 'manager'], mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });

        // 工事種別マスターを取得
        const constructionTypes = await prisma.constructionType.findMany({
            where: { isActive: true },
            select: { id: true, name: true, color: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' },
        });

        // 職長リスト（foremen表示名解決用）
        const foremen = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
            select: { id: true, displayName: true },
        });
        const foremenMap = new Map(foremen.map(f => [f.id, f.displayName]));

        // managerロールの場合は自分の担当案件のみ
        // adminの場合はfilterManagerIdで絞り込み可能
        const targetManagerId = role === 'manager' ? userId : (filterManagerId || null);

        // 案件ごとに集計
        const projectMap = new Map<string, {
            projectMasterId: string;
            projectTitle: string;
            projectName: string | null;
            customerName: string | null;
            constructionSuffixId: string | null;
            constructionContent: string | null;
            managerIds: string[];
            status: string;
            foremen: Map<string, string>;
            workEntries: { date: string; constructionTypeId: string | null }[];
        }>();

        for (const a of assignments) {
            const pmId = a.projectMasterId;
            // createdByはJSON文字列の場合があるのでパース
            let createdByIds: string[] = [];
            const raw = a.projectMaster.createdBy;
            if (Array.isArray(raw)) {
                createdByIds = raw;
            } else if (typeof raw === 'string') {
                try { createdByIds = JSON.parse(raw); } catch { createdByIds = raw ? [raw] : []; }
            }

            // 担当者フィルタ: targetManagerIdがある場合、そのIDがcreatedByに含まれる案件のみ
            if (targetManagerId && !createdByIds.includes(targetManagerId)) {
                continue;
            }

            if (!projectMap.has(pmId)) {
                projectMap.set(pmId, {
                    projectMasterId: pmId,
                    projectTitle: a.projectMaster.title,
                    projectName: a.projectMaster.name ? `${a.projectMaster.name}${a.projectMaster.honorific || ''}` : null,
                    customerName: a.projectMaster.customerName,
                    constructionSuffixId: a.projectMaster.constructionSuffixId,
                    // 旧enum値が混じるので正規化してから返す（絞り込みの選択肢がここから作られる）
                    constructionContent: normalizeConstructionContent(a.projectMaster.constructionContent),
                    managerIds: createdByIds,
                    status: a.projectMaster.status,
                    foremen: new Map(),
                    workEntries: [],
                });
            }

            const project = projectMap.get(pmId)!;

            if (a.assignedEmployeeId) {
                const name = foremenMap.get(a.assignedEmployeeId);
                if (name) {
                    project.foremen.set(a.assignedEmployeeId, name);
                }
            }

            const dateStr = a.date instanceof Date
                ? a.date.toISOString().split('T')[0]
                : new Date(a.date).toISOString().split('T')[0];
            project.workEntries.push({
                date: dateStr,
                constructionTypeId: a.constructionType,
            });
        }

        // レスポンス形式に変換
        const result = Array.from(projectMap.values()).map(p => {
            const dates = p.workEntries.map(e => e.date).sort();
            const startDateActual = dates[0] ?? null;
            const endDateActual = dates[dates.length - 1] ?? null;

            return {
                projectMasterId: p.projectMasterId,
                projectTitle: p.projectTitle,
                projectName: p.projectName,
                customerName: p.customerName,
                constructionSuffixId: p.constructionSuffixId,
                constructionContent: p.constructionContent,
                startDate: startDateActual,
                endDate: endDateActual,
                managerIds: p.managerIds,
                status: p.status,
                foremen: Array.from(p.foremen.entries()).map(([id, displayName]) => ({
                    id,
                    displayName,
                })),
                workEntries: p.workEntries,
            };
        });

        // 工事名称マスターを取得
        const constructionSuffixes = await prisma.constructionSuffix.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { sortOrder: 'asc' },
        });

        // 工事内容マスターを取得（絞り込みの並び順に使うだけ。無効化済みの工事内容が付いた案件も
        // 残っているので isActive では絞らない）
        const contentMaster = await prisma.constructionContent.findMany({
            select: { name: true, sortOrder: true },
            orderBy: { sortOrder: 'asc' },
        });
        // 同じ名前が複数行ある（例:「改修」が無効化済みと現行の2件）ので最小 sortOrder を採用
        const contentOrder = new Map<string, number>();
        for (const c of contentMaster) {
            const name = normalizeConstructionContent(c.name);
            if (!name) continue;
            const prev = contentOrder.get(name);
            if (prev === undefined || c.sortOrder < prev) contentOrder.set(name, c.sortOrder);
        }
        const constructionContents = Array.from(contentOrder.entries())
            .map(([name, sortOrder]) => ({ name, sortOrder }))
            .sort((a, b) => a.sortOrder - b.sortOrder);

        return NextResponse.json({
            projects: result,
            constructionTypes,
            constructionSuffixes,
            constructionContents,
            managers,
            currentUserRole: role,
        }, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        return serverErrorResponse('マイ工程取得', error);
    }
}
