/**
 * 販売前監査用テストアカウントを4ロール分作成する
 *
 * 実行:
 *   DIRECT_URL="postgresql://..." npx tsx scripts/create-audit-accounts.ts
 *
 * 終了後:
 *   DIRECT_URL="..." npx tsx scripts/create-audit-accounts.ts --cleanup
 *   で全アカウントを isActive=false + isLoginEnabled=false に更新する
 *
 * パスワードは実行ごとに 24 文字ランダム生成し、コンソールに1回だけ出力する。
 * (チャット転送せずSecureなチャネルでclaudecoworkに渡すこと)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

const AUDIT_PREFIX = 'audit_';
const DATE_SUFFIX = new Date().toISOString().slice(0, 10).replace(/-/g, '');

interface AuditAccountSpec {
    role: 'admin' | 'manager' | 'foreman1' | 'foreman2' | 'worker' | 'partner';
    displayName: string;
}

const SPECS: AuditAccountSpec[] = [
    { role: 'admin',    displayName: '[監査] admin' },
    { role: 'manager',  displayName: '[監査] manager' },
    { role: 'foreman1', displayName: '[監査] foreman1' },
    { role: 'foreman2', displayName: '[監査] foreman2' },
    { role: 'worker',   displayName: '[監査] worker' },
    { role: 'partner',  displayName: '[監査] partner' },
];

function generatePassword(): string {
    // 英大小+数字+記号で24文字、URLセーフな範囲
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^*';
    const buf = randomBytes(24);
    let out = '';
    for (let i = 0; i < 24; i++) out += charset[buf[i] % charset.length];
    return out;
}

async function createAccounts() {
    const created: Array<{ username: string; password: string; role: string }> = [];

    for (const spec of SPECS) {
        const username = `${AUDIT_PREFIX}${spec.role}_${DATE_SUFFIX}`;
        const email = `${username}@audit.local.invalid`;
        const password = generatePassword();
        const passwordHash = await bcrypt.hash(password, 10);

        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) {
            console.log(`[skip] ${username} already exists. (id=${existing.id})`);
            continue;
        }

        const user = await prisma.user.create({
            data: {
                username,
                email,
                displayName: spec.displayName,
                passwordHash,
                role: spec.role,
                isActive: true,
                isLoginEnabled: true,
            },
        });
        created.push({ username: user.username, password, role: spec.role });
    }

    console.log('\n========================================');
    console.log('AUDIT ACCOUNTS CREATED');
    console.log('========================================');
    console.log('※ チャットに貼らず、1Password / Bitwarden 経由で渡すこと\n');
    for (const c of created) {
        console.log(`  username: ${c.username}`);
        console.log(`  password: ${c.password}`);
        console.log(`  role    : ${c.role}\n`);
    }
    console.log('Cleanup command:');
    console.log('  DIRECT_URL="..." npx tsx scripts/create-audit-accounts.ts --cleanup');
    console.log('========================================\n');
}

async function cleanup() {
    const targets = await prisma.user.findMany({
        where: { username: { startsWith: AUDIT_PREFIX } },
        select: { id: true, username: true, isActive: true, isLoginEnabled: true },
    });
    if (targets.length === 0) {
        console.log('[cleanup] no audit accounts found.');
        return;
    }
    const result = await prisma.user.updateMany({
        where: { username: { startsWith: AUDIT_PREFIX } },
        data: { isActive: false, isLoginEnabled: false },
    });
    console.log(`[cleanup] disabled ${result.count} audit account(s):`);
    targets.forEach(t => console.log(`  - ${t.username}`));
    console.log('\n物理削除する場合は Supabase ダッシュボードから手動で。');
    console.log('(関連レコードがある可能性があるため自動削除はしない)');
}

async function main() {
    const mode = process.argv[2];
    try {
        if (mode === '--cleanup') {
            await cleanup();
        } else {
            await createAccounts();
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
