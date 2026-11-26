import assert from "node:assert/strict";
import fs from "node:fs";
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
  await summaryHandler({ method, body, headers }, res, { fetchImpl: global.fetch, openAiFetch: global.fetch });
  return res;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
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


test("Executive Brief analyzes the real M&S PDF and cites page-labelled source text", {
  skip: !process.env.SNIP_MS_PDF_PATH
}, async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const pdfBytes = fs.readFileSync(process.env.SNIP_MS_PDF_PATH);
  const calls = [];
  let aiRequest = null;
  global.fetch = async (url, options = {}) => {
    const address = String(url);
    calls.push(address);
    if (address.endsWith("/auth/v1/user")) {
      return jsonResponse({ id: "summary-test-user" });
    }
    if (address.includes("/rest/v1/snip_usage_reservations?")) {
      assert.equal(options.method, "PATCH");
      return jsonResponse([{
        reservation_id: "11111111-1111-4111-8111-111111111111",
        plan: "free"
      }]);
    }
    if (address === "https://example.com/annual-report.pdf") {
      return new Response(pdfBytes, {
        status: 200,
        headers: { "content-type": "application/pdf" }
      });
    }
    if (address === "https://api.openai.com/v1/chat/completions") {
      aiRequest = JSON.parse(options.body);
      return jsonResponse({
        choices: [{ message: { content: "## Executive summary\\nA source-grounded test brief. (PDF p. 1)" } }]
      });
    }
    throw new Error("Unexpected request: " + address);
  };

  const res = await invoke("POST", {
    url: "https://example.com/annual-report.pdf",
    reservation_id: "11111111-1111-4111-8111-111111111111"
  }, { authorization: "Bearer valid-session" });

  assert.equal(res.statusCode, 200);
  assert.match(res.body.brief, /source-grounded test brief/);
  assert.ok(res.body.pageCount > 0);
  assert.ok(res.body.pagesUsed > 0);
  assert.ok(aiRequest);
  assert.match(aiRequest.messages[1].content, /\[PDF page 1\]/);
  assert.ok(calls.includes("https://api.openai.com/v1/chat/completions"));
});
