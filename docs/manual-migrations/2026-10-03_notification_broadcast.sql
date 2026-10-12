-- ============================================================================
-- 2026-10-03: 通知の新着を Realtime broadcast で知らせる
-- ============================================================================
-- 背景:
--   通知ベル（components/Notifications/NotificationsInbox.tsx）は、Supabase Realtime の
--   postgres_changes で "Notification" の INSERT を購読していたが、購読は毎回
--   「invalid column for filter userId」で失敗していた（DB のログに 1 日数百回）。
--   原因は、ブラウザ側のロール anon に public の表を読む権限が無いこと。
--   Realtime は購読者のロールで列の権限を確かめるので、anon には列が 1 つも見えず、
--   filter に書いた userId 列が「無い」と判定される。
--   権限を与えると、公開キーを持つ人なら誰でも Data API から通知を読めてしまうので、
--   権限は与えない。代わりに、DB が「新着があった」ことだけを broadcast で知らせる。
--
-- やること:
--   "Notification" に行が入るたびに、公開トピック notification-<userId> へ
--   イベント new（中身は通知の id だけ）を送るトリガを張る。
--   ブラウザ側は同じトピックの broadcast を聞いて、未読数の再取得を行う。
--
-- 影響:
--   * 通知の作成（lib/notifications.ts → prisma.notification.create）に、1 行ごとに
--     realtime.messages への insert が 1 つ増える。realtime.send は失敗しても
--     WARNING を出すだけで、通知の作成を止めない
--   * 届く中身は通知の id だけ。本文・URL は入れない（公開トピックのため）
--   * トリガを張る一瞬だけ "Notification" への書き込みが待つ。3 秒で取れなければ中止
--
-- 適用: prisma db execute --file docs/manual-migrations/2026-10-03_notification_broadcast.sql
--       （2026-10-03 は Claude（Cowork）が Supabase 経由で適用）
-- 戻し方: drop trigger notification_broadcast_new on public."Notification";
--         drop function public.notification_broadcast_new();
-- ============================================================================

create or replace function public.notification_broadcast_new()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id),   -- 中身は id だけ（本文は入れない）
    'new',                               -- イベント名
    'notification-' || new."userId",    -- トピック（ブラウザ側の channel 名と同じ）
    false                                -- 公開トピック（ログインなしの購読を許す）
  );
  return null;
end;
$$;

comment on function public.notification_broadcast_new() is
  '通知の新着を Realtime broadcast（公開トピック notification-<userId>、イベント new）で知らせる。中身は id だけ';

do $$
begin
  perform set_config('lock_timeout', '3s', true);
  if not exists (select 1 from pg_trigger where tgname = 'notification_broadcast_new' and tgrelid = 'public."Notification"'::regclass) then
    create trigger notification_broadcast_new
      after insert on public."Notification"
      for each row execute function public.notification_broadcast_new();
  end if;
end $$;

-- 確認: 1 行出れば OK
select tgname, tgenabled from pg_trigger
 where tgrelid = 'public."Notification"'::regclass and tgname = 'notification_broadcast_new';
