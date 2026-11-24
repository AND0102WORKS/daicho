// 業者ページ：案件の写真を見る（現地調査など、ほかの人が入れた写真も）。
// 呼び出しは業者ページのリンク（vendors.token）と工程 id。その業者の工程（打診中も含む）の案件の写真だけ返す。
//   POST {token, proc}            → 写真の一覧 {photos:[{id,cat,phase,mine}]}
//   GET  ?t=<token>&p=<proc>&i=<写真 id> → 写真そのもの（画像）
// 写真の場所（path）や期限つきリンクは返さない：場所にはほかの業者のフォルダ名（＝その業者のリンク）が入っているため、画像はここを通して渡す。
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
function client(schema: string | null) {
  const sc = schema === "test" ? "test" : "public";
  return { bucket: sc === "test" ? "reports-test" : "reports",
    db: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: sc }, auth: { persistSession: false } }) };
}
// その業者の、その工程の案件 id（無ければ null）
async function caseOf(db: ReturnType<typeof client>["db"], token: string, proc: string) {
  const { data: v } = await db.from("vendors").select("name").eq("token", token).eq("active", true).maybeSingle();
  if (!v) return null;
  const { data: p } = await db.from("procs").select("case_id").eq("id", proc).eq("who", v.name).maybeSingle();
  return p ? { case_id: p.case_id as string, name: v.name as string } : null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url), t = u.searchParams.get("t") || "", p = u.searchParams.get("p") || "", i = u.searchParams.get("i") || "";
      const { db, bucket } = client(u.searchParams.get("s"));
      const c = t && p && i ? await caseOf(db, t, p) : null;
      if (!c) return new Response("not found", { status: 404, headers: cors });
      const { data: f } = await db.from("photos").select("path").eq("id", i).eq("case_id", c.case_id).maybeSingle();
      if (!f) return new Response("not found", { status: 404, headers: cors });
      const { data: blob } = await db.storage.from(bucket).download(f.path);
      if (!blob) return new Response("not found", { status: 404, headers: cors });
      return new Response(blob, { headers: { ...cors, "Content-Type": blob.type || "image/jpeg", "Cache-Control": "private, max-age=3600" } });
    }
    const { token, proc, schema } = await req.json();
    const { db } = client(schema);
    const c = token && proc ? await caseOf(db, token, proc) : null;
    if (!c) return json({ photos: [] });
    const { data: ph } = await db.from("photos").select("id,cat,phase,who,created_at").eq("case_id", c.case_id).order("created_at").limit(600);
    return json({ photos: (ph || []).map((r) => ({ id: r.id, cat: r.cat, phase: r.phase, mine: r.who === c.name })) });
  } catch (_e) {
    return json({ photos: [], error: "failed" });
  }
});
