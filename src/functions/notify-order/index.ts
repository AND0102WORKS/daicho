// 発注を業者に知らせる：携帯の通知（業者ページで「通知を受け取る」を押した端末）と、メール（協力業者に登録したアドレス）。
// 呼び出しは台帳（ログインした人）から。POST {order_id}
//   ・呼んだ人の権限で発注を読めること（RLS）、役割が 管理者／スタッフ であることを確かめる
//   ・鍵は Supabase 側の環境変数だけ：VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY（携帯の通知）、RESEND_API_KEY / MAIL_FROM（メール。無ければメールは送らない）
//   ・結果は notify_log に残す（台帳の発注書に「いつ・何で知らせたか」を出すため）
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const SITE = (Deno.env.get("SITE_URL") || "https://and0102works.github.io/daicho/").replace(/\/?$/, "/");
const md = (d: string | null) => (d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") || "";
    const { order_id } = await req.json();
    if (!order_id) return json({ ok: false, reason: "no_order" }, 400);
    // 呼んだ人として読む（読めない発注・役割の無い人は断る）
    const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: role } = await me.rpc("my_role");
    if (role !== "hq" && role !== "staff") return json({ ok: false, reason: "forbidden" }, 403);
    const { data: o } = await me.from("orders").select("id,org,no,who,st,token,case_id,start_date,end_date").eq("id", order_id).maybeSingle();
    if (!o) return json({ ok: false, reason: "no_order" }, 404);
    if (o.st === "下書き" || !o.token) return json({ ok: false, reason: "draft" });

    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: v } = await db.from("vendors").select("id,name,full_name,email,active").eq("org", o.org).eq("name", o.who).maybeSingle();
    if (!v || v.active === false) return json({ ok: false, reason: "no_vendor" });
    const { data: c } = await db.from("cases").select("prop").eq("id", o.case_id).maybeSingle();
    const { data: co } = await db.from("settings").select("value").eq("org", o.org).eq("key", "co").maybeSingle();
    const company = (co?.value as { name?: string } | null)?.name || "アンドワークス株式会社";
    const prop = c?.prop || "", term = o.start_date ? md(o.start_date) + (o.end_date && o.end_date !== o.start_date ? "〜" + md(o.end_date) : "") : "";
    const link = `${SITE}order.html?t=${o.token}`;
    const log: { org: string; order_id: string; vendor_id: string; kind: string; ok: boolean; detail: string }[] = [];

    // ---- 携帯の通知 ----
    let pushSent = 0, pushTotal = 0;
    const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
    if (pub && priv) {
      webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:noreply@example.com", pub, priv);
      const { data: subs } = await db.from("vendor_push").select("id,endpoint,p256dh,auth").eq("vendor_id", v.id);
      pushTotal = (subs || []).length;
      const payload = JSON.stringify({ title: `${company}：発注書が届きました`, body: `${prop}${term ? "（" + term + "）" : ""}\n内容を確かめて「承諾」を押してください`, url: link });
      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 * 3 });
          pushSent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode || 0;
          if (code === 404 || code === 410) await db.from("vendor_push").delete().eq("id", s.id);   // もう使われていない端末
        }
      }
      if (pushTotal) log.push({ org: o.org, order_id: o.id, vendor_id: v.id, kind: "push", ok: pushSent > 0, detail: `${pushSent}/${pushTotal}台` });
    }

    // ---- メール ----
    let mail = "not_set";
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("MAIL_FROM");
    if (key && from) {
      if (!v.email) mail = "no_address";
      else {
        const text = [`${v.full_name || v.name} 様`, "", `いつもお世話になっております。${company}です。`, "下記の工事を発注いたします。リンク先で内容をご確認のうえ、「承諾」を押してください。", "",
          `発注No：${o.no}`, `現場：${prop}`, `工期：${term || "未定"}`, "", `発注書：${link}`, "", company].join("\n");
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [v.email], subject: `【発注書】${o.no} ${prop}`, text }) });
        mail = r.ok ? "sent" : "failed";
        log.push({ org: o.org, order_id: o.id, vendor_id: v.id, kind: "mail", ok: r.ok, detail: r.ok ? "" : "HTTP " + r.status });
      }
    }
    if (log.length) await db.from("notify_log").insert(log);
    return json({ ok: true, push: pushSent, pushTotal, mail });
  } catch (_e) {
    return json({ ok: false, reason: "failed" }, 500);
  }
});
