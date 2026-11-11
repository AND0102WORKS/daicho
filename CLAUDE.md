# Aチーム統合台帳 v4（アンドワークス株式会社）

原状回復工事チームの 受注→工程→発注→完工→請求 を1画面で回す台帳。データは Supabase（PostgreSQL）、画面は静的HTML（GitHub Pages）。

## 置き場
- `docs/index.html` … 台帳本体（スタッフ用。メールのリンクでログイン）。**build4.py が生成する。直接編集しない**
- `docs/me.html` … 職人用スマホページ（`?t=<vendors.token>`）
- `docs/order.html` … 業者用の発注書・承諾ページ（`?t=<orders.token>`）
- `src/app3.src.html` … 画面コード（CSS+JS 一体。ここを直す）
- `src/store4.js` … 保存層（Supabase の読み書き・Realtime・ログイン）
- `src/build4.py` … `app3.src.html` + `store4.js` + `config.json` → `docs/index.html`
- `src/schema.sql` … DB の表・権限（RLS）・関数。変更は Supabase の migration として適用する
- `src/config.json` … Supabase の URL と公開キー（anon/publishable）。秘密鍵は置かない
- `test/` … 手元の PostgreSQL ＋ supabase-js もどきで動かすテスト（Playwright）

## 直し方
1. `src/app3.src.html` または `src/store4.js` を直す
2. `python3 src/build4.py` で `docs/index.html` を作り直す
3. `cd test && ./reset.sh && node run.js`（台帳）／`node pages.js`（職人・業者ページ）が通ること
4. commit → push。GitHub Pages（`docs/`）が数十秒で更新される
5. DB の表を変えるときは `src/schema.sql` を直し、同じ SQL を Supabase の migration として適用（Claude の Supabase コネクタ `apply_migration`、または SQL Editor）

## 設計の約束
- すべての表に `org`（所属：hq＝本部、fc_a..fc_d）。本部版では全行 `hq`。後でフランチャイズを統合する前提
- 権限は RLS：`profiles.role` が `hq` なら全部、`staff` は自分の org の読み書き、`viewer` は閲覧
- JS の項目名と列名の対応は `store4.js` の `TABLES`（case→case_id、order→order_id、date→start_date、end→end_date など）
- 保存は「変わった行だけ upsert、消えた行は delete」。合流・墓標・箱分けは無い（v3 の不具合の元だった）
- 職人・業者は ログイン無し、トークン付きURL＋ `security definer` の RPC だけで読む
- id は既存の文字列 id（C1302 / P00012 / L284-c8d …）を維持。発注番号 AW-H は `next_no()` で採番

## やってはいけないこと
- `docs/index.html` を直接編集（build で消える）
- Supabase の service_role キーをリポジトリや画面に置く
- 年次案件管理 v2（Googleスプレッドシート）への書き込み
- 個人名・口座情報をコードに埋め込む（マスタはDBから読む）

## 関連
- Artifact 版（v3、読み取り専用で残す）：claude.ai/artifact/EA7nuvuABJHoFUWbEk8Tyf
- 構成図：claude.ai/artifact/LTP17PKP78dGJMi4P6buRz
- 仕様・修正ログ：claude.ai プロジェクト「アンドワークス(ナレッジ)」の claude/38
