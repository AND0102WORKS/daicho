// 見本の発注書 PDF を作る（文字が入った PDF。依頼元のツールから出したものに近い形）
const {chromium}=require('playwright');
const html=`<html><body style="font-family:sans-serif;font-size:12px;padding:30px"><h2 style="text-align:center">発　注　書</h2>
<p>アンドワークス株式会社 御中　　　　　　　　　発注No. 2026-1123　発注日 2026年11月20日</p><p>物件名：レフィール日本橋本町 602　　工期：2026/11/18〜2026/11/25</p><p>下記のとおり発注いたします。　合計金額 ￥248,314（税込）</p>
<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%"><tr style="background:#eee"><th>No</th><th>場所</th><th>名称</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th><th>備考</th></tr>
<tr><td>1</td><td>LD</td><td>クロス貼替（量産品）</td><td align="right">42.5</td><td>㎡</td><td align="right">1,500</td><td align="right">63,750</td><td>SP-9901</td></tr>
<tr><td>2</td><td>洋室</td><td>床 リペア補修</td><td align="right">1</td><td>式</td><td align="right">25,000</td><td align="right">25,000</td><td></td></tr>
<tr><td>3</td><td>全室</td><td>ルームクリーニング（1LDK）</td><td align="right">1</td><td>式</td><td align="right">45,000</td><td align="right">45,000</td><td>エアコン1台含む</td></tr>
<tr><td>4</td><td>キッチン</td><td>水栓交換</td><td align="right">1</td><td>台</td><td align="right">38,000</td><td align="right">38,000</td><td></td></tr>
<tr><td>5</td><td>玄関</td><td>鍵交換</td><td align="right">1</td><td>個</td><td align="right">18,000</td><td align="right">18,000</td><td></td></tr>
<tr><td>6</td><td></td><td>諸経費</td><td align="right">1</td><td>式</td><td align="right">35,990</td><td align="right">35,990</td><td></td></tr>
<tr><td colspan="6" align="right">小計</td><td align="right">225,740</td><td></td></tr><tr><td colspan="6" align="right">消費税（10%）</td><td align="right">22,574</td><td></td></tr><tr><td colspan="6" align="right">合計</td><td align="right">248,314</td><td></td></tr></table>
<p>備考：鍵はキーボックスにて。</p></body></html>`;
(async()=>{ const b=await chromium.launch(); const p=await b.newPage(); await p.setContent(html); await p.pdf({path:process.argv[2],format:'A4'}); await b.close(); })();
