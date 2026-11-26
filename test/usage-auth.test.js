import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { afterEach } from "node:test";

process.env.SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";

const { verifyUsageReservation } = await import("../api/usage-auth.js");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const reservationId = "11111111-1111-4111-8111-111111111111";
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }

test("authenticated reservation claim uses anon key and caller session", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return json({ id: "user-123" });
    return json({ ok: true, reservation_id: reservationId, plan: "pro" });
  };
  const result = await verifyUsageReservation({ headers: { authorization: "Bearer user-session" }, body: { reservation_id: reservationId } });
  assert.deepEqual(result, { ok: true, reservationId, plan: "pro" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://test.supabase.co/rest/v1/rpc/snip_api_claim_usage_reservation");
  assert.equal(calls[1].options.headers.apikey, "test-anon");
  assert.equal(calls[1].options.headers.Authorization, "Bearer user-session");
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_reservation_id: reservationId, p_install_hash: null });
});

test("anonymous reservation claim sends hashed installation identity", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), options }); return json({ ok: true, reservation_id: reservationId, plan: "free" }); };
  const key = "install-secret";
  const result = await verifyUsageReservation({ headers: { "x-snip-extensionpay-key": key }, body: { reservation_id: reservationId } });
  assert.deepEqual(result, { ok: true, reservationId, plan: "free" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.apikey, "test-anon");
  assert.equal("Authorization" in calls[0].options.headers, false);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_reservation_id: reservationId, p_install_hash: createHash("sha256").update(key).digest("hex") });
});

test("invalid or expired claims fail closed", async () => {
  globalThis.fetch = async () => json({ ok: false });
  const result = await verifyUsageReservation({ headers: { "x-snip-extensionpay-key": "install-secret" }, body: { reservation_id: reservationId } });
  assert.deepEqual(result, { ok: false, status: 403, error: "Reservation invalid or expired." });
});

test("invalid sessions are rejected before claiming", async () => {
  globalThis.fetch = async () => json({ error: "invalid token" }, 401);
  const result = await verifyUsageReservation({ headers: { authorization: "Bearer expired" }, body: { reservation_id: reservationId } });
  assert.deepEqual(result, { ok: false, status: 401, error: "Invalid session." });
});