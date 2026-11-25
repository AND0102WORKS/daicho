-- 2026-11-26 協力業者のメニュー：連絡先の欄と、業者ページの招待・利用の記録（追加のみ）
alter table vendors add column if not exists contact text default '';        -- 担当者
alter table vendors add column if not exists addr text default '';           -- 住所
alter table vendors add column if not exists invited_at timestamptz;         -- 業者ページの案内を送った日時（台帳が入れる）
alter table vendors add column if not exists seen_at timestamptz;            -- 業者が業者ページを最後に開いた日時（DB が入れる）
alter table vendors add column if not exists first_seen_at timestamptz;      -- 最初に開いた日時
-- 業者ページを開いたときに呼ぶ。1時間に1回だけ書く（開くたびに書くと、台帳の画面が何度も描き直される）
create or replace function vendor_seen(p_token text) returns boolean language sql security definer set search_path = public as $$
  update vendors set first_seen_at=coalesce(first_seen_at,now()), seen_at=now()
   where token=p_token and active and (seen_at is null or seen_at<now()-interval '1 hour') returning true $$;
revoke execute on function vendor_seen(text) from public;
grant execute on function vendor_seen(text) to anon, authenticated;
