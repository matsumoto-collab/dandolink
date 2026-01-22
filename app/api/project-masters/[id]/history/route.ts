import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET: 案件マスターに紐づく配置（作業履歴）を取得
export async function GET(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await context.params;

        // 案件マスターIDに紐づく配置を取得
        const { data: assignments, error } = await supabase
            .from('assignments')
            .select(`
                id,
                date,
                assigned_employee_id,
                construction_type,
                construction_content,
                workers,
                vehicles,
                confirmed_worker_ids,
                confirmed_vehicle_ids,
                is_dispatch_confirmed,
                remarks,
                created_at
            `)
            .eq('project_master_id', id)
            .order('date', { ascending: false });

        if (error) {
            console.error('Error fetching assignment history:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // 職長・職方・車両の名前を取得するため、追加のクエリ
        const employeeIds = new Set<string>();
        const vehicleIds = new Set<string>();

        assignments?.forEach(a => {
            if (a.assigned_employee_id) employeeIds.add(a.assigned_employee_id);
            a.confirmed_worker_ids?.forEach((id: string) => employeeIds.add(id));
            a.confirmed_vehicle_ids?.forEach((id: string) => vehicleIds.add(id));
        });

        // ユーザー名取得
        const { data: users } = await supabase
            .from('users')
            .select('id, display_name')
            .in('id', Array.from(employeeIds));

        const userMap = new Map<string, string>();
        users?.forEach(u => userMap.set(u.id, u.display_name));

        // 車両名取得
        const { data: vehicles } = await supabase
            .from('vehicles')
            .select('id, name')
            .in('id', Array.from(vehicleIds));

        const vehicleMap = new Map<string, string>();
        vehicles?.forEach(v => vehicleMap.set(v.id, v.name));

        // レスポンス整形
        const history = assignments?.map(a => ({
            id: a.id,
            date: a.date,
            foremanId: a.assigned_employee_id,
            foremanName: userMap.get(a.assigned_employee_id) || '不明',
            constructionType: a.construction_type,
            constructionContent: a.construction_content,
            workerIds: a.confirmed_worker_ids || a.workers || [],
            workerNames: (a.confirmed_worker_ids || a.workers || [])
                .map((id: string) => userMap.get(id) || id)
                .filter((name: string) => name !== userMap.get(a.assigned_employee_id)), // 職長を除外
            vehicleIds: a.confirmed_vehicle_ids || a.vehicles || [],
            vehicleNames: (a.confirmed_vehicle_ids || a.vehicles || [])
                .map((id: string) => vehicleMap.get(id) || id),
            isConfirmed: a.is_dispatch_confirmed,
            remarks: a.remarks,
            createdAt: a.created_at,
        }));

        return NextResponse.json(history || []);
    } catch (error) {
        console.error('Error in assignment history API:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
