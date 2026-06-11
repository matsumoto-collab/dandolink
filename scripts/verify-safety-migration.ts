/**
 * 安全書類マイグレーション（2026-06-11_add_safety_documents.sql）の適用検証。
 * ほぼ読み取り専用 — 唯一の書き込みは「失敗するはずの INSERT」で、
 * CHECK 制約（workerId/userId 排他）が機能していれば何も残らない。
 *
 *   npx tsx scripts/verify-safety-migration.ts
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    let ok = true;
    const fail = (msg: string) => { ok = false; console.log(`❌ ${msg}`); };
    const pass = (msg: string) => console.log(`✅ ${msg}`);

    // 1) テーブル存在
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('WorkerSafetyProfile', 'WorkerQualification', 'SafetyDocument')
        ORDER BY table_name`;
    const tableNames = tables.map((t) => t.table_name);
    for (const name of ['SafetyDocument', 'WorkerQualification', 'WorkerSafetyProfile']) {
        if (tableNames.includes(name)) pass(`テーブル ${name} 存在`);
        else fail(`テーブル ${name} が見つからない`);
    }

    // 2) CHECK 制約
    const checks = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = '"public"."WorkerSafetyProfile"'::regclass AND contype = 'c'`;
    if (checks.some((c) => c.conname === 'WorkerSafetyProfile_target_xor')) {
        pass('CHECK 制約 WorkerSafetyProfile_target_xor 存在');
    } else {
        fail(`CHECK 制約が見つからない（検出: ${checks.map((c) => c.conname).join(', ') || 'なし'}）`);
    }

    // 3) UNIQUE インデックス・FK
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('WorkerSafetyProfile', 'WorkerQualification', 'SafetyDocument')`;
    const idxNames = indexes.map((i) => i.indexname);
    for (const name of [
        'WorkerSafetyProfile_workerId_key',
        'WorkerSafetyProfile_userId_key',
        'WorkerQualification_profileId_idx',
        'SafetyDocument_deletedAt_idx',
    ]) {
        if (idxNames.includes(name)) pass(`インデックス ${name} 存在`);
        else fail(`インデックス ${name} が見つからない`);
    }

    const fks = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text IN
          ('"WorkerSafetyProfile"', '"WorkerQualification"', '"SafetyDocument"')`;
    if (fks.length >= 4) pass(`FK ${fks.length}本 存在（workerId/userId/profileId/projectId）`);
    else fail(`FK が不足（検出 ${fks.length}本: ${fks.map((f) => f.conname).join(', ')}）`);

    // 4) CHECK 制約の動作: 両方 NULL の INSERT は拒否される（成功してしまったら即削除して報告）
    try {
        await prisma.$executeRaw`
            INSERT INTO "public"."WorkerSafetyProfile" ("id", "updatedAt") VALUES ('___check_test___', NOW())`;
        await prisma.$executeRaw`DELETE FROM "public"."WorkerSafetyProfile" WHERE "id" = '___check_test___'`;
        fail('両方NULLのINSERTが通ってしまった（CHECK制約が効いていない・テスト行は削除済み）');
    } catch {
        pass('CHECK 制約が機能（workerId/userId 両方NULLのINSERTを拒否）');
    }

    // 5) 資格の番号・画像列（2026-06-11_add_qualification_number_image.sql）
    const qualColumns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'WorkerQualification'
          AND column_name IN ('licenseNumber', 'imagePath', 'imageThumbPath')`;
    const colNames = qualColumns.map((c) => c.column_name);
    for (const name of ['licenseNumber', 'imagePath', 'imageThumbPath']) {
        if (colNames.includes(name)) pass(`列 WorkerQualification.${name} 存在`);
        else fail(`列 WorkerQualification.${name} が見つからない`);
    }

    // 6) Phase 2: 車両安全プロフィール・機械マスター（2026-06-11_add_safety_phase2_vehicle_machine.sql）
    const phase2Tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('VehicleSafetyProfile', 'Machine')
        ORDER BY table_name`;
    const phase2Names = phase2Tables.map((t) => t.table_name);
    for (const name of ['Machine', 'VehicleSafetyProfile']) {
        if (phase2Names.includes(name)) pass(`テーブル ${name} 存在`);
        else fail(`テーブル ${name} が見つからない`);
    }

    const phase2Indexes = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename IN ('VehicleSafetyProfile', 'Machine')`;
    const phase2IdxNames = phase2Indexes.map((i) => i.indexname);
    for (const name of ['VehicleSafetyProfile_vehicleId_key', 'Machine_category_idx']) {
        if (phase2IdxNames.includes(name)) pass(`インデックス ${name} 存在`);
        else fail(`インデックス ${name} が見つからない`);
    }

    const phase2Fks = await prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = '"VehicleSafetyProfile"'`;
    if (phase2Fks.some((f) => f.conname === 'VehicleSafetyProfile_vehicleId_fkey')) {
        pass('FK VehicleSafetyProfile_vehicleId_fkey 存在');
    } else {
        fail('FK VehicleSafetyProfile_vehicleId_fkey が見つからない');
    }

    // 7) Prisma クライアント整合（生成済みクライアントで count が通る）
    const [profiles, quals, docs, vehicleProfiles, machines] = await Promise.all([
        prisma.workerSafetyProfile.count(),
        prisma.workerQualification.count(),
        prisma.safetyDocument.count(),
        prisma.vehicleSafetyProfile.count(),
        prisma.machine.count(),
    ]);
    pass(
        `Prismaクライアント整合 OK（profiles=${profiles}, qualifications=${quals}, documents=${docs}, vehicleProfiles=${vehicleProfiles}, machines=${machines}）`
    );

    console.log(ok ? '\n🎉 マイグレーション検証 すべてOK' : '\n⚠️ 検証に失敗があります');
    if (!ok) process.exitCode = 1;
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
