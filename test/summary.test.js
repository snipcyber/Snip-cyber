import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

process.env.SUPABASE_URL ||= "https://test.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service";

const { default: summaryHandler } = await import("../api/summary.js");
const originalFetch = global.fetch;
const originalOpenAIKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
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

async function invoke(method, body = {}, headers = {}) {
  const res = response();
  await summaryHandler({ method, body, headers }, res);
  return res;
}

test("Executive Brief supports preflight without contacting upstream services", async () => {
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected network request");
  };

  const res = await invoke("OPTIONS");
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
  assert.equal(fetchCalls, 0);
});

test("Executive Brief rejects unsupported methods", async () => {
  const res = await invoke("GET");
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: "Method not allowed" });
});

test("Executive Brief rejects private PDF URLs before usage or download requests", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected network request");
  };

  const res = await invoke("POST", { url: "http://127.0.0.1/private.pdf" });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "A public PDF URL is required." });
  assert.equal(fetchCalls, 0);
});

test("Executive Brief reports missing OpenAI configuration before claiming usage", async () => {
  delete process.env.OPENAI_API_KEY;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected network request");
  };

  const res = await invoke("POST", { url: "https://example.com/report.pdf" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "Executive Brief is temporarily unavailable." });
  assert.equal(fetchCalls, 0);
});

test("Executive Brief rejects invalid authenticated reservations before downloading a PDF", async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ message: "Invalid token" }), { status: 401 });
    }
    throw new Error("PDF download must not occur");
  };

  const res = await invoke("POST", {
    url: "https://example.com/report.pdf",
    reservation_id: "11111111-1111-4111-8111-111111111111"
  }, { authorization: "Bearer invalid-session" });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Invalid session." });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/auth\/v1\/user$/);
});
