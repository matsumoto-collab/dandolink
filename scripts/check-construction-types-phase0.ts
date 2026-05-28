/**
 * Phase 0 マイグレーション設計のための ConstructionType マスタ確認スクリプト。
 * 本番 DB に対して読み取り専用 SELECT のみ実行する。
 *
 * 用途:
 *   - 「組立／解体／その他」以外のカスタム工程レコードの有無
 *   - 既存カラム構成の確認（code 列が未存在であることを念のため確認）
 *
 * 実行: npx tsx -r dotenv/config scripts/check-construction-types-phase0.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(dbUrl).host;
    } catch {
      return '(unparsable)';
    }
  })();

  console.log('=== Phase 0 ConstructionType マスタ確認 ===');
  console.log(`DB host: ${host}`);
  console.log('');

  // 1. 既存カラム構成の確認（code 列が存在しないことを念のため確認）
  const cols = await prisma.$queryRaw<ColumnInfo[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ConstructionType'
    ORDER BY ordinal_position;
  `;

  console.log('--- 現存カラム ---');
  for (const c of cols) {
    const def = c.column_default ? ` DEFAULT ${c.column_default}` : '';
    const nul = c.is_nullable === 'YES' ? '' : ' NOT NULL';
    console.log(`  ${c.column_name}: ${c.data_type}${nul}${def}`);
  }
  const hasCodeColumn = cols.some((c) => c.column_name === 'code');
  console.log(`  → code 列の存在: ${hasCodeColumn ? '有り' : '無し'}`);
  console.log('');

  // 2. 既存レコード一覧
  const types = await prisma.constructionType.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  console.log(`--- 既存レコード（${types.length} 件） ---`);
  console.log('');
  console.log('| sortOrder | name | id | isActive | color | createdAt |');
  console.log('|---:|---|---|:---:|---|---|');
  for (const t of types) {
    console.log(
      `| ${t.sortOrder} | ${t.name} | ${t.id} | ${t.isActive} | ${t.color} | ${t.createdAt.toISOString()} |`
    );
  }
  console.log('');

  // 3. ProjectAssignment.constructionType でどの ConstructionType.id が
  //    実際に使われているかも合わせて確認（マスタにあるが未使用、または
  //    マスタに無いのに参照されているケースを検出）
  const usage = await prisma.$queryRaw<
    Array<{ constructionType: string | null; rows: bigint }>
  >`
    SELECT "constructionType", COUNT(*)::bigint AS rows
    FROM "ProjectAssignment"
    GROUP BY "constructionType"
    ORDER BY rows DESC;
  `;
  console.log('--- ProjectAssignment.constructionType 集計 ---');
  for (const u of usage) {
    const matched = u.constructionType
      ? types.find((t) => t.id === u.constructionType)
      : null;
    const note = u.constructionType
      ? matched
        ? `→ マスタ: ${matched.name}`
        : '⚠️ マスタに該当 id 無し'
      : '(NULL)';
    console.log(`  ${u.constructionType ?? '(null)'} : ${u.rows} 行 ${note}`);
  }
  console.log('');

  // 4. 名前ベースで「組立／解体／その他」をマッチして候補表示
  const STANDARD_NAMES = ['組立', '解体', 'その他'];
  const standard = types.filter((t) => STANDARD_NAMES.includes(t.name));
  const custom = types.filter((t) => !STANDARD_NAMES.includes(t.name));
  console.log('--- 標準 3 種マッチング ---');
  console.log(`  標準（組立/解体/その他）: ${standard.length} 件`);
  console.log(`  カスタム: ${custom.length} 件`);
  if (custom.length > 0) {
    console.log('  カスタム工程一覧:');
    for (const c of custom) {
      console.log(`    - ${c.name} (id=${c.id}, isActive=${c.isActive})`);
    }
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
