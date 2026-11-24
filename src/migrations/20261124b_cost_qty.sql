-- 2026-11-24 原価にも数量・単位（発注書・業者ページは原価の数量・単位で出す）。足すだけ。何度実行しても同じ
alter table lines add column if not exists cost_qty numeric;
alter table lines add column if not exists cost_unit text default '';
create or replace function order_view(p_token text)
returns table(order_no text, who text, kind text, start_date date, end_date date, due date, naiyo text, memo text, st text, accepted_at timestamptz,
              prop text, addr text, client text, lines jsonb, plan date, procs jsonb, key_info text, taxable boolean)
language sql security definer stable as $$
  select o.no, o.who, o.kind, o.start_date, o.end_date, o.due, o.naiyo, o.memo, o.st, o.accepted_at, c.prop, c.addr, c.client,
    (select jsonb_agg(jsonb_build_object('name',l.name,'spec',l.spec,'qty',coalesce(l.cost_qty,l.qty),'unit',coalesce(nullif(l.cost_unit,''),l.unit),'price',l.price,'memo',l.memo) order by l.no) from lines l where l.order_id=o.id),
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
    and not exists (select 1 from vendors v where v.name=o.who and not v.active) $$;
alter function order_view(text) set search_path = public;
create or replace function my_orders(p_token text)
returns table(order_no text, order_token text, prop text, client text, kind text, start_date date, end_date date, due date,
              st text, accepted_at timestamptz, amount numeric, taxable boolean, sent timestamptz)
language sql security definer stable as $$
  select o.no, o.token, c.prop, c.client, o.kind, o.start_date, o.end_date, o.due, o.st, o.accepted_at,
    coalesce((select sum(round(coalesce(l.cost_qty,l.qty,0)*coalesce(l.price,0))) from lines l where l.order_id=o.id),0),
    coalesce(o.taxable,true), o.sent
  from vendors v join orders o on o.who=v.name join cases c on c.id=o.case_id
  where v.token=p_token and v.active and o.st in ('送付済','承諾','完了','請求済')
  order by case o.st when '送付済' then 0 when '承諾' then 1 else 2 end, o.start_date nulls last, o.no $$;
alter function my_orders(text) set search_path = public;
