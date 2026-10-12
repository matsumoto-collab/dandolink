-- ============================================================================
-- 2026-10-03  public の全テーブルで RLS（行ごとの鍵）を有効にする
-- ============================================================================
-- 背景:
--   Supabase のセキュリティ診断が「public の 83 テーブルで RLS が無効」と警告している。
--   実際には anon / authenticated / service_role のどれにも public のテーブル権限が無く
--   （スキーマの USAGE も無い）、Data API からは 1 行も読めない状態だが、
--   人事システム（hr スキーマ）を同じ DB に入れるのを機に、二重の鍵として有効にしておく。
--
-- 影響が無いことの確認（2026-10-03）:
--   * Prisma の接続ユーザーは postgres（全テーブルの所有者）。所有者は RLS の対象外
--     （FORCE ROW LEVEL SECURITY は付けない）
--   * MQ会計（mq_app）は mq.v_* ビュー越しに読む。ビューの所有者は postgres で、
--     security_invoker ではないので、所有者の権限で読まれる＝対象外
--   * public のテーブルに権限を持つ所有者以外のロールは 0
--   * すでに 23 テーブルは RLS 有効で、今のアプリはそのまま動いている
--
-- ロックについて:
--   ALTER TABLE は一瞬だけ強いロックを取る。3 秒待って取れなければ全体を取り消して
--   終わる（何も変わらない）ので、そのときは時間を置いてもう一度流す。
--
-- 元に戻す: alter table public."<表名>" disable row level security;
-- ============================================================================

do $$
declare
  r record;
  n int := 0;
begin
  -- この処理の間だけ有効（終われば元に戻る）
  perform set_config('lock_timeout', '3s', true);

  for r in
    select c.relname
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
     order by 1
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    n := n + 1;
  end loop;
  raise notice '% テーブルで RLS を有効にしました', n;
end $$;

-- 確認: rls_off が 0 なら OK
select count(*) filter (where not c.relrowsecurity) as rls_off,
       count(*)                                     as tables
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
 where ns.nspname = 'public' and c.relkind = 'r';
