# Aチーム統合台帳 v4（Supabase 版）

- `site/index.html` … 台帳本体（スタッフ用。メールのリンクでログイン）
- `site/me.html` … 職人用（自分の工程。`?t=<vendors.token>`）
- `site/order.html` … 業者用の発注書・承諾（`?t=<orders.token>`）
- `schema.sql` … Supabase（PostgreSQL）の表・権限・関数
- `store4.js` … 台帳の保存層。`build4.py` が v3 の画面コードと合わせて `site/index.html` を組み立てる
- `config.json` … `{ "url": "https://xxxx.supabase.co", "anon": "<anon key>" }`（公開キー。秘密鍵は置かない）

## 作り直し方
```
python3 build4.py     # ../v3/app3.src.html + store4.js + config.json → site/index.html
```
## テスト（手元の PostgreSQL で）
```
cd test && ./reset.sh && node run.js      # 台帳：読み込み→編集→取り込み→発注→再読み込み
cd test && node pages.js                  # 職人ページ・業者ページ
```
