insert into clients(id,name,full_name) values ('CL1','日本財託','株式会社日本財託管理サービス') on conflict do nothing;
insert into vendors(id,name,full_name,type,def_kind) values ('V1','長沼俊介','長沼俊介','専属','清掃'),('V2','FORCE-ONE','小出貴明','外注','内装') on conflict do nothing;
insert into prices(id,name,kind,unit,price) values ('PR1','クロス貼替','内装','㎡',900) on conflict do nothing;
insert into cases(id,client,prop,kind,st,live,ord,sales,plan,recv) values ('C1302','日本財託','プレール・ドゥーク豊洲Ⅱ 608','清掃　修繕','受注',true,'未',91500,'2026-11-20','K1') on conflict do nothing;
insert into procs(id,case_id,kind,who,start_date,amt) values ('P1','C1302','清掃','長沼俊介','2026-11-15',22000) on conflict do nothing;
insert into inbox(key,case_no,client,prop,net,po_lines) values ('K1','AW-2611-0001','日本財託','プレール・ドゥーク豊洲Ⅱ 608',91500,'[{"name":"完了写真撮影費","qty":1,"unit":"式","price":2000},{"name":"ｸﾛｽ貼替","place":"洋室","qty":8.4,"unit":"㎡","price":1200},{"name":"手元灯交換","place":"キッチン","qty":0,"unit":"式","price":0,"cut":true}]') on conflict do nothing;
