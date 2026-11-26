import { createHash } from "node:crypto";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const ANON = (process.env.SUPABASE_ANON_KEY || "").trim();


function rpcHeaders(token = "") {
  const headers = { apikey: ANON, "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

async function rpc(name, body, token = "") {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: rpcHeaders(token),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Database error ${response.status}`);
  return data;
}

async function verifyUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Invalid session. Please sign in again.");
  const user = await response.json();
  if (!user.id) throw new Error("Account verification failed.");
  return user.id;
}

async function verifyPlan(key) {
  if (!key) throw new Error("Subscription verification unavailable.");
  const response = await fetch(
    `https://extensionpay.com/extension/snip/api/v2/user?api_key=${encodeURIComponent(key)}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
  );
  if (!response.ok) throw new Error("Subscription verification failed.");
  const user = await response.json();
  if (!user.paid) return "free";
  const name = String(user.plan?.nickname || "").trim().toLowerCase();
  const amount = Number(user.plan?.unitAmountCents || 0);
  const isMonthly = user.plan?.interval === "month" && Number(user.plan?.intervalCount) === 1;
  const isUsd = String(user.plan?.currency || "").toLowerCase() === "usd";
  if (isMonthly && isUsd && amount === 1500 && (!name || name === "unlimited")) return "unlimited";
  if (isMonthly && isUsd && amount === 500 && (!name || name === "pro")) return "pro";
  throw new Error("Unrecognized paid subscription plan.");
}

function installHash(key) {
  return createHash("sha256").update(key).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Snip-ExtensionPay-Key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !ANON) throw new Error("Missing Supabase configuration.");

    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const key = String(req.headers["x-snip-extensionpay-key"] || "");
    const action = String(req.body?.action || "");
    const id = String(req.body?.reservation_id || "");

    if (!["status", "reserve", "commit", "release"].includes(action))
      return res.status(400).json({ error: "Unknown usage action." });

    if (action === "commit" || action === "release") {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return res.status(400).json({ error: "Invalid reservation." });
    }

    if (token) {
      await verifyUser(token);
      const plan = (action === "status" || action === "reserve")
        ? await verifyPlan(key)
        : "free";
      const args = { p_plan: plan };

      if (action === "status" || action === "reserve") {
        const fn = action === "status" ? "snip_api_get_usage" : "snip_api_reserve_usage";
        const result = await rpc(fn, args, token);
        return res.status(200).json({ ...result, plan, authenticated: true });
      }

      const fn = action === "commit" ? "snip_api_commit_usage" : "snip_api_release_usage";
      const result = await rpc(fn, { p_reservation_id: id }, token);
      return res.status(200).json(result);
    }

    if (!key || key.length > 512)
      return res.status(401).json({ error: "Installation identity missing." });

    const hash = installHash(key);
    const args = { p_install_hash: hash };

    if (action === "status" || action === "reserve") {
      const fn = action === "status" ? "snip_api_anon_get_usage" : "snip_api_anon_reserve_usage";
      const result = await rpc(fn, args);
      return res.status(200).json({ ...result, plan: "anonymous", authenticated: false });
    }

    const fn = action === "commit" ? "snip_api_anon_commit_usage" : "snip_api_anon_release_usage";
    const result = await rpc(fn, { p_install_hash: hash, p_reservation_id: id });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Snip usage error:", {
      message: error.message,
      cause: error.cause?.message,
      code: error.cause?.code,
      hostname: (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return "invalid-url"; } })()
    });
    return res.status(503).json({ error: "Usage service unavailable." });
  }
}
