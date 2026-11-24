-- 2026-11-24 見積の段（見積・発注タブの「① 見積」）。足すだけ。何度実行しても同じ
alter table cases add column if not exists est_amt int default 0;        -- 見積金額（税抜）
alter table cases add column if not exists est_date date;                -- 見積の提出日
alter table cases add column if not exists est_file text default '';     -- 見積書のファイル（保存領域 reports の中の場所）
alter table clients add column if not exists est_mode text default '';   -- 見積の作り方：''／依頼元の画面で作る／台帳で作る
