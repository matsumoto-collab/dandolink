import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { canManageUsers } from '@/utils/permissions';
import { createUserSchema, validateRequest } from '@/lib/validations';
import { requireAuth, parseJsonField, stringifyJsonField, errorResponse, validationErrorResponse, serverErrorResponse, applyRateLimit, RATE_LIMITS } from '@/lib/api/utils';

/**
 * GET /api/users - ユーザー一覧取得
 */
export async function GET(req: NextRequest) {
    const rateLimitError = applyRateLimit(req, RATE_LIMITS.api);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        const userRole = (session?.user?.role as string | undefined)?.toLowerCase();
        const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

        // クエリパラメータによるフィルタリング
        const queryRole = req.nextUrl.searchParams.get('role');
        const rolesToFetch = queryRole ? queryRole.split(',').map(r => r.trim().toUpperCase()) : undefined;

        const whereClause = rolesToFetch ? { role: { in: rolesToFetch } } : undefined;

        const users = await prisma.user.findMany({
            where: whereClause,
            select: { id: true, username: true, email: true, displayName: true, role: true, assignedProjects: true, isActive: true, hourlyRate: true, createdAt: true, updatedAt: true },
            orderBy: { createdAt: 'desc' },
        });

        // 権限に応じて返却するデータを制御。管理者・マネージャー以外には機密情報を送信しない
        return NextResponse.json(users.map(user => {
            const baseData = {
                id: user.id,
                displayName: user.displayName,
                role: user.role.toLowerCase(),
                isActive: user.isActive,
            };

            // 管理者またはマネージャーの場合は詳細情報も含める
            if (isAdminOrManager) {
                return {
                    ...baseData,
                    username: user.username,
                    email: user.email,
                    assignedProjects: parseJsonField<string[]>(user.assignedProjects, []),
                    hourlyRate: user.hourlyRate ? Number(user.hourlyRate) : null,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                };
            }

            // 一般ユーザーには基本情報のみを返す
            return baseData;
        }));
    } catch (error) {
        return serverErrorResponse('ユーザー一覧の取得', error);
    }
}

/**
 * POST /api/users - ユーザー作成
 */
export async function POST(req: NextRequest) {
    const rateLimitError = applyRateLimit(req, RATE_LIMITS.auth);
    if (rateLimitError) return rateLimitError;

    try {
        const { session, error } = await requireAuth();
        if (error) return error;
        if (!canManageUsers(session!.user)) return errorResponse('権限がありません', 403);

        const body = await req.json();
        const validation = validateRequest(createUserSchema, body);
        if (!validation.success) {
            return validationErrorResponse(validation.error!, validation.details);
        }

        const { username, email, displayName, password, role, assignedProjects, hourlyRate } = validation.data;

        const existingUser = await prisma.user.findUnique({ where: { username } });
        if (existingUser) return errorResponse('このユーザー名は既に使用されています', 400);

        const existingEmail = await prisma.user.findUnique({ where: { email } });
        if (existingEmail) return errorResponse('このメールアドレスは既に使用されています', 400);

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username, email, displayName,
                passwordHash: hashedPassword,
                role: role.toUpperCase(),
                assignedProjects: stringifyJsonField(assignedProjects),
                hourlyRate: hourlyRate != null ? hourlyRate : null,
                isActive: true,
            },
        });

        return NextResponse.json({
            id: newUser.id, username: newUser.username, email: newUser.email, displayName: newUser.displayName,
            role: newUser.role.toLowerCase(),
            assignedProjects: parseJsonField<string[]>(newUser.assignedProjects, []),
            hourlyRate: newUser.hourlyRate ? Number(newUser.hourlyRate) : null,
            isActive: newUser.isActive, createdAt: newUser.createdAt, updatedAt: newUser.updatedAt,
        });
    } catch (error) {
        return serverErrorResponse('ユーザーの作成', error);
    }
}
