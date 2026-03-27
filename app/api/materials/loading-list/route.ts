import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';
import { parseJsonField } from '@/lib/json-utils';

export async function GET(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { searchParams } = new URL(request.url);
        const date = searchParams.get('date');
        const vehicleId = searchParams.get('vehicleId');

        if (!date || !vehicleId) {
            return NextResponse.json({ error: '日付とトラックIDは必須です' }, { status: 400 });
        }

        const targetDate = new Date(date);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        // 1. Get assignments for the date that have this vehicle in confirmedVehicleIds
        const assignments = await prisma.projectAssignment.findMany({
            where: {
                date: { gte: targetDate, lt: nextDate },
                isDispatchConfirmed: true,
            },
            include: {
                projectMaster: { select: { id: true, title: true, name: true } },
            },
        });

        // Filter to assignments that include the specified vehicle
        const relevantAssignments = assignments.filter(a => {
            const vehicleIds = parseJsonField<string[]>(a.confirmedVehicleIds, []);
            return vehicleIds.includes(vehicleId);
        });

        if (relevantAssignments.length === 0) {
            return NextResponse.json({
                date,
                vehicleId,
                vehicleName: '',
                projects: [],
                items: [],
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        // Get unique project IDs
        const projectIds = [...new Set(relevantAssignments.map(a => a.projectMasterId))];
        const projects = relevantAssignments
            .map(a => a.projectMaster)
            .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i)
            .map(p => ({ id: p.id, title: p.name || p.title }));

        // 2. Get material lists for these projects
        const projectMaterials = await prisma.projectMaterialItem.findMany({
            where: { projectMasterId: { in: projectIds }, requiredQuantity: { gt: 0 } },
            include: {
                materialItem: {
                    include: { category: { select: { name: true, sortOrder: true } } },
                },
            },
        });

        if (projectMaterials.length === 0) {
            return NextResponse.json({
                date,
                vehicleId,
                vehicleName: '',
                projects,
                items: [],
            }, { headers: { 'Cache-Control': 'no-store' } });
        }

        // 3. Get check states for this date + vehicle
        const checkItems = await prisma.loadingCheckItem.findMany({
            where: {
                date: targetDate,
                vehicleId,
            },
        });
        const checkMap = new Map(
            checkItems.map(c => [`${c.materialItemId}:${c.projectMasterId}`, c])
        );

        // 4. Aggregate by material item
        const materialMap = new Map<string, {
            materialItemId: string;
            categoryName: string;
            categorySortOrder: number;
            materialName: string;
            spec: string | null;
            unit: string;
            totalQuantity: number;
            breakdown: { projectMasterId: string; projectTitle: string; quantity: number; isChecked: boolean }[];
        }>();

        for (const pm of projectMaterials) {
            const key = pm.materialItemId;
            const projectTitle = projects.find(p => p.id === pm.projectMasterId)?.title || '不明';
            const checkState = checkMap.get(`${pm.materialItemId}:${pm.projectMasterId}`);

            if (!materialMap.has(key)) {
                materialMap.set(key, {
                    materialItemId: pm.materialItemId,
                    categoryName: pm.materialItem.category.name,
                    categorySortOrder: pm.materialItem.category.sortOrder,
                    materialName: pm.materialItem.name,
                    spec: pm.materialItem.spec,
                    unit: pm.materialItem.unit,
                    totalQuantity: 0,
                    breakdown: [],
                });
            }
            const entry = materialMap.get(key)!;
            entry.totalQuantity += pm.requiredQuantity;
            entry.breakdown.push({
                projectMasterId: pm.projectMasterId,
                projectTitle,
                quantity: pm.requiredQuantity,
                isChecked: checkState?.isChecked ?? false,
            });
        }

        // Sort by category, then material name
        const items = Array.from(materialMap.values())
            .sort((a, b) => a.categorySortOrder - b.categorySortOrder || a.materialName.localeCompare(b.materialName))
            .map(({ categorySortOrder, ...rest }) => ({
                ...rest,
                isChecked: rest.breakdown.every(b => b.isChecked),
            }));

        // Get vehicle name
        const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { name: true } });

        return NextResponse.json({
            date,
            vehicleId,
            vehicleName: vehicle?.name || '',
            projects,
            items,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('積込リスト取得', error);
    }
}
