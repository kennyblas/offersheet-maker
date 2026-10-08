// offersheet-lookup — READ-ONLY lookup of o2i rows by tracking code.
// Deployed to the o2i Supabase project (chebtjqheqnrnjgbixza) as an Edge Function (verify_jwt: false).
// Only SELECTs. Caller must be signed in (o2i project's Google login) with a company email.
const DOMAIN = "@usawholesalesupplies.com";
const ALLOWED_ORIGINS = ["https://kennyblas.github.io"];
const DB_URL = Deno.env.get("SUPABASE_URL")!;
const DB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type, x-user-token, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (b: unknown, s: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...h, "Content-Type": "application/json" } });

async function get(table: string, select: string, col: string, vals: (string | number)[]) {
  if (!vals.length) return [];
  const list = vals.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",");
  const url = `${DB_URL}/rest/v1/${table}?select=${select}&${col}=in.(${encodeURIComponent(list)})`;
  const r = await fetch(url, { headers: { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}` } });
  if (!r.ok) throw new Error(`${table}: ${r.status}`);
  return await r.json();
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin") || "");
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, h);

  // 1) Verify the signed-in user (o2i project's own login)
  const token = req.headers.get("x-user-token") || "";
  if (!token) return json({ error: "Not signed in" }, 401, h);
  const u = await fetch(`${DB_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return json({ error: "Session expired — sign in again" }, 401, h);
  const user = await u.json();
  if (!String(user?.email || "").toLowerCase().endsWith(DOMAIN)) return json({ error: "Company email required" }, 403, h);

  // 2) Read-only lookups
  let body: { codes?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : [])
    .map((c) => String(c).trim()).filter((c) => /^[A-Za-z0-9_\-]{1,60}$/.test(c)))].slice(0, 1000);
  if (!codes.length) return json({ error: "No valid tracking codes" }, 400, h);

  try {
    const raw = await get("raw_info",
      "tracking_code,asin,brand,upc,unit_price,bundle_size,order_quantity,profit,roi,target_sell_price,distributor_id,distributor_dc",
      "tracking_code", codes);
    const alloc = await get("product_allocation", "tracking_code,store_id", "tracking_code", codes);
    const stores = await get("store_info", "store_id,store_code", "store_id",
      [...new Set(alloc.map((a: any) => a.store_id).filter((x: any) => x != null))]);
    const dists = await get("distributor_info", "id,distributor_name", "id",
      [...new Set(raw.map((r: any) => r.distributor_id).filter((x: any) => x != null))]);
    const storeById = Object.fromEntries(stores.map((s: any) => [s.store_id, s.store_code]));
    const distById = Object.fromEntries(dists.map((d: any) => [d.id, d.distributor_name]));
    const allocBy: Record<string, string[]> = {};
    alloc.forEach((a: any) => { (allocBy[a.tracking_code] ||= []).push(storeById[a.store_id] ?? ""); });

    const rows: unknown[] = [];
    for (const r of raw) {
      const storeCodes = allocBy[r.tracking_code]?.length ? allocBy[r.tracking_code] : [""];
      const base = String(distById[r.distributor_id] ?? "").trim();
      const dc = String(r.distributor_dc ?? "").trim();
      const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();
      // Add the DC (e.g. "Kehe" + "DC27" -> "Kehe DC27") unless the name already contains it.
      const distName = dc && !squash(base).includes(squash(dc)) ? (base ? base + " " + dc : dc) : base;
      for (const sc of storeCodes) rows.push({ ...r, store_code: sc, distributor_name: distName });
    }
    const found = new Set(raw.map((r: any) => r.tracking_code));
    return json({ rows, missing: codes.filter((c) => !found.has(c)) }, 200, h);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500, h);
  }
});
