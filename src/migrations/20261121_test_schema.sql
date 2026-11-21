-- 本番に apply_migration test_schema_snapshot_20261121 として適用した版（drop を外し、set local と検査を付けたもの）
-- テスト用の棚（schema test）。src/make_test_schema.py が本番の schema.sql から作った（2026-11-21 時点で固定。今後の本番の変更は入れない）
create schema if not exists test;
set local search_path = test, extensions;
do $g$ begin if current_setting('search_path') not like 'test%' then raise exception 'search_path is not test: %', current_setting('search_path'); end if; end $g$;
create or replace view test.profiles with (security_invoker = on) as select * from public.profiles;
-- ワークス台帳 v4（旧称：Aチーム統合台帳） — Supabase (PostgreSQL) スキーマ
-- 方針：
--   * すべての表に org（所属：hq＝本部／fc_a..fc_d）。本部版では全行 'hq'。
--   * id は既存のテキスト id をそのまま使う（移行で C1302 / P00012 / L284-c8d などを維持）。
--   * JS 側の項目名と列名はできるだけ同じ。予約語だけ変える（case→case_id, order→order_id, end→end_date, date→start_date）。
--   * updated_at はトリガで自動。削除は物理削除（監査が要るものは audit に残す）。
--   * 権限は RLS：profiles.role が 'hq' なら全部、'fc' なら自分の org だけ。職人・業者は専用ビュー＋トークンで読む。



-- ---------- 所属と利用者 ----------
create table if not exists orgs (
  id text primary key,            -- 'hq','fc_a','fc_b','fc_c','fc_d'
  name text not null,
  created_at timestamptz default now()
);
insert into orgs (id,name) values ('hq','本部') on conflict do nothing;



-- ---------- マスタ ----------
create table if not exists clients (            -- 依頼元
  id text primary key default ('CL'||substr(gen_random_uuid()::text,1,8)),
  org text not null default 'hq' references orgs(id),
  name text not null,
  full_name text default '',
  mail text default '',
  method text default '',         -- 請求書の様式：先方規定／弊社仕様
  close_day int default 31,       -- 締日
  site int default 30,            -- 支払サイト（日）
  note text default '',
  src text default '',
  updated_at timestamptz default now(),
  unique(org,name)
);

create table if not exists vendors (            -- 発注先（職人・業者・経費）。全社共通（org は作成元の記録）
  id text primary key default ('V'||substr(gen_random_uuid()::text,1,8)),
  org text not null default 'hq' references orgs(id),
  name text not null unique,
  full_name text default '',
  type text default '外注',        -- 専属／外注／経費
  def_kind text default '',       -- 既定の工程区分
  inv text default '',            -- インボイス登録番号
  bank text default '',
  close_day int default 30,
  site int default 30,
  phone text default '',
  email text default '',
  taxable boolean default true,   -- 課税事業者か（インボイス登録あり）。false＝免税事業者：発注は税抜金額のまま（消費税を足さない）
  token text unique default encode(gen_random_bytes(12),'hex'),  -- 職人ページ用の個人リンク
  active boolean default true,
  src text default '',
  updated_at timestamptz default now()
);

create table if not exists prices (             -- 単価表
  id text primary key,
  org text not null default 'hq' references orgs(id),
  name text not null,
  alias text default '',          -- 別名（／区切り）
  kind text default '',
  unit text default '式',
  price int default 0,
  who text default '',            -- 既定の発注先
  client text default '',         -- 依頼元別単価（空＝共通）
  memo text default '',
  updated_at timestamptz default now()
);

-- ---------- 案件 ----------
create table if not exists cases (
  id text primary key,
  org text not null default 'hq' references orgs(id),
  client text default '',         -- 依頼元名（clients.name）
  prop text default '',           -- 物件名＋号室
  kind text default '',
  st text default '受注',          -- 受注／施工中／完工／請求済 …
  live boolean default true,      -- 運用中
  ord text default '未',           -- 発注：未／済
  ord_by text default '',         -- 'order'＝発注から自動／'' ＝手動
  sales int default 0,            -- 売上税抜
  add_amt int default 0,          -- 追加
  bill text default '',           -- 請求月 YYYY-MM
  kisan date,                     -- 起算日
  want date,                      -- 依頼元の完了希望日
  plan date,                      -- 弊社の完了予定日
  plan_manual boolean default false,
  done date,                      -- 完工日
  keyx text default '',           -- 鍵交換（'有'／''）
  warr text default '',           -- 設備保証（'有'／''）
  recv text default '',           -- 受注受付の受付ID（inbox.key）
  case_no text default '',        -- 案件番号
  src text default '',
  memo text default '',
  items text default '',
  report text default '',
  photo text default '',
  addr text default '',           -- 現場住所（職人ページ用）
  key_info text default '',       -- 鍵情報（キーボックスの場所・番号など。発注書に出す）
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table cases add column if not exists key_info text default '';
alter table cases add column if not exists madori text default '';     -- 間取り（1R／1K／1DK／1LDK／2K／2DK／2LDK／3K以上）。検査のボリュームに使う
alter table vendors add column if not exists kinds text default '';    -- 担当できる区分（カンマ区切り。例：清掃,AW検査）。兼任できる。空なら既定の工程区分だけ
create index if not exists cases_org_live on cases(org,live);
create index if not exists cases_client on cases(client);
create index if not exists cases_done on cases(done);

create table if not exists procs (               -- 工程
  id text primary key,
  org text not null default 'hq' references orgs(id),
  case_id text not null references cases(id) on delete cascade,
  kind text default '',
  who text default '',            -- 発注先名
  start_date date,
  end_date date,
  amt int default 0,              -- 発注金額（税抜。2026-11 から。それより前の外注には税込で入っているものがある）
  month text default '',          -- 支払月
  prog text default '',           -- 完了など
  order_id text default '',
  auto boolean default false,     -- 発注から自動生成
  memo text default '',
  updated_at timestamptz default now()
);
create index if not exists procs_case on procs(case_id);
create index if not exists procs_who_date on procs(who,start_date);

alter table procs add column if not exists ask text default '';      -- 日程の打診：''／打診中／受諾／辞退:業者名（断られたら工程の業者は空に戻る）
alter table procs add column if not exists ask_at timestamptz;          -- 打診・返事の日時
create table if not exists lines (               -- 明細
  id text primary key,
  org text not null default 'hq' references orgs(id),
  case_id text not null references cases(id) on delete cascade,
  no int,                         -- 依頼元の行番号
  name text default '',
  spec text default '',           -- 場所
  qty numeric default 1,
  unit text default '式',
  sell int default 0,             -- 販売単価
  price int default 0,            -- 原価単価
  kind text default '',
  who text default '',
  memo text default '',
  cut boolean default false,      -- 依頼元が落とした行
  src text default '',            -- 'PO'＝依頼元の発注書から
  order_id text default '',
  updated_at timestamptz default now()
);
create index if not exists lines_case on lines(case_id);

create table if not exists orders (              -- 発注
  id text primary key,
  org text not null default 'hq' references orgs(id),
  no text unique,                 -- AW-H0001
  case_id text not null references cases(id) on delete cascade,
  who text default '',
  kind text default '',
  start_date date,
  end_date date,
  due date,                       -- 回答期限
  naiyo text default '',
  memo text default '',
  st text default '下書き',         -- 下書き／送付済／承諾／完了／請求済
  sent timestamptz,
  accepted_at timestamptz,        -- 業者が承諾した日時
  accepted_by text default '',
  token text unique default encode(gen_random_bytes(12),'hex'),  -- 業者の承諾ページ用URL
  proc_id text default '',
  taxable boolean default true,   -- 発注した時点の発注先の課税区分。false＝消費税を足さない（免税事業者）
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table vendors add column if not exists taxable boolean default true;
alter table orders add column if not exists taxable boolean default true;
create index if not exists orders_case on orders(case_id);
create index if not exists orders_who on orders(who);

-- ---------- 入金・支払・休み・設定 ----------
create table if not exists receipts (            -- 入金 recv：依頼元×月
  org text not null default 'hq' references orgs(id),
  client text not null,
  month text not null,
  amount int default 0,
  updated_at timestamptz default now(),
  primary key(org,client,month)
);
create table if not exists payments (            -- 支払済 paid：発注先×月
  org text not null default 'hq' references orgs(id),
  who text not null,
  month text not null,
  amount int default 0,
  updated_at timestamptz default now(),
  primary key(org,who,month)
);
create table if not exists days_off (            -- 職人の休み
  org text not null default 'hq' references orgs(id),
  who text not null,
  month text not null,
  days int[] default '{}',
  primary key(org,who,month)
);
create table if not exists settings (            -- 計上基準など
  org text not null default 'hq' references orgs(id),
  key text not null,
  value jsonb,
  primary key(org,key)
);

-- ---------- 受注受付（定期タスク・GAS が書く） ----------
create table if not exists inbox (
  key text primary key,           -- 受付ID
  org text not null default 'hq' references orgs(id),
  case_no text default '',
  client text default '',
  order_no text default '',
  prop text default '',
  room text default '',
  prop_code text default '',
  recv_date date,
  net int default 0, tax int default 0, gross int default 0,
  estimate int default 0,
  plan date, move_in date, cancel date,
  memo text default '', items text default '', url text default '',
  po_lines jsonb,                 -- 依頼元の発注書の明細（配列）
  merged_case text default '',    -- 台帳に取り込んだ案件 id
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------- 採番 ----------
create table if not exists counters (
  org text not null references orgs(id),
  name text not null,
  value bigint not null default 0,
  primary key(org,name)
);
insert into counters(org,name,value) values ('hq','order',0),('hq','case',0),('hq','proc',0),('hq','line',0),('hq','price',0)
  on conflict do nothing;

create or replace function next_no(p_org text, p_name text) returns bigint
language sql security definer as $$
  insert into counters(org,name,value) values (p_org,p_name,1)
  on conflict (org,name) do update set value = counters.value + 1
  returning value;
$$;

-- ---------- updated_at ----------
-- ---------- 完了報告と業者の請求（業者ページから） ----------
create table if not exists reports (            -- 完了報告：工程1つに1つ（出し直しは上書き）
  id text primary key default ('R'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  proc_id text not null unique,
  case_id text not null references cases(id) on delete cascade,
  who text default '',
  done_date date,
  note text default '',           -- 業者のコメント
  base int default 0,             -- 報告した時点の発注金額（税抜）
  extra int default 0,            -- 追加金額（税抜）。スタッフが承認すると工程の金額に足される
  extra_note text default '',     -- 追加の理由
  photos jsonb default '[]',      -- 保存領域 reports の中の場所の一覧
  st text default '報告済',        -- 報告済／承認／差し戻し
  reply text default '',          -- 差し戻しの理由
  approved_at timestamptz,
  invoice_id text default '',     -- 請求書・支払明細書に載ったら入る（二重請求を防ぐ）
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists invoices (           -- 業者の請求書（業者が発行）／支払明細書（会社が発行）：発注先×締め期間
  id text primary key default ('I'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  who text not null,
  kind text default '請求書',      -- 請求書／支払明細書
  month text default '',          -- 締めた月 '2026-11'
  period_from date,
  period_to date,
  items jsonb default '[]',       -- 載せた完了報告の写し（物件・区分・完了日・金額）
  subtotal int default 0,         -- 税抜
  tax int default 0,
  total int default 0,
  taxable boolean default true,   -- 発行した時点の発注先の課税区分
  inv text default '',            -- 発行した時点の登録番号（インボイス）
  st text default '発行',          -- 発行／確認済（業者が支払明細書を確認）／支払済
  issued_at timestamptz default now(),
  confirmed_at timestamptz,
  paid_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists photos (             -- 写真台帳：案件ごと・区分ごと（現地調査／清掃／クロス貼替／リペア／その他／完了検査）。1枚1行
  id text primary key default ('F'||substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  org text not null default 'hq' references orgs(id),
  case_id text not null references cases(id) on delete cascade,
  proc_id text default '',        -- どの工程から入れたか
  who text default '',            -- 入れた人（発注先名。社員も発注先として登録して業者ページから入れる）
  cat text not null default 'その他',
  phase text default '',          -- 前／後／''（清掃・クロス貼替・リペアは施工前後を分ける）
  path text not null unique,      -- 保存領域 reports の中の場所
  created_at timestamptz default now()
);
create index if not exists photos_case on photos(case_id);
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['clients','vendors','prices','cases','procs','lines','orders','receipts','payments','inbox','reports','invoices'] loop
    execute format('create trigger touch_%1$s before update on %1$s for each row execute function touch_updated_at();', t);
  end loop; end $$;

-- ---------- 監査（消した・直した記録。後で「誰がいつ」を追える） ----------
create table if not exists audit (
  id bigserial primary key,
  at timestamptz default now(),
  uid uuid default auth.uid(),
  tbl text, op text, row_id text, before jsonb, after jsonb
);
create or replace function audit_row() returns trigger language plpgsql security definer as $$
begin
  if tg_op='DELETE' then insert into audit(tbl,op,row_id,before) values (tg_table_name,tg_op,old.id,to_jsonb(old)); return old;
  elsif tg_op='UPDATE' then insert into audit(tbl,op,row_id,before,after) values (tg_table_name,tg_op,new.id,to_jsonb(old),to_jsonb(new)); return new;
  else insert into audit(tbl,op,row_id,after) values (tg_table_name,tg_op,new.id,to_jsonb(new)); return new; end if;
end $$;
do $$ declare t text; begin
  foreach t in array array['cases','procs','lines','orders'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_row();', t);
  end loop; end $$;

-- ---------- 権限（RLS） ----------
create or replace function my_role() returns text language sql stable security definer as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'none') $$;
create or replace function my_org() returns text language sql stable security definer as $$
  select coalesce((select org from public.profiles where id = auth.uid()), '') $$;
-- 読める：本部管理者は全部、それ以外は自 org。書ける：本部管理者と staff（自 org）。
do $$ declare t text; begin
  foreach t in array array['clients','vendors','prices','cases','procs','lines','orders','receipts','payments','days_off','settings','inbox','reports','invoices','photos'] loop
    execute format('alter table %1$s enable row level security;', t);
    execute format('create policy sel_%1$s on %1$s for select using (my_role()=''hq'' or org=my_org());', t);
    execute format('create policy ins_%1$s on %1$s for insert with check (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t);
    execute format('create policy upd_%1$s on %1$s for update using (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t);
    execute format('create policy del_%1$s on %1$s for delete using (my_role()=''hq'' or (my_role()=''staff'' and org=my_org()));', t);
  end loop; end $$;
alter table orgs enable row level security;
create policy sel_orgs on orgs for select using (true);
alter table counters enable row level security;   -- next_no() は security definer なので直接は触れない
alter table audit enable row level security;
create policy sel_audit on audit for select using (my_role()='hq');

-- 新規ユーザーに profile を自動で作る（役割は本部が後で直す）


-- ---------- 職人・業者向け（ログイン無し、トークンで） ----------
-- 職人：自分の工程（vendors.token で引く）。業者：発注1件（orders.token で引く）。anon から RPC だけ許す。
-- 鍵情報（key_info）も返す（職人が現場に入るのに要る）。戻り値の形を変えるので drop してから作る。
create or replace function my_schedule(p_token text, p_from date, p_to date)
returns table(proc_id text, case_id text, prop text, addr text, kind text, start_date date, end_date date, prog text, memo text, client text, key_info text)
language sql security definer stable as $$
  select p.id, c.id, c.prop, c.addr, p.kind, p.start_date, p.end_date, p.prog, p.memo, c.client,
    -- 鍵情報は作業日の前後だけ（開始の3日前〜終了の翌日。日本時間）。それ以外は案内だけ返す（URL が漏れたときの被害を小さく）
    case when coalesce(c.key_info,'')='' then ''
         when (now() at time zone 'Asia/Tokyo')::date between p.start_date-3 and coalesce(p.end_date,p.start_date)+1 then c.key_info
         else '（作業日の3日前から表示されます）' end
  from procs p join cases c on c.id=p.case_id join vendors v on v.name=p.who
  where v.token=p_token and v.active and coalesce(p.ask,'')<>'打診中'      -- 打診中は出さない（受けたら出る）
    and p.start_date<=p_to and coalesce(p.end_date,p.start_date)>=p_from   -- 期間に少しでも掛かる工程（前の週から続く工程も出す）
  order by p.start_date, c.prop $$;
-- 業者ページの工程（今はこちらを使う）：my_schedule に、発注金額（amt・税抜）と完了報告（rep）を足したもの
create or replace function my_jobs(p_token text, p_from date, p_to date)
returns table(proc_id text, case_id text, prop text, addr text, kind text, start_date date, end_date date, prog text, memo text, client text, key_info text,
              amt int, rep jsonb)
language sql security definer stable as $$
  select s.*, coalesce(p.amt,0),
    (select jsonb_build_object('st',r.st,'reply',r.reply,'done_date',r.done_date,'note',r.note,'extra',r.extra,'extra_note',r.extra_note,
        'photos',r.photos,'billed',r.invoice_id<>'') from reports r where r.proc_id=s.proc_id)
  from my_schedule(p_token,p_from,p_to) s join procs p on p.id=s.proc_id $$;
-- 発注書 2ページ目の工程表用に、同じ案件の全工程（procs）と完了予定日（plan）も返す。鍵情報（key_info）も返す。
-- 他社の名前・金額は出さない（区分・日付・工事内容だけ）。mine＝この発注の工程。戻り値の形を変えるので drop してから作る。
-- 発注先が免税事業者なら消費税を足さない（taxable）も返す。
create or replace function order_view(p_token text)
returns table(order_no text, who text, kind text, start_date date, end_date date, due date, naiyo text, memo text, st text, accepted_at timestamptz,
              prop text, addr text, client text, lines jsonb, plan date, procs jsonb, key_info text, taxable boolean)
language sql security definer stable as $$
  select o.no, o.who, o.kind, o.start_date, o.end_date, o.due, o.naiyo, o.memo, o.st, o.accepted_at, c.prop, c.addr, c.client,
    (select jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',l.qty,'unit',l.unit,'price',l.price,'memo',l.memo) order by l.no) from lines l where l.order_id=o.id),
    c.plan,
    (select jsonb_agg(jsonb_build_object('kind',p.kind,'start_date',p.start_date,'end_date',p.end_date,'prog',p.prog,
        'mine',(p.order_id=o.id or p.id=o.proc_id),
        -- 区分ごとの工事内容：その工程の発注の「内容」と、同じ区分の明細（場所＋名称。落とした行・数量0は除く）
        'naiyo',(select o2.naiyo from orders o2 where o2.id=p.order_id and p.order_id<>''),
        'items',(select jsonb_agg(trim(coalesce(l.spec,'')||' '||l.name) order by l.no, l.id) from lines l
                 where l.case_id=p.case_id and l.kind=p.kind and p.kind<>'' and not l.cut and l.qty>0)
      ) order by p.start_date nulls last, p.id) from procs p where p.case_id=o.case_id),
    c.key_info, coalesce(o.taxable,true)
  from orders o join cases c on c.id=o.case_id where o.token=p_token
    and not exists (select 1 from vendors v where v.name=o.who and not v.active) $$;   -- 無効にした発注先への発注書は開けない
create or replace function order_accept(p_token text, p_by text) returns boolean
language sql security definer as $$
  update orders o set st='承諾', accepted_at=now(), accepted_by=coalesce(p_by,'') where o.token=p_token and o.st in ('送付済','下書き')
    and not exists (select 1 from vendors v where v.name=o.who and not v.active) returning true $$;   -- 無効にした発注先は承諾できない
create or replace function proc_done(p_token text, p_proc text, p_done boolean) returns boolean
language sql security definer as $$
  update procs p set prog = case when p_done then '完了' else '' end
  from vendors v where v.token=p_token and v.active and v.name=p.who and p.id=p_proc returning true $$;   -- 無効にした発注先のリンクでは変えられない
create or replace function my_vendor(p_token text) returns table(name text, type text)
language sql security definer stable as $$ select name, type from vendors where token=p_token and active $$;
-- 業者ページ（me.html）の「発注」一覧：その発注先への発注（送付済み以降。下書きは出さない）。金額は明細の合計（税抜）
create or replace function my_orders(p_token text)
returns table(order_no text, order_token text, prop text, client text, kind text, start_date date, end_date date, due date,
              st text, accepted_at timestamptz, amount numeric, taxable boolean, sent timestamptz)
language sql security definer stable as $$
  select o.no, o.token, c.prop, c.client, o.kind, o.start_date, o.end_date, o.due, o.st, o.accepted_at,
    coalesce((select sum(round(coalesce(l.qty,0)*coalesce(l.price,0))) from lines l where l.order_id=o.id),0),
    coalesce(o.taxable,true), o.sent
  from vendors v join orders o on o.who=v.name join cases c on c.id=o.case_id
  where v.token=p_token and v.active and o.st in ('送付済','承諾','完了','請求済')
  order by case o.st when '送付済' then 0 when '承諾' then 1 else 2 end, o.start_date nulls last, o.no $$;
-- 業者ページのリンクを作り直す（リンクが漏れたとき）。台帳にログインしたスタッフだけ。古いリンクはすぐ使えなくなる
create or replace function reset_vendor_token(p_name text) returns text
language plpgsql security definer as $$
declare t text;
begin
  if my_role() not in ('hq','staff') then raise exception 'not allowed'; end if;
  t := substr(replace(gen_random_uuid()::text,'-',''),1,24);
  update vendors set token=t where name=p_name;
  return t;
end $$;
-- ---------- 業者ページ：日程の打診（工程を組む画面の予定表から） ----------
-- 業者ページ：自分への打診（返事待ち）。鍵情報・金額は出さない
create or replace function my_asks(p_token text)
returns table(proc_id text, prop text, addr text, client text, kind text, start_date date, end_date date, asked_at timestamptz)
language sql security definer stable as $$
  select p.id, c.prop, c.addr, c.client, p.kind, p.start_date, p.end_date, p.ask_at
  from procs p join cases c on c.id=p.case_id join vendors v on v.name=p.who
  where v.token=p_token and v.active and p.ask='打診中'
  order by p.start_date, c.prop $$;

-- 業者ページ：打診に返事。受ける→'受諾'。都合が悪い→工程の業者を空に戻し '辞退:業者名'
create or replace function answer_ask(p_token text, p_proc text, p_ok boolean)
returns text language plpgsql security definer as $$
declare nm text; r text;
begin
  select name into nm from vendors where token=p_token and active; if nm is null then return 'ng'; end if;
  update procs set ask=case when p_ok then '受諾' else '辞退:'||nm end,
                   who=case when p_ok then who else '' end, ask_at=now()
   where id=p_proc and who=nm and ask='打診中' returning ask into r;
  return coalesce(r,'ng');
end $$;

-- ---------- 業者ページ：検査の予定とボリューム ----------
-- 検査（AW検査）の工程ごとに：間取り（無ければ発注内容・明細の文字から推測）、自社施工の明細の行数、
-- 同じ現場の他の工程（区分・業者・完了報告の状態）、写真の枚数。業者ページで「大・中・小」と「検査に行ってよいか」を出す
create or replace function my_inspections(p_token text, p_from date, p_to date)
returns table(proc_id text, madori text, madori_guess boolean, self_lines int, works jsonb, photos int, cfg jsonb)
language sql security definer stable as $$
  select p.id,
    coalesce(nullif(c.madori,''), substring(coalesce(c.memo,'')||' '||coalesce(c.items,'')||' '||coalesce(c.prop,'')||' '||
      coalesce((select string_agg(l.name,' ') from lines l where l.case_id=c.id),'') from '([1-4](?:SLDK|LDK|DK|K|R))')),
    coalesce(c.madori,'')='',
    (select count(*)::int from lines l where l.case_id=c.id and l.kind='自社施工' and coalesce(l.qty,0)>0),
    (select coalesce(jsonb_agg(jsonb_build_object('kind',q.kind,'who',q.who,'prog',q.prog,
        'report',(select r.st from reports r where r.proc_id=q.id)) order by q.start_date nulls last),'[]'::jsonb)
      from procs q where q.case_id=c.id and q.id<>p.id and q.kind not in ('AW検査','検査','現地調査')),
    (select count(*)::int from photos f where f.case_id=c.id),
    (select value from settings s where s.org=c.org and s.key='cfg')
  from vendors v join procs p on p.who=v.name join cases c on c.id=p.case_id
  where v.token=p_token and v.active and p.kind in ('AW検査','検査')
    and p.start_date<=p_to and coalesce(p.end_date,p.start_date)>=p_from $$;
-- ---------- 写真台帳 ----------
-- 業者ページから写真を登録（写真の本体は先に保存領域へ送ってある）。自分の工程の案件にだけ。場所は自分のリンクのフォルダだけ
create or replace function add_photos(p_token text, p_proc text, p_cat text, p_phase text, p_paths jsonb) returns int
language plpgsql security definer as $$
declare v vendors; p procs; n int;
begin
  select * into v from vendors where token=p_token and active; if not found then return 0; end if;
  select * into p from procs where id=p_proc and who=v.name; if not found then return 0; end if;
  insert into photos(org,case_id,proc_id,who,cat,phase,path)
  select p.org, p.case_id, p.id, v.name, coalesce(nullif(p_cat,''),'その他'), coalesce(p_phase,''), x
  from jsonb_array_elements_text(coalesce(p_paths,'[]'::jsonb)) x where x like p_token||'/%'
  on conflict (path) do nothing;
  get diagnostics n = row_count; return n;
end $$;
-- 業者ページ：その工程の案件で、自分が入れた写真
create or replace function my_photos(p_token text, p_proc text) returns table(id text, cat text, phase text, path text, created_at timestamptz)
language sql security definer stable as $$
  select f.id, f.cat, f.phase, f.path, f.created_at from vendors v join procs p on p.who=v.name and p.id=p_proc
    join photos f on f.case_id=p.case_id and f.who=v.name
  where v.token=p_token and v.active order by f.created_at $$;
-- 業者ページ：自分が入れた写真を外す（その工程の完了報告が承認される前だけ）。本体は画面から保存領域で消す
create or replace function del_my_photo(p_token text, p_id text) returns boolean
language sql security definer as $$
  delete from photos f using vendors v where v.token=p_token and v.active and f.who=v.name and f.id=p_id
    and not exists (select 1 from reports r where r.proc_id=f.proc_id and r.st='承認') returning true $$;
-- 台帳：案件の写真（スタッフだけ）
create or replace function case_photos(p_case text) returns table(id text, proc_id text, who text, cat text, phase text, path text, created_at timestamptz)
language sql security definer stable as $$
  select f.id, f.proc_id, f.who, f.cat, f.phase, f.path, f.created_at from photos f
  where f.case_id=p_case and my_role() in ('hq','staff','viewer') and (my_role()='hq' or f.org=my_org()) order by f.cat, f.phase, f.created_at $$;
-- 台帳（スタッフ）がパソコンから写真を入れる。場所は保存領域の staff/ の下。工程が無くても案件に入れられる
create or replace function staff_add_photos(p_case text, p_cat text, p_phase text, p_paths jsonb) returns int
language plpgsql security definer as $$
declare c cases; n int; who text;
begin
  if my_role() not in ('hq','staff') then return 0; end if;
  select * into c from cases where id=p_case; if not found then return 0; end if;
  if my_role()<>'hq' and c.org<>my_org() then return 0; end if;
  select coalesce(nullif(name,''),email,'スタッフ') into who from public.profiles where id=auth.uid();
  insert into photos(org,case_id,proc_id,who,cat,phase,path)
  select c.org, c.id, '', coalesce(who,'スタッフ'), coalesce(nullif(p_cat,''),'その他'), coalesce(p_phase,''), x
  from jsonb_array_elements_text(coalesce(p_paths,'[]'::jsonb)) x where x like 'staff/%'
  on conflict (path) do nothing;
  get diagnostics n = row_count; return n;
end $$;
-- 台帳（スタッフ）が写真を外す。外した写真の場所を返す（本体は画面から保存領域で消す）
create or replace function staff_del_photo(p_id text) returns text
language sql security definer as $$
  delete from photos f where f.id=p_id and my_role() in ('hq','staff') and (my_role()='hq' or f.org=my_org()) returning f.path $$;
-- ---------- 業者ページ：完了報告・請求 ----------
-- 業者ページのリンク（vendors.token）が有効か。写真の保存領域のきまり（anon が自分のフォルダにだけ置ける）で使う
create or replace function vendor_token_ok(p_token text) returns boolean
language sql security definer stable as $$ select exists(select 1 from vendors where token=p_token and active) $$;
-- 締め期間：締日（1〜27。28 以上は月末）で、その月に締める期間を返す。例：5日締めの 2026-11 → 10/6〜11/5
create or replace function close_period(p_month text, p_close int) returns table(pfrom date, pto date)
language sql immutable as $$
  with m as (select to_date(p_month||'-01','YYYY-MM-DD') d0)
  select case when coalesce(p_close,31)>=28 then d0 else ((d0 - interval '1 month')::date + least(p_close,27)) end,
         case when coalesce(p_close,31)>=28 then (d0 + interval '1 month' - interval '1 day')::date else d0 + (least(p_close,27)-1) end
  from m $$;
-- 完了報告を出す（出し直しは上書き）。承認済み・請求済みは出し直せない。出すと工程は「完了」
create or replace function submit_report(p_token text, p_proc text, p_done date, p_note text, p_extra int, p_extra_note text, p_photos jsonb)
returns boolean language plpgsql security definer as $$
declare v vendors; p procs;
begin
  select * into v from vendors where token=p_token and active; if not found then return false; end if;
  select * into p from procs where id=p_proc and who=v.name; if not found then return false; end if;
  if exists(select 1 from reports where proc_id=p_proc and (st='承認' or invoice_id<>'')) then return false; end if;
  insert into reports(org,proc_id,case_id,who,done_date,note,base,extra,extra_note,photos,st,reply)
  values(p.org,p.id,p.case_id,v.name,coalesce(p_done,(now() at time zone 'Asia/Tokyo')::date),coalesce(p_note,''),coalesce(p.amt,0),
         greatest(coalesce(p_extra,0),0),coalesce(p_extra_note,''),coalesce(p_photos,'[]'::jsonb),'報告済','')
  on conflict (proc_id) do update set done_date=excluded.done_date, note=excluded.note, base=excluded.base, extra=excluded.extra,
    extra_note=excluded.extra_note, photos=excluded.photos, st='報告済', reply='';
  update procs set prog='完了' where id=p.id;
  return true;
end $$;
-- 完了報告を取り消す（承認前だけ）。工程の「完了」も外す
create or replace function cancel_report(p_token text, p_proc text) returns boolean
language plpgsql security definer as $$
declare v vendors;
begin
  select * into v from vendors where token=p_token and active; if not found then return false; end if;
  if not exists(select 1 from procs where id=p_proc and who=v.name) then return false; end if;
  if exists(select 1 from reports where proc_id=p_proc and (st='承認' or invoice_id<>'')) then return false; end if;
  delete from reports where proc_id=p_proc;
  update procs set prog='' where id=p_proc;
  return true;
end $$;
-- 業者ページの「請求」：発注先の情報、完了報告（まだ請求書に載っていないもの）、請求書・支払明細書の一覧
create or replace function my_billing(p_token text) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'vendor', jsonb_build_object('name',v.name,'full',v.full_name,'inv',v.inv,'taxable',coalesce(v.taxable,true),'close',v.close_day),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('proc_id',r.proc_id,'prop',c.prop,'kind',p.kind,'done_date',r.done_date,
                'base',r.base,'extra',r.extra,'extra_note',r.extra_note,'st',r.st,'reply',r.reply) order by r.done_date),'[]'::jsonb)
              from reports r join procs p on p.id=r.proc_id join cases c on c.id=r.case_id where r.who=v.name and r.invoice_id=''),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i)-'org' order by i.issued_at desc),'[]'::jsonb) from invoices i where i.who=v.name))
  from vendors v where v.token=p_token and v.active $$;
-- 業者が請求書を発行する：締め期間内の「承認」済みで、まだ請求書に載っていない完了報告をまとめる。発行した ID を返す
create or replace function issue_invoice(p_token text, p_month text) returns text
language plpgsql security definer as $$
declare v vendors; pf date; pt date; its jsonb; sub int; tx int; nid text;
begin
  select * into v from vendors where token=p_token and active; if not found then raise exception 'link'; end if;
  select pfrom,pto into pf,pt from close_period(p_month,v.close_day);
  select coalesce(jsonb_agg(jsonb_build_object('report_id',r.id,'proc_id',r.proc_id,'prop',c.prop,'kind',p.kind,'done_date',r.done_date,
           'base',r.base,'extra',r.extra,'extra_note',r.extra_note) order by r.done_date),'[]'::jsonb), coalesce(sum(r.base+r.extra),0)
    into its, sub
    from reports r join procs p on p.id=r.proc_id join cases c on c.id=r.case_id
    where r.who=v.name and r.st='承認' and r.invoice_id='' and r.done_date between pf and pt;
  if jsonb_array_length(its)=0 then raise exception 'empty'; end if;
  tx := case when coalesce(v.taxable,true) then round(sub*0.1) else 0 end;
  insert into invoices(org,who,kind,month,period_from,period_to,items,subtotal,tax,total,taxable,inv)
  values(v.org,v.name,'請求書',p_month,pf,pt,its,sub,tx,sub+tx,coalesce(v.taxable,true),coalesce(v.inv,'')) returning id into nid;
  update reports set invoice_id=nid where id in (select x->>'report_id' from jsonb_array_elements(its) x);
  return nid;
end $$;
-- 会社が出した支払明細書を、業者が「内容を確認した」にする
create or replace function confirm_statement(p_token text, p_id text) returns boolean
language sql security definer as $$
  update invoices i set st='確認済', confirmed_at=now() from vendors v
  where v.token=p_token and v.active and i.who=v.name and i.id=p_id and i.kind='支払明細書' and i.st='発行' returning true $$;
-- 写真の保存量（スタッフが台帳で見る）。無料枠は 1GB
do $$ begin
  if exists (select 1 from pg_namespace where nspname='storage') then
    execute $f$create or replace function photo_usage() returns jsonb language sql security definer stable set search_path = test, extensions as $b$
      select case when my_role() in ('hq','staff','viewer') then
        (select jsonb_build_object('bytes',coalesce(sum((metadata->>'size')::bigint),0),'files',count(*)) from storage.objects where bucket_id='reports-test')
      else '{}'::jsonb end $b$ $f$;
    execute 'revoke execute on function photo_usage() from public, anon';
    execute 'grant execute on function photo_usage() to authenticated';
  end if;
end $$;
-- 完了報告の写真：非公開の保存領域 reports。業者は自分のリンクの名前のフォルダにだけ置ける・見られる。スタッフは全部見られる
do $$ begin
  if exists (select 1 from pg_namespace where nspname='storage') then
    insert into storage.buckets(id,name,public) values ('reports-test','reports-test',false) on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reportstest_vendor_insert') then
      execute $p$create policy reportstest_vendor_insert on storage.objects for insert to anon, authenticated
        with check (bucket_id='reports-test' and test.vendor_token_ok((storage.foldername(name))[1]))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reportstest_vendor_select') then
      execute $p$create policy reportstest_vendor_select on storage.objects for select to anon
        using (bucket_id='reports-test' and test.vendor_token_ok((storage.foldername(name))[1]))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reportstest_vendor_delete') then
      execute $p$create policy reportstest_vendor_delete on storage.objects for delete to anon
        using (bucket_id='reports-test' and test.vendor_token_ok((storage.foldername(name))[1]))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reportstest_staff_insert') then
      execute $p$create policy reportstest_staff_insert on storage.objects for insert to authenticated
        with check (bucket_id='reports-test' and (storage.foldername(name))[1]='staff' and test.my_role() in ('hq','staff'))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reportstest_staff_delete') then
      execute $p$create policy reportstest_staff_delete on storage.objects for delete to authenticated
        using (bucket_id='reports-test' and test.my_role() in ('hq','staff'))$p$; end if;
    if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reportstest_staff_select') then
      execute $p$create policy reportstest_staff_select on storage.objects for select to authenticated
        using (bucket_id='reports-test' and test.my_role() in ('hq','staff','viewer'))$p$; end if;
  end if;
end $$;
grant execute on function my_schedule(text,date,date), order_view(text), order_accept(text,text), proc_done(text,text,boolean), my_vendor(text) to anon, authenticated;

-- ---------- Realtime（他の人の変更を画面に流す） ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'alter publication supabase_realtime add table cases, procs, lines, orders, vendors, clients, prices';
  end if;
exception when others then null; end $$;
do $$ begin   -- 後から足した表（上の add がすでに済んでいると、まとめて足すと失敗するので別に）
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'alter publication supabase_realtime add table reports, invoices';
  end if;
exception when others then null; end $$;

-- ---------- 仕上げ：security definer 関数の search_path 固定、anon に不要な実行権を外す ----------
do $$ declare f text; begin
  foreach f in array array['next_no(text,text)','my_role()','my_org()','audit_row()','my_schedule(text,date,date)','order_view(text)','order_accept(text,text)','proc_done(text,text,boolean)','my_vendor(text)','my_orders(text)','reset_vendor_token(text)','my_jobs(text,date,date)','my_inspections(text,date,date)','my_asks(text)','answer_ask(text,text,boolean)','close_period(text,int)','add_photos(text,text,text,text,jsonb)','my_photos(text,text)','del_my_photo(text,text)','case_photos(text)','staff_add_photos(text,text,text,jsonb)','staff_del_photo(text)','vendor_token_ok(text)','submit_report(text,text,date,text,int,text,jsonb)','cancel_report(text,text)','my_billing(text)','issue_invoice(text,text)','confirm_statement(text,text)'] loop
    execute format('alter function %s set search_path = test, extensions', f);
  end loop; end $$;
revoke execute on function next_no(text,text) from anon;

-- ---------- 関数の実行権（Supabase は PUBLIC に既定で execute を与えるため明示的に外す） ----------
alter function touch_updated_at() set search_path = test, extensions;
revoke execute on function audit_row() from public, anon, authenticated;

revoke execute on function touch_updated_at() from public, anon, authenticated;
-- my_role() / my_org() は RLS のポリシーが呼ぶ。ログインしていない（anon）リクエストでも表に触るとポリシーが評価されるので、
-- anon にも実行権が要る（無いと「permission denied for function my_org」になる。ログイン切れの時に起きた）。
-- 返すのは 'none' と '' だけなので、anon が呼べても行は見えない。本番は 2026-11-18 の migration grant_my_org_role_to_anon で適用済み。
revoke execute on function my_role() from public;
revoke execute on function my_org() from public;
grant execute on function my_role(), my_org() to anon, authenticated;
revoke execute on function next_no(text,text) from public, anon;
grant execute on function next_no(text,text) to authenticated;
revoke execute on function my_schedule(text,date,date), order_view(text), order_accept(text,text), proc_done(text,text,boolean), my_vendor(text) from public;
grant execute on function my_schedule(text,date,date), order_view(text), order_accept(text,text), proc_done(text,text,boolean), my_vendor(text) to anon, authenticated;
revoke execute on function my_orders(text) from public;
grant execute on function my_orders(text) to anon, authenticated;
revoke execute on function add_photos(text,text,text,text,jsonb), my_photos(text,text), del_my_photo(text,text), case_photos(text) from public;
grant execute on function add_photos(text,text,text,text,jsonb), my_photos(text,text), del_my_photo(text,text) to anon, authenticated;
revoke execute on function case_photos(text) from anon;   -- Supabase は新しい関数を anon にも既定で許すので、スタッフ専用は明示的に外す
grant execute on function case_photos(text) to authenticated;
revoke execute on function staff_add_photos(text,text,text,jsonb), staff_del_photo(text) from public, anon;
grant execute on function staff_add_photos(text,text,text,jsonb), staff_del_photo(text) to authenticated;
revoke execute on function my_inspections(text,date,date) from public;
grant execute on function my_inspections(text,date,date) to anon, authenticated;
revoke execute on function my_jobs(text,date,date) from public;
grant execute on function my_jobs(text,date,date) to anon, authenticated;
revoke execute on function vendor_token_ok(text), submit_report(text,text,date,text,int,text,jsonb), cancel_report(text,text), my_billing(text), issue_invoice(text,text), confirm_statement(text,text) from public;
grant execute on function vendor_token_ok(text), submit_report(text,text,date,text,int,text,jsonb), cancel_report(text,text), my_billing(text), issue_invoice(text,text), confirm_statement(text,text) to anon, authenticated;
revoke execute on function reset_vendor_token(text) from public, anon;
grant execute on function reset_vendor_token(text) to authenticated;
create policy none_counters on counters for select using (my_role()='hq');

-- ---------- ログイン前の役割プリセット（初回ログイン時に handle_new_user が参照） ----------


revoke execute on function my_asks(text), answer_ask(text,text,boolean) from public;
grant execute on function my_asks(text), answer_ask(text,text,boolean) to anon, authenticated;

-- テスト用の棚を画面（anon・ログインした人）から使えるように
grant usage on schema test to anon, authenticated, service_role;
grant all on all tables in schema test to anon, authenticated, service_role;
grant all on all sequences in schema test to anon, authenticated, service_role;
alter default privileges in schema test grant all on tables to anon, authenticated, service_role;
alter default privileges in schema test grant all on sequences to anon, authenticated, service_role;
-- 所属（hq ほか）は本番と同じ行を入れておく（中身のデータは空）
insert into test.orgs select * from public.orgs on conflict do nothing;
