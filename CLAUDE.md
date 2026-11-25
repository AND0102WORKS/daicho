# ワークス台帳 v4（アンドワークス株式会社）　※旧称：Aチーム統合台帳

原状回復工事チームの 受注→工程→発注→完工→請求 を1画面で回す台帳。データは Supabase（PostgreSQL）、画面は静的HTML（GitHub Pages）。

## 置き場
- `docs/index.html` … 台帳本体（スタッフ用。メールのリンクでログイン）。**build4.py が生成する。直接編集しない**
- `docs/me.html` … 業者・職人用スマホページ（`?t=<vendors.token>`）。発注の一覧・工程・完了報告・請求
- `docs/order.html` … 業者用の発注書・承諾ページ（`?t=<orders.token>`）
- `src/app3.src.html` … 画面コード（CSS+JS 一体。ここを直す）
- `src/store4.js` … 保存層（Supabase の読み書き・Realtime・ログイン）
- `src/build4.py` … `app3.src.html` + `store4.js` + `config.json` → `docs/index.html`
- `src/schema.sql` … DB の表・権限（RLS）・関数。変更は Supabase の migration として適用する
- `src/functions/case-photos/` … 業者ページに案件の写真を渡す Edge Function（Supabase に deploy。service_role は Supabase 側の環境変数だけ。verify_jwt は切り、vendors.token で確かめる）
- `docs/vendor/` … 発注書・見積書をブラウザの中だけで読む部品（外に送らない）。`pdfjs/`＝PDF の文字（pdf.js 3.11.174・日本語用 cmaps つき）、`xlsx/`＝Excel・CSV（SheetJS 0.18.5）、`tesseract/`＝写真・スキャンの OCR（tesseract.js 5.1.1＋日本語データ）。いずれも Apache-2.0
- `src/config.json` … Supabase の URL と公開キー（anon/publishable）。秘密鍵は置かない
- `test/` … 手元の PostgreSQL ＋ supabase-js もどきで動かすテスト（Playwright）
- `docs/test/` … **テスト用の台帳・業者ページ・発注書**（https://and0102works.github.io/daicho/test/）。同じ Supabase の中の別の棚（schema `test`）を見る。写真は `reports-test`。ログインの人と役割は本番と共通（`test.profiles` は `public.profiles` の view）
  - 2026-11-21 時点で固定。**今後の本番の直しはテスト用には入れない**（北村さんの指示）。`build4.py` は `docs/test/` に触らない
  - 作り直すときだけ：`python3 src/make_test_schema.py`（→ `src/test_schema.sql`）、`python3 src/make_test_pages.py`（→ `docs/test/`）
  - 手元でテスト用を試す：`FAKESB_SCHEMA=test node run.js` など（DB の search_path を test にしておく）

## 直し方
1. `src/app3.src.html` または `src/store4.js` を直す
2. `python3 src/build4.py` で `docs/index.html` を作り直す
3. `cd test && ./reset.sh && node run.js`（台帳）／`node pages.js`（業者ページ・発注書）／`node report.js`（完了報告〜請求）／`node ask.js`（日程の打診）／`node fix5.js`（新しい案件・発注書の確認・業者ページの発注書リンク・再読み込み）／`node hide.js`（今までの案件を隠す）／`node est.js`（見積の段）／`node modes.js`（明細の表の切り替え・原価の数量と単位）／`node drag.js`（明細の行の並べ替え）／`node kfocus.js`（区分のボタンで工程を足す）／`node site.js`（住所・鍵情報）／`node info.js`（業者ページの案件の詳細・写真）／`node cpage.js`（案件ページのタブ）／`node e2e.js`（新しい案件から請求書までの通し）／`node pdf.js`（発注書の読み取り：PDF・Excel・写真）／`node fix6.js`（洗い出しの直し：取り直し・発注済みの工程・追加金額・受注額・元に戻す・登録の無いメール）／`node pl.js`（月次：損益の表・月の案件・粗利率の低い案件・科目の編集）が通ること。テストごとに `./reset.sh` からやり直す。まとめて流すなら `./all.sh`
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
