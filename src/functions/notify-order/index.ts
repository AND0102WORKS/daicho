// 発注を業者に知らせる：携帯の通知（業者ページで「通知を受け取る」を押した端末）と、メール（協力業者に登録したアドレス）。
// 呼び出しは台帳（ログインした人）から。POST {order_id}（発注）または {proc_id}（日程の打診）。verify_jwt は切り、下で「呼んだ人の役割」を自分で確かめる（ログインしていなければ役割は none で断る）
//   ・呼んだ人の権限で発注を読めること（RLS）、役割が 管理者／スタッフ であることを確かめる
//   ・鍵は Supabase 側だけ：環境変数、無ければ表 app_secrets（service_role だけが読める）。VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY（携帯の通知）、RESEND_API_KEY / MAIL_FROM（メール。無ければメールは送らない）
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
    const { order_id, proc_id } = await req.json();
    if (!order_id && !proc_id) return json({ ok: false, reason: "no_order" }, 400);
    // 呼んだ人として読む（読めない発注・役割の無い人は断る）
    const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: role } = await me.rpc("my_role");
    if (role !== "hq" && role !== "staff") return json({ ok: false, reason: "forbidden" }, 403);
    // 発注（orders）か、日程の打診（procs。打診中のものだけ）か
    let o: { id: string; org: string; no: string; who: string; case_id: string; start_date: string | null; end_date: string | null; token?: string; kind?: string };
    const isAsk = !order_id;
    if (isAsk) {
      const { data: p } = await me.from("procs").select("id,org,who,kind,ask,case_id,start_date,end_date").eq("id", proc_id).maybeSingle();
      if (!p || p.ask !== "打診中" || !p.who) return json({ ok: false, reason: "not_ready" });
      o = { id: p.id, org: p.org, no: "", who: p.who, case_id: p.case_id, start_date: p.start_date, end_date: p.end_date, kind: p.kind };
    } else {
      const { data: od } = await me.from("orders").select("id,org,no,who,st,token,case_id,start_date,end_date").eq("id", order_id).maybeSingle();
      if (!od) return json({ ok: false, reason: "no_order" }, 404);
      if (od.st === "下書き" || !od.token) return json({ ok: false, reason: "draft" });
      o = od;
    }

    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const sec = async (n: string) => Deno.env.get(n) || ((await db.from("app_secrets").select("value").eq("name", n).maybeSingle()).data?.value as string | undefined) || "";
    const { data: v } = await db.from("vendors").select("id,name,full_name,email,active,token").eq("org", o.org).eq("name", o.who).maybeSingle();
    if (!v || v.active === false) return json({ ok: false, reason: "no_vendor" });
    const { data: c } = await db.from("cases").select("prop").eq("id", o.case_id).maybeSingle();
    const { data: co } = await db.from("settings").select("value").eq("org", o.org).eq("key", "co").maybeSingle();
    const company = (co?.value as { name?: string } | null)?.name || "アンドワークス株式会社";
    const prop = c?.prop || "", term = o.start_date ? md(o.start_date) + (o.end_date && o.end_date !== o.start_date ? "〜" + md(o.end_date) : "") : "";
    const link = isAsk ? `${SITE}me.html?t=${v.token}` : `${SITE}order.html?t=${o.token}`;
    if (isAsk && !v.token) return json({ ok: false, reason: "no_vendor" });
    const log: { org: string; order_id: string; proc_id: string; vendor_id: string; kind: string; ok: boolean; detail: string }[] = [];
    const lid = { order_id: isAsk ? "" : o.id, proc_id: isAsk ? o.id : "" };

    // ---- 携帯の通知 ----
    let pushSent = 0, pushTotal = 0;
    const pub = await sec("VAPID_PUBLIC_KEY"), priv = await sec("VAPID_PRIVATE_KEY");
    if (pub && priv) {
      webpush.setVapidDetails((await sec("VAPID_SUBJECT")) || "mailto:noreply@example.com", pub, priv);
      const { data: subs } = await db.from("vendor_push").select("id,endpoint,p256dh,auth").eq("vendor_id", v.id);
      pushTotal = (subs || []).length;
      const payload = JSON.stringify(isAsk
        ? { title: `${company}：日程のご相談です`, body: `${prop}${term ? "（" + term + "）" : ""} ${o.kind || ""}\n「受けられる／都合が悪い」を押してください`, url: link }
        : { title: `${company}：発注書が届きました`, body: `${prop}${term ? "（" + term + "）" : ""}\n内容を確かめて「承諾」を押してください`, url: link });
      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 * 3 });
          pushSent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode || 0;
          if (code === 404 || code === 410) await db.from("vendor_push").delete().eq("id", s.id);   // もう使われていない端末
        }
      }
      if (pushTotal) log.push({ org: o.org, ...lid, vendor_id: v.id, kind: "push", ok: pushSent > 0, detail: `${pushSent}/${pushTotal}台` });
    }

    // ---- メール ----
    let mail = "not_set";
    const key = await sec("RESEND_API_KEY"), from = await sec("MAIL_FROM");
    if (key && from) {
      if (!v.email) mail = "no_address";
      else {
        const text = (isAsk
          ? [`${v.full_name || v.name} 様`, "", `いつもお世話になっております。${company}です。`, "下記の日程でお願いできるか、リンク先で「受けられる／都合が悪い」を押してください。", "",
            `現場：${prop}`, `作業：${o.kind || ""}`, `日程：${term || "未定"}`, "", `ご返事はこちら：${link}`, "", company]
          : [`${v.full_name || v.name} 様`, "", `いつもお世話になっております。${company}です。`, "下記の工事を発注いたします。リンク先で内容をご確認のうえ、「承諾」を押してください。", "",
            `発注No：${o.no}`, `現場：${prop}`, `工期：${term || "未定"}`, "", `発注書：${link}`, "", company]).join("\n");
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [v.email], subject: isAsk ? `【日程のご相談】${term} ${prop}` : `【発注書】${o.no} ${prop}`, text }) });
        mail = r.ok ? "sent" : "failed";
        log.push({ org: o.org, ...lid, vendor_id: v.id, kind: "mail", ok: r.ok, detail: r.ok ? "" : "HTTP " + r.status });
      }
    }
    if (log.length) await db.from("notify_log").insert(log);
    return json({ ok: true, push: pushSent, pushTotal, mail });
  } catch (e) {
    return json({ ok: false, reason: "failed", detail: String((e as Error)?.message || e).slice(0, 200) }, 500);
  }
});
