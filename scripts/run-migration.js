const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
    const sql = fs.readFileSync(path.join(__dirname, 'migrate-materials.sql'), 'utf-8');
    // Split on semicolons, filter empty
    const statements = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));

    for (const stmt of statements) {
        try {
            await prisma.$executeRawUnsafe(stmt);
            console.log('OK:', stmt.substring(0, 60) + '...');
        } catch (e) {
            // Ignore "already exists" errors
            if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
                console.log('SKIP (exists):', stmt.substring(0, 60) + '...');
            } else {
                console.error('ERR:', e.message?.substring(0, 100));
            }
        }
    }
    console.log('Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
