-- 2026-11-26 試験運用の前の直し：発注書の鍵情報・下書きの発注書・承諾の取り消し（関数の置き換えとトリガの追加のみ）
-- 1) 発注書ページの鍵情報は、工程と同じく「作業日の3日前〜終了の翌日」だけ出す（今までは、いつでも出ていた）
create or replace function order_view(p_token text)
returns table(order_no text, who text, kind text, start_date date, end_date date, due date, naiyo text, memo text, st text, accepted_at timestamptz,
              prop text, addr text, client text, lines jsonb, plan date, procs jsonb, key_info text, taxable boolean)
language sql security definer stable set search_path = public as $$
  select o.no, o.who, o.kind, o.start_date, o.end_date, o.due, o.naiyo, o.memo, o.st, o.accepted_at, c.prop, c.addr, c.client,
    (select jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',coalesce(l.cost_qty,l.qty),'unit',coalesce(nullif(l.cost_unit,''),l.unit),'price',l.price,'memo',l.memo) order by l.no) from lines l where l.order_id=o.id),
    c.plan,
    (select jsonb_agg(jsonb_build_object('kind',p.kind,'start_date',p.start_date,'end_date',p.end_date,'prog',p.prog,
        'mine',(p.order_id=o.id or p.id=o.proc_id),
        'naiyo',(select o2.naiyo from orders o2 where o2.id=p.order_id and p.order_id<>''),
        'items',(select jsonb_agg(trim(coalesce(l.spec,'')||' '||l.name) order by l.no, l.id) from lines l
                 where l.case_id=p.case_id and l.kind=p.kind and p.kind<>'' and not l.cut and l.qty>0)
      ) order by p.start_date nulls last, p.id) from procs p where p.case_id=o.case_id),
    case when coalesce(c.key_info,'')='' then ''
         when o.start_date is not null and (now() at time zone 'Asia/Tokyo')::date between o.start_date-3 and coalesce(o.end_date,o.start_date)+1 then c.key_info
         else '（作業日の3日前から表示されます）' end,
    coalesce(o.taxable,true)
  from orders o join cases c on c.id=o.case_id where o.token=p_token
    and not exists (select 1 from vendors v where v.name=o.who and not v.active) $$;
-- 2) 業者ページ：下書きの発注書のリンクは渡さない（送る前の発注書を、業者ページから開けないように）
create or replace function my_job_orders(p_token text)
returns table(proc_id text, order_no text, order_token text, order_st text)
language sql security definer stable set search_path = public as $$
  select p.id, o.no, case when o.st='下書き' then null else o.token end, o.st
  from vendors v join procs p on p.who=v.name join orders o on o.id=p.order_id and p.order_id<>''
  where v.token=p_token and v.active and o.who=v.name $$;
-- 3) 発注の状態が 下書き・送付済 に戻ったら、承諾の記録を消す（承諾後に中身を変えたとき、台帳が 送付済 に戻す）
create or replace function order_unaccept() returns trigger language plpgsql set search_path = public as $$
begin
  if new.st in ('下書き','送付済') and old.st not in ('下書き','送付済') then new.accepted_at := null; new.accepted_by := ''; end if;
  return new;
end $$;
drop trigger if exists order_unaccept on orders;
create trigger order_unaccept before update on orders for each row execute function order_unaccept();
revoke execute on function order_unaccept() from public, anon, authenticated;
