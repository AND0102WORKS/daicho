-- 2026-11-20 間取り・担当できる区分（兼任）・検査の予定とボリューム（業者ページ）。足すだけ。何度実行しても同じ
alter table cases add column if not exists madori text default '';
alter table vendors add column if not exists kinds text default '';
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
alter function my_inspections(text,date,date) set search_path = public;
revoke execute on function my_inspections(text,date,date) from public;
grant execute on function my_inspections(text,date,date) to anon, authenticated;
