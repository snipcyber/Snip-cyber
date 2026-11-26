export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const url = (process.env.SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return res.status(503).json({ ok: false, error: "Supabase public configuration missing" });
  try {
    const response = await fetch(url + "/rest/v1/rpc/snip_api_anon_get_usage", {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_install_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
    });
    const body = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : 502).json({ ok: response.ok, status: response.status, result: body });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error.message });
  }
}