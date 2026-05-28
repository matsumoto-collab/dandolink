import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
    billingDraftListQuerySchema,
    createBillingDraftSchema,
    validateRequest,
} from '@/lib/validations';
import {
    requireManagerOrAbove,
    serverErrorResponse,
    validationErrorResponse,
} from '@/lib/api/utils';

/**
 * Get billing drafts (with filters)
 * GET /api/billing-drafts
 * クエリ:
 *   - status: 'pending' | 'confirmed' | 'cancelled'
 *   - customerId: 顧客 ID
 *   - projectId: 案件 ID
 *   - createdById: 作成者 User.id
 *   - q: フリーテキスト（担当者名 / 案件名 / 顧客名 / タイトル / メモを横断検索）
 *   - includeDeleted: '1' で論理削除済みを含む（既定 '0' = 除外）
 */
export async function GET(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const { searchParams } = new URL(req.url);
        const queryValidation = validateRequest(billingDraftListQuerySchema, {
            status: searchParams.get('status') ?? undefined,
            customerId: searchParams.get('customerId') ?? undefined,
            projectId: searchParams.get('projectId') ?? undefined,
            createdById: searchParams.get('createdById') ?? undefined,
            q: searchParams.get('q') ?? undefined,
            includeDeleted: searchParams.get('includeDeleted') ?? undefined,
        });
        if (!queryValidation.success) {
            return validationErrorResponse(queryValidation.error!, queryValidation.details);
        }

        const { status, customerId, projectId, createdById, q, includeDeleted } = queryValidation.data;

        const where: Prisma.BillingDraftWhereInput = {};

        if (includeDeleted !== '1') {
            where.deletedAt = null;
        }
        if (status) where.status = status;
        if (customerId) where.customerId = customerId;
        if (projectId) where.projectId = projectId;
        if (createdById) where.createdById = createdById;

        if (q && q.trim()) {
            const keyword = q.trim();
            where.OR = [
                { title: { contains: keyword, mode: 'insensitive' } },
                { note: { contains: keyword, mode: 'insensitive' } },
                { projectMaster: { title: { contains: keyword, mode: 'insensitive' } } },
                { projectMaster: { name: { contains: keyword, mode: 'insensitive' } } },
                { customer: { name: { contains: keyword, mode: 'insensitive' } } },
                { createdBy: { displayName: { contains: keyword, mode: 'insensitive' } } },
            ];
        }

        const drafts = await prisma.billingDraft.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }],
            include: {
                projectMaster: { select: { id: true, title: true, name: true } },
                customer: { select: { id: true, name: true } },
                createdBy: { select: { id: true, displayName: true, username: true } },
                invoice: { select: { id: true, invoiceNumber: true, status: true } },
            },
        });

        return NextResponse.json(drafts, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求予定の取得', error);
    }
}

/**
 * Create a new billing draft
 * POST /api/billing-drafts
 */
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireManagerOrAbove();
        if (error) return error;

        const body = await req.json();
        const validation = validateRequest(createBillingDraftSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const data = validation.data;

        const created = await prisma.billingDraft.create({
            data: {
                projectId: data.projectId,
                customerId: data.customerId,
                title: data.title.trim(),
                amount: data.amount ?? null,
                taxRate: data.taxRate ?? '0.10',
                note: data.note?.trim() || null,
                createdById: session!.user.id,
            },
            include: {
                projectMaster: { select: { id: true, title: true, name: true } },
                customer: { select: { id: true, name: true } },
                createdBy: { select: { id: true, displayName: true, username: true } },
            },
        });

        return NextResponse.json(created, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('請求予定の作成', error);
    }
}
