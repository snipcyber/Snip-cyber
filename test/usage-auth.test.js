import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

process.env.SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "sb_secret_test-key";

const { verifyUsageReservation, usageReservationServiceHeaders } = await import("../api/usage-auth.js");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const reservationId = "11111111-1111-4111-8111-111111111111";

test("modern Supabase secret keys are not sent as Bearer JWTs when claiming reservations", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-123" }), { status: 200 });
    }
    return new Response(JSON.stringify([{ reservation_id: reservationId, plan: "pro" }]), { status: 200 });
  };

  const result = await verifyUsageReservation({
    headers: { authorization: "Bearer user-session" },
    body: { reservation_id: reservationId }
  });

  assert.deepEqual(result, { ok: true, reservationId, plan: "pro" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer user-session");
  const claim = calls[1].options;
  assert.equal(claim.method, "PATCH");
  assert.equal(claim.headers.apikey, "sb_secret_test-key");
  assert.equal("Authorization" in claim.headers, false);
  assert.deepEqual(JSON.parse(claim.body), { status: "processing" });
});

test("legacy service-role JWTs retain Bearer authentication for reservation claims", () => {
  assert.deepEqual(usageReservationServiceHeaders("legacy-service-role-jwt"), {
    apikey: "legacy-service-role-jwt",
    "Content-Type": "application/json",
    Prefer: "return=representation",
    Authorization: "Bearer legacy-service-role-jwt"
  });
});

test("modern secret-key reservation headers omit Authorization", () => {
  assert.deepEqual(usageReservationServiceHeaders("sb_secret_example"), {
    apikey: "sb_secret_example",
    "Content-Type": "application/json",
    Prefer: "return=representation"
  });
});
