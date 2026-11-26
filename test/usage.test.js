import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { afterEach } from "node:test";

process.env.SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service";

const { default: usageHandler } = await import("../api/usage.js");
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

async function invoke(body, headers = {}) {
  const res = response();
  await usageHandler({ method: "POST", body, headers }, res);
  return res;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("anonymous usage status hashes the installation key before calling Supabase", async () => {
  const key = "snip-installation-test";
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ ok: true, used: 2, limit: 10, remaining: 8 });
  };

  const res = await invoke({ action: "status" }, {
    "x-snip-extensionpay-key": key
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.plan, "anonymous");
  assert.equal(res.body.authenticated, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpc\/snip_anon_get_usage$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_install_hash: createHash("sha256").update(key).digest("hex")
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-service");
});

test("authenticated Pro reservation verifies the session and ExtensionPay plan", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({ url: address, options });
    if (address.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-123" });
    if (address.includes("extensionpay.com")) {
      return jsonResponse({ paid: true, plan: { nickname: "Pro", unitAmountCents: 500, currency: "usd", interval: "month", intervalCount: 1 } });
    }
    return jsonResponse({ ok: true, reservation_id: "reservation-123", used: 1, limit: 500 });
  };

  const res = await invoke({ action: "reserve" }, {
    authorization: "Bearer valid-session",
    "x-snip-extensionpay-key": "extensionpay-key"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.plan, "pro");
  assert.equal(res.body.authenticated, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/auth\/v1\/user$/);
  assert.match(calls[1].url, /extensionpay\.com\/extension\/snip\/api\/v2\/user/);
  assert.match(calls[2].url, /rpc\/snip_reserve_usage$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    p_user_id: "user-123",
    p_plan: "pro"
  });
});

test("authenticated Unlimited reservation maps the $15 plan to unlimited", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push(address);
    if (address.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-456" });
    if (address.includes("extensionpay.com")) {
      return jsonResponse({ paid: true, plan: { nickname: "Unlimited", unitAmountCents: 1500, currency: "usd", interval: "month", intervalCount: 1 } });
    }
    return jsonResponse({ ok: true, reservation_id: "reservation-456" });
  };

  const res = await invoke({ action: "reserve" }, {
    authorization: "Bearer valid-session",
    "x-snip-extensionpay-key": "extensionpay-key"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.plan, "unlimited");
  assert.equal(calls.length, 3);
});

test("authenticated commit does not re-check the subscription and scopes the RPC to the user", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push({ url: address, options });
    if (address.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-789" });
    return jsonResponse({ ok: true, status: "committed" });
  };

  const res = await invoke({ action: "commit", reservation_id: "11111111-1111-4111-8111-111111111111" }, {
    authorization: "Bearer valid-session",
    "x-snip-extensionpay-key": "extensionpay-key"
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /rpc\/snip_commit_usage$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    p_user_id: "user-789",
    p_reservation_id: "11111111-1111-4111-8111-111111111111"
  });
});

test("unknown paid ExtensionPay plans fail closed without creating a reservation", async () => {
  const calls = [];
  global.fetch = async url => {
    const address = String(url);
    calls.push(address);
    if (address.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-unknown" });
    return jsonResponse({ paid: true, plan: { nickname: "Legacy plan", unitAmountCents: 999 } });
  };

  const res = await invoke({ action: "reserve" }, {
    authorization: "Bearer valid-session",
    "x-snip-extensionpay-key": "extensionpay-key"
  });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Usage service unavailable." });
  assert.equal(calls.length, 2);
});

test("yearly and one-time plans fail closed even when their nickname and price match", async () => {
  for (const interval of ["year", "once"]) {
    const calls = [];
    global.fetch = async url => {
      const address = String(url);
      calls.push(address);
      if (address.endsWith("/auth/v1/user")) return jsonResponse({ id: "user-nonmonthly" });
      return jsonResponse({
        paid: true,
        plan: { nickname: "Pro", unitAmountCents: 500, currency: "usd", interval, intervalCount: interval === "once" ? null : 1 }
      });
    };

    const res = await invoke({ action: "reserve" }, {
      authorization: "Bearer valid-session",
      "x-snip-extensionpay-key": "extensionpay-key"
    });

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: "Usage service unavailable." });
    assert.equal(calls.length, 2, "must reject before creating a reservation");
  }
});

test("anonymous usage requires an installation identity and rejects unknown actions", async () => {
  global.fetch = async () => {
    throw new Error("fetch must not run");
  };

  const missingKey = await invoke({ action: "status" });
  assert.equal(missingKey.statusCode, 401);

  const unknownAction = await invoke({ action: "delete" }, {
    "x-snip-extensionpay-key": "snip-installation-test"
  });
  assert.equal(unknownAction.statusCode, 400);
});
