-- 2026-11-20 日程の打診（工程を組む画面の予定表から → 業者ページで「受けられる／都合が悪い」）。足すだけ。何度実行しても同じ
-- procs.ask：''（なし）／'打診中'／'受諾'／'辞退:業者名'（断られたら工程の業者は空に戻す）。ask_at：打診・返事の日時
alter table procs add column if not exists ask text default '';
alter table procs add column if not exists ask_at timestamptz;

-- 業者の工程（my_schedule）には、打診中のものは出さない（受けたら出る）。戻り値は前と同じ
create or replace function my_schedule(p_token text, p_from date, p_to date)
returns table(proc_id text, case_id text, prop text, addr text, kind text, start_date date, end_date date, prog text, memo text, client text, key_info text)
language sql security definer stable as $$
  select p.id, c.id, c.prop, c.addr, p.kind, p.start_date, p.end_date, p.prog, p.memo, c.client,
    case when coalesce(c.key_info,'')='' then ''
         when (now() at time zone 'Asia/Tokyo')::date between p.start_date-3 and coalesce(p.end_date,p.start_date)+1 then c.key_info
         else '（作業日の3日前から表示されます）' end
  from procs p join cases c on c.id=p.case_id join vendors v on v.name=p.who
  where v.token=p_token and v.active and coalesce(p.ask,'')<>'打診中'
    and p.start_date<=p_to and coalesce(p.end_date,p.start_date)>=p_from
  order by p.start_date, c.prop $$;
alter function my_schedule(text,date,date) set search_path = public;

-- 業者ページ：自分への打診（返事待ち）。鍵情報・金額は出さない
create or replace function my_asks(p_token text)
returns table(proc_id text, prop text, addr text, client text, kind text, start_date date, end_date date, asked_at timestamptz)
language sql security definer stable as $$
  select p.id, c.prop, c.addr, c.client, p.kind, p.start_date, p.end_date, p.ask_at
  from procs p join cases c on c.id=p.case_id join vendors v on v.name=p.who
  where v.token=p_token and v.active and p.ask='打診中'
  order by p.start_date, c.prop $$;
alter function my_asks(text) set search_path = public;

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
alter function answer_ask(text,text,boolean) set search_path = public;

revoke execute on function my_asks(text), answer_ask(text,text,boolean) from public;
grant execute on function my_asks(text), answer_ask(text,text,boolean) to anon, authenticated;
